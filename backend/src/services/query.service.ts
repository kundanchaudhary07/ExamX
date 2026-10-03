import { StudentQuery, IStudentQueryDocument, QueryReasonType } from '../models/StudentQuery';
import { Exam } from '../models/Exam';
import { ExamAssignment } from '../models/ExamAssignment';
import { ExamAttempt } from '../models/ExamAttempt';
import { Result } from '../models/Result';
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
  'OTHER'
];

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
      input.explanation ?? input.message ?? input.description ?? (input as any).question ?? '';
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

    const rawReason = input.reason ?? input.reasonType;
    const reason: QueryReasonType =
      rawReason && VALID_REASONS.includes(rawReason) ? rawReason : 'INCORRECT_KEY';

    const queryId = await generateNextQueryId();
    const questionText = (input.questionText || input.questionId || 'General Examination Query').trim();

    const queryDoc = await StudentQuery.create({
      queryId,
      examId,
      examTitle: exam.title,
      questionId: (input.questionId || '').trim(),
      questionText,
      studentId: user.userId,
      studentName: user.name,
      studentAnswer: (input.studentAnswer || '').trim(),
      expectedAnswer: (input.expectedAnswer || '').trim(),
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
    emitToRooms(
      ['role:ADMIN', `teacher:${exam.createdBy}`, `student:${user.userId}`],
      'query.created',
      { query: queryJson },
      user.userId
    );
    emitNotification(
      ['role:ADMIN', `teacher:${exam.createdBy}`],
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

    if (user.role === 'TEACHER' && exam.createdBy !== user.userId) {
      const err: any = new Error('Forbidden: You are not authorized to adjudicate queries for this examination');
      err.statusCode = 403;
      throw err;
    }

    let resolvedDecision: 'ACCEPT' | 'REJECT' | undefined = payload.decision;
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

    const adjustment =
      resolvedDecision === 'ACCEPT' && typeof payload.scoreAdjustment === 'number'
        ? payload.scoreAdjustment
        : 0;

    const remarks = (payload.teacherRemarks ?? payload.response ?? '').trim();

    queryDoc.status = resolvedDecision === 'ACCEPT' ? 'RESOLVED_ACCEPTED' : 'RESOLVED_REJECTED';
    queryDoc.teacherRemarks =
      remarks ||
      (resolvedDecision === 'ACCEPT'
        ? 'Query accepted after verification.'
        : 'Answer key verified as accurate.');
    queryDoc.scoreAdjustment = adjustment;
    queryDoc.resolvedBy = user.userId;
    queryDoc.resolvedAt = new Date();
    await queryDoc.save();

    if (adjustment !== 0) {
      const resDoc = await Result.findOne({ examId: queryDoc.examId, studentId: queryDoc.studentId });
      if (resDoc) {
        resDoc.score = Math.min(resDoc.totalMarks, Math.max(0, resDoc.score + adjustment));
        resDoc.percentage =
          resDoc.totalMarks > 0 ? Number(((resDoc.score / resDoc.totalMarks) * 100).toFixed(2)) : 0;
        resDoc.passed = resDoc.score >= resDoc.passingMarks;
        resDoc.status = 'REVISED';
        await resDoc.save();

        emitToRooms(
          ['role:ADMIN', `teacher:${exam.createdBy}`, `student:${queryDoc.studentId}`],
          'result.updated',
          { result: resDoc.toJSON() },
          user.userId
        );
      }
    } else {
      await Result.updateOne(
        { examId: queryDoc.examId, studentId: queryDoc.studentId, status: 'QUERIED' },
        { $set: { status: 'PUBLISHED' } }
      );
    }

    await AuditService.record({
      actorId: user.userId,
      actorName: user.name,
      actorRole: user.role,
      action: 'QUERY_RESOLVED',
      targetType: 'QUERY',
      targetId: queryId,
      details: `Query ${queryId} resolved as ${queryDoc.status} by ${user.userId}`
    });

    const queryJson = queryDoc.toJSON();
    const targetRooms = ['role:ADMIN', `teacher:${exam.createdBy}`, `student:${queryDoc.studentId}`];
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
