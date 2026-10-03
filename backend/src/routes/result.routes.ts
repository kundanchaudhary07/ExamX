import { Router, Response, NextFunction } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import { requireRole } from '../middleware/role.middleware';
import { ResultService } from '../services/result.service';
import { AuthenticatedRequest } from '../types/auth.types';

const router = Router();

router.use(authenticate);

// List results based on role:
// - STUDENT: only own PUBLISHED results
// - TEACHER: results for own exams (or filtered by ?examId=)
// - ADMIN: all results (or filtered by ?examId=)
router.get(
  '/',
  async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const results = await ResultService.getResults(
        {
          examId: req.query.examId as string | undefined,
          studentId: req.query.studentId as string | undefined,
          status: req.query.status as string | undefined
        },
        req.user!
      );
      res.status(200).json({
        success: true,
        data: { results }
      });
    } catch (err) {
      next(err);
    }
  }
);

// Student's own published results
router.get(
  '/my',
  requireRole('STUDENT'),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const results = await ResultService.getResults({}, req.user!);
      res.status(200).json({
        success: true,
        data: { results }
      });
    } catch (err) {
      next(err);
    }
  }
);

// Teacher / Admin get results for a specific exam
router.get(
  '/exam/:examId',
  requireRole('TEACHER', 'ADMIN'),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const results = await ResultService.getResults(
        { examId: req.params.examId as string },
        req.user!
      );
      res.status(200).json({
        success: true,
        data: { results }
      });
    } catch (err) {
      next(err);
    }
  }
);

// Teacher / Admin publish all results for an exam
router.post(
  '/exam/:examId/publish',
  requireRole('TEACHER', 'ADMIN'),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const examId = req.params.examId as string;
      const result = await ResultService.publishAllExamResults(examId, req.user!);
      res.status(200).json({
        success: true,
        data: { ...result, examId }
      });
    } catch (err) {
      next(err);
    }
  }
);

// Get individual result by resultId (enforces student ownership & PUBLISHED gating)
router.get(
  '/:resultId',
  async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await ResultService.getResultById(
        req.params.resultId as string,
        req.user!
      );
      res.status(200).json({
        success: true,
        data: { result }
      });
    } catch (err) {
      next(err);
    }
  }
);

// Publish a single result (Teacher / Admin)
router.patch(
  '/:resultId/publish',
  requireRole('TEACHER', 'ADMIN'),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await ResultService.publishResult(
        req.params.resultId as string,
        { feedback: req.body?.feedback },
        req.user!
      );
      res.status(200).json({
        success: true,
        data: { result }
      });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
