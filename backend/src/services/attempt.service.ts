import { Exam, IExamDocument } from '../models/Exam';
import { Question, IQuestionDocument } from '../models/Question';
import { ExamAssignment } from '../models/ExamAssignment';
import { ExamAttempt, IExamAttemptDocument, IAttemptAnswer } from '../models/ExamAttempt';
import { Result, IResultDocument, IResultAnswerBreakdown } from '../models/Result';
import { StudentQuery } from '../models/StudentQuery';
import { User } from '../models/User';
import { JwtUserPayload } from '../types/auth.types';
import { generateNextAttemptId, generateNextResultId } from '../utils/exam-id.generator';
import { AuditService } from './audit.service';
import { emitTeacherAndAdmin, emitToRooms } from '../realtime/socket';
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
  private static sanitizeAttemptForStaff(attempt: IExamAttemptDocument) {
    const safeAttempt = attempt.toJSON();
    delete safeAttempt.deviceSessionId;
    return safeAttempt;
  }

  private static assertDeviceOwnership(
    attempt: IExamAttemptDocument,
    user: JwtUserPayload,
    deviceSessionId: string
  ): void {
    if (
      user.role === 'STUDENT' &&
      attempt.status === 'IN_PROGRESS' &&
      (!deviceSessionId || attempt.deviceSessionId !== deviceSessionId)
    ) {
      const err: any = new Error('This examination attempt is active in another browser or device.');
      err.statusCode = 403;
      throw err;
    }
  }

  private static sanitizeExamForStudent(exam: IExamDocument) {
    return {
      examId: exam.examId,
      title: exam.title,
      description: exam.description,
      subject: exam.subject,
      course: exam.course,
      department: exam.department,
      academicYear: exam.academicYear,
      semester: exam.semester,
      durationMinutes: exam.durationMinutes,
      questionCount: exam.questionCount,
      totalMarks: exam.totalMarks,
      passingMarks: exam.passingMarks,
      attemptLimit: exam.attemptLimit || 1,
      strictMode: exam.strictMode,
      instructions: exam.instructions,
      status: exam.status,
      startAt: exam.startAt || exam.startDateTime,
      endAt: exam.endAt || exam.endDateTime
    };
  }

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
    rawAnswers: Array<{ questionId: string; selectedOption: string; markedForReview?: boolean }>,
    finalAttemptStatus:
      | 'SUBMITTED'
      | 'AUTO_SUBMITTED'
      | 'EXPIRED'
      | 'TERMINATED'
      | 'EVALUATED'
      | 'FORCE_SUBMITTED'
  ): Promise<{ attempt: IExamAttemptDocument; result: IResultDocument }> {
    const [questions, resolutions] = await Promise.all([
      Question.find({ questionId: { $in: exam.questions } }),
      StudentQuery.find({
        attemptId: attempt.attemptId,
        status: 'RESOLVED_ACCEPTED',
        resolutionType: {
          $in: ['OUT_OF_SYLLABUS', 'INVALID_QUESTION', 'CORRECT_ANSWER_CHANGED', 'GRACE_MARKS', 'EXCLUDE_QUESTION']
        }
      }).lean()
    ]);
    const excludedQuestionIds = new Set(
      resolutions
        .filter(query => ['OUT_OF_SYLLABUS', 'INVALID_QUESTION', 'EXCLUDE_QUESTION'].includes(query.resolutionType || ''))
        .map(query => query.questionId)
    );
    const correctedAnswers = new Map(
      resolutions
        .filter(query => query.resolutionType === 'CORRECT_ANSWER_CHANGED' && query.questionId && query.correctedAnswer)
        .map(query => [query.questionId!, query.correctedAnswer!])
    );
    const graceMarks = resolutions
      .filter(query => query.resolutionType === 'GRACE_MARKS')
      .reduce((sum, query) => sum + (query.scoreAdjustment || 0), 0);
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
      const canonicalCorrect = (correctedAnswers.get(qId) || q.correctOption || q.correctAnswer || '').trim();
      const excluded = excludedQuestionIds.has(qId);

      let isCorrect = false;
      let marksAwarded = 0;

      if (!excluded && selectedOption) {
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
        markedForReview: Boolean(rawAnswers.find(answer => answer.questionId === qId)?.markedForReview),
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
        maxMarks: excluded ? 0 : qMarks,
        excluded,
        negativeMarks: qNeg
      });
      if (excluded) questionMarksTotal -= qMarks;
    }

    rawScore += graceMarks;
    let effectiveTotalMarks = questionMarksTotal;
    let effectiveFinalStatus = finalAttemptStatus;
    let finalScore =
      finalAttemptStatus === 'TERMINATED'
        ? 0
        : Math.min(effectiveTotalMarks, Math.max(0, Number(rawScore.toFixed(2))));
    let percentage =
      effectiveTotalMarks > 0 ? Number(((finalScore / effectiveTotalMarks) * 100).toFixed(2)) : 0;

    let submittedAt = new Date();
    let finalizedAttempt = await ExamAttempt.findOneAndUpdate(
      {
        attemptId: attempt.attemptId,
        status: 'IN_PROGRESS',
        updatedAt: attempt.updatedAt
      },
      {
        $set: {
          answers: attemptAnswers,
          score: finalScore,
          totalMarks: effectiveTotalMarks,
          percentage,
          status: finalAttemptStatus,
          ...(finalAttemptStatus === 'TERMINATED' && { proctoringStatus: 'TERMINATED' }),
          submittedAt
        }
      },
      { returnDocument: 'after' }
    );
    if (!finalizedAttempt) {
      const [currentAttempt, existingResult] = await Promise.all([
        ExamAttempt.findOne({ attemptId: attempt.attemptId }),
        Result.findOne({ attemptId: attempt.attemptId })
      ]);
      if (currentAttempt && existingResult) {
        return { attempt: currentAttempt, result: existingResult };
      }
      if (currentAttempt && currentAttempt.status !== 'IN_PROGRESS') {
        finalizedAttempt = currentAttempt;
        effectiveFinalStatus = currentAttempt.status;
        effectiveTotalMarks = currentAttempt.totalMarks;
        finalScore = currentAttempt.score;
        percentage = currentAttempt.percentage;
        submittedAt = currentAttempt.submittedAt || submittedAt;
      } else {
        const err: any = new Error('Attempt was finalized by another request.');
        err.statusCode = 409;
        throw err;
      }
    }
    const passingThreshold =
      exam.passingMarks <= effectiveTotalMarks
        ? exam.passingMarks
        : Math.round(effectiveTotalMarks * 0.4);

    await ExamAssignment.findOneAndUpdate(
      { examId: exam.examId, studentId: attempt.studentId },
      { status: effectiveFinalStatus === 'EXPIRED' ? 'EXPIRED' : 'SUBMITTED' }
    );

    let result = await Result.findOne({ attemptId: attempt.attemptId });
    if (!result) {
      const resultData = {
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
        passed: finalScore >= passingThreshold && effectiveFinalStatus !== 'TERMINATED',
        status: effectiveFinalStatus === 'TERMINATED' ? 'TERMINATED' as const : 'PENDING' as const,
        answers: resultBreakdown,
        proctoringWarnings: attempt.warningCount || 0,
        feedback:
          effectiveFinalStatus === 'EXPIRED'
            ? 'Attempt automatically finalized upon timer expiration.'
            : effectiveFinalStatus === 'TERMINATED'
            ? 'Attempt terminated due to proctoring violations.'
            : effectiveFinalStatus === 'FORCE_SUBMITTED' || effectiveFinalStatus === 'AUTO_SUBMITTED'
            ? 'Attempt automatically submitted when the examination was ended.'
            : 'Submitted for faculty verification.',
        submittedAt
      };
      let resultCreated = false;
      for (let retry = 0; retry < 5 && !result; retry += 1) {
        try {
          result = await Result.create({
            resultId: await generateNextResultId(),
            ...resultData
          });
          resultCreated = true;
        } catch (error: any) {
          if (error?.code !== 11000) throw error;
          result = await Result.findOne({ attemptId: attempt.attemptId });
          if (!result && retry === 4) throw error;
        }
      }

      if (!result) {
        const err: any = new Error(`Result for attempt ${attempt.attemptId} could not be created`);
        err.statusCode = 500;
        throw err;
      }
      if (resultCreated) {
        emitTeacherAndAdmin(exam.createdBy, 'result.created', { result: result.toJSON() }, attempt.studentId);
        emitTeacherAndAdmin(
          exam.createdBy,
          'proctoring.completed',
          {
            attemptId: attempt.attemptId,
            examId: exam.examId,
            studentId: attempt.studentId,
            studentName: attempt.studentName,
            status: effectiveFinalStatus,
            warningCount: attempt.warningCount || 0
          },
          attempt.studentId
        );
      }
    }

    return { attempt: finalizedAttempt, result };
  }

  static async forceEndExam(exam: IExamDocument, actorId: string): Promise<void> {
    const activeAttempts = await ExamAttempt.find({ examId: exam.examId, status: 'IN_PROGRESS' })
      .select('attemptId studentId')
      .lean();
    await Promise.all(
      activeAttempts.map(async attempt => {
        let finalizedAttempt: IExamAttemptDocument | null = null;
        let result: IResultDocument | null = null;
        for (let retry = 0; retry < 5; retry += 1) {
          const currentAttempt = await ExamAttempt.findOne({
            attemptId: attempt.attemptId,
            examId: exam.examId,
            status: 'IN_PROGRESS'
          });
          if (!currentAttempt) break;
          try {
            await this.evaluateAndCreateResult(
              currentAttempt,
              exam,
              currentAttempt.answers || [],
              'FORCE_SUBMITTED'
            );
          } catch (error: any) {
            if (error?.statusCode !== 409) throw error;
          }
          finalizedAttempt = await ExamAttempt.findOne({
            attemptId: attempt.attemptId,
            status: { $ne: 'IN_PROGRESS' }
          });
          result = await Result.findOne({ attemptId: attempt.attemptId });
          if (finalizedAttempt && result) break;
        }

        if (!finalizedAttempt || !result) {
          for (let retry = 0; retry < 20 && (!finalizedAttempt || !result); retry += 1) {
            await new Promise(resolve => setTimeout(resolve, 25));
            finalizedAttempt = await ExamAttempt.findOne({
              attemptId: attempt.attemptId,
              status: { $ne: 'IN_PROGRESS' }
            });
            result = await Result.findOne({ attemptId: attempt.attemptId });
          }
        }
        if (!finalizedAttempt || !result) {
          const err: any = new Error(`Attempt ${attempt.attemptId} could not be finalized during exam end.`);
          err.statusCode = 500;
          throw err;
        }

        const notifyClaim = await ExamAttempt.updateOne(
          { attemptId: attempt.attemptId, forceEndNotifiedAt: { $exists: false } },
          { $set: { forceEndNotifiedAt: new Date() } }
        );
        if (notifyClaim.modifiedCount > 0) {
          emitTeacherAndAdmin(
            exam.createdBy,
            'monitoring.updated',
            { attempt: this.sanitizeAttemptForStaff(finalizedAttempt) },
            actorId
          );
          emitToRooms(
            `student:${attempt.studentId}`,
            'exam.forceEnded',
            {
              examId: exam.examId,
              attemptId: attempt.attemptId,
              attempt: this.sanitizeAttemptForStudent(finalizedAttempt),
              resultId: result.resultId,
              message: 'Exam ended by faculty/admin. Your attempt was submitted automatically.'
            },
            actorId
          );
        }
      })
    );
  }

  /**
   * Start or resume an ExamAttempt with strict RBAC, assignment ownership, and attemptLimit enforcement
   */
  static async startAttempt(
    examId: string,
    user: JwtUserPayload,
    deviceSessionId: string
  ): Promise<{
    resumed: boolean;
    attempt: any;
    exam: any;
    questions: SanitizedExamQuestionDto[];
    remainingSeconds: number;
    suspended?: boolean;
  }> {
    if (user.role !== 'STUDENT') {
      const err: any = new Error('Forbidden: Only students can start examination attempts');
      err.statusCode = 403;
      throw err;
    }
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(deviceSessionId || '')) {
      const err: any = new Error('A valid device session identifier is required');
      err.statusCode = 400;
      throw err;
    }

    const exam = await Exam.findOne({ examId });
    if (!exam || exam.deleting) {
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
    let activeAttempt = await ExamAttempt.findOne({
      studentId: user.userId,
      status: 'IN_PROGRESS'
    });

    if (activeAttempt) {
      if (now.getTime() > activeAttempt.expiresAt.getTime()) {
        const activeExam = activeAttempt.examId === examId ? exam : await Exam.findOne({ examId: activeAttempt.examId });
        if (!activeExam) {
          await ExamAttempt.deleteOne({ attemptId: activeAttempt.attemptId, status: 'IN_PROGRESS' });
          activeAttempt = null;
        } else {
          await this.evaluateAndCreateResult(activeAttempt, activeExam, activeAttempt.answers || [], 'EXPIRED');
          activeAttempt = null;
        }
      } else {
        const activeExam = activeAttempt.examId === examId
          ? exam
          : await Exam.findOne({ examId: activeAttempt.examId });
        if (!activeExam) {
          await ExamAttempt.deleteOne({ attemptId: activeAttempt.attemptId, status: 'IN_PROGRESS' });
          activeAttempt = null;
        } else if (!['PUBLISHED', 'LIVE'].includes(activeExam.status)) {
          await this.evaluateAndCreateResult(
            activeAttempt,
            activeExam,
            activeAttempt.answers || [],
            'FORCE_SUBMITTED'
          );
          activeAttempt = null;
        } else if (activeAttempt.examId !== examId) {
          const err: any = new Error(
            `You already have ${activeExam?.title || activeAttempt.examId} — In Progress (attempt ${activeAttempt.attemptId}). Finish or resume it before starting another examination.`
          );
          err.statusCode = 409;
          (err as any).details = { examId: activeAttempt.examId, attemptId: activeAttempt.attemptId };
          throw err;
        }
        if (!activeAttempt) {
          // The orphaned or ended attempt was cleared above; continue with a fresh attempt.
        } else if (!activeAttempt.deviceSessionId) {
          await ExamAttempt.updateOne(
            { attemptId: activeAttempt.attemptId, deviceSessionId: '' },
            { $set: { deviceSessionId } }
          );
          activeAttempt = await ExamAttempt.findOne({ attemptId: activeAttempt.attemptId }) || activeAttempt;
        }
        if (activeAttempt && activeAttempt.deviceSessionId !== deviceSessionId) {
          const err: any = new Error(
            `Exam ${exam.title} — In Progress (attempt ${activeAttempt.attemptId}) in another browser or device.`
          );
          err.statusCode = 409;
          (err as any).details = { examId: activeAttempt.examId, attemptId: activeAttempt.attemptId };
          throw err;
        }
        if (activeAttempt) {
          const questions = await Question.find({
            questionId: { $in: exam.questions },
            status: 'ACTIVE'
          });
          const questionMap = new Map(questions.map(question => [question.questionId, question]));
          const orderedQuestions = exam.questions
            .map(questionId => questionMap.get(questionId))
            .filter(question => question !== undefined);
          const remainingSeconds = Math.max(
            0,
            Math.floor((activeAttempt.expiresAt.getTime() - now.getTime()) / 1000)
          );
          return {
            resumed: true,
            attempt: this.sanitizeAttemptForStudent(activeAttempt),
            exam: this.sanitizeExamForStudent(exam),
            questions: this.sanitizeQuestionsForStudent(orderedQuestions),
            remainingSeconds,
            suspended: activeAttempt.suspended
          };
        }
      }
    }

    // 4. Enforce attemptLimit on completed attempts
    const completedAttemptsCount = await ExamAttempt.countDocuments({
      examId,
      studentId: user.userId,
      status: {
        $in: ['SUBMITTED', 'AUTO_SUBMITTED', 'EXPIRED', 'EVALUATED', 'TERMINATED', 'FORCE_SUBMITTED']
      }
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

    let attempt: IExamAttemptDocument;
    try {
      attempt = await ExamAttempt.create({
      attemptId,
      examId: exam.examId,
      studentId: user.userId,
      deviceSessionId,
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
      warningCount: 0,
      currentQuestionIndex: 0,
      reportedQuestionIds: [],
      suspended: false,
      cameraStatus: 'UNKNOWN',
      faceStatus: 'UNKNOWN',
      fullscreenActive: false,
      lastHeartbeatAt: startedAt
      });
    } catch (error: any) {
      if (error?.code !== 11000) throw error;
      const competingAttempt = await ExamAttempt.findOne({ studentId: user.userId, status: 'IN_PROGRESS' });
      if (competingAttempt?.examId === examId && competingAttempt.deviceSessionId === deviceSessionId) {
        return this.startAttempt(examId, user, deviceSessionId);
      }
      const competingExam = competingAttempt
        ? await Exam.findOne({ examId: competingAttempt.examId }).select('title')
        : null;
      const conflict: any = new Error(
        competingAttempt
          ? `You already have ${competingExam?.title || competingAttempt.examId} — In Progress (attempt ${competingAttempt.attemptId}).`
          : 'An examination attempt was started concurrently. Refresh and try again.'
      );
      conflict.statusCode = 409;
      conflict.details = competingAttempt
        ? { examId: competingAttempt.examId, attemptId: competingAttempt.attemptId }
        : undefined;
      throw conflict;
    }

    const currentExam = await Exam.findOne({ examId });
    if (!currentExam || !['PUBLISHED', 'LIVE'].includes(currentExam.status)) {
      if (!currentExam) {
        await ExamAttempt.deleteOne({ attemptId: attempt.attemptId, status: 'IN_PROGRESS' });
      } else if (currentExam.status === 'ENDED' || currentExam.status === 'CLOSED') {
        await this.forceEndExam(currentExam, currentExam.createdBy);
      }
      const err: any = new Error(
        currentExam ? 'Examination is no longer accepting attempts.' : 'Examination no longer exists.'
      );
      err.statusCode = currentExam ? 409 : 404;
      throw err;
    }

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
      resumed: false,
      attempt: this.sanitizeAttemptForStudent(attempt),
      exam: this.sanitizeExamForStudent(exam),
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
    user: JwtUserPayload,
    deviceSessionId: string
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
    this.assertDeviceOwnership(attempt, user, deviceSessionId);

    if (attempt.status !== 'IN_PROGRESS') {
      const result = await Result.findOne({ attemptId: attempt.attemptId });
      if (result) {
        return {
          attempt: this.sanitizeAttemptForStudent(attempt),
          resultId: result.resultId,
          status: result.status
        };
      }
      const err: any = new Error(`Attempt has already been finalized with status ${attempt.status}`);
      err.statusCode = 409;
      throw err;
    }
    if (attempt.suspended) {
      const err: any = new Error('Attempt is suspended pending faculty assistance');
      err.statusCode = 423;
      throw err;
    }

    const exam = await Exam.findOne({ examId: attempt.examId });
    if (!exam || exam.deleting) {
      const err: any = new Error(`Associated exam ${attempt.examId} not found`);
      err.statusCode = 404;
      throw err;
    }

    // Check server-side exam status & timer expiration BEFORE accepting new answers
    if (
      exam.deleting ||
      exam.status === 'ENDED' ||
      exam.status === 'CLOSED' ||
      exam.status === 'ARCHIVED' ||
      exam.status === 'RESULT_PUBLISHED'
    ) {
      const finalized = await this.evaluateAndCreateResult(
        attempt,
        exam,
        attempt.answers || [],
        'FORCE_SUBMITTED'
      );
      return {
        attempt: this.sanitizeAttemptForStudent(finalized.attempt),
        resultId: finalized.result.resultId,
        status: finalized.result.status
      };
    }

    const now = new Date();
    if (now.getTime() > attempt.expiresAt.getTime()) {
      const finalized = await this.evaluateAndCreateResult(
        attempt,
        exam,
        attempt.answers || [],
        'EXPIRED'
      );
      return {
        attempt: this.sanitizeAttemptForStudent(finalized.attempt),
        resultId: finalized.result.resultId,
        status: finalized.result.status
      };
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
    answers: Array<{ questionId: string; selectedOption: string; markedForReview?: boolean }>,
    user: JwtUserPayload,
    state: {
      currentQuestionIndex?: number;
      cameraStatus?: 'ACTIVE' | 'OFFLINE' | 'UNKNOWN';
      faceStatus?: 'DETECTED' | 'NOT_DETECTED' | 'MULTIPLE' | 'UNKNOWN';
      fullscreenActive?: boolean;
      deviceSessionId?: string;
    } = {}
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
    this.assertDeviceOwnership(attempt, user, state.deviceSessionId || '');

    if (attempt.status !== 'IN_PROGRESS') {
      const err: any = new Error(`Cannot save answers: Attempt is ${attempt.status}`);
      err.statusCode = 400;
      throw err;
    }
    if (attempt.suspended) {
      const err: any = new Error('Attempt is suspended pending faculty assistance');
      err.statusCode = 423;
      throw err;
    }

    const exam = await Exam.findOne({ examId: attempt.examId });
    if (!exam || exam.deleting) {
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
      const err: any = new Error(
        `Cannot save answers: Examination has already ${exam.status.toLowerCase()}.`
      );
      err.statusCode = 409;
      throw err;
    }

    const now = new Date();
    if (now.getTime() > attempt.expiresAt.getTime()) {
      const finalized = await this.evaluateAndCreateResult(attempt, exam, attempt.answers || [], 'EXPIRED');
      return { attempt: this.sanitizeAttemptForStudent(finalized.attempt), remainingSeconds: 0 };
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
      cleanAnswers.push({
        questionId: qId,
        selectedOption: optId,
        markedForReview: Boolean(item.markedForReview)
      });
    }

    const updates: Record<string, unknown> = {
      answers: cleanAnswers,
      lastHeartbeatAt: now
    };
    if (Number.isInteger(state.currentQuestionIndex)) {
      updates.currentQuestionIndex = Math.max(
        0,
        Math.min(state.currentQuestionIndex!, Math.max(0, exam.questions.length - 1))
      );
    }
    if (state.cameraStatus) updates.cameraStatus = state.cameraStatus;
    if (state.faceStatus) updates.faceStatus = state.faceStatus;
    if (typeof state.fullscreenActive === 'boolean') updates.fullscreenActive = state.fullscreenActive;
    const savedAttempt = await ExamAttempt.findOneAndUpdate(
      {
        attemptId,
        studentId: user.userId,
        status: 'IN_PROGRESS',
        suspended: false,
        deviceSessionId: state.deviceSessionId
      },
      { $set: updates },
      { returnDocument: 'after' }
    );
    if (!savedAttempt) {
      const err: any = new Error('Attempt is no longer available for answer changes');
      err.statusCode = 409;
      throw err;
    }

    const remainingSeconds = Math.max(0, Math.floor((savedAttempt.expiresAt.getTime() - now.getTime()) / 1000));
    const [attemptExam, assignedStudent] = await Promise.all([
      Exam.findOne({ examId: attempt.examId }).select('createdBy').lean(),
      User.findOne({ userId: attempt.studentId }).select('managedBy teacherIds').lean()
    ]);
    emitTeacherAndAdmin(
      Array.from(new Set([
        ...(assignedStudent?.managedBy || []),
        ...(assignedStudent?.teacherIds || []),
        attemptExam?.createdBy || ''
      ])),
      'monitoring.updated',
      { attempt: this.sanitizeAttemptForStudent(savedAttempt) },
      user.userId
    );
    return {
      attempt: this.sanitizeAttemptForStudent(savedAttempt),
      remainingSeconds
    };
  }

  static async recordHeartbeat(
    attemptId: string,
    user: JwtUserPayload,
    state: {
      cameraStatus?: 'ACTIVE' | 'OFFLINE' | 'UNKNOWN';
      faceStatus?: 'DETECTED' | 'NOT_DETECTED' | 'MULTIPLE' | 'UNKNOWN';
      fullscreenActive?: boolean;
      deviceSessionId?: string;
    } = {}
  ): Promise<{ attempt: any; remainingSeconds: number; result?: IResultDocument }> {
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
    this.assertDeviceOwnership(attempt, user, state.deviceSessionId || '');
    if (attempt.status !== 'IN_PROGRESS') {
      const err: any = new Error(`Attempt is ${attempt.status}`);
      err.statusCode = 400;
      throw err;
    }

    const now = new Date();
    if (now.getTime() >= attempt.expiresAt.getTime()) {
      const exam = await Exam.findOne({ examId: attempt.examId });
      if (!exam || exam.deleting) {
        const err: any = new Error('Exam not found');
        err.statusCode = 404;
        throw err;
      }
      const evaluation = await this.evaluateAndCreateResult(
        attempt,
        exam,
        attempt.answers || [],
        'EXPIRED'
      );
      return {
        attempt: this.sanitizeAttemptForStudent(evaluation.attempt),
        remainingSeconds: 0,
        result: evaluation.result
      };
    }

    const exam = await Exam.findOne({ examId: attempt.examId });
    if (!exam || exam.deleting) {
      const err: any = new Error('Exam not found');
      err.statusCode = 404;
      throw err;
    }
    if (!['PUBLISHED', 'LIVE'].includes(exam.status)) {
      await this.forceEndExam(exam, exam.createdBy);
      const [finalizedAttempt, result] = await Promise.all([
        ExamAttempt.findOne({ attemptId }),
        Result.findOne({ attemptId })
      ]);
      return {
        attempt: this.sanitizeAttemptForStudent(finalizedAttempt || attempt),
        remainingSeconds: 0,
        result: result || undefined
      };
    }

    const heartbeatUpdates: Record<string, unknown> = { lastHeartbeatAt: now };
    if (state.cameraStatus) heartbeatUpdates.cameraStatus = state.cameraStatus;
    if (state.faceStatus) heartbeatUpdates.faceStatus = state.faceStatus;
    if (typeof state.fullscreenActive === 'boolean') heartbeatUpdates.fullscreenActive = state.fullscreenActive;
    const updatedAttempt = await ExamAttempt.findOneAndUpdate(
      {
        attemptId,
        studentId: user.userId,
        status: 'IN_PROGRESS',
        deviceSessionId: state.deviceSessionId
      },
      { $set: heartbeatUpdates },
      { returnDocument: 'after' }
    );
    if (!updatedAttempt) {
      const err: any = new Error('Attempt is no longer active');
      err.statusCode = 409;
      throw err;
    }

    const [monitoringExam, student] = await Promise.all([
      Exam.findOne({ examId: attempt.examId }).select('createdBy').lean(),
      User.findOne({ userId: attempt.studentId }).select('managedBy teacherIds').lean()
    ]);
    emitTeacherAndAdmin(
      Array.from(new Set([
        ...(student?.managedBy || []),
        ...(student?.teacherIds || []),
        monitoringExam?.createdBy || ''
      ])),
      'monitoring.updated',
      { attempt: this.sanitizeAttemptForStudent(updatedAttempt) },
      user.userId
    );
    return {
      attempt: this.sanitizeAttemptForStudent(updatedAttempt),
      remainingSeconds: Math.max(0, Math.floor((updatedAttempt.expiresAt.getTime() - now.getTime()) / 1000))
    };
  }

  /**
   * Get single attempt with timer check and RBAC protection
   */
  static async getAttemptById(attemptId: string, user: JwtUserPayload, deviceSessionId: string): Promise<any> {
    const attempt = await ExamAttempt.findOne({ attemptId });
    if (!attempt) {
      const err: any = new Error(`Attempt ${attemptId} not found`);
      err.statusCode = 404;
      throw err;
    }

    const exam = await Exam.findOne({ examId: attempt.examId });
    if (!exam || exam.deleting) {
      const err: any = new Error('Exam not found');
      err.statusCode = 404;
      throw err;
    }

    if (user.role === 'STUDENT' && attempt.studentId !== user.userId) {
      const err: any = new Error('Forbidden: You do not own this attempt');
      err.statusCode = 403;
      throw err;
    }
    this.assertDeviceOwnership(attempt, user, deviceSessionId);

    if (user.role === 'TEACHER' && exam.createdBy !== user.userId) {
      const student = await User.findOne({
        userId: attempt.studentId,
        role: 'STUDENT',
        $or: [{ managedBy: user.userId }, { teacherIds: user.userId }]
      }).select('_id').lean();
      if (!student) {
        const err: any = new Error('Forbidden: This student is not assigned to you');
        err.statusCode = 403;
        throw err;
      }
    }

    let currentAttempt: IExamAttemptDocument = attempt;
    const now = new Date();
    if (attempt.status === 'IN_PROGRESS' && now.getTime() > attempt.expiresAt.getTime()) {
      const finalized = await this.evaluateAndCreateResult(attempt, exam, attempt.answers || [], 'EXPIRED');
      currentAttempt = finalized.attempt;
    }

    const remainingSeconds =
      currentAttempt.status === 'IN_PROGRESS'
        ? Math.max(0, Math.floor((currentAttempt.expiresAt.getTime() - now.getTime()) / 1000))
        : 0;

    if (user.role === 'STUDENT') {
      const questions = await Question.find({ questionId: { $in: exam.questions }, status: 'ACTIVE' });
      const qMap = new Map<string, IQuestionDocument>();
      questions.forEach(q => qMap.set(q.questionId, q));
      const orderedQuestions = exam.questions
        .map(id => qMap.get(id))
        .filter((q): q is IQuestionDocument => Boolean(q));

      return {
        attempt: this.sanitizeAttemptForStudent(currentAttempt),
        exam: this.sanitizeExamForStudent(exam),
        questions: this.sanitizeQuestionsForStudent(orderedQuestions),
        remainingSeconds
      };
    }

    return {
      attempt: this.sanitizeAttemptForStaff(currentAttempt),
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
      const [teacherExams, students] = await Promise.all([
        Exam.find({ createdBy: user.userId }).select('examId').lean(),
        User.find({
          role: 'STUDENT',
          $or: [{ managedBy: user.userId }, { teacherIds: user.userId }]
        }).select('userId').lean()
      ]);
      const query: any = {
        $or: [
          { examId: { $in: teacherExams.map(exam => exam.examId) } },
          { studentId: { $in: students.map(student => student.userId) } }
        ]
      };
      if (filters.examId) query.$and = [{ $or: query.$or }, { examId: filters.examId }];
      const attempts = await ExamAttempt.find(query).sort({ createdAt: -1 });
      return attempts.map(attempt => this.sanitizeAttemptForStaff(attempt));
    }

    const query: any = {};
    if (filters.examId) query.examId = filters.examId;
    const attempts = await ExamAttempt.find(query).sort({ createdAt: -1 });
    return attempts.map(attempt => this.sanitizeAttemptForStaff(attempt));
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
      suspended: attempt.suspended,
      warningCount: attempt.warningCount,
      currentQuestionIndex: attempt.currentQuestionIndex || 0,
      reportedQuestionIds: attempt.reportedQuestionIds || [],
      cameraStatus: attempt.cameraStatus,
      faceStatus: attempt.faceStatus,
      fullscreenActive: attempt.fullscreenActive,
      lastHeartbeatAt: attempt.lastHeartbeatAt,
      answers: (attempt.answers || []).map(a => ({
        questionId: a.questionId,
        selectedOption: a.selectedOption,
        markedForReview: a.markedForReview
      }))
    };
  }
}
