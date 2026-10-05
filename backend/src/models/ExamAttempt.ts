import mongoose, { Schema, Document } from 'mongoose';

export type AttemptStatus = 'IN_PROGRESS' | 'SUBMITTED' | 'EXPIRED' | 'EVALUATED' | 'TERMINATED';
export type ProctoringStatus = 'CLEAN' | 'WARNED' | 'FLAGGED' | 'SUSPENDED' | 'TERMINATED';

export interface IAttemptAnswer {
  questionId: string;
  selectedOption: string;
  markedForReview?: boolean;
  marksAwarded?: number;
  isCorrect?: boolean;
}

export interface IExamAttemptDocument extends Document {
  attemptId: string;
  examId: string;
  studentId: string;
  deviceSessionId: string;
  studentName: string;
  startedAt: Date;
  expiresAt: Date;
  submittedAt?: Date;
  status: AttemptStatus;
  answers: IAttemptAnswer[];
  score: number;
  totalMarks: number;
  percentage: number;
  attemptNumber: number;
  proctoringStatus: ProctoringStatus;
  warningCount: number;
  currentQuestionIndex: number;
  reportedQuestionIds: string[];
  suspended: boolean;
  cameraStatus: 'ACTIVE' | 'OFFLINE' | 'UNKNOWN';
  faceStatus: 'DETECTED' | 'NOT_DETECTED' | 'MULTIPLE' | 'UNKNOWN';
  fullscreenActive: boolean;
  lastHeartbeatAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const AttemptAnswerSchema = new Schema<IAttemptAnswer>(
  {
    questionId: { type: String, required: true, trim: true },
    selectedOption: { type: String, default: '', trim: true },
    markedForReview: { type: Boolean, default: false },
    marksAwarded: { type: Number, default: 0 },
    isCorrect: { type: Boolean, default: false }
  },
  { _id: false }
);

const ExamAttemptSchema = new Schema<IExamAttemptDocument>(
  {
    attemptId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true
    },
    examId: {
      type: String,
      required: true,
      trim: true,
      index: true
    },
    studentId: {
      type: String,
      required: true,
      trim: true
    },
    deviceSessionId: {
      type: String,
      default: '',
      trim: true
    },
    studentName: {
      type: String,
      default: '',
      trim: true
    },
    startedAt: {
      type: Date,
      required: true,
      default: Date.now
    },
    expiresAt: {
      type: Date,
      required: true
    },
    submittedAt: {
      type: Date
    },
    status: {
      type: String,
      enum: ['IN_PROGRESS', 'SUBMITTED', 'EXPIRED', 'EVALUATED', 'TERMINATED'],
      default: 'IN_PROGRESS',
      index: true
    },
    answers: {
      type: [AttemptAnswerSchema],
      default: []
    },
    score: {
      type: Number,
      default: 0
    },
    totalMarks: {
      type: Number,
      default: 0
    },
    percentage: {
      type: Number,
      default: 0
    },
    attemptNumber: {
      type: Number,
      required: true,
      default: 1,
      min: 1
    },
    proctoringStatus: {
      type: String,
      enum: ['CLEAN', 'WARNED', 'FLAGGED', 'SUSPENDED', 'TERMINATED'],
      default: 'CLEAN'
    },
    warningCount: {
      type: Number,
      default: 0
    },
    currentQuestionIndex: {
      type: Number,
      default: 0,
      min: 0
    },
    reportedQuestionIds: {
      type: [String],
      default: []
    },
    suspended: {
      type: Boolean,
      default: false,
      index: true
    },
    cameraStatus: {
      type: String,
      enum: ['ACTIVE', 'OFFLINE', 'UNKNOWN'],
      default: 'UNKNOWN'
    },
    faceStatus: {
      type: String,
      enum: ['DETECTED', 'NOT_DETECTED', 'MULTIPLE', 'UNKNOWN'],
      default: 'UNKNOWN'
    },
    fullscreenActive: {
      type: Boolean,
      default: false
    },
    lastHeartbeatAt: {
      type: Date
    }
  },
  {
    timestamps: true,
    toJSON: {
      transform: (_doc, ret: any) => {
        ret.id = ret.attemptId || ret._id?.toString();
        delete ret.__v;
        return ret;
      }
    }
  }
);

ExamAttemptSchema.index({ examId: 1, studentId: 1, attemptNumber: 1 }, { unique: true });
ExamAttemptSchema.index(
  { studentId: 1 },
  { unique: true, partialFilterExpression: { status: 'IN_PROGRESS' } }
);

export const ExamAttempt = mongoose.model<IExamAttemptDocument>('ExamAttempt', ExamAttemptSchema);
