import mongoose, { Schema, Document } from 'mongoose';

export interface IAuditLogDocument extends Document {
  auditId: string;
  actorId: string;
  actorName: string;
  actorRole: 'ADMIN' | 'TEACHER' | 'STUDENT' | 'SYSTEM';
  action: string;
  targetType: string;
  targetId: string;
  details: string;
  timestamp: Date;
  createdAt: Date;
  updatedAt: Date;
}

const AuditLogSchema = new Schema<IAuditLogDocument>(
  {
    auditId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true
    },
    actorId: {
      type: String,
      required: true,
      trim: true,
      index: true
    },
    actorName: {
      type: String,
      required: true,
      trim: true
    },
    actorRole: {
      type: String,
      enum: ['ADMIN', 'TEACHER', 'STUDENT', 'SYSTEM'],
      required: true
    },
    action: {
      type: String,
      required: true,
      trim: true,
      index: true
    },
    targetType: {
      type: String,
      default: 'RESOURCE',
      trim: true
    },
    targetId: {
      type: String,
      default: '',
      trim: true
    },
    details: {
      type: String,
      default: '',
      trim: true
    },
    timestamp: {
      type: Date,
      default: Date.now,
      index: true
    }
  },
  {
    timestamps: true,
    toJSON: {
      transform: (_doc, ret: any) => {
        ret.id = ret.auditId || ret._id?.toString();
        delete ret.__v;
        return ret;
      }
    }
  }
);

AuditLogSchema.index({ actorId: 1, createdAt: -1 });
AuditLogSchema.index({ createdAt: -1 });

export const AuditLog = mongoose.model<IAuditLogDocument>('AuditLog', AuditLogSchema);
