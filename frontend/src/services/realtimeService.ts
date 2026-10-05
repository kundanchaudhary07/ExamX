import { io, Socket } from 'socket.io-client';
import { dbService } from './dbService';

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
  | 'audit.created'
  | 'notification.created';

export interface RealtimeEventPayload<T = any> {
  event: RealtimeEventName;
  timestamp: string;
  actorId?: string;
  data: T;
}

export type RealtimeEventListener = (payload: RealtimeEventPayload) => void;
export type ConnectionStatusListener = (status: {
  connected: boolean;
  reconnected?: boolean;
  error?: string | null;
}) => void;

class RealtimeService {
  private socket: Socket | null = null;
  private eventListeners = new Set<RealtimeEventListener>();
  private statusListeners = new Set<ConnectionStatusListener>();
  private hasConnectedOnce = false;

  connect(): Socket | null {
    const token = dbService.getAuthToken();
    if (!token) {
      this.disconnect();
      return null;
    }

    if (this.socket) {
      this.socket.auth = { token };
      if (!this.socket.connected) {
        this.socket.connect();
      }
      return this.socket;
    }

    this.hasConnectedOnce = false;
    const socket = io(window.location.origin, {
      path: '/socket.io',
      auth: { token },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000
    });

    socket.on('connect', () => {
      const wasReconnect = this.hasConnectedOnce;
      this.hasConnectedOnce = true;
      this.notifyStatus({ connected: true, reconnected: wasReconnect, error: null });
    });

    socket.on('disconnect', () => {
      this.notifyStatus({ connected: false, reconnected: false, error: null });
    });

    socket.io.on('reconnect_attempt', () => {
      const latestToken = dbService.getAuthToken();
      if (latestToken) {
        socket.auth = { token: latestToken };
      }
    });

    socket.io.on('reconnect', () => {
      this.notifyStatus({ connected: true, reconnected: true, error: null });
    });

    socket.on('connect_error', (err: Error) => {
      const message = err?.message || 'Real-time connection interrupted';
      this.notifyStatus({ connected: false, reconnected: false, error: message });
    });

    socket.on('realtime:event', (payload: RealtimeEventPayload) => {
      if (!payload || !payload.event) return;
      this.eventListeners.forEach(listener => {
        try {
          listener(payload);
        } catch {
          // Prevent listener error from breaking event loop
        }
      });
    });

    this.socket = socket;
    return socket;
  }

  disconnect(): void {
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.disconnect();
      this.socket = null;
    }
    this.hasConnectedOnce = false;
  }

  joinExamRoom(examId: string): void {
    if (this.socket && this.socket.connected && examId) {
      this.socket.emit('join:exam', examId);
    }
  }

  subscribe(listener: RealtimeEventListener): () => void {
    this.eventListeners.add(listener);
    return () => {
      this.eventListeners.delete(listener);
    };
  }

  subscribeStatus(listener: ConnectionStatusListener): () => void {
    this.statusListeners.add(listener);
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  isConnected(): boolean {
    return Boolean(this.socket?.connected);
  }

  private notifyStatus(status: { connected: boolean; reconnected?: boolean; error?: string | null }): void {
    this.statusListeners.forEach(listener => {
      try {
        listener(status);
      } catch {
        // Ignore individual listener errors
      }
    });
  }
}

export const realtimeService = new RealtimeService();
