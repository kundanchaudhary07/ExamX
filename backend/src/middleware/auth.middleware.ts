import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../types/auth.types';
import { verifyToken } from '../utils/token';
import { User } from '../models/User';
import { logger } from '../utils/logger';

export async function authMiddleware(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({
      success: false,
      message: 'Authentication token missing or invalid format'
    });
    return;
  }

  const token = authHeader.split(' ')[1];

  try {
    const payload = verifyToken(token);

    // Check if user still exists in database and has active status
    const existingUser = await User.findOne({ userId: payload.userId }).select('status role');
    if (!existingUser) {
      res.status(401).json({
        success: false,
        message: 'Account no longer exists'
      });
      return;
    }

    if (existingUser.status !== 'ACTIVE') {
      res.status(403).json({
        success: false,
        message: 'Account is deactivated or suspended. Contact examination controller.'
      });
      return;
    }

    req.user = {
      id: payload.id,
      userId: payload.userId,
      name: payload.name,
      role: existingUser.role
    };

    next();
  } catch (err: any) {
    logger.warn('Token verification failed:', err.message);
    res.status(401).json({
      success: false,
      message: 'Session expired or invalid token'
    });
  }
}

export const authenticate = authMiddleware;
export const requireAuth = authMiddleware;
