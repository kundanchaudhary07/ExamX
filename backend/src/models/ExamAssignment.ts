import mongoose, { Schema, Document } from 'mongoose';
import { AssignmentStatus } from '../types/exam.types';

export interface IExamAssignmentDocument extends Document {
  examId: string;
  studentId: string;
  assignedBy: string;
  assignedAt: Date;
  status: AssignmentStatus;
  createdAt: Date;
  updatedAt: Date;
}

const ExamAssignmentSchema = new Schema<IExamAssignmentDocument>(
  {
    examId: {
      type: String,
      required: [true, 'Exam ID is required'],
      trim: true,
      index: true
    },
    studentId: {
      type: String,
      required: [true, 'Student ID is required'],
      trim: true,
      index: true
    },
    assignedBy: {
      type: String,
      required: [true, 'Assigning teacher/admin ID is required'],
      trim: true
    },
    assignedAt: {
      type: Date,
      default: Date.now
    },
    status: {
      type: String,
      enum: {
        values: ['ASSIGNED', 'IN_PROGRESS', 'SUBMITTED', 'GRADED', 'EXPIRED'],
        message: '{VALUE} is not a valid assignment status'
      },
      default: 'ASSIGNED'
    }
  },
  {
    timestamps: true,
    toJSON: {
      transform: (_doc, ret: any) => {
        delete ret.__v;
        return ret;
      }
    }
  }
);

// Compound unique index ensuring a student cannot be assigned to the same exam more than once
ExamAssignmentSchema.index({ examId: 1, studentId: 1 }, { unique: true });
ExamAssignmentSchema.index({ studentId: 1, status: 1 });

export const ExamAssignment = mongoose.model<IExamAssignmentDocument>('ExamAssignment', ExamAssignmentSchema);
