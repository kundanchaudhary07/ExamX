import mongoose, { Schema, Document } from 'mongoose';

export type ResultStatus = 'PENDING' | 'VERIFIED' | 'PUBLISHED' | 'QUERIED' | 'REVISED' | 'TERMINATED';

export interface IResultAnswerBreakdown {
  questionId: string;
  questionText: string;
  options: Array<{ id: string; text: string }>;
  selectedOption: string;
  correctOption: string;
  isCorrect: boolean;
  marksAwarded: number;
  maxMarks: number;
}

export interface IResultDocument extends Document {
  resultId: string;
  studentId: string;
  studentName: string;
  examId: string;
  examTitle: string;
  subject: string;
  attemptId: string;
  score: number;
  totalMarks: number;
  passingMarks: number;
  percentage: number;
  passed: boolean;
  status: ResultStatus;
  answers: IResultAnswerBreakdown[];
  proctoringWarnings: number;
  feedback?: string;
  verifiedBy?: string;
  submittedAt: Date;
  publishedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const ResultAnswerSchema = new Schema<IResultAnswerBreakdown>(
  {
    questionId: { type: String, required: true },
    questionText: { type: String, default: '' },
    options: {
      type: [{ id: String, text: String }],
      default: []
    },
    selectedOption: { type: String, default: '' },
    correctOption: { type: String, default: '' },
    isCorrect: { type: Boolean, default: false },
    marksAwarded: { type: Number, default: 0 },
    maxMarks: { type: Number, default: 1 }
  },
  { _id: false }
);

const ResultSchema = new Schema<IResultDocument>(
  {
    resultId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true
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
    subject: {
      type: String,
      default: '',
      trim: true
    },
    attemptId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true
    },
    score: {
      type: Number,
      required: true,
      default: 0
    },
    totalMarks: {
      type: Number,
      required: true,
      default: 0
    },
    passingMarks: {
      type: Number,
      default: 0
    },
    percentage: {
      type: Number,
      required: true,
      default: 0
    },
    passed: {
      type: Boolean,
      default: false
    },
    status: {
      type: String,
      enum: ['PENDING', 'VERIFIED', 'PUBLISHED', 'QUERIED', 'REVISED', 'TERMINATED'],
      default: 'PENDING',
      index: true
    },
    answers: {
      type: [ResultAnswerSchema],
      default: []
    },
    proctoringWarnings: {
      type: Number,
      default: 0
    },
    feedback: {
      type: String,
      default: ''
    },
    verifiedBy: {
      type: String,
      default: ''
    },
    submittedAt: {
      type: Date,
      required: true,
      default: Date.now
    },
    publishedAt: {
      type: Date
    }
  },
  {
    timestamps: true,
    toJSON: {
      transform: (_doc, ret: any) => {
        ret.id = ret.resultId || ret._id?.toString();
        delete ret.__v;
        return ret;
      }
    }
  }
);

ResultSchema.index({ studentId: 1, examId: 1 });
ResultSchema.index({ examId: 1, status: 1 });

export const Result = mongoose.model<IResultDocument>('Result', ResultSchema);
