import { UnblockRequest, IUnblockRequestDocument, UnblockStatus } from '../models/UnblockRequest';
import { ExamAttempt } from '../models/ExamAttempt';
import { Exam } from '../models/Exam';
import { User } from '../models/User';
import { JwtUserPayload } from '../types/auth.types';
import { generateNextUnblockRequestId } from '../utils/exam-id.generator';
import { emitToRooms, emitTeacherAndAdmin, emitStudentTeacherAdmin } from '../realtime/socket';
import { AuditService } from './audit.service';
import { logger } from '../utils/logger';

export class UnblockService {
  /**
   * Blocked student submits an unblock / review request
   */
  static async requestUnblock(
    input: {
      attemptId: string;
      examId: string;
      reason: string;
    },
    user: JwtUserPayload
  ): Promise<IUnblockRequestDocument> {
    if (user.role !== 'STUDENT') {
      const err: any = new Error('Forbidden: Only students can request unblock review');
      err.statusCode = 403;
      throw err;
    }

    if (!input.attemptId || typeof input.attemptId !== 'string' || !input.attemptId.trim()) {
      const err: any = new Error('attemptId is required');
      err.statusCode = 400;
      throw err;
    }

    if (!input.examId || typeof input.examId !== 'string' || !input.examId.trim()) {
      const err: any = new Error('examId is required');
      err.statusCode = 400;
      throw err;
    }

    if (!input.reason || typeof input.reason !== 'string' || !input.reason.trim()) {
      const err: any = new Error('Reason for unblock review is required');
      err.statusCode = 400;
      throw err;
    }

    const attemptId = input.attemptId.trim();
    const examId = input.examId.trim();

    const [attempt, exam] = await Promise.all([
      ExamAttempt.findOne({ attemptId }),
      Exam.findOne({ examId })
    ]);

    if (!attempt) {
      const err: any = new Error(`Attempt ${attemptId} not found`);
      err.statusCode = 404;
      throw err;
    }

    if (attempt.studentId !== user.userId) {
      const err: any = new Error('Forbidden: You can only request unblock for your own examination attempts');
      err.statusCode = 403;
      throw err;
    }

    // Check if there is already a pending request for this attempt
    const existingPending = await UnblockRequest.findOne({ attemptId, status: 'PENDING' });
    if (existingPending) {
      const err: any = new Error('A review request is already pending for this examination attempt');
      err.statusCode = 400;
      throw err;
    }

    const requestId = await generateNextUnblockRequestId();
    const doc = await UnblockRequest.create({
      requestId,
      attemptId,
      examId,
      examTitle: exam?.title || 'Examination',
      studentId: user.userId,
      studentName: user.name,
      reason: input.reason.trim(),
      status: 'PENDING',
      warningCount: attempt.warningCount || 6
    });

    // Notify exam teacher and admins
    if (exam?.createdBy) {
      emitTeacherAndAdmin(exam.createdBy, 'unblock.created', { request: doc.toJSON() }, user.userId);
    } else {
      emitToRooms(['role:ADMIN'], 'unblock.created', { request: doc.toJSON() }, user.userId);
    }

    await AuditService.logAction({
      action: 'UNBLOCK_REQUEST_SUBMITTED',
      actorId: user.userId,
      actorName: user.name,
      actorRole: user.role,
      targetType: 'EXAM_ATTEMPT',
      targetId: attemptId,
      details: `Student submitted review request ${requestId} for attempt ${attemptId} on exam ${examId}: "${input.reason.trim()}"`
    });

    logger.info(`Unblock request ${requestId} created by student ${user.userId} for attempt ${attemptId}`);
    return doc;
  }

  /**
   * List unblock requests according to role
   */
  static async listUnblockRequests(
    filters: { examId?: string; studentId?: string; status?: string },
    user: JwtUserPayload
  ): Promise<IUnblockRequestDocument[]> {
    if (user.role === 'STUDENT') {
      const query: any = { studentId: user.userId };
      if (filters.examId) query.examId = filters.examId;
      if (filters.status) query.status = filters.status;
      return UnblockRequest.find(query).sort({ createdAt: -1 });
    }

    if (user.role === 'TEACHER') {
      const [teacherExams, supervisedStudents] = await Promise.all([
        Exam.find({ createdBy: user.userId }).select('examId').lean(),
        User.find({
          role: 'STUDENT',
          $or: [{ managedBy: user.userId }, { teacherIds: user.userId }]
        }).select('userId').lean()
      ]);

      const examIds = teacherExams.map(e => e.examId);
      const studentIds = supervisedStudents.map(s => s.userId);

      const query: any = {
        $or: [
          { examId: { $in: examIds } },
          { studentId: { $in: studentIds } }
        ]
      };

      if (filters.examId) query.examId = filters.examId;
      if (filters.studentId) query.studentId = filters.studentId;
      if (filters.status) query.status = filters.status;

      return UnblockRequest.find(query).sort({ createdAt: -1 });
    }

    // ADMIN
    const query: any = {};
    if (filters.examId) query.examId = filters.examId;
    if (filters.studentId) query.studentId = filters.studentId;
    if (filters.status) query.status = filters.status;
    return UnblockRequest.find(query).sort({ createdAt: -1 });
  }

  /**
   * Teacher or Admin reviews unblock request (Approve or Reject)
   */
  static async reviewUnblockRequest(
    requestId: string,
    decision: { status: 'APPROVED' | 'REJECTED'; remarks?: string },
    user: JwtUserPayload
  ): Promise<IUnblockRequestDocument> {
    if (user.role !== 'TEACHER' && user.role !== 'ADMIN') {
      const err: any = new Error('Forbidden: Only faculty or administrators can adjudicate unblock requests');
      err.statusCode = 403;
      throw err;
    }

    if (!['APPROVED', 'REJECTED'].includes(decision.status)) {
      const err: any = new Error('Decision status must be either APPROVED or REJECTED');
      err.statusCode = 400;
      throw err;
    }

    const doc = await UnblockRequest.findOne({ requestId });
    if (!doc) {
      const err: any = new Error(`Unblock request ${requestId} not found`);
      err.statusCode = 404;
      throw err;
    }

    const exam = await Exam.findOne({ examId: doc.examId });

    if (user.role === 'TEACHER') {
      const isExamOwner = exam?.createdBy === user.userId;
      const studentDoc = await User.findOne({ userId: doc.studentId }).lean();
      const isSupervised =
        Array.isArray(studentDoc?.managedBy) && studentDoc.managedBy.includes(user.userId);

      if (!isExamOwner && !isSupervised) {
        const err: any = new Error('Forbidden: You are not authorized to review unblock requests for this candidate');
        err.statusCode = 403;
        throw err;
      }
    }

    doc.status = decision.status;
    doc.reviewedBy = user.userId;
    doc.reviewedByName = user.name;
    doc.reviewedAt = new Date();
    doc.remarks = (decision.remarks || '').trim();
    await doc.save();

    // If APPROVED, unblock the attempt and allow student to continue
    if (decision.status === 'APPROVED') {
      const attempt = await ExamAttempt.findOne({ attemptId: doc.attemptId });
      if (attempt) {
        attempt.status = 'IN_PROGRESS';
        attempt.proctoringStatus = 'WARNED';
        // Cap warning count at 5 so student can continue without being blocked instantly
        attempt.warningCount = Math.min(attempt.warningCount || 0, 5);
        await attempt.save();
      }
    }

    // Realtime notification to student and teacher
    emitStudentTeacherAdmin(
      doc.studentId,
      exam?.createdBy ? [exam.createdBy] : [],
      'unblock.updated',
      { request: doc.toJSON() },
      user.userId
    );

    await AuditService.logAction({
      action: decision.status === 'APPROVED' ? 'UNBLOCK_REQUEST_APPROVED' : 'UNBLOCK_REQUEST_REJECTED',
      actorId: user.userId,
      actorName: user.name,
      actorRole: user.role,
      targetType: 'UNBLOCK_REQUEST',
      targetId: requestId,
      details: `${user.role} ${user.name} ${decision.status.toLowerCase()} review request ${requestId} for student ${doc.studentId}. Remarks: "${doc.remarks}"`
    });

    logger.info(`Unblock request ${requestId} ${decision.status} by ${user.role} ${user.userId}`);
    return doc;
  }
}
