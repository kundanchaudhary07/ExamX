import mongoose, { Schema, Document } from 'mongoose';

export type UnblockStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface IUnblockRequestDocument extends Document {
  requestId: string;
  attemptId: string;
  examId: string;
  examTitle: string;
  studentId: string;
  studentName: string;
  assignedFacultyId: string;
  reason: string;
  status: UnblockStatus;
  warningCount: number;
  reviewedBy?: string;
  reviewedByName?: string;
  reviewedAt?: Date;
  remarks?: string;
  createdAt: Date;
  updatedAt: Date;
}

const UnblockRequestSchema = new Schema<IUnblockRequestDocument>(
  {
    requestId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true
    },
    attemptId: {
      type: String,
      required: true,
      trim: true,
      index: true
    },
    examId: {
      type: String,
      required: true,
      trim: true,
      index: true
    },
    examTitle: {
      type: String,
      default: '',
      trim: true
    },
    studentId: {
      type: String,
      required: true,
      trim: true,
      index: true
    },
    studentName: {
      type: String,
      default: '',
      trim: true
    },
    assignedFacultyId: {
      type: String,
      required: true,
      trim: true,
      index: true
    },
    reason: {
      type: String,
      required: true,
      trim: true
    },
    status: {
      type: String,
      enum: ['PENDING', 'APPROVED', 'REJECTED'],
      default: 'PENDING',
      index: true
    },
    warningCount: {
      type: Number,
      default: 5
    },
    reviewedBy: {
      type: String,
      default: '',
      trim: true
    },
    reviewedByName: {
      type: String,
      default: '',
      trim: true
    },
    reviewedAt: {
      type: Date
    },
    remarks: {
      type: String,
      default: '',
      trim: true
    }
  },
  {
    timestamps: true,
    toJSON: {
      transform: (_doc, ret: any) => {
        ret.id = ret.requestId || ret._id?.toString();
        delete ret.__v;
        return ret;
      }
    }
  }
);

UnblockRequestSchema.index({ attemptId: 1, status: 1 });
UnblockRequestSchema.index({ examId: 1, studentId: 1 });

export const UnblockRequest = mongoose.model<IUnblockRequestDocument>(
  'UnblockRequest',
  UnblockRequestSchema
);
