import mongoose, { Document, Schema } from 'mongoose';
import { QuestionDifficulty } from '../types/exam.types';

export type GenerationBatchReviewStatus =
  | 'PENDING_REVIEW'
  | 'PARTIALLY_REVIEWED'
  | 'APPROVED'
  | 'DISCARDED';

export interface IAiGenerationBatchDocument extends Document {
  generationId: string;
  generatedBy: string;
  generatedByName: string;
  subject: string;
  course: string;
  semester: string;
  topic: string;
  selectedUnits?: string[];
  difficulty: QuestionDifficulty | 'MIXED';
  marksPerQuestion: number;
  requestedCount: number;
  generatedCount: number;
  syllabusId: string;
  sourceFileName: string;
  provider: 'GROQ';
  aiModel: string;
  generatedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const AiGenerationBatchSchema = new Schema<IAiGenerationBatchDocument>(
  {
    generationId: { type: String, required: true, unique: true, trim: true, index: true },
    generatedBy: { type: String, required: true, trim: true, index: true },
    generatedByName: { type: String, required: true, trim: true },
    subject: { type: String, required: true, trim: true, index: true },
    course: { type: String, required: true, trim: true, index: true },
    semester: { type: String, required: true, trim: true, index: true },
    topic: { type: String, required: true, trim: true },
    selectedUnits: { type: [String], default: [] },
    difficulty: { type: String, enum: ['EASY', 'MEDIUM', 'HARD', 'MIXED'], required: true },
    marksPerQuestion: { type: Number, required: true, min: 1 },
    requestedCount: { type: Number, required: true, min: 1, max: 200 },
    generatedCount: { type: Number, required: true, min: 1, max: 200 },
    syllabusId: { type: String, required: true, index: true },
    sourceFileName: { type: String, required: true, trim: true },
    provider: { type: String, enum: ['GROQ'], required: true },
    aiModel: { type: String, required: true, trim: true },
    generatedAt: { type: Date, required: true, default: Date.now, index: true }
  },
  { timestamps: true }
);

AiGenerationBatchSchema.index({ generatedBy: 1, generatedAt: -1 });

export const AiGenerationBatch = mongoose.model<IAiGenerationBatchDocument>(
  'AiGenerationBatch',
  AiGenerationBatchSchema
);
