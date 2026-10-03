import { Result, IResultDocument } from '../models/Result';
import { Exam } from '../models/Exam';
import { JwtUserPayload } from '../types/auth.types';
import { AuditService } from './audit.service';
import { emitToRooms, emitNotification } from '../realtime/socket';
import { logger } from '../utils/logger';

export class ResultService {
  /**
   * List results with strict RBAC and publication visibility:
   * - STUDENT: only sees OWN results that are PUBLISHED / QUERIED / REVISED
   * - TEACHER: only sees results for exams created by themselves
   * - ADMIN: sees all results
   */
  static async getResults(
    filters: { examId?: string; studentId?: string; status?: string },
    user: JwtUserPayload
  ): Promise<IResultDocument[]> {
    if (user.role === 'STUDENT') {
      if (filters.studentId && filters.studentId !== user.userId) {
        const err: any = new Error('Forbidden: Students cannot query another student result');
        err.statusCode = 403;
        throw err;
      }

      const query: any = {
        studentId: user.userId,
        status: { $in: ['PUBLISHED', 'QUERIED', 'REVISED'] }
      };
      if (filters.examId) {
        query.examId = filters.examId;
      }

      return Result.find(query).sort({ submittedAt: -1 });
    }

    if (user.role === 'TEACHER') {
      const teacherExams = await Exam.find({ createdBy: user.userId }).select('examId').lean();
      const teacherExamIds = teacherExams.map(e => e.examId);

      if (filters.examId && !teacherExamIds.includes(filters.examId)) {
        const err: any = new Error('Forbidden: You are not authorized to view results for this exam');
        err.statusCode = 403;
        throw err;
      }

      const query: any = {
        examId: filters.examId ? filters.examId : { $in: teacherExamIds }
      };
      if (filters.studentId) query.studentId = filters.studentId;
      if (filters.status) query.status = filters.status;

      return Result.find(query).sort({ submittedAt: -1 });
    }

    // ADMIN
    const query: any = {};
    if (filters.examId) query.examId = filters.examId;
    if (filters.studentId) query.studentId = filters.studentId;
    if (filters.status) query.status = filters.status;

    return Result.find(query).sort({ submittedAt: -1 });
  }

  /**
   * Get single result by resultId with strict ownership & publication checks
   */
  static async getResultById(resultId: string, user: JwtUserPayload): Promise<IResultDocument> {
    const result = await Result.findOne({ resultId });
    if (!result) {
      const err: any = new Error(`Result ${resultId} not found`);
      err.statusCode = 404;
      throw err;
    }

    if (user.role === 'STUDENT') {
      if (result.studentId !== user.userId) {
        const err: any = new Error("Forbidden: You are not authorized to access another student's result");
        err.statusCode = 403;
        throw err;
      }

      const publishedStatuses = ['PUBLISHED', 'QUERIED', 'REVISED'];
      if (!publishedStatuses.includes(result.status)) {
        const err: any = new Error('Forbidden: Result has not been published yet');
        err.statusCode = 403;
        throw err;
      }

      return result;
    }

    if (user.role === 'TEACHER') {
      const exam = await Exam.findOne({ examId: result.examId });
      if (!exam || exam.createdBy !== user.userId) {
        const err: any = new Error('Forbidden: You do not own the examination for this result');
        err.statusCode = 403;
        throw err;
      }
    }

    return result;
  }

  /**
   * Publish a single Result (Teacher of the exam or Admin)
   */
  static async publishResult(
    resultId: string,
    payload: { feedback?: string },
    user: JwtUserPayload
  ): Promise<IResultDocument> {
    const result = await Result.findOne({ resultId });
    if (!result) {
      const err: any = new Error(`Result ${resultId} not found`);
      err.statusCode = 404;
      throw err;
    }

    const exam = await Exam.findOne({ examId: result.examId });
    if (!exam) {
      const err: any = new Error('Associated examination not found');
      err.statusCode = 404;
      throw err;
    }

    if (user.role === 'TEACHER' && exam.createdBy !== user.userId) {
      const err: any = new Error('Forbidden: You are not authorized to publish results for this examination');
      err.statusCode = 403;
      throw err;
    }

    result.status = 'PUBLISHED';
    result.publishedAt = new Date();
    result.verifiedBy = user.userId;
    if (payload.feedback && typeof payload.feedback === 'string') {
      result.feedback = payload.feedback.trim();
    }

    await result.save();

    await AuditService.record({
      actorId: user.userId,
      actorName: user.name,
      actorRole: user.role,
      action: 'RESULT_PUBLISHED',
      targetType: 'RESULT',
      targetId: result.resultId,
      details: `Published result ${result.resultId} for student ${result.studentId} on exam ${result.examId}`
    });

    const resultJson = result.toJSON();
    emitToRooms(
      ['role:ADMIN', `teacher:${exam.createdBy}`, `student:${result.studentId}`],
      'result.published',
      { result: resultJson },
      user.userId
    );
    emitNotification(
      [`student:${result.studentId}`],
      {
        id: `notif-${Date.now()}-${result.resultId}`,
        title: `Result published for ${result.examTitle}`
      },
      user.userId
    );

    logger.info(`Result ${resultId} published by ${user.role} [${user.userId}]`);
    return result;
  }

  /**
   * Publish all pending/verified results for an examination
   */
  static async publishAllExamResults(
    examId: string,
    user: JwtUserPayload
  ): Promise<{ publishedCount: number }> {
    const exam = await Exam.findOne({ examId });
    if (!exam) {
      const err: any = new Error(`Exam ${examId} not found`);
      err.statusCode = 404;
      throw err;
    }

    if (user.role === 'TEACHER' && exam.createdBy !== user.userId) {
      const err: any = new Error('Forbidden: You are not authorized to publish results for this examination');
      err.statusCode = 403;
      throw err;
    }

    const pendingResults = await Result.find({
      examId,
      status: { $in: ['PENDING', 'VERIFIED'] }
    });

    const now = new Date();
    const res = await Result.updateMany(
      { examId, status: { $in: ['PENDING', 'VERIFIED'] } },
      {
        $set: {
          status: 'PUBLISHED',
          publishedAt: now,
          verifiedBy: user.userId
        }
      }
    );

    await AuditService.record({
      actorId: user.userId,
      actorName: user.name,
      actorRole: user.role,
      action: 'RESULT_PUBLISHED',
      targetType: 'EXAM',
      targetId: examId,
      details: `Published ${res.modifiedCount} results for exam ${examId}`
    });

    for (const r of pendingResults) {
      const updatedJson = {
        ...r.toJSON(),
        status: 'PUBLISHED',
        publishedAt: now,
        verifiedBy: user.userId
      };
      emitToRooms(
        ['role:ADMIN', `teacher:${exam.createdBy}`, `student:${r.studentId}`],
        'result.published',
        { result: updatedJson },
        user.userId
      );
      emitNotification(
        [`student:${r.studentId}`],
        {
          id: `notif-${Date.now()}-${r.resultId}`,
          title: `Result published for ${exam.title}`
        },
        user.userId
      );
    }

    return { publishedCount: res.modifiedCount };
  }
}
