import { UnblockRequest, IUnblockRequestDocument, UnblockStatus } from '../models/UnblockRequest';
import { ExamAttempt } from '../models/ExamAttempt';
import { Exam } from '../models/Exam';
import { User } from '../models/User';
import { JwtUserPayload } from '../types/auth.types';
import { generateNextUnblockRequestId } from '../utils/exam-id.generator';
import { emitToRooms, emitTeacherAndAdmin, emitStudentTeacherAdmin } from '../realtime/socket';
import { AuditService } from './audit.service';
import { AttemptService } from './attempt.service';
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
      deviceSessionId?: string;
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
    if (!exam) {
      const err: any = new Error(`Exam ${examId} not found`);
      err.statusCode = 404;
      throw err;
    }

    if (attempt.studentId !== user.userId) {
      const err: any = new Error('Forbidden: You can only request unblock for your own examination attempts');
      err.statusCode = 403;
      throw err;
    }
    if (attempt.examId !== examId || !attempt.suspended || attempt.status !== 'IN_PROGRESS') {
      const err: any = new Error('Faculty assistance is available only for your currently suspended attempt');
      err.statusCode = 400;
      throw err;
    }
    if (!input.deviceSessionId || attempt.deviceSessionId !== input.deviceSessionId) {
      const err: any = new Error('This examination attempt is active in another browser or device.');
      err.statusCode = 403;
      throw err;
    }

    const student = await User.findOne({ userId: user.userId, role: 'STUDENT' })
      .select('managedBy teacherIds')
      .lean();
    const facultyIds = Array.from(new Set([
      ...(student?.managedBy || []),
      ...(student?.teacherIds || [])
    ]));
    const candidates = Array.from(new Set([exam.createdBy, ...facultyIds]));
    const faculty = await User.findOne({
      userId: { $in: candidates },
      role: 'TEACHER',
      status: 'ACTIVE'
    }).select('userId').lean();
    const assignedFacultyId =
      faculty?.userId && facultyIds.includes(faculty.userId)
        ? faculty.userId
        : faculty?.userId === exam.createdBy
        ? exam.createdBy
        : '';
    if (!assignedFacultyId) {
      const err: any = new Error('No faculty member is assigned to review this student');
      err.statusCode = 409;
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
      assignedFacultyId,
      reason: input.reason.trim(),
      status: 'PENDING',
      warningCount: attempt.warningCount || 5
    });

    emitTeacherAndAdmin(assignedFacultyId, 'unblock.created', { request: doc.toJSON() }, user.userId);

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
      const query: any = { assignedFacultyId: user.userId };

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

    let doc = await UnblockRequest.findOne({ requestId });
    if (!doc) {
      const err: any = new Error(`Unblock request ${requestId} not found`);
      err.statusCode = 404;
      throw err;
    }

    if (doc.status !== 'PENDING') {
      const err: any = new Error(`Assistance request is already ${doc.status.toLowerCase()}`);
      err.statusCode = 409;
      throw err;
    }

    if (user.role === 'TEACHER' && doc.assignedFacultyId !== user.userId) {
      const err: any = new Error('Forbidden: This assistance request is not assigned to you');
      err.statusCode = 403;
      throw err;
    }

    const attempt = await ExamAttempt.findOne({ attemptId: doc.attemptId });

    if (
      decision.status === 'APPROVED' &&
      (!attempt || attempt.status !== 'IN_PROGRESS' || attempt.expiresAt.getTime() <= Date.now())
    ) {
      const err: any = new Error('This examination attempt has expired or is no longer resumable');
      err.statusCode = 409;
      throw err;
    }
    if (
      decision.status === 'REJECTED' &&
      (!attempt || attempt.status !== 'IN_PROGRESS' || !attempt.suspended)
    ) {
      const err: any = new Error('This assistance request is no longer associated with a suspended active attempt');
      err.statusCode = 409;
      throw err;
    }

    const reviewedRequest = await UnblockRequest.findOneAndUpdate(
      { requestId, status: 'PENDING' },
      {
        $set: {
          status: decision.status,
          reviewedBy: user.userId,
          reviewedByName: user.name,
          reviewedAt: new Date(),
          remarks: (decision.remarks || '').trim()
        }
      },
      { returnDocument: 'after' }
    );
    if (!reviewedRequest) {
      const err: any = new Error('Assistance request has already been reviewed');
      err.statusCode = 409;
      throw err;
    }
    doc = reviewedRequest;

    // If APPROVED, unblock the attempt and allow student to continue
    if (decision.status === 'APPROVED') {
      attempt!.proctoringStatus = 'WARNED';
      attempt!.suspended = false;
      attempt!.lastHeartbeatAt = new Date();
      await attempt!.save();
    }

    let rejectionMessage: string | undefined;
    let submittedAttempt: any;
    let resultId: string | undefined;
    if (decision.status === 'REJECTED') {
      if (!attempt) {
        const err: any = new Error('The examination attempt could not be found for submission');
        err.statusCode = 409;
        throw err;
      }
      const claimedAttempt = await ExamAttempt.findOneAndUpdate(
        { attemptId: doc.attemptId, status: 'IN_PROGRESS', suspended: true },
        {
          $set: {
            status: 'SUBMITTED',
            submittedAt: new Date(),
            suspended: false,
            cameraStatus: 'OFFLINE'
          }
        },
        { returnDocument: 'after' }
      );
      if (!claimedAttempt) {
        const err: any = new Error('The suspended attempt is no longer available for faculty rejection');
        err.statusCode = 409;
        throw err;
      }
      const exam = await Exam.findOne({ examId: claimedAttempt.examId });
      if (!exam) {
        const err: any = new Error('The examination associated with this attempt could not be found');
        err.statusCode = 409;
        throw err;
      }
      const evaluated = await AttemptService.evaluateAndCreateResult(
        claimedAttempt,
        exam,
        claimedAttempt.answers || [],
        'SUBMITTED'
      );
      submittedAttempt = evaluated.attempt.toJSON();
      resultId = evaluated.result.resultId;
      rejectionMessage = 'Your assistance request was rejected. Your exam has been submitted.';
    }

    // Realtime notification to student and teacher
    emitStudentTeacherAdmin(
      doc.studentId,
      [doc.assignedFacultyId],
      'unblock.updated',
      {
        request: doc.toJSON(),
        attempt: submittedAttempt,
        resultId,
        message:
          decision.status === 'APPROVED'
            ? 'Faculty has approved your request.'
            : rejectionMessage
      },
      user.userId
    );
    if (decision.status === 'APPROVED') {
      emitToRooms(
        ['role:ADMIN', `teacher:${doc.assignedFacultyId}`, `student:${doc.studentId}`],
        'attempt.resumed',
        {
          attemptId: doc.attemptId,
          examId: doc.examId,
          studentId: doc.studentId,
          message: 'Faculty has approved your request.'
        },
        user.userId
      );
    } else {
      emitToRooms(
        ['role:ADMIN', `teacher:${doc.assignedFacultyId}`, `student:${doc.studentId}`],
        'attempt.submitted',
        {
          attemptId: doc.attemptId,
          examId: doc.examId,
          studentId: doc.studentId,
          attempt: submittedAttempt,
          resultId,
          message: rejectionMessage
        },
        user.userId
      );
    }

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
