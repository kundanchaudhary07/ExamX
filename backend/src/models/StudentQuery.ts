import mongoose, { Schema, Document } from 'mongoose';

export type QueryReasonType =
  | 'AMBIGUOUS_QUESTION'
  | 'INCORRECT_KEY'
  | 'EVALUATION_ERROR'
  | 'TECHNICAL_GLITCH'
  | 'OTHER'
  | 'INCORRECT_QUESTION'
  | 'TYPO_ERROR'
  | 'TECHNICAL_ISSUE'
  | 'OUT_OF_SYLLABUS'
  | 'INCORRECT_OPTIONS'
  | 'MULTIPLE_OPTIONS_CORRECT'
  | 'QUESTION_UNCLEAR';

export type QueryStatusType =
  | 'PENDING'
  | 'UNDER_REVIEW'
  | 'RESOLVED_ACCEPTED'
  | 'RESOLVED_REJECTED';

export type QueryResolutionType =
  | 'VALID_QUESTION'
  | 'OUT_OF_SYLLABUS'
  | 'INVALID_QUESTION'
  | 'CORRECT_ANSWER_CHANGED'
  | 'GRACE_MARKS'
  | 'EXCLUDE_QUESTION';

export interface IStudentQueryDocument extends Document {
  queryId: string;
  examId: string;
  examTitle: string;
  attemptId?: string;
  resultId?: string;
  questionId?: string;
  questionNumber?: number;
  questionText: string;
  options: Array<{ id: string; text: string }>;
  studentId: string;
  studentName: string;
  studentAnswer?: string;
  expectedAnswer?: string;
  assignedFacultyId: string;
  reason: QueryReasonType;
  explanation: string;
  status: QueryStatusType;
  resolutionType?: QueryResolutionType;
  resolutionNotes?: string;
  correctedAnswer?: string;
  teacherRemarks?: string;
  scoreAdjustment: number;
  resolvedBy?: string;
  resolvedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const StudentQuerySchema = new Schema<IStudentQueryDocument>(
  {
    queryId: {
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
    examTitle: {
      type: String,
      default: '',
      trim: true
    },
    attemptId: {
      type: String,
      default: '',
      trim: true
    },
    resultId: {
      type: String,
      default: '',
      trim: true
    },
    questionId: {
      type: String,
      default: '',
      trim: true
    },
    questionNumber: {
      type: Number,
      default: 0
    },
    questionText: {
      type: String,
      required: [true, 'Question text or reference is required'],
      trim: true
    },
    options: {
      type: [{ id: String, text: String }],
      default: []
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
    studentAnswer: {
      type: String,
      default: '',
      trim: true
    },
    expectedAnswer: {
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
      enum: [
        'AMBIGUOUS_QUESTION',
        'INCORRECT_KEY',
        'EVALUATION_ERROR',
        'TECHNICAL_GLITCH',
        'OTHER',
        'INCORRECT_QUESTION',
        'TYPO_ERROR',
        'TECHNICAL_ISSUE',
        'OUT_OF_SYLLABUS',
        'INCORRECT_OPTIONS',
        'MULTIPLE_OPTIONS_CORRECT',
        'QUESTION_UNCLEAR'
      ],
      default: 'INCORRECT_KEY'
    },
    explanation: {
      type: String,
      required: [true, 'Explanation is required'],
      trim: true
    },
    status: {
      type: String,
      enum: ['PENDING', 'UNDER_REVIEW', 'RESOLVED_ACCEPTED', 'RESOLVED_REJECTED'],
      default: 'PENDING',
      index: true
    },
    resolutionType: {
      type: String,
      enum: [
        'VALID_QUESTION',
        'OUT_OF_SYLLABUS',
        'INVALID_QUESTION',
        'CORRECT_ANSWER_CHANGED',
        'GRACE_MARKS',
        'EXCLUDE_QUESTION'
      ]
    },
    resolutionNotes: {
      type: String,
      default: '',
      trim: true
    },
    correctedAnswer: {
      type: String,
      default: '',
      trim: true
    },
    teacherRemarks: {
      type: String,
      default: '',
      trim: true
    },
    scoreAdjustment: {
      type: Number,
      default: 0
    },
    resolvedBy: {
      type: String,
      default: '',
      trim: true
    },
    resolvedAt: {
      type: Date
    }
  },
  {
    timestamps: true,
    toJSON: {
      transform: (_doc, ret: any) => {
        ret.id = ret.queryId || ret._id?.toString();
        delete ret.__v;
        return ret;
      }
    }
  }
);

StudentQuerySchema.index({ studentId: 1, examId: 1 });

export const StudentQuery = mongoose.model<IStudentQueryDocument>('StudentQuery', StudentQuerySchema);
