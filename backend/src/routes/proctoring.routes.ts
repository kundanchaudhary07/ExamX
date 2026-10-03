import { Router, Response, NextFunction } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import { requireRole } from '../middleware/role.middleware';
import { ProctoringService } from '../services/proctoring.service';
import { UnblockService } from '../services/unblock.service';
import { AuthenticatedRequest } from '../types/auth.types';

const router = Router();

router.use(authenticate);

// Student submits an unblock / review request for a blocked attempt
router.post(
  '/unblock-requests',
  requireRole('STUDENT'),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const request = await UnblockService.requestUnblock(req.body || {}, req.user!);
      res.status(201).json({
        success: true,
        data: { request }
      });
    } catch (err) {
      next(err);
    }
  }
);

// List unblock requests (Student gets own, Teacher gets own exam candidates, Admin gets all)
router.get(
  '/unblock-requests',
  async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const requests = await UnblockService.listUnblockRequests(
        {
          examId: req.query.examId as string | undefined,
          studentId: req.query.studentId as string | undefined,
          status: req.query.status as string | undefined
        },
        req.user!
      );
      res.status(200).json({
        success: true,
        data: { requests }
      });
    } catch (err) {
      next(err);
    }
  }
);

// Teacher / Admin approves or rejects unblock request
router.patch(
  '/unblock-requests/:requestId',
  requireRole('TEACHER', 'ADMIN'),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const request = await UnblockService.reviewUnblockRequest(
        req.params.requestId as string,
        req.body || {},
        req.user!
      );
      res.status(200).json({
        success: true,
        data: { request }
      });
    } catch (err) {
      next(err);
    }
  }
);

// Student records a proctoring event during an active exam attempt
router.post(
  '/events',
  requireRole('STUDENT'),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const event = await ProctoringService.recordEvent(req.body || {}, req.user!);
      res.status(201).json({
        success: true,
        data: { event }
      });
    } catch (err) {
      next(err);
    }
  }
);

// List proctoring events (Students see only their own events, Teachers see exam events, Admins see all)
router.get(
  '/events',
  requireRole('TEACHER', 'ADMIN', 'STUDENT'),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const events = await ProctoringService.getEvents(
        {
          examId: req.query.examId as string | undefined,
          attemptId: req.query.attemptId as string | undefined,
          studentId: req.query.studentId as string | undefined
        },
        req.user!
      );
      res.status(200).json({
        success: true,
        data: { events }
      });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
