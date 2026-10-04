import mongoose, { Document, Schema } from 'mongoose';

export interface ISubjectDocument extends Document {
  name: string;
  normalizedName: string;
  createdBy?: string;
  createdAt: Date;
  updatedAt: Date;
}

const SubjectSchema = new Schema<ISubjectDocument>(
  {
    name: { type: String, required: true, trim: true },
    normalizedName: { type: String, required: true, unique: true, trim: true, index: true },
    createdBy: { type: String, trim: true }
  },
  { timestamps: true }
);

export const Subject = mongoose.model<ISubjectDocument>('Subject', SubjectSchema);
