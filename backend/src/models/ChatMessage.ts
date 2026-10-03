import mongoose, { Schema, Document } from 'mongoose';

export type ChatSenderRole = 'ADMIN' | 'TEACHER' | 'STUDENT';
export type ChatType = 'DIRECT' | 'EXAM_LIVE';

export interface IChatMessageDocument extends Document {
  messageId: string;
  conversationId: string;
  senderId: string;
  senderRole: ChatSenderRole;
  senderName: string;
  recipientId?: string;
  content: string;
  type: ChatType;
  examId?: string;
  readBy: string[];
  createdAt: Date;
  updatedAt: Date;
}

const ChatMessageSchema = new Schema<IChatMessageDocument>(
  {
    messageId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true
    },
    conversationId: {
      type: String,
      required: true,
      trim: true,
      index: true
    },
    senderId: {
      type: String,
      required: true,
      trim: true,
      index: true
    },
    senderRole: {
      type: String,
      enum: ['ADMIN', 'TEACHER', 'STUDENT'],
      required: true
    },
    senderName: {
      type: String,
      required: true,
      trim: true
    },
    recipientId: {
      type: String,
      default: '',
      trim: true,
      index: true
    },
    content: {
      type: String,
      required: true,
      trim: true
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
    readBy: {
      type: [String],
      default: []
    }
  },
  {
    timestamps: true,
    toJSON: {
      transform: (_doc, ret: any) => {
        ret.id = ret.messageId || ret._id?.toString();
        delete ret.__v;
        return ret;
      }
    }
  }
);

ChatMessageSchema.index({ conversationId: 1, createdAt: 1 });

export const ChatMessage = mongoose.model<IChatMessageDocument>(
  'ChatMessage',
  ChatMessageSchema
);
