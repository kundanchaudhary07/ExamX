import mongoose, { Schema } from 'mongoose';

interface ISequenceDocument {
  _id: string;
  value: number;
}

const SequenceSchema = new Schema<ISequenceDocument>({
  _id: { type: String, required: true },
  value: { type: Number, required: true, default: 0 }
});

export const Sequence = mongoose.model<ISequenceDocument>('Sequence', SequenceSchema);
