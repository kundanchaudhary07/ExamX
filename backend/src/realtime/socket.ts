import http from 'http';
import { Server as SocketIOServer, Socket } from 'socket.io';
import { verifyToken } from '../utils/token';
import { User } from '../models/User';
import { Exam } from '../models/Exam';
import { ExamAssignment } from '../models/ExamAssignment';
import { logger } from '../utils/logger';

export type RealtimeEventName =
  | 'teacher.created'
  | 'teacher.updated'
  | 'teacher.statusChanged'
  | 'student.created'
  | 'student.updated'
  | 'student.statusChanged'
  | 'student.assigned'
  | 'exam.created'
  | 'exam.updated'
  | 'exam.published'
  | 'exam.started'
  | 'exam.completed'
  | 'exam.cancelled'
  | 'exam.deleted'
  | 'exam.forceEnded'
  | 'question.created'
  | 'question.updated'
  | 'question.deleted'
  | 'result.created'
  | 'result.published'
  | 'results.bulkPublished'
  | 'result.updated'
  | 'query.created'
  | 'query.updated'
  | 'query.resolved'
  | 'proctoring.started'
  | 'proctoring.event'
  | 'proctoring.completed'
  | 'unblock.created'
  | 'unblock.updated'
  | 'attempt.suspended'
  | 'attempt.resumed'
  | 'attempt.submitted'
  | 'monitoring.updated'
  | 'message.created'
  | 'audit.created'
  | 'notification.created';

export interface RealtimeEventPayload<T = any> {
  event: RealtimeEventName;
  timestamp: string;
  actorId?: string;
  data: T;
}

let ioInstance: SocketIOServer | null = null;

function extractSocketToken(socket: Socket): string | null {
  const authToken = socket.handshake.auth?.token;
  if (typeof authToken === 'string' && authToken.trim()) {
    return authToken.replace(/^Bearer\s+/i, '').trim();
  }

  const headerAuth = socket.handshake.headers?.authorization;
  if (typeof headerAuth === 'string' && headerAuth.trim()) {
    return headerAuth.replace(/^Bearer\s+/i, '').trim();
  }

  const queryToken = socket.handshake.query?.token;
  if (typeof queryToken === 'string' && queryToken.trim()) {
    return queryToken.replace(/^Bearer\s+/i, '').trim();
  }

  return null;
}

export function initSocketServer(httpServer: http.Server): SocketIOServer {
  if (ioInstance) {
    ioInstance.close();
  }

  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
      credentials: true
    },
    path: '/socket.io'
  });

  // Strict JWT Authentication Middleware for every WebSocket connection
  io.use(async (socket, next) => {
    try {
      const token = extractSocketToken(socket);
      if (!token) {
        return next(new Error('Authentication error: Token missing'));
      }

      const decoded = verifyToken(token);
      const user = await User.findOne({ userId: decoded.userId }).lean();
      if (!user) {
        return next(new Error('Authentication error: User account not found'));
      }

      if (user.status !== 'ACTIVE') {
        return next(new Error(`Authentication error: Account is ${user.status}`));
      }

      socket.data.user = {
        id: user._id.toString(),
        userId: user.userId,
        name: user.name,
        role: user.role,
        managedBy: Array.isArray(user.managedBy) ? user.managedBy : []
      };

      next();
    } catch (err: any) {
      next(new Error(`Authentication error: ${err?.message || 'Invalid or expired JWT'}`));
    }
  });

  io.on('connection', async (socket: Socket) => {
    const user = socket.data.user;
    if (!user) {
      socket.disconnect(true);
      return;
    }

    const joinedRooms: string[] = [];

    if (user.role === 'ADMIN') {
      const adminRoom = `admin:${user.userId}`;
      socket.join('role:ADMIN');
      socket.join(adminRoom);
      joinedRooms.push('role:ADMIN', adminRoom);
    } else if (user.role === 'TEACHER') {
      const teacherRoom = `teacher:${user.userId}`;
      socket.join('role:TEACHER');
      socket.join(teacherRoom);
      joinedRooms.push('role:TEACHER', teacherRoom);
    } else if (user.role === 'STUDENT') {
      const studentRoom = `student:${user.userId}`;
      socket.join('role:STUDENT');
      socket.join(studentRoom);
      joinedRooms.push('role:STUDENT', studentRoom);

      try {
        const [assignments, assignedExams] = await Promise.all([
          ExamAssignment.find({ studentId: user.userId }).select('examId').lean(),
          Exam.find({
            $or: [{ assignedStudentIds: user.userId }, { assignedStudents: user.userId }],
            status: { $in: ['PUBLISHED', 'LIVE', 'SCHEDULED', 'ENDED'] },
            deleting: { $ne: true }
          })
            .select('examId')
            .lean()
        ]);

        const examIds = new Set<string>();
        assignments.forEach((a: any) => a?.examId && examIds.add(a.examId));
        assignedExams.forEach((e: any) => e?.examId && examIds.add(e.examId));

        for (const examId of examIds) {
          const room = `exam:${examId}`;
          socket.join(room);
          joinedRooms.push(room);
        }
      } catch (err: any) {
        logger.warn(`Failed to join exam rooms for student ${user.userId}: ${err.message}`);
      }
    }

    socket.emit('socket.authenticated', {
      userId: user.userId,
      role: user.role,
      rooms: joinedRooms,
      timestamp: new Date().toISOString()
    });

    // Authorized room subscription for exam sessions
    socket.on('join:exam', async (examId: string, ack?: (res: { ok: boolean; error?: string }) => void) => {
      try {
        if (!examId || typeof examId !== 'string') {
          ack?.({ ok: false, error: 'Invalid examId' });
          return;
        }
        const cleanExamId = examId.trim();

        const exam = await Exam.findOne({ examId: cleanExamId, deleting: { $ne: true } }).lean();
        if (!exam) {
          ack?.({ ok: false, error: 'Exam not found' });
          return;
        }

        if (user.role === 'ADMIN') {
          socket.join(`exam:${cleanExamId}`);
          ack?.({ ok: true });
          return;
        }

        if (user.role === 'TEACHER') {
          if (exam.createdBy !== user.userId) {
            ack?.({ ok: false, error: 'Forbidden: Not your exam' });
            return;
          }
          socket.join(`exam:${cleanExamId}`);
          ack?.({ ok: true });
          return;
        }

        if (user.role === 'STUDENT') {
          const isAssigned =
            (Array.isArray(exam.assignedStudentIds) && exam.assignedStudentIds.includes(user.userId)) ||
            (Array.isArray(exam.assignedStudents) && exam.assignedStudents.includes(user.userId)) ||
            Boolean(await ExamAssignment.exists({ examId: cleanExamId, studentId: user.userId }));

          if (!isAssigned) {
            ack?.({ ok: false, error: 'Forbidden: Not assigned to this exam' });
            return;
          }
          socket.join(`exam:${cleanExamId}`);
          ack?.({ ok: true });
          return;
        }
      } catch (err: any) {
        ack?.({ ok: false, error: err?.message || 'Failed to join exam room' });
      }
    });
  });

  ioInstance = io;
  return io;
}

export function getSocketServer(): SocketIOServer | null {
  return ioInstance;
}

export function emitToRooms<T = any>(
  rooms: string | string[],
  event: RealtimeEventName,
  data: T,
  actorId?: string
): void {
  if (!ioInstance) return;
  const roomList = Array.from(new Set((Array.isArray(rooms) ? rooms : [rooms]).filter(Boolean)));
  if (roomList.length === 0) return;

  const payload: RealtimeEventPayload<T> = {
    event,
    timestamp: new Date().toISOString(),
    actorId,
    data
  };

  ioInstance.to(roomList).emit(event, payload);
  ioInstance.to(roomList).emit('realtime:event', payload);
}

export function emitAdminEvent<T = any>(
  event: RealtimeEventName,
  data: T,
  actorId?: string
): void {
  emitToRooms(['role:ADMIN'], event, data, actorId);
}

export function emitTeacherAndAdmin<T = any>(
  teacherIds: string | string[],
  event: RealtimeEventName,
  data: T,
  actorId?: string
): void {
  const ids = Array.isArray(teacherIds) ? teacherIds : [teacherIds];
  const rooms = ['role:ADMIN', ...ids.filter(Boolean).map(id => `teacher:${id}`)];
  emitToRooms(rooms, event, data, actorId);
}

export function emitStudentTeacherAdmin<T = any>(
  studentId: string,
  teacherIds: string[],
  event: RealtimeEventName,
  data: T,
  actorId?: string
): void {
  const rooms = [
    'role:ADMIN',
    studentId ? `student:${studentId}` : '',
    ...(Array.isArray(teacherIds) ? teacherIds : []).filter(Boolean).map(id => `teacher:${id}`)
  ];
  emitToRooms(rooms, event, data, actorId);
}

export function emitExamEvent<T = any>(
  exam: {
    examId: string;
    createdBy: string;
    assignedStudentIds?: string[];
    assignedStudents?: string[];
  },
  event: RealtimeEventName,
  data: T,
  includeAssignedStudents = true,
  actorId?: string
): void {
  const studentIds = includeAssignedStudents
    ? Array.from(
        new Set([...(exam.assignedStudentIds || []), ...(exam.assignedStudents || [])].filter(Boolean))
      )
    : [];

  const rooms = [
    'role:ADMIN',
    exam.createdBy ? `teacher:${exam.createdBy}` : '',
    `exam:${exam.examId}`,
    ...studentIds.map(sId => `student:${sId}`)
  ];

  emitToRooms(rooms, event, data, actorId);
}

export function leaveExamRoom(examId: string): void {
  const room = `exam:${examId}`;
  if (ioInstance) void ioInstance.in(room).socketsLeave(room);
}

export function emitNotification(
  targetRooms: string | string[],
  notification: {
    id: string;
    title: string;
    message?: string;
    type?: string;
    timestamp?: string;
  },
  actorId?: string
): void {
  emitToRooms(
    targetRooms,
    'notification.created',
    {
      ...notification,
      timestamp: notification.timestamp || new Date().toISOString()
    },
    actorId
  );
}
