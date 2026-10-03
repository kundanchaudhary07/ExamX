import {
  ProctoringEvent,
  IProctoringEventDocument,
  ProctoringEventType,
  ProctoringSeverity
} from '../models/ProctoringEvent';
import { Exam } from '../models/Exam';
import { ExamAssignment } from '../models/ExamAssignment';
import { ExamAttempt } from '../models/ExamAttempt';
import { JwtUserPayload } from '../types/auth.types';
import { generateNextProctoringEventId } from '../utils/exam-id.generator';
import { emitTeacherAndAdmin } from '../realtime/socket';
import { logger } from '../utils/logger';

const VALID_EVENT_TYPES: ProctoringEventType[] = [
  'TAB_SWITCH',
  'FULLSCREEN_EXIT',
  'NO_FACE',
  'MULTIPLE_FACES',
  'CAMERA_OFF',
  'CAMERA_BLOCKED',
  'LOOKING_AWAY',
  'COPY_PASTE_ATTEMPT',
  'RIGHT_CLICK_ATTEMPT',
  'SCREENSHOT_ATTEMPT'
];

const VALID_SEVERITIES: ProctoringSeverity[] = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

export class ProctoringService {
  /**
   * Record an actual browser proctoring event with ownership verification
   */
  static async recordEvent(
    input: {
      attemptId?: string;
      examId: string;
      eventType: ProctoringEventType;
      severity?: ProctoringSeverity;
      details?: string;
      metadata?: Record<string, any>;
    },
    user: JwtUserPayload
  ): Promise<IProctoringEventDocument> {
    if (user.role !== 'STUDENT') {
      const err: any = new Error('Forbidden: Only active candidate sessions can log proctoring events');
      err.statusCode = 403;
      throw err;
    }

    if (!input.examId || typeof input.examId !== 'string' || !input.examId.trim()) {
      const err: any = new Error('examId is required');
      err.statusCode = 400;
      throw err;
    }

    if (!input.eventType || !VALID_EVENT_TYPES.includes(input.eventType)) {
      const err: any = new Error(`Invalid proctoring eventType. Must be one of: ${VALID_EVENT_TYPES.join(', ')}`);
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

    // Verify attempt ownership if attemptId is provided
    let attemptId = '';
    if (input.attemptId && typeof input.attemptId === 'string' && input.attemptId.trim()) {
      attemptId = input.attemptId.trim();
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

      // SCREENSHOT_ATTEMPT events are informational / browser security warnings only and must NEVER increment the warning counter
      if (input.eventType !== 'SCREENSHOT_ATTEMPT') {
        attempt.warningCount = (attempt.warningCount || 0) + 1;
        attempt.proctoringStatus =
          attempt.warningCount >= 6
            ? 'TERMINATED'
            : attempt.warningCount >= 3
            ? 'FLAGGED'
            : 'WARNED';
        await attempt.save();
      }
    } else {
      // Verify student is assigned to exam
      const isAssigned =
        (Array.isArray(exam.assignedStudentIds) && exam.assignedStudentIds.includes(user.userId)) ||
        (Array.isArray(exam.assignedStudents) && exam.assignedStudents.includes(user.userId)) ||
        Boolean(await ExamAssignment.exists({ examId, studentId: user.userId }));
      if (!isAssigned) {
        const err: any = new Error('Forbidden: You are not assigned to this examination');
        err.statusCode = 403;
        throw err;
      }
    }

    const severity: ProctoringSeverity =
      input.severity && VALID_SEVERITIES.includes(input.severity) ? input.severity : 'MEDIUM';

    const eventId = await generateNextProctoringEventId();
    const eventDoc = await ProctoringEvent.create({
      eventId,
      attemptId,
      studentId: user.userId,
      studentName: user.name,
      examId,
      eventType: input.eventType,
      severity,
      details: (input.details || input.eventType).trim(),
      metadata: input.metadata || {},
      timestamp: new Date()
    });

    emitTeacherAndAdmin(exam.createdBy, 'proctoring.event', { event: eventDoc.toJSON() }, user.userId);

    logger.info(`Proctoring event [${input.eventType}] logged for student ${user.userId} on exam ${examId}`);
    return eventDoc;
  }

  /**
   * List proctoring events with strict RBAC ownership isolation
   */
  static async getEvents(
    filters: { examId?: string; studentId?: string; attemptId?: string },
    user: JwtUserPayload
  ): Promise<IProctoringEventDocument[]> {
    if (user.role === 'STUDENT') {
      if (filters.studentId && filters.studentId !== user.userId) {
        const err: any = new Error('Forbidden: Students cannot view proctoring events for another student');
        err.statusCode = 403;
        throw err;
      }
      const query: any = { studentId: user.userId };
      if (filters.examId) query.examId = filters.examId;
      if (filters.attemptId) query.attemptId = filters.attemptId;
      return ProctoringEvent.find(query).sort({ timestamp: -1 });
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
      if (filters.studentId) query.studentId = filters.studentId;
      if (filters.attemptId) query.attemptId = filters.attemptId;
      return ProctoringEvent.find(query).sort({ timestamp: -1 });
    }

    // ADMIN
    const query: any = {};
    if (filters.examId) query.examId = filters.examId;
    if (filters.studentId) query.studentId = filters.studentId;
    if (filters.attemptId) query.attemptId = filters.attemptId;
    return ProctoringEvent.find(query).sort({ timestamp: -1 });
  }
}
