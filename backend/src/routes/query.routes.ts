import { Router, Response, NextFunction } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import { requireRole } from '../middleware/role.middleware';
import { QueryService } from '../services/query.service';
import { AuthenticatedRequest } from '../types/auth.types';

const router = Router();

router.use(authenticate);

// Student creates a query on an assigned/attempted exam
router.post(
  '/',
  requireRole('STUDENT'),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const query = await QueryService.createQuery(req.body || {}, req.user!);
      res.status(201).json({
        success: true,
        data: { query }
      });
    } catch (err) {
      next(err);
    }
  }
);

// List queries based on role (Student: own, Teacher: own exams, Admin: all)
router.get(
  '/',
  async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const queries = await QueryService.getQueries(
        {
          examId: req.query.examId as string | undefined,
          status: req.query.status as string | undefined
        },
        req.user!
      );
      res.status(200).json({
        success: true,
        data: { queries }
      });
    } catch (err) {
      next(err);
    }
  }
);

// Teacher / Admin resolves or updates a query
router.patch(
  '/:queryId/resolve',
  requireRole('TEACHER', 'ADMIN'),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const query = await QueryService.resolveQuery(
        req.params.queryId as string,
        req.body || {},
        req.user!
      );
      res.status(200).json({
        success: true,
        data: { query }
      });
    } catch (err) {
      next(err);
    }
  }
);

router.patch(
  '/:queryId',
  requireRole('TEACHER', 'ADMIN'),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const query = await QueryService.resolveQuery(
        req.params.queryId as string,
        req.body || {},
        req.user!
      );
      res.status(200).json({
        success: true,
        data: { query }
      });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
