import { AuditLog, IAuditLogDocument } from '../models/AuditLog';
import { generateNextAuditId } from '../utils/exam-id.generator';
import { logger } from '../utils/logger';
import { emitAdminEvent } from '../realtime/socket';

export interface IAuditLogInput {
  actorId: string;
  actorName: string;
  actorRole: 'ADMIN' | 'TEACHER' | 'STUDENT' | 'SYSTEM';
  action: string;
  targetType?: string;
  targetId?: string;
  details?: string;
}

export class AuditService {
  static async record(input: IAuditLogInput): Promise<IAuditLogDocument | null> {
    try {
      const auditId = await generateNextAuditId();
      const doc = await AuditLog.create({
        auditId,
        actorId: input.actorId,
        actorName: input.actorName || input.actorId,
        actorRole: input.actorRole,
        action: input.action,
        targetType: input.targetType || 'RESOURCE',
        targetId: input.targetId || '',
        details: input.details || '',
        timestamp: new Date()
      });
      emitAdminEvent('audit.created', { log: doc.toJSON() }, input.actorId);
      return doc;
    } catch (err: any) {
      logger.warn(`Failed to write audit log [${input.action}]: ${err.message}`);
      return null;
    }
  }

  static async logAction(input: IAuditLogInput): Promise<IAuditLogDocument | null> {
    return this.record(input);
  }

  static async getAuditLogs(limit = 100): Promise<IAuditLogDocument[]> {
    return AuditLog.find({})
      .sort({ timestamp: -1 })
      .limit(Math.min(limit, 500));
  }
}
