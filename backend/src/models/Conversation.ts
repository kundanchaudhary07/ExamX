import mongoose, { Schema, Document } from 'mongoose';

export type ConversationType = 'DIRECT' | 'EXAM_LIVE';

export interface IConversationDocument extends Document {
  conversationId: string;
  type: ConversationType;
  examId?: string;
  examTitle?: string;
  participants: string[];
  participantRoles: Record<string, string>;
  participantNames: Record<string, string>;
  lastMessage?: {
    content: string;
    senderId: string;
    senderRole: string;
    senderName: string;
    createdAt: Date;
  };
  createdAt: Date;
  updatedAt: Date;
}

const ConversationSchema = new Schema<IConversationDocument>(
  {
    conversationId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true
    },
    type: {
      type: String,
      enum: ['DIRECT', 'EXAM_LIVE'],
      default: 'DIRECT',
      index: true
    },
    examId: {
      type: String,
      default: '',
      trim: true,
      index: true
    },
    examTitle: {
      type: String,
      default: '',
      trim: true
    },
    participants: {
      type: [String],
      required: true
    },
    participantRoles: {
      type: Map,
      of: String,
      default: {}
    },
    participantNames: {
      type: Map,
      of: String,
      default: {}
    },
    lastMessage: {
      content: { type: String, default: '' },
      senderId: { type: String, default: '' },
      senderRole: { type: String, default: '' },
      senderName: { type: String, default: '' },
      createdAt: { type: Date }
    }
  },
  {
    timestamps: true,
    toJSON: {
      transform: (_doc, ret: any) => {
        ret.id = ret.conversationId || ret._id?.toString();
        delete ret.__v;
        return ret;
      }
    }
  }
);

ConversationSchema.index({ participants: 1 });
ConversationSchema.index({ type: 1, examId: 1 });

export const Conversation = mongoose.model<IConversationDocument>(
  'Conversation',
  ConversationSchema
);
