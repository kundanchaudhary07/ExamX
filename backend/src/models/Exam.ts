import mongoose, { Schema, Document } from 'mongoose';
import { ExamStatus } from '../types/exam.types';

export interface IExamDocument extends Document {
  examId: string;
  title: string;
  description: string;
  subject: string;
  course: string;
  department: string;
  academicYear: string;
  semester: string;
  durationMinutes: number;
  questionCount: number;
  totalMarks: number;
  passingMarks: number;
  attemptLimit: number;
  strictMode: boolean;
  instructions: string;
  status: ExamStatus;
  createdBy: string;
  questions: string[];
  assignedStudents: string[];
  assignedStudentIds: string[];
  startAt?: Date;
  endAt?: Date;
  startDateTime?: Date;
  endDateTime?: Date;
  publishedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const ExamSchema = new Schema<IExamDocument>(
  {
    examId: {
      type: String,
      required: [true, 'Exam ID is required'],
      unique: true,
      trim: true,
      index: true
    },
    title: {
      type: String,
      required: [true, 'Exam title is required'],
      trim: true
    },
    description: {
      type: String,
      trim: true,
      default: ''
    },
    subject: {
      type: String,
      required: [true, 'Subject is required'],
      trim: true,
      index: true
    },
    course: {
      type: String,
      trim: true,
      default: ''
    },
    department: {
      type: String,
      trim: true,
      default: ''
    },
    academicYear: {
      type: String,
      trim: true,
      default: ''
    },
    semester: {
      type: String,
      trim: true,
      default: ''
    },
    durationMinutes: {
      type: Number,
      required: [true, 'Duration in minutes is required'],
      min: [1, 'Duration must be at least 1 minute']
    },
    questionCount: {
      type: Number,
      default: 0,
      min: [0, 'Question count cannot be negative']
    },
    totalMarks: {
      type: Number,
      required: [true, 'Total marks are required'],
      default: 0,
      min: [0, 'Total marks cannot be negative']
    },
    passingMarks: {
      type: Number,
      required: [true, 'Passing marks are required'],
      min: [0, 'Passing marks cannot be negative'],
      default: 0
    },
    attemptLimit: {
      type: Number,
      default: 1,
      min: [1, 'Attempt limit must be at least 1']
    },
    strictMode: {
      type: Boolean,
      default: true
    },
    instructions: {
      type: String,
      trim: true,
      default: 'Read all questions carefully. Strict online proctoring is enabled.'
    },
    status: {
      type: String,
      enum: {
        values: [
          'DRAFT',
          'SCHEDULED',
          'LIVE',
          'ENDED',
          'PUBLISHED',
          'RESULT_PUBLISHED',
          'CLOSED',
          'ARCHIVED'
        ],
        message: '{VALUE} is not a valid exam status'
      },
      default: 'DRAFT',
      index: true
    },
    createdBy: {
      type: String,
      required: [true, 'Creator userId is required'],
      trim: true,
      index: true
    },
    questions: {
      type: [String],
      default: []
    },
    assignedStudents: {
      type: [String],
      default: [],
      index: true
    },
    assignedStudentIds: {
      type: [String],
      default: [],
      index: true
    },
    startAt: {
      type: Date,
      index: true
    },
    endAt: {
      type: Date
    },
    startDateTime: {
      type: Date,
      index: true
    },
    endDateTime: {
      type: Date
    },
    publishedAt: {
      type: Date
    }
  },
  {
    timestamps: true,
    toJSON: {
      transform: (_doc, ret: any) => {
        ret.id = ret.examId || ret._id?.toString();
        delete ret.__v;
        return ret;
      }
    }
  }
);

ExamSchema.index({ createdBy: 1, status: 1 });

export const Exam = mongoose.model<IExamDocument>('Exam', ExamSchema);
