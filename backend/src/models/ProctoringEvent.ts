import mongoose, { Schema, Document } from 'mongoose';

export type ProctoringEventType =
  | 'TAB_SWITCH'
  | 'FULLSCREEN_EXIT'
  | 'NO_FACE'
  | 'MULTIPLE_FACES'
  | 'CAMERA_OFF'
  | 'CAMERA_BLOCKED'
  | 'LOOKING_AWAY'
  | 'COPY_PASTE_ATTEMPT'
  | 'RIGHT_CLICK_ATTEMPT'
  | 'SCREENSHOT_ATTEMPT'
  | 'WINDOW_BLUR'
  | 'WINDOW_FOCUS'
  | 'CAMERA_CONNECTED'
  | 'FACE_DETECTED'
  | 'FACE_STATUS';

export type ProctoringSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface IProctoringEventDocument extends Document {
  eventId: string;
  attemptId: string;
  studentId: string;
  studentName: string;
  examId: string;
  eventType: ProctoringEventType;
  severity: ProctoringSeverity;
  details: string;
  metadata: Record<string, any>;
  timestamp: Date;
  createdAt: Date;
  updatedAt: Date;
}

const ProctoringEventSchema = new Schema<IProctoringEventDocument>(
  {
    eventId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true
    },
    attemptId: {
      type: String,
      default: '',
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
    eventType: {
      type: String,
      enum: [
        'TAB_SWITCH',
        'FULLSCREEN_EXIT',
        'NO_FACE',
        'MULTIPLE_FACES',
        'CAMERA_OFF',
        'CAMERA_BLOCKED',
        'LOOKING_AWAY',
        'COPY_PASTE_ATTEMPT',
        'RIGHT_CLICK_ATTEMPT',
        'SCREENSHOT_ATTEMPT',
        'WINDOW_BLUR',
        'WINDOW_FOCUS',
        'CAMERA_CONNECTED',
        'FACE_DETECTED',
        'FACE_STATUS'
      ],
      required: true
    },
    severity: {
      type: String,
      enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'],
      default: 'MEDIUM'
    },
    details: {
      type: String,
      default: '',
      trim: true
    },
    metadata: {
      type: Schema.Types.Mixed,
      default: {}
    },
    timestamp: {
      type: Date,
      default: Date.now,
      index: true
    }
  },
  {
    timestamps: true,
    toJSON: {
      transform: (_doc, ret: any) => {
        ret.id = ret.eventId || ret._id?.toString();
        ret.violationType = ret.eventType;
        delete ret.__v;
        return ret;
      }
    }
  }
);

ProctoringEventSchema.index({ examId: 1, studentId: 1 });
ProctoringEventSchema.index({ attemptId: 1, createdAt: -1 });
ProctoringEventSchema.index({ studentId: 1, createdAt: -1 });
ProctoringEventSchema.index({ createdAt: -1 });

export const ProctoringEvent = mongoose.model<IProctoringEventDocument>('ProctoringEvent', ProctoringEventSchema);
