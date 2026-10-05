import { Result, IResultDocument } from '../models/Result';
import { Exam } from '../models/Exam';
import { JwtUserPayload } from '../types/auth.types';
import { AuditService } from './audit.service';
import { emitToRooms, emitNotification } from '../realtime/socket';
import { logger } from '../utils/logger';

export class ResultService {
  /**
   * Return only aggregate rank information for the authenticated student.
   */
  static async getStudentRankings(
    examId: string | undefined,
    user: JwtUserPayload
  ): Promise<{
    examRank: { rank: number; totalRankedStudents: number; percentile: number; score: number; totalMarks: number } | null;
    overallRank: {
      rank: number;
      totalRankedStudents: number;
      percentile: number;
      averagePercentage: number;
      examsAttempted: number;
      passed: number;
    } | null;
  }> {
    if (user.role !== 'STUDENT') {
      const err: any = new Error('Forbidden: Aggregate student rankings are only available to students');
      err.statusCode = 403;
      throw err;
    }

    const visibleStatuses = ['PUBLISHED', 'QUERIED', 'REVISED'] as const;
    const ownQuery = {
      studentId: user.userId,
      status: { $in: visibleStatuses },
      ...(examId ? { examId } : {})
    };

    const [ownResults, peerExamResults, allPublishedResults] = await Promise.all([
      Result.find(ownQuery).sort({ submittedAt: -1, _id: -1 }).lean(),
      examId
        ? Result.find({ examId, status: { $in: visibleStatuses } })
            .select('studentId examId attemptId score totalMarks percentage submittedAt')
            .sort({ submittedAt: -1, _id: -1 })
            .lean()
        : Promise.resolve([]),
      Result.find({ status: { $in: visibleStatuses } })
        .select('studentId examId attemptId score totalMarks percentage passed submittedAt')
        .sort({ submittedAt: -1, _id: -1 })
        .lean()
    ]);

    const latestForStudentAndExam = <T extends {
      studentId: string;
      examId: string;
      submittedAt: Date;
    }>(records: T[]): T[] => {
      const latest = new Map<string, T>();
      records.forEach(record => {
        const key = `${record.studentId}:${record.examId}`;
        if (!latest.has(key)) latest.set(key, record);
      });
      return Array.from(latest.values());
    };
    const getPercentile = (rank: number, total: number): number =>
      total <= 1 ? 100 : Math.round(((total - rank) / total) * 10000) / 100;
    const getRank = <T>(records: T[], scoreOf: (record: T) => number, ownScore: number) =>
      1 + records.filter(record => scoreOf(record) > ownScore).length;

    const ownExamResult = examId
      ? ownResults.find(result => result.examId === examId)
      : undefined;
    const rankedExamResults = examId
      ? latestForStudentAndExam(peerExamResults)
          .filter(result => Number.isFinite(result.score))
          .map(result => ({
            studentId: result.studentId,
            score: result.score,
            totalMarks: result.totalMarks,
            percentage: result.percentage
          }))
      : [];
    const examRank = ownExamResult && rankedExamResults.length > 0
      ? (() => {
          const ownScore = ownExamResult.score;
          const rank = getRank(rankedExamResults, result => result.score, ownScore);
          return {
            rank,
            totalRankedStudents: rankedExamResults.length,
            percentile: getPercentile(rank, rankedExamResults.length),
            score: ownExamResult.score,
            totalMarks: ownExamResult.totalMarks
          };
        })()
      : null;

    const overallByStudentAndExam = latestForStudentAndExam(allPublishedResults);
    const overallByStudent = new Map<string, { scores: number[]; passed: number }>();
    overallByStudentAndExam.forEach(result => {
      const percentage = Number.isFinite(result.percentage)
        ? result.percentage
        : result.totalMarks > 0
          ? (result.score / result.totalMarks) * 100
          : null;
      if (percentage === null || !Number.isFinite(percentage)) return;
      const aggregate = overallByStudent.get(result.studentId) || { scores: [], passed: 0 };
      aggregate.scores.push(percentage);
      if (result.passed) aggregate.passed += 1;
      overallByStudent.set(result.studentId, aggregate);
    });
    const overallRows = Array.from(overallByStudent, ([studentId, aggregate]) => ({
      studentId,
      averagePercentage: aggregate.scores.reduce((sum, score) => sum + score, 0) / aggregate.scores.length,
      examsAttempted: aggregate.scores.length,
      passed: aggregate.passed
    }));
    const ownOverall = overallRows.find(row => row.studentId === user.userId);
    const overallRank = ownOverall
      ? (() => {
          const rank = getRank(overallRows, row => row.averagePercentage, ownOverall.averagePercentage);
          return {
            rank,
            totalRankedStudents: overallRows.length,
            percentile: getPercentile(rank, overallRows.length),
            averagePercentage: Math.round(ownOverall.averagePercentage * 100) / 100,
            examsAttempted: ownOverall.examsAttempted,
            passed: ownOverall.passed
          };
        })()
      : null;

    return { examRank, overallRank };
  }

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

    const publishedResults = pendingResults.map(r => ({
        ...r.toJSON(),
        status: 'PUBLISHED',
        publishedAt: now,
        verifiedBy: user.userId
      }));

    emitToRooms(
      ['role:ADMIN', `teacher:${exam.createdBy}`],
      'results.bulkPublished',
      {
        examId,
        resultIds: publishedResults.map(result => result.resultId),
        publishedAt: now,
        publishedBy: user.userId
      },
      user.userId
    );

    for (const result of publishedResults) {
      emitToRooms(
        [`student:${result.studentId}`],
        'result.published',
        { result },
        user.userId
      );
      emitNotification(
        [`student:${result.studentId}`],
        {
          id: `notif-${Date.now()}-${result.resultId}`,
          title: `Result published for ${exam.title}`
        },
        user.userId
      );
    }

    return { publishedCount: res.modifiedCount };
  }
}
