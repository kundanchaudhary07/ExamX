import mongoose, { Document, Schema } from 'mongoose';

export interface ISyllabusDocument extends Document {
  syllabusId: string;
  uploadedBy: string;
  uploadedByRole: 'ADMIN' | 'TEACHER';
  course: string;
  semester: string;
  subject: string;
  fileName: string;
  fileType: 'PDF' | 'DOCX' | 'TXT';
  charCount: number;
  wordCount: number;
  extractedText: string;
  createdAt: Date;
  updatedAt: Date;
}

const SyllabusSchema = new Schema<ISyllabusDocument>(
  {
    syllabusId: { type: String, required: true, unique: true, index: true },
    uploadedBy: { type: String, required: true, index: true },
    uploadedByRole: { type: String, enum: ['ADMIN', 'TEACHER'], required: true },
    course: { type: String, required: true, index: true },
    semester: { type: String, required: true, index: true },
    subject: { type: String, required: true, index: true },
    fileName: { type: String, required: true },
    fileType: { type: String, enum: ['PDF', 'DOCX', 'TXT'], required: true },
    charCount: { type: Number, required: true, min: 1 },
    wordCount: { type: Number, required: true, min: 1 },
    extractedText: { type: String, required: true, select: false }
  },
  { timestamps: true }
);

SyllabusSchema.index({ uploadedBy: 1, createdAt: -1 });

export const Syllabus = mongoose.model<ISyllabusDocument>('Syllabus', SyllabusSchema);
