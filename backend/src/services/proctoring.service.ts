import {
  ProctoringEvent,
  IProctoringEventDocument,
  ProctoringEventType,
  ProctoringSeverity
} from '../models/ProctoringEvent';
import { Exam } from '../models/Exam';
import { ExamAssignment } from '../models/ExamAssignment';
import { ExamAttempt, IExamAttemptDocument } from '../models/ExamAttempt';
import { User } from '../models/User';
import { Question } from '../models/Question';
import { JwtUserPayload } from '../types/auth.types';
import { generateNextProctoringEventId } from '../utils/exam-id.generator';
import { emitTeacherAndAdmin, emitToRooms } from '../realtime/socket';
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
  'SCREENSHOT_ATTEMPT',
  'WINDOW_BLUR',
  'WINDOW_FOCUS',
  'CAMERA_CONNECTED',
  'FACE_DETECTED',
  'FACE_STATUS'
];

const VALID_SEVERITIES: ProctoringSeverity[] = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

export class ProctoringService {
  /**
   * Record an actual browser proctoring event with ownership verification
   */
  static async recordEvent(
    input: {
      attemptId?: string;
      deviceSessionId?: string;
      examId: string;
      eventType: ProctoringEventType;
      severity?: ProctoringSeverity;
      details?: string;
      metadata?: Record<string, any> & {
        attemptState?: {
          answers?: Array<{ questionId: string; selectedOption?: string | null; markedForReview?: boolean }>;
          currentQuestionIndex?: number;
        };
      };
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
    if (!exam || exam.deleting) {
      const err: any = new Error(`Exam ${examId} not found`);
      err.statusCode = 404;
      throw err;
    }

    // Verify attempt ownership if attemptId is provided
    let attemptId = '';
    let attemptRecord: IExamAttemptDocument | null = null;
    if (input.attemptId && typeof input.attemptId === 'string' && input.attemptId.trim()) {
      attemptId = input.attemptId.trim();
      let attempt = await ExamAttempt.findOne({ attemptId });
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
      if (attempt.examId !== examId || attempt.status !== 'IN_PROGRESS') {
        const err: any = new Error('Proctoring events must belong to your active attempt and examination');
        err.statusCode = 400;
        throw err;
      }
      if (!input.deviceSessionId || attempt.deviceSessionId !== input.deviceSessionId) {
        const err: any = new Error('This examination attempt is active in another browser or device.');
        err.statusCode = 403;
        throw err;
      }
      attemptRecord = attempt;
      const originalWarningCount = attempt.warningCount || 0;

      if (!attempt.suspended && Array.isArray(input.metadata?.attemptState?.answers)) {
        const state = input.metadata.attemptState;
        const questions = await Question.find({ questionId: { $in: exam.questions } });
        const questionMap = new Map(questions.map(question => [question.questionId, question]));
        const answers = [];
        for (const answer of state.answers) {
          const question = questionMap.get(answer.questionId);
          const selectedOption = answer.selectedOption ? String(answer.selectedOption).trim() : '';
          if (!question || !exam.questions.includes(answer.questionId)) {
            const err: any = new Error('Proctoring checkpoint contains a question outside this examination');
            err.statusCode = 400;
            throw err;
          }
          if (selectedOption && !question.options.some(option => option.id === selectedOption)) {
            const err: any = new Error('Proctoring checkpoint contains an invalid selected option');
            err.statusCode = 400;
            throw err;
          }
          answers.push({
            questionId: answer.questionId,
            selectedOption,
            markedForReview: Boolean(answer.markedForReview)
          });
        }
        attempt.answers = answers;
        if (Number.isInteger(state.currentQuestionIndex)) {
          attempt.currentQuestionIndex = Math.max(
            0,
            Math.min(state.currentQuestionIndex!, Math.max(0, exam.questions.length - 1))
          );
        }
      }

      // Screenshot reminders and monitoring-only events do not count as violations.
      const nonWarningEvents = ['SCREENSHOT_ATTEMPT', 'WINDOW_FOCUS', 'CAMERA_CONNECTED', 'FACE_DETECTED', 'FACE_STATUS'];
      const wasSuspended = attempt.suspended;
      if (!nonWarningEvents.includes(input.eventType)) {
        attempt.warningCount = Math.min(5, (attempt.warningCount || 0) + 1);
        if (attempt.warningCount >= 5) {
          attempt.suspended = true;
          attempt.proctoringStatus = 'SUSPENDED';
        } else {
          attempt.proctoringStatus = attempt.warningCount >= 3 ? 'FLAGGED' : 'WARNED';
        }
      }
      if (input.eventType === 'CAMERA_OFF' || input.eventType === 'CAMERA_BLOCKED') {
        attempt.cameraStatus = 'OFFLINE';
      } else if (input.eventType === 'CAMERA_CONNECTED') {
        attempt.cameraStatus = 'ACTIVE';
      }
      if (input.eventType === 'NO_FACE') attempt.faceStatus = 'NOT_DETECTED';
      if (input.eventType === 'MULTIPLE_FACES') attempt.faceStatus = 'MULTIPLE';
      if (input.eventType === 'FACE_DETECTED') attempt.faceStatus = 'DETECTED';
      if (input.eventType === 'FULLSCREEN_EXIT') attempt.fullscreenActive = false;
      if (input.eventType === 'WINDOW_BLUR' || input.eventType === 'TAB_SWITCH') {
        attempt.lastHeartbeatAt = new Date();
      }
      const updatedAttempt = await ExamAttempt.findOneAndUpdate(
        {
          attemptId,
          studentId: user.userId,
          status: 'IN_PROGRESS',
          deviceSessionId: input.deviceSessionId,
          updatedAt: attempt.updatedAt,
          warningCount: originalWarningCount
        },
        {
          $set: {
            answers: attempt.answers,
            currentQuestionIndex: attempt.currentQuestionIndex,
            warningCount: attempt.warningCount,
            suspended: attempt.suspended,
            proctoringStatus: attempt.proctoringStatus,
            cameraStatus: attempt.cameraStatus,
            faceStatus: attempt.faceStatus,
            fullscreenActive: attempt.fullscreenActive,
            lastHeartbeatAt: attempt.lastHeartbeatAt
          }
        },
        { returnDocument: 'after' }
      );
      if (!updatedAttempt) {
        const err: any = new Error('Proctoring state changed concurrently; refresh the active attempt.');
        err.statusCode = 409;
        throw err;
      }
      attemptRecord = updatedAttempt;
      attempt = updatedAttempt;
      if (!wasSuspended && attempt.suspended) {
        const student = await User.findOne({ userId: user.userId })
          .select('managedBy teacherIds')
          .lean();
        const facultyIds = Array.from(new Set([
          ...(student?.managedBy || []),
          ...(student?.teacherIds || []),
          exam.createdBy
        ]));
        emitToRooms(
          ['role:ADMIN', `student:${user.userId}`, ...facultyIds.map(id => `teacher:${id}`)],
          'attempt.suspended',
          { attemptId, examId, studentId: user.userId, warningCount: attempt.warningCount },
          user.userId
        );
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
    const currentExam = await Exam.findOne({ examId, deleting: { $ne: true } }).select('status').lean();
    if (!currentExam || !['PUBLISHED', 'LIVE'].includes(currentExam.status)) {
      const err: any = new Error('Proctoring events can only be recorded for an active examination');
      err.statusCode = 409;
      throw err;
    }
    if (
      attemptId &&
      !(await ExamAttempt.exists({ attemptId, studentId: user.userId, examId, status: 'IN_PROGRESS' }))
    ) {
      const err: any = new Error('Proctoring attempt was finalized before the event could be recorded');
      err.statusCode = 409;
      throw err;
    }
    const eventDoc = await ProctoringEvent.create({
      eventId,
      attemptId,
      studentId: user.userId,
      studentName: user.name,
      examId,
      eventType: input.eventType,
      severity,
      details: (input.details || input.eventType).trim(),
      metadata: input.metadata
        ? Object.fromEntries(Object.entries(input.metadata).filter(([key]) => key !== 'attemptState'))
        : {},
      timestamp: new Date()
    });
    const examStillActive = await Exam.exists({ examId, deleting: { $ne: true } });
    const attemptStillActive = !attemptId || Boolean(
      await ExamAttempt.exists({ attemptId, studentId: user.userId, status: 'IN_PROGRESS' })
    );
    if (!examStillActive || !attemptStillActive) {
      await ProctoringEvent.deleteOne({ eventId });
      const err: any = new Error('Examination ended while the proctoring event was being recorded');
      err.statusCode = 409;
      throw err;
    }

    const student = await User.findOne({ userId: user.userId })
      .select('managedBy teacherIds')
      .lean();
    const facultyIds = Array.from(new Set([
      ...(student?.managedBy || []),
      ...(student?.teacherIds || []),
      exam.createdBy
    ]));
    emitTeacherAndAdmin(facultyIds, 'proctoring.event', { event: eventDoc.toJSON() }, user.userId);
    if (attemptRecord) {
      emitTeacherAndAdmin(
        facultyIds,
        'monitoring.updated',
        { attempt: attemptRecord.toJSON() },
        user.userId
      );
    }

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
      const [teacherExams, assignedStudents] = await Promise.all([
        Exam.find({ createdBy: user.userId }).select('examId').lean(),
        User.find({
          role: 'STUDENT',
          $or: [{ managedBy: user.userId }, { teacherIds: user.userId }]
        }).select('userId').lean()
      ]);
      const teacherExamIds = teacherExams.map(e => e.examId);
      const studentIds = assignedStudents.map(student => student.userId);

      if (filters.examId && !teacherExamIds.includes(filters.examId)) {
        const hasAssignedStudentAttempt = studentIds.length > 0
          ? await ExamAttempt.exists({
              examId: filters.examId,
              studentId: { $in: studentIds }
            })
          : false;
        if (!hasAssignedStudentAttempt) {
          const err: any = new Error('Forbidden: You are not authorized to view proctoring events for this exam');
          err.statusCode = 403;
          throw err;
        }
      }

      if (filters.studentId && !studentIds.includes(filters.studentId)) {
        const studentOwnsExam = await ExamAttempt.exists({ studentId: filters.studentId, examId: { $in: teacherExamIds } });
        if (!studentOwnsExam) {
          const err: any = new Error('Forbidden: This student is not assigned to you');
          err.statusCode = 403;
          throw err;
        }
      }

      const ownershipClauses = [
        ...(!filters.examId || teacherExamIds.includes(filters.examId)
          ? [{ examId: filters.examId || { $in: teacherExamIds } }]
          : []),
        ...(studentIds.length ? [{ studentId: { $in: studentIds } }] : [])
      ];
      if (ownershipClauses.length === 0) return [];
      const ownershipFilter = { $or: ownershipClauses };
      const query: any = filters.examId
        ? { $and: [ownershipFilter, { examId: filters.examId }] }
        : ownershipFilter;
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
