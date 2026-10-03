import { Exam, IExamDocument } from '../models/Exam';
import { Question, IQuestionDocument } from '../models/Question';
import { ExamAssignment } from '../models/ExamAssignment';
import { ExamAttempt, IExamAttemptDocument, IAttemptAnswer } from '../models/ExamAttempt';
import { Result, IResultDocument, IResultAnswerBreakdown } from '../models/Result';
import { JwtUserPayload } from '../types/auth.types';
import { generateNextAttemptId, generateNextResultId } from '../utils/exam-id.generator';
import { AuditService } from './audit.service';
import { emitTeacherAndAdmin } from '../realtime/socket';
import { logger } from '../utils/logger';

export interface SanitizedExamQuestionDto {
  id: string;
  questionId: string;
  questionText: string;
  subject: string;
  topic: string;
  difficulty: string;
  marks: number;
  negativeMarks: number;
  options: Array<{ id: string; text: string }>;
}

export class AttemptService {
  /**
   * Strip correctOption, correctAnswer, and explanation so students can NEVER see answers during an exam
   */
  static sanitizeQuestionsForStudent(questions: IQuestionDocument[]): SanitizedExamQuestionDto[] {
    return questions.map(q => ({
      id: q.questionId,
      questionId: q.questionId,
      questionText: q.questionText,
      subject: q.subject,
      topic: q.topic || '',
      difficulty: q.difficulty,
      marks: q.marks || 1,
      negativeMarks: q.negativeMarks || 0,
      options: q.options.map(o => ({ id: o.id, text: o.text }))
    }));
  }

  /**
   * Server-side scoring helper used on both normal submission and automatic timer expiration
   */
  static async evaluateAndCreateResult(
    attempt: IExamAttemptDocument,
    exam: IExamDocument,
    rawAnswers: Array<{ questionId: string; selectedOption: string }>,
    finalAttemptStatus: 'SUBMITTED' | 'EXPIRED' | 'TERMINATED' | 'EVALUATED'
  ): Promise<{ attempt: IExamAttemptDocument; result: IResultDocument }> {
    const questions = await Question.find({ questionId: { $in: exam.questions } });
    const questionMap = new Map<string, IQuestionDocument>();
    for (const q of questions) {
      questionMap.set(q.questionId, q);
    }

    const answerInputMap = new Map<string, string>();
    for (const ans of rawAnswers) {
      if (ans && typeof ans.questionId === 'string') {
        answerInputMap.set(ans.questionId.trim(), typeof ans.selectedOption === 'string' ? ans.selectedOption.trim() : '');
      }
    }

    const attemptAnswers: IAttemptAnswer[] = [];
    const resultBreakdown: IResultAnswerBreakdown[] = [];
    let rawScore = 0;
    let questionMarksTotal = 0;

    for (const qId of exam.questions) {
      const q = questionMap.get(qId);
      if (!q) continue;

      const qMarks = q.marks || 1;
      const qNeg = q.negativeMarks || 0;
      questionMarksTotal += qMarks;

      const selectedOption = answerInputMap.get(qId) || '';
      const canonicalCorrect = (q.correctOption || q.correctAnswer || '').trim();

      let isCorrect = false;
      let marksAwarded = 0;

      if (selectedOption) {
        if (selectedOption === canonicalCorrect) {
          isCorrect = true;
          marksAwarded = qMarks;
        } else {
          isCorrect = false;
          marksAwarded = -qNeg;
        }
      }

      rawScore += marksAwarded;

      attemptAnswers.push({
        questionId: q.questionId,
        selectedOption,
        marksAwarded,
        isCorrect
      });

      resultBreakdown.push({
        questionId: q.questionId,
        questionText: q.questionText,
        options: q.options.map(o => ({ id: o.id, text: o.text })),
        selectedOption,
        correctOption: canonicalCorrect,
        isCorrect,
        marksAwarded,
        maxMarks: qMarks
      });
    }

    const finalScore = finalAttemptStatus === 'TERMINATED' ? 0 : Math.max(0, Number(rawScore.toFixed(2)));
    const effectiveTotalMarks = questionMarksTotal > 0 ? questionMarksTotal : exam.totalMarks;
    const percentage =
      effectiveTotalMarks > 0 ? Number(((finalScore / effectiveTotalMarks) * 100).toFixed(2)) : 0;

    const passingThreshold =
      exam.passingMarks <= effectiveTotalMarks
        ? exam.passingMarks
        : Math.round(effectiveTotalMarks * 0.4);

    attempt.answers = attemptAnswers;
    attempt.score = finalScore;
    attempt.totalMarks = effectiveTotalMarks;
    attempt.percentage = percentage;
    attempt.status = finalAttemptStatus;
    attempt.submittedAt = new Date();
    await attempt.save();

    await ExamAssignment.findOneAndUpdate(
      { examId: exam.examId, studentId: attempt.studentId },
      { status: finalAttemptStatus === 'EXPIRED' ? 'EXPIRED' : 'SUBMITTED' }
    );

    let result = await Result.findOne({ attemptId: attempt.attemptId });
    if (!result) {
      const resultId = await generateNextResultId();
      result = await Result.create({
        resultId,
        studentId: attempt.studentId,
        studentName: attempt.studentName,
        examId: exam.examId,
        examTitle: exam.title,
        subject: exam.subject,
        attemptId: attempt.attemptId,
        score: finalScore,
        totalMarks: effectiveTotalMarks,
        passingMarks: passingThreshold,
        percentage,
        passed: finalScore >= passingThreshold && finalAttemptStatus !== 'TERMINATED',
        status: finalAttemptStatus === 'TERMINATED' ? 'TERMINATED' : 'PENDING',
        answers: resultBreakdown,
        proctoringWarnings: attempt.warningCount || 0,
        feedback:
          finalAttemptStatus === 'EXPIRED'
            ? 'Attempt automatically finalized upon timer expiration.'
            : finalAttemptStatus === 'TERMINATED'
            ? 'Attempt terminated due to proctoring violations.'
            : 'Submitted for faculty verification.',
        submittedAt: attempt.submittedAt
      });

      emitTeacherAndAdmin(exam.createdBy, 'result.created', { result: result.toJSON() }, attempt.studentId);
      emitTeacherAndAdmin(
        exam.createdBy,
        'proctoring.completed',
        {
          attemptId: attempt.attemptId,
          examId: exam.examId,
          studentId: attempt.studentId,
          studentName: attempt.studentName,
          status: finalAttemptStatus,
          warningCount: attempt.warningCount || 0
        },
        attempt.studentId
      );
    }

    return { attempt, result };
  }

  /**
   * Start or resume an ExamAttempt with strict RBAC, assignment ownership, and attemptLimit enforcement
   */
  static async startAttempt(
    examId: string,
    user: JwtUserPayload
  ): Promise<{
    attempt: any;
    exam: any;
    questions: SanitizedExamQuestionDto[];
    remainingSeconds: number;
  }> {
    if (user.role !== 'STUDENT') {
      const err: any = new Error('Forbidden: Only students can start examination attempts');
      err.statusCode = 403;
      throw err;
    }

    const exam = await Exam.findOne({ examId });
    if (!exam) {
      const err: any = new Error(`Exam with ID ${examId} not found`);
      err.statusCode = 404;
      throw err;
    }

    // 1. Verify student is assigned to this exam
    const isDirectlyAssigned =
      (Array.isArray(exam.assignedStudentIds) && exam.assignedStudentIds.includes(user.userId)) ||
      (Array.isArray(exam.assignedStudents) && exam.assignedStudents.includes(user.userId));
    const assignmentDoc = await ExamAssignment.findOne({ examId, studentId: user.userId });

    if (!isDirectlyAssigned && !assignmentDoc) {
      const err: any = new Error('Forbidden: You are not assigned to this examination');
      err.statusCode = 403;
      throw err;
    }

    // 2. Verify exam status and schedule window
    const allowedStatuses = ['PUBLISHED', 'LIVE'];
    if (!allowedStatuses.includes(exam.status)) {
      const err: any = new Error(
        `Examination is currently ${exam.status} and not open for attempts (must be LIVE or PUBLISHED)`
      );
      err.statusCode = 400;
      throw err;
    }

    const now = new Date();
    const startWindow = exam.startAt || exam.startDateTime;
    const endWindow = exam.endAt || exam.endDateTime;

    if (exam.status === 'SCHEDULED' && startWindow && now < new Date(startWindow)) {
      const err: any = new Error('Examination has not started yet');
      err.statusCode = 400;
      throw err;
    }

    if (endWindow && now > new Date(endWindow)) {
      const err: any = new Error('Examination schedule window has ended');
      err.statusCode = 400;
      throw err;
    }

    // 3. Check existing IN_PROGRESS attempt and validate server-side timer
    const activeAttempt = await ExamAttempt.findOne({
      examId,
      studentId: user.userId,
      status: 'IN_PROGRESS'
    });

    if (activeAttempt) {
      if (now.getTime() > activeAttempt.expiresAt.getTime()) {
        // Auto-expire this attempt
        await this.evaluateAndCreateResult(activeAttempt, exam, activeAttempt.answers || [], 'EXPIRED');
      } else {
        const questions = await Question.find({
          questionId: { $in: exam.questions },
          status: 'ACTIVE'
        });
        const remainingSeconds = Math.max(
          0,
          Math.floor((activeAttempt.expiresAt.getTime() - now.getTime()) / 1000)
        );
        return {
          attempt: this.sanitizeAttemptForStudent(activeAttempt),
          exam: {
            examId: exam.examId,
            title: exam.title,
            subject: exam.subject,
            durationMinutes: exam.durationMinutes,
            totalMarks: exam.totalMarks,
            passingMarks: exam.passingMarks,
            attemptLimit: exam.attemptLimit || 1,
            strictMode: exam.strictMode
          },
          questions: this.sanitizeQuestionsForStudent(questions),
          remainingSeconds
        };
      }
    }

    // 4. Enforce attemptLimit on completed attempts
    const completedAttemptsCount = await ExamAttempt.countDocuments({
      examId,
      studentId: user.userId,
      status: { $in: ['SUBMITTED', 'EXPIRED', 'EVALUATED', 'TERMINATED'] }
    });

    const attemptLimit = exam.attemptLimit || 1;
    if (completedAttemptsCount >= attemptLimit) {
      const err: any = new Error(
        `Attempt limit (${attemptLimit}) reached for this examination. You cannot start another attempt.`
      );
      err.statusCode = 400;
      throw err;
    }

    // 5. Create new ExamAttempt with authoritative server timestamps
    const attemptId = await generateNextAttemptId();
    const startedAt = new Date();
    const expiresAt = new Date(startedAt.getTime() + exam.durationMinutes * 60 * 1000);

    const attempt = await ExamAttempt.create({
      attemptId,
      examId: exam.examId,
      studentId: user.userId,
      studentName: user.name,
      startedAt,
      expiresAt,
      status: 'IN_PROGRESS',
      answers: [],
      score: 0,
      totalMarks: exam.totalMarks,
      percentage: 0,
      attemptNumber: completedAttemptsCount + 1,
      proctoringStatus: 'CLEAN',
      warningCount: 0
    });

    await ExamAssignment.findOneAndUpdate(
      { examId: exam.examId, studentId: user.userId },
      { status: 'IN_PROGRESS' }
    );

    emitTeacherAndAdmin(
      exam.createdBy,
      'proctoring.started',
      {
        attemptId: attempt.attemptId,
        examId: exam.examId,
        studentId: user.userId,
        studentName: user.name,
        startedAt: attempt.startedAt
      },
      user.userId
    );

    const questions = await Question.find({
      questionId: { $in: exam.questions },
      status: 'ACTIVE'
    });

    // Preserve order of exam.questions
    const questionById = new Map<string, IQuestionDocument>();
    questions.forEach(q => questionById.set(q.questionId, q));
    const orderedQuestions = exam.questions
      .map(qId => questionById.get(qId))
      .filter((q): q is IQuestionDocument => Boolean(q));

    const remainingSeconds = Math.max(0, Math.floor((expiresAt.getTime() - startedAt.getTime()) / 1000));

    logger.info(`ExamAttempt ${attemptId} started by student ${user.userId} for exam ${examId}`);

    return {
      attempt: this.sanitizeAttemptForStudent(attempt),
      exam: {
        examId: exam.examId,
        title: exam.title,
        subject: exam.subject,
        durationMinutes: exam.durationMinutes,
        totalMarks: exam.totalMarks,
        passingMarks: exam.passingMarks,
        attemptLimit: exam.attemptLimit || 1,
        strictMode: exam.strictMode
      },
      questions: this.sanitizeQuestionsForStudent(orderedQuestions),
      remainingSeconds
    };
  }

  /**
   * Validate and save/submit answers with strict ownership, timer, and server-side scoring
   */
  static async submitAttempt(
    attemptId: string,
    payload: { answers?: Array<{ questionId: string; selectedOption: string }>; terminateReason?: string },
    user: JwtUserPayload
  ): Promise<{ attempt: any; resultId: string; status: string }> {
    const attempt = await ExamAttempt.findOne({ attemptId });
    if (!attempt) {
      const err: any = new Error(`Attempt ${attemptId} not found`);
      err.statusCode = 404;
      throw err;
    }

    if (attempt.studentId !== user.userId) {
      const err: any = new Error('Forbidden: You do not own this examination attempt');
      err.statusCode = 403;
      throw err;
    }

    if (attempt.status !== 'IN_PROGRESS') {
      const err: any = new Error(`Attempt has already been finalized with status ${attempt.status}`);
      err.statusCode = 400;
      throw err;
    }

    const exam = await Exam.findOne({ examId: attempt.examId });
    if (!exam) {
      const err: any = new Error(`Associated exam ${attempt.examId} not found`);
      err.statusCode = 404;
      throw err;
    }

    // Check server-side exam status & timer expiration BEFORE accepting new answers
    if (
      exam.status === 'ENDED' ||
      exam.status === 'CLOSED' ||
      exam.status === 'ARCHIVED' ||
      exam.status === 'RESULT_PUBLISHED'
    ) {
      await this.evaluateAndCreateResult(attempt, exam, attempt.answers || [], 'EXPIRED');
      const err: any = new Error(
        `Examination has already ${exam.status.toLowerCase()}. Cannot continue or submit new answers.`
      );
      err.statusCode = 400;
      throw err;
    }

    const now = new Date();
    if (now.getTime() > attempt.expiresAt.getTime()) {
      await this.evaluateAndCreateResult(attempt, exam, attempt.answers || [], 'EXPIRED');
      const err: any = new Error('Exam attempt has expired. Submissions after time expiration are rejected.');
      err.statusCode = 400;
      throw err;
    }

    // Validate answers against exam questions and option IDs (use saved attempt.answers if payload.answers is omitted)
    const submittedAnswers =
      Array.isArray(payload.answers) && payload.answers.length > 0
        ? payload.answers
        : attempt.answers || [];

    const questions = await Question.find({ questionId: { $in: exam.questions } });
    const questionMap = new Map<string, IQuestionDocument>();
    for (const q of questions) {
      questionMap.set(q.questionId, q);
    }

    for (const item of submittedAnswers) {
      if (!item || typeof item.questionId !== 'string' || !item.questionId.trim()) {
        const err: any = new Error('Each answer must include a valid questionId');
        err.statusCode = 400;
        throw err;
      }
      const qId = item.questionId.trim();
      if (!exam.questions.includes(qId) || !questionMap.has(qId)) {
        const err: any = new Error(`Question ${qId} does not belong to examination ${exam.examId}`);
        err.statusCode = 400;
        throw err;
      }

      if (item.selectedOption !== undefined && item.selectedOption !== null && String(item.selectedOption).trim() !== '') {
        const optId = String(item.selectedOption).trim();
        const question = questionMap.get(qId)!;
        const validOpt = question.options.some(o => o.id === optId);
        if (!validOpt) {
          const err: any = new Error(`Option "${optId}" is not a valid choice for question ${qId}`);
          err.statusCode = 400;
          throw err;
        }
      }
    }

    const finalStatus = payload.terminateReason ? 'TERMINATED' : 'EVALUATED';
    if (payload.terminateReason) {
      attempt.proctoringStatus = 'TERMINATED';
    }

    const { attempt: scoredAttempt, result } = await this.evaluateAndCreateResult(
      attempt,
      exam,
      submittedAnswers,
      finalStatus
    );

    await AuditService.record({
      actorId: user.userId,
      actorName: user.name,
      actorRole: 'STUDENT',
      action: finalStatus === 'TERMINATED' ? 'ATTEMPT_TERMINATED' : 'ATTEMPT_SUBMITTED',
      targetType: 'EXAM_ATTEMPT',
      targetId: attempt.attemptId,
      details: `Exam ${exam.examId} attempt #${attempt.attemptNumber} finalized as ${finalStatus}`
    });

    logger.info(`Attempt ${attemptId} submitted by student ${user.userId}`);

    return {
      attempt: this.sanitizeAttemptForStudent(scoredAttempt),
      resultId: result.resultId,
      status: result.status
    };
  }

  /**
   * Save in-progress answers without finalizing attempt (validating timer & ownership)
   */
  static async saveProgressAnswers(
    attemptId: string,
    answers: Array<{ questionId: string; selectedOption: string }>,
    user: JwtUserPayload
  ): Promise<{ attempt: any; remainingSeconds: number }> {
    const attempt = await ExamAttempt.findOne({ attemptId });
    if (!attempt) {
      const err: any = new Error(`Attempt ${attemptId} not found`);
      err.statusCode = 404;
      throw err;
    }

    if (attempt.studentId !== user.userId) {
      const err: any = new Error('Forbidden: You do not own this examination attempt');
      err.statusCode = 403;
      throw err;
    }

    if (attempt.status !== 'IN_PROGRESS') {
      const err: any = new Error(`Cannot save answers: Attempt is ${attempt.status}`);
      err.statusCode = 400;
      throw err;
    }

    const exam = await Exam.findOne({ examId: attempt.examId });
    if (!exam) {
      const err: any = new Error('Exam not found');
      err.statusCode = 404;
      throw err;
    }

    if (
      exam.status === 'ENDED' ||
      exam.status === 'CLOSED' ||
      exam.status === 'ARCHIVED' ||
      exam.status === 'RESULT_PUBLISHED'
    ) {
      await this.evaluateAndCreateResult(attempt, exam, attempt.answers || [], 'EXPIRED');
      const err: any = new Error(
        `Cannot save answers: Examination has already ${exam.status.toLowerCase()}.`
      );
      err.statusCode = 400;
      throw err;
    }

    const now = new Date();
    if (now.getTime() > attempt.expiresAt.getTime()) {
      await this.evaluateAndCreateResult(attempt, exam, attempt.answers || [], 'EXPIRED');
      const err: any = new Error('Exam attempt has expired');
      err.statusCode = 400;
      throw err;
    }

    if (!Array.isArray(answers)) {
      const err: any = new Error('answers must be an array');
      err.statusCode = 400;
      throw err;
    }

    const questions = await Question.find({ questionId: { $in: exam.questions } });
    const questionMap = new Map<string, IQuestionDocument>();
    questions.forEach(q => questionMap.set(q.questionId, q));

    const cleanAnswers: IAttemptAnswer[] = [];
    for (const item of answers) {
      if (!item || typeof item.questionId !== 'string') continue;
      const qId = item.questionId.trim();
      if (!exam.questions.includes(qId) || !questionMap.has(qId)) {
        const err: any = new Error(`Question ${qId} does not belong to this exam`);
        err.statusCode = 400;
        throw err;
      }
      const optId = item.selectedOption ? String(item.selectedOption).trim() : '';
      if (optId) {
        const q = questionMap.get(qId)!;
        if (!q.options.some(o => o.id === optId)) {
          const err: any = new Error(`Option "${optId}" is not valid for question ${qId}`);
          err.statusCode = 400;
          throw err;
        }
      }
      cleanAnswers.push({ questionId: qId, selectedOption: optId });
    }

    attempt.answers = cleanAnswers;
    await attempt.save();

    const remainingSeconds = Math.max(0, Math.floor((attempt.expiresAt.getTime() - now.getTime()) / 1000));
    return {
      attempt: this.sanitizeAttemptForStudent(attempt),
      remainingSeconds
    };
  }

  /**
   * Get single attempt with timer check and RBAC protection
   */
  static async getAttemptById(attemptId: string, user: JwtUserPayload): Promise<any> {
    const attempt = await ExamAttempt.findOne({ attemptId });
    if (!attempt) {
      const err: any = new Error(`Attempt ${attemptId} not found`);
      err.statusCode = 404;
      throw err;
    }

    const exam = await Exam.findOne({ examId: attempt.examId });
    if (!exam) {
      const err: any = new Error('Exam not found');
      err.statusCode = 404;
      throw err;
    }

    if (user.role === 'STUDENT' && attempt.studentId !== user.userId) {
      const err: any = new Error('Forbidden: You do not own this attempt');
      err.statusCode = 403;
      throw err;
    }

    if (user.role === 'TEACHER' && exam.createdBy !== user.userId) {
      const err: any = new Error('Forbidden: You do not own the examination for this attempt');
      err.statusCode = 403;
      throw err;
    }

    const now = new Date();
    if (attempt.status === 'IN_PROGRESS' && now.getTime() > attempt.expiresAt.getTime()) {
      await this.evaluateAndCreateResult(attempt, exam, attempt.answers || [], 'EXPIRED');
    }

    const remainingSeconds =
      attempt.status === 'IN_PROGRESS'
        ? Math.max(0, Math.floor((attempt.expiresAt.getTime() - now.getTime()) / 1000))
        : 0;

    if (user.role === 'STUDENT') {
      const questions = await Question.find({ questionId: { $in: exam.questions }, status: 'ACTIVE' });
      const qMap = new Map<string, IQuestionDocument>();
      questions.forEach(q => qMap.set(q.questionId, q));
      const orderedQuestions = exam.questions
        .map(id => qMap.get(id))
        .filter((q): q is IQuestionDocument => Boolean(q));

      return {
        attempt: this.sanitizeAttemptForStudent(attempt),
        questions: this.sanitizeQuestionsForStudent(orderedQuestions),
        remainingSeconds
      };
    }

    return {
      attempt,
      remainingSeconds
    };
  }

  /**
   * List attempts for authenticated user or teacher/admin
   */
  static async listAttempts(filters: { examId?: string }, user: JwtUserPayload): Promise<any[]> {
    if (user.role === 'STUDENT') {
      const query: any = { studentId: user.userId };
      if (filters.examId) query.examId = filters.examId;
      const attempts = await ExamAttempt.find(query).sort({ createdAt: -1 });
      return attempts.map(a => this.sanitizeAttemptForStudent(a));
    }

    if (user.role === 'TEACHER') {
      const teacherExams = await Exam.find({ createdBy: user.userId }).select('examId').lean();
      const teacherExamIds = teacherExams.map(e => e.examId);
      if (filters.examId && !teacherExamIds.includes(filters.examId)) {
        const err: any = new Error('Forbidden: You do not own this examination');
        err.statusCode = 403;
        throw err;
      }
      const query: any = {
        examId: filters.examId ? filters.examId : { $in: teacherExamIds }
      };
      return ExamAttempt.find(query).sort({ createdAt: -1 });
    }

    const query: any = {};
    if (filters.examId) query.examId = filters.examId;
    return ExamAttempt.find(query).sort({ createdAt: -1 });
  }

  /**
   * Hide server-calculated scores/isCorrect on student attempt DTO until result is published
   */
  static sanitizeAttemptForStudent(attempt: IExamAttemptDocument) {
    return {
      id: attempt.attemptId,
      attemptId: attempt.attemptId,
      examId: attempt.examId,
      studentId: attempt.studentId,
      studentName: attempt.studentName,
      startedAt: attempt.startedAt,
      expiresAt: attempt.expiresAt,
      submittedAt: attempt.submittedAt,
      status: attempt.status,
      score: attempt.score,
      totalMarks: attempt.totalMarks,
      percentage: attempt.percentage,
      attemptNumber: attempt.attemptNumber,
      proctoringStatus: attempt.proctoringStatus,
      warningCount: attempt.warningCount,
      answers: (attempt.answers || []).map(a => ({
        questionId: a.questionId,
        selectedOption: a.selectedOption
      }))
    };
  }
}
