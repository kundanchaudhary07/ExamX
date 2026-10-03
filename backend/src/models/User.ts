import mongoose, { Schema, Document } from 'mongoose';
import { UserRole, UserStatus } from '../types/auth.types';

export interface IUserDocument extends Document {
  userId: string;
  name: string;
  email?: string;
  phone?: string;
  dob?: string;
  dobYear?: number;
  passwordHash: string;
  role: UserRole;
  status: UserStatus;
  department?: string;
  // Teacher-specific academic & professional fields
  qualification?: string;
  specialization?: string;
  designation?: string;
  experienceYears?: number;
  // Student-specific academic fields
  enrollmentNo?: string;
  course?: string;
  academicYear?: string;
  semester?: string;
  section?: string;
  managedBy: string[]; // Teacher userIds allowed to manage this student
  teacherIds: string[]; // Alias for managedBy (assigned teacher IDs)
  createdBy?: string;  // userId who provisioned this account
  createdAt: Date;
  updatedAt: Date;
}

const UserSchema = new Schema<IUserDocument>(
  {
    userId: {
      type: String,
      required: [true, 'User ID is required'],
      unique: true,
      trim: true
    },
    name: {
      type: String,
      required: [true, 'Name is required'],
      trim: true
    },
    email: {
      type: String,
      lowercase: true,
      trim: true,
      default: '',
      index: true
    },
    phone: {
      type: String,
      trim: true,
      default: ''
    },
    dob: {
      type: String,
      trim: true,
      default: ''
    },
    dobYear: {
      type: Number
    },
    passwordHash: {
      type: String,
      required: [true, 'Password hash is required'],
      select: false // Crucial: Never return passwordHash in queries by default
    },
    role: {
      type: String,
      enum: {
        values: ['ADMIN', 'TEACHER', 'STUDENT'],
        message: '{VALUE} is not a valid examination role'
      },
      required: true,
      index: true
    },
    status: {
      type: String,
      enum: {
        values: ['ACTIVE', 'INACTIVE', 'BLOCKED'],
        message: '{VALUE} is not a valid account status'
      },
      default: 'ACTIVE',
      index: true
    },
    department: {
      type: String,
      trim: true,
      default: ''
    },
    qualification: {
      type: String,
      trim: true,
      default: ''
    },
    specialization: {
      type: String,
      trim: true,
      default: ''
    },
    designation: {
      type: String,
      trim: true,
      default: ''
    },
    experienceYears: {
      type: Number,
      default: 0
    },
    enrollmentNo: {
      type: String,
      trim: true,
      default: ''
    },
    course: {
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
    section: {
      type: String,
      trim: true,
      default: ''
    },
    managedBy: {
      type: [String], // Array of Teacher userIds
      default: [],
      index: true
    },
    teacherIds: {
      type: [String], // Array of Teacher userIds
      default: [],
      index: true
    },
    createdBy: {
      type: String,
      default: 'SYSTEM'
    }
  },
  {
    timestamps: true,
    toJSON: {
      transform(_doc, ret: any) {
        if (ret._id) {
          ret.id = ret._id.toString();
          delete ret._id;
        }
        delete ret.__v;
        delete ret.passwordHash; // Double-guard: never serialize passwordHash
        return ret;
      }
    }
  }
);

// Compound index for role and status queries
UserSchema.index({ role: 1, status: 1 });

export const User = mongoose.model<IUserDocument>('User', UserSchema);
