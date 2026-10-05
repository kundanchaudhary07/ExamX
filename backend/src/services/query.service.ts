import { StudentQuery, IStudentQueryDocument, QueryReasonType } from '../models/StudentQuery';
import { Exam } from '../models/Exam';
import { ExamAssignment } from '../models/ExamAssignment';
import { ExamAttempt } from '../models/ExamAttempt';
import { Result } from '../models/Result';
import { Question } from '../models/Question';
import { User } from '../models/User';
import { JwtUserPayload } from '../types/auth.types';
import { generateNextQueryId } from '../utils/exam-id.generator';
import { AuditService } from './audit.service';
import { emitToRooms, emitNotification } from '../realtime/socket';
import { logger } from '../utils/logger';

const VALID_REASONS: QueryReasonType[] = [
  'AMBIGUOUS_QUESTION',
  'INCORRECT_KEY',
  'EVALUATION_ERROR',
  'TECHNICAL_GLITCH',
  'OTHER',
  'INCORRECT_QUESTION',
  'TYPO_ERROR',
  'TECHNICAL_ISSUE',
  'OUT_OF_SYLLABUS',
  'INCORRECT_OPTIONS',
  'MULTIPLE_OPTIONS_CORRECT',
  'QUESTION_UNCLEAR'
];

function normalizeQueryReason(reason?: QueryReasonType): QueryReasonType {
  return reason || 'INCORRECT_KEY';
}

export class QueryService {
  /**
   * Student creates a query for an exam they are assigned to or have attempted
   */
  static async createQuery(
    input: {
      examId: string;
      questionId?: string;
      questionText?: string;
      studentAnswer?: string;
      expectedAnswer?: string;
      reason?: QueryReasonType;
      reasonType?: QueryReasonType;
      explanation?: string;
      message?: string;
      description?: string;
      attemptId?: string;
      question?: string;
      deviceSessionId?: string;
    },
    user: JwtUserPayload
  ): Promise<IStudentQueryDocument> {
    if (user.role !== 'STUDENT') {
      const err: any = new Error('Forbidden: Only students can submit examination queries');
      err.statusCode = 403;
      throw err;
    }

    if (!input.examId || typeof input.examId !== 'string' || !input.examId.trim()) {
      const err: any = new Error('examId is required');
      err.statusCode = 400;
      throw err;
    }

    const rawText =
      input.explanation ?? input.message ?? input.description ?? input.question ?? '';
    if (!rawText || typeof rawText !== 'string' || !rawText.trim()) {
      const err: any = new Error('Query explanation is required');
      err.statusCode = 400;
      throw err;
    }

    const examId = input.examId.trim();
    const exam = await Exam.findOne({ examId });
    if (!exam) {
      const err: any = new Error(`Exam ${examId} not found`);
      err.statusCode = 404;
      throw err;
    }

    // Verify student is assigned to or attempted this exam
    const isAssigned =
      (Array.isArray(exam.assignedStudentIds) && exam.assignedStudentIds.includes(user.userId)) ||
      (Array.isArray(exam.assignedStudents) && exam.assignedStudents.includes(user.userId)) ||
      Boolean(await ExamAssignment.exists({ examId, studentId: user.userId })) ||
      Boolean(await ExamAttempt.exists({ examId, studentId: user.userId }));

    if (!isAssigned) {
      const err: any = new Error('Forbidden: You cannot raise a query for an examination you are not assigned to');
      err.statusCode = 403;
      throw err;
    }

    const attempt = input.attemptId
      ? await ExamAttempt.findOne({ attemptId: input.attemptId.trim(), examId, studentId: user.userId })
      : await ExamAttempt.findOne({ examId, studentId: user.userId }).sort({ createdAt: -1 });
    if (input.attemptId && !attempt) {
      const err: any = new Error('The supplied attempt does not belong to this student or examination');
      err.statusCode = 403;
      throw err;
    }
    if (attempt?.status === 'IN_PROGRESS' && attempt.deviceSessionId !== input.deviceSessionId) {
      const err: any = new Error('This examination attempt is active in another browser or device.');
      err.statusCode = 403;
      throw err;
    }

    const question = input.questionId
      ? await Question.findOne({ questionId: input.questionId.trim() })
      : null;
    if (input.questionId && (!question || !exam.questions.includes(question.questionId))) {
      const err: any = new Error('The reported question does not belong to this examination');
      err.statusCode = 400;
      throw err;
    }

    const student = await User.findOne({ userId: user.userId, role: 'STUDENT' }).select('managedBy teacherIds').lean();
    const facultyIds = Array.from(new Set([...(student?.managedBy || []), ...(student?.teacherIds || [])]));
    const facultyCandidates = Array.from(new Set([exam.createdBy, ...facultyIds]));
    const faculty = await User.findOne({
      userId: { $in: facultyCandidates },
      role: 'TEACHER',
      status: 'ACTIVE'
    }).select('userId').lean();
    const assignedFacultyId =
      faculty?.userId && facultyIds.includes(faculty.userId)
        ? faculty.userId
        : facultyCandidates.includes(exam.createdBy) && faculty?.userId === exam.createdBy
        ? exam.createdBy
        : '';
    if (!assignedFacultyId) {
      const err: any = new Error('No active faculty member is assigned to review this student for the examination');
      err.statusCode = 409;
      throw err;
    }

    const rawReason = input.reason ?? input.reasonType;
    const reason: QueryReasonType = normalizeQueryReason(
      rawReason && VALID_REASONS.includes(rawReason) ? rawReason : 'INCORRECT_KEY'
    );

    const queryId = await generateNextQueryId();
    const questionText = question?.questionText || (input.questionText || input.questionId || 'General Examination Query').trim();
    const questionIndex = question ? exam.questions.indexOf(question.questionId) : -1;
    const attemptAnswer = question && attempt
      ? attempt.answers.find(answer => answer.questionId === question.questionId)
      : undefined;
    const selectedAnswer = attemptAnswer?.selectedOption || '';

    const queryDoc = await StudentQuery.create({
      queryId,
      examId,
      examTitle: exam.title,
      attemptId: attempt?.attemptId || '',
      questionId: (input.questionId || '').trim(),
      questionNumber: questionIndex >= 0 ? questionIndex + 1 : 0,
      questionText,
      options: question?.options.map(option => ({ id: option.id, text: option.text })) || [],
      studentId: user.userId,
      studentName: user.name,
      studentAnswer: selectedAnswer || (input.studentAnswer || '').trim(),
      expectedAnswer: '',
      assignedFacultyId,
      reason,
      explanation: rawText.trim(),
      status: 'PENDING',
      scoreAdjustment: 0
    });

    // If a published result exists, mark it as QUERIED
    await Result.updateOne(
      { examId, studentId: user.userId, status: 'PUBLISHED' },
      { $set: { status: 'QUERIED' } }
    );

    await AuditService.record({
      actorId: user.userId,
      actorName: user.name,
      actorRole: 'STUDENT',
      action: 'QUERY_CREATED',
      targetType: 'QUERY',
      targetId: queryId,
      details: `Student ${user.userId} created query ${queryId} for exam ${examId}`
    });

    const queryJson = queryDoc.toJSON();
    if (attempt && question && !attempt.reportedQuestionIds.includes(question.questionId)) {
      attempt.reportedQuestionIds.push(question.questionId);
      await attempt.save();
    }

    emitToRooms(
      ['role:ADMIN', `teacher:${assignedFacultyId}`, `student:${user.userId}`],
      'query.created',
      { query: queryJson },
      user.userId
    );
    emitNotification(
      ['role:ADMIN', `teacher:${assignedFacultyId}`],
      {
        id: `notif-${Date.now()}-${queryId}`,
        title: `New query submitted by ${user.name} on ${exam.title}`
      },
      user.userId
    );

    logger.info(`Query ${queryId} created by student ${user.userId} for exam ${examId}`);
    return queryDoc;
  }

  /**
   * List queries with strict RBAC ownership isolation
   */
  static async getQueries(
    filters: { examId?: string; status?: string },
    user: JwtUserPayload
  ): Promise<IStudentQueryDocument[]> {
    if (user.role === 'STUDENT') {
      const query: any = { studentId: user.userId };
      if (filters.examId) query.examId = filters.examId;
      if (filters.status) query.status = filters.status;
      return StudentQuery.find(query).sort({ createdAt: -1 });
    }

    if (user.role === 'TEACHER') {
      const query: any = { assignedFacultyId: user.userId };
      if (filters.examId) query.examId = filters.examId;
      if (filters.status) query.status = filters.status;
      return StudentQuery.find(query).sort({ createdAt: -1 });
    }

    // ADMIN
    const query: any = {};
    if (filters.examId) query.examId = filters.examId;
    if (filters.status) query.status = filters.status;
    return StudentQuery.find(query).sort({ createdAt: -1 });
  }

  /**
   * Resolve query (Teacher of exam or Admin)
   */
  static async resolveQuery(
    queryId: string,
    payload: {
      decision?: 'ACCEPT' | 'REJECT';
      status?: string;
      teacherRemarks?: string;
      response?: string;
      scoreAdjustment?: number;
      resolutionType?: string;
      resolutionNotes?: string;
      correctedAnswer?: string;
    },
    user: JwtUserPayload
  ): Promise<IStudentQueryDocument> {
    if (user.role === 'STUDENT') {
      const err: any = new Error('Forbidden: Students cannot resolve queries');
      err.statusCode = 403;
      throw err;
    }

    const queryDoc = await StudentQuery.findOne({ queryId });
    if (!queryDoc) {
      const err: any = new Error(`Query ${queryId} not found`);
      err.statusCode = 404;
      throw err;
    }

    const exam = await Exam.findOne({ examId: queryDoc.examId });
    if (!exam) {
      const err: any = new Error('Associated examination not found');
      err.statusCode = 404;
      throw err;
    }

    if (user.role === 'TEACHER' && queryDoc.assignedFacultyId !== user.userId) {
      const err: any = new Error('Forbidden: This query is not assigned to you');
      err.statusCode = 403;
      throw err;
    }
    if (queryDoc.status !== 'PENDING' && queryDoc.status !== 'UNDER_REVIEW') {
      const err: any = new Error(`Query is already ${queryDoc.status.toLowerCase()}`);
      err.statusCode = 409;
      throw err;
    }

    let resolvedDecision: 'ACCEPT' | 'REJECT' | undefined = payload.decision;
    if (!resolvedDecision && payload.resolutionType) {
      resolvedDecision = payload.resolutionType === 'VALID_QUESTION' ? 'REJECT' : 'ACCEPT';
    }
    if (!resolvedDecision && payload.status) {
      if (['APPROVED', 'RESOLVED', 'RESOLVED_ACCEPTED', 'ACCEPT'].includes(payload.status)) {
        resolvedDecision = 'ACCEPT';
      } else if (['REJECTED', 'RESOLVED_REJECTED', 'REJECT'].includes(payload.status)) {
        resolvedDecision = 'REJECT';
      }
    }

    if (!resolvedDecision || !['ACCEPT', 'REJECT'].includes(resolvedDecision)) {
      const err: any = new Error('Decision must be ACCEPT/APPROVED or REJECT/REJECTED');
      err.statusCode = 400;
      throw err;
    }

    const resolutionType =
      payload.resolutionType ||
      (typeof payload.scoreAdjustment === 'number' && payload.scoreAdjustment !== 0
        ? 'GRACE_MARKS'
        : resolvedDecision === 'ACCEPT'
        ? 'EXCLUDE_QUESTION'
        : 'VALID_QUESTION');
    const validResolutions = [
      'VALID_QUESTION',
      'OUT_OF_SYLLABUS',
      'INVALID_QUESTION',
      'CORRECT_ANSWER_CHANGED',
      'GRACE_MARKS',
      'EXCLUDE_QUESTION'
    ];
    if (!validResolutions.includes(resolutionType)) {
      const err: any = new Error(`resolutionType must be one of: ${validResolutions.join(', ')}`);
      err.statusCode = 400;
      throw err;
    }
    if (
      resolutionType === 'CORRECT_ANSWER_CHANGED' &&
      (!payload.correctedAnswer || typeof payload.correctedAnswer !== 'string')
    ) {
      const err: any = new Error('A corrected answer option is required');
      err.statusCode = 400;
      throw err;
    }
    if (resolutionType === 'GRACE_MARKS' && typeof payload.scoreAdjustment !== 'number') {
      const err: any = new Error('A numeric grace-mark adjustment is required');
      err.statusCode = 400;
      throw err;
    }
    if (resolutionType === 'CORRECT_ANSWER_CHANGED') {
      const question = await Question.findOne({ questionId: queryDoc.questionId });
      const corrected = payload.correctedAnswer!.trim();
      if (!question || !question.options.some(option => option.id === corrected)) {
        const err: any = new Error('The corrected answer must match an option on the reported question');
        err.statusCode = 400;
        throw err;
      }
    }

    const adjustment = resolutionType === 'GRACE_MARKS' && typeof payload.scoreAdjustment === 'number'
      ? payload.scoreAdjustment
      : 0;

    const remarks = (payload.resolutionNotes ?? payload.teacherRemarks ?? payload.response ?? '').trim();

    const resolutionAccepted = resolutionType !== 'VALID_QUESTION';
    queryDoc.status = resolutionAccepted ? 'RESOLVED_ACCEPTED' : 'RESOLVED_REJECTED';
    queryDoc.teacherRemarks =
      remarks ||
      (resolvedDecision === 'ACCEPT'
        ? 'Query accepted after verification.'
        : 'Answer key verified as accurate.');
    queryDoc.scoreAdjustment = adjustment;
    queryDoc.resolutionType = resolutionType as NonNullable<typeof queryDoc.resolutionType>;
    queryDoc.resolutionNotes = remarks;
    queryDoc.correctedAnswer = payload.correctedAnswer?.trim() || '';
    queryDoc.resolvedBy = user.userId;
    queryDoc.resolvedAt = new Date();
    await queryDoc.save();

    const resultDoc = await Result.findOne({ attemptId: queryDoc.attemptId || '', examId: queryDoc.examId, studentId: queryDoc.studentId });
    if (resolutionType === 'CORRECT_ANSWER_CHANGED' && queryDoc.questionId) {
      const question = await Question.findOne({ questionId: queryDoc.questionId });
      const corrected = payload.correctedAnswer!.trim();
      if (question) {
        question.correctOption = corrected;
        question.correctAnswer = corrected;
        await question.save();
      }
    }

    if (resultDoc) {
      const answer = resultDoc.answers.find(item => item.questionId === queryDoc.questionId);
      if (answer && resolutionType === 'CORRECT_ANSWER_CHANGED') {
        answer.correctOption = queryDoc.correctedAnswer || '';
        answer.isCorrect = answer.selectedOption === answer.correctOption;
        const question = await Question.findOne({ questionId: queryDoc.questionId }).lean();
        answer.marksAwarded = answer.isCorrect
          ? answer.maxMarks
          : answer.selectedOption
          ? -(question?.negativeMarks || 0)
          : 0;
      }
      if (
        answer &&
        ['OUT_OF_SYLLABUS', 'INVALID_QUESTION', 'EXCLUDE_QUESTION'].includes(resolutionType)
      ) {
        answer.excluded = true;
        answer.marksAwarded = 0;
        answer.maxMarks = 0;
      }
      if (resolutionType === 'VALID_QUESTION') {
        if (resultDoc.status === 'QUERIED') resultDoc.status = 'PUBLISHED';
      } else {
        const graceResolutions = await StudentQuery.find({
          attemptId: queryDoc.attemptId,
          status: 'RESOLVED_ACCEPTED',
          resolutionType: 'GRACE_MARKS'
        }).select('scoreAdjustment').lean();
        const totalGraceMarks = graceResolutions.reduce((sum, item) => sum + (item.scoreAdjustment || 0), 0);
        const previousTotalMarks = resultDoc.totalMarks;
        resultDoc.totalMarks = resultDoc.answers.reduce((sum, item) => sum + item.maxMarks, 0);
        resultDoc.passingMarks =
          previousTotalMarks > 0
            ? Math.min(
                resultDoc.totalMarks,
                Number(((resultDoc.passingMarks / previousTotalMarks) * resultDoc.totalMarks).toFixed(2))
              )
            : 0;
        resultDoc.score = Math.min(
          resultDoc.totalMarks,
          Math.max(0, resultDoc.answers.reduce((sum, item) => sum + item.marksAwarded, 0) + totalGraceMarks)
        );
        resultDoc.percentage =
          resultDoc.totalMarks > 0 ? Number(((resultDoc.score / resultDoc.totalMarks) * 100).toFixed(2)) : 0;
        resultDoc.passed = resultDoc.score >= resultDoc.passingMarks;
        resultDoc.status = 'REVISED';
        resultDoc.feedback = [resultDoc.feedback, `Query ${queryId}: ${resolutionType}. ${remarks}`]
          .filter(Boolean)
          .join('\n');
      }
      await resultDoc.save();

      emitToRooms(
        ['role:ADMIN', `teacher:${queryDoc.assignedFacultyId}`, `student:${queryDoc.studentId}`],
        'result.updated',
        { result: resultDoc.toJSON() },
        user.userId
      );
    }

    await AuditService.record({
      actorId: user.userId,
      actorName: user.name,
      actorRole: user.role,
      action: 'QUERY_RESOLVED',
      targetType: 'QUERY',
      targetId: queryId,
      details: `Query ${queryId} resolved as ${queryDoc.status} (${resolutionType}) by ${user.userId}. ${remarks}`
    });

    const queryJson = queryDoc.toJSON();
    const targetRooms = ['role:ADMIN', `teacher:${queryDoc.assignedFacultyId}`, `student:${queryDoc.studentId}`];
    emitToRooms(targetRooms, 'query.updated', { query: queryJson }, user.userId);
    emitToRooms(targetRooms, 'query.resolved', { query: queryJson }, user.userId);
    emitNotification(
      [`student:${queryDoc.studentId}`],
      {
        id: `notif-${Date.now()}-${queryId}`,
        title: `Your query on ${queryDoc.examTitle} was resolved`
      },
      user.userId
    );

    return queryDoc;
  }
}
