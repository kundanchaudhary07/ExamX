import jwt, { SignOptions } from 'jsonwebtoken';
import { ENV } from '../config/env';
import { JwtUserPayload } from '../types/auth.types';

export function signToken(payload: JwtUserPayload): string {
  const options: SignOptions = {
    expiresIn: ENV.JWT_EXPIRES_IN as any
  };
  return jwt.sign(payload, ENV.JWT_SECRET, options);
}

export function verifyToken(token: string): JwtUserPayload {
  return jwt.verify(token, ENV.JWT_SECRET) as JwtUserPayload;
}
