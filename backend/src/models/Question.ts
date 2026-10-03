import mongoose, { Schema, Document } from 'mongoose';
import { AiReviewStatus, QuestionDifficulty, QuestionSource, QuestionStatus, QuestionOption } from '../types/exam.types';

export interface IQuestionDocument extends Document {
  questionId: string;
  questionText: string;
  subject: string;
  topic: string;
  course?: string;
  semester?: string;
  questionType: 'MCQ';
  difficulty: QuestionDifficulty;
  options: QuestionOption[];
  correctAnswer: string;
  correctOption: string;
  marks: number;
  negativeMarks: number;
  explanation: string;
  createdBy: string;
  source: QuestionSource;
  reviewStatus?: AiReviewStatus;
  syllabusId?: string;
  syllabusUnit?: string;
  syllabusTopic?: string;
  sourceReference?: string;
  aiProvider?: 'GEMINI' | 'GROQ';
  aiModel?: string;
  dedupeKey?: string;
  approvedBy?: string;
  approvedAt?: Date;
  status: QuestionStatus;
  createdAt: Date;
  updatedAt: Date;
}

const QuestionOptionSchema = new Schema<QuestionOption>(
  {
    id: { type: String, required: true, trim: true },
    text: { type: String, required: true, trim: true }
  },
  { _id: false }
);

const QuestionSchema = new Schema<IQuestionDocument>(
  {
    questionId: {
      type: String,
      required: [true, 'Question ID is required'],
      unique: true,
      trim: true,
      index: true
    },
    questionText: {
      type: String,
      required: [true, 'Question text is required'],
      trim: true
    },
    subject: {
      type: String,
      required: [true, 'Subject is required'],
      trim: true,
      index: true
    },
    topic: {
      type: String,
      trim: true,
      default: '',
      index: true
    },
    course: {
      type: String,
      trim: true,
      default: '',
      index: true
    },
    semester: {
      type: String,
      trim: true,
      default: '',
      index: true
    },
    questionType: {
      type: String,
      enum: ['MCQ'],
      default: 'MCQ'
    },
    difficulty: {
      type: String,
      enum: {
        values: ['EASY', 'MEDIUM', 'HARD'],
        message: '{VALUE} is not a valid question difficulty'
      },
      default: 'MEDIUM'
    },
    options: {
      type: [QuestionOptionSchema],
      required: [true, 'Options are required'],
      validate: {
        validator: (v: QuestionOption[]) => Array.isArray(v) && v.length >= 2,
        message: 'A question must provide at least 2 valid options'
      }
    },
    correctAnswer: {
      type: String,
      required: [true, 'Correct answer is required'],
      trim: true
    },
    correctOption: {
      type: String,
      required: [true, 'Correct option is required'],
      trim: true
    },
    marks: {
      type: Number,
      required: [true, 'Marks are required'],
      min: [1, 'Marks must be positive'],
      default: 1
    },
    negativeMarks: {
      type: Number,
      min: [0, 'Negative marks cannot be less than 0'],
      default: 0
    },
    explanation: {
      type: String,
      trim: true,
      default: ''
    },
    createdBy: {
      type: String,
      required: [true, 'Created by teacher userId is required'],
      trim: true,
      index: true
    },
    source: {
      type: String,
      enum: {
        values: ['MANUAL', 'AI_GENERATED'],
        message: '{VALUE} is not a valid question source'
      },
      default: 'MANUAL'
    },
    reviewStatus: {
      type: String,
      enum: ['PENDING_TEACHER_REVIEW', 'APPROVED']
    },
    syllabusId: { type: String, index: true },
    syllabusUnit: { type: String, trim: true },
    syllabusTopic: { type: String, trim: true },
    sourceReference: { type: String, trim: true },
    aiProvider: { type: String, enum: ['GEMINI', 'GROQ'] },
    aiModel: { type: String, trim: true },
    dedupeKey: { type: String, unique: true, sparse: true, select: false },
    approvedBy: { type: String },
    approvedAt: { type: Date },
    status: {
      type: String,
      enum: {
        values: ['DRAFT', 'ACTIVE', 'INACTIVE', 'ARCHIVED'],
        message: '{VALUE} is not a valid question status'
      },
      default: 'ACTIVE',
      index: true
    }
  },
  {
    timestamps: true,
    toJSON: {
      transform: (_doc, ret: any) => {
        ret.id = ret.questionId || ret._id?.toString();
        delete ret.__v;
        return ret;
      }
    }
  }
);

QuestionSchema.index({ createdBy: 1, subject: 1 });
QuestionSchema.index({ subject: 1, topic: 1 });
QuestionSchema.index({ createdBy: 1, source: 1, reviewStatus: 1, status: 1 });

export const Question = mongoose.model<IQuestionDocument>('Question', QuestionSchema);
