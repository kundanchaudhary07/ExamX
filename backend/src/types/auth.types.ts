import { Request } from 'express';

export type UserRole = 'ADMIN' | 'TEACHER' | 'STUDENT';
export type UserStatus = 'ACTIVE' | 'INACTIVE' | 'BLOCKED';

export interface JwtUserPayload {
  id: string;
  userId: string;
  name: string;
  role: UserRole;
}

export interface AuthenticatedRequest extends Request {
  user?: JwtUserPayload;
  deviceSessionId?: string;
}
