import { Router, Response, NextFunction } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import { requireRole } from '../middleware/role.middleware';
import { AuthenticatedRequest } from '../types/auth.types';
import { SubjectService } from '../services/subject.service';

const router = Router();
router.use(authenticate, requireRole('TEACHER', 'ADMIN'));

router.get('/', async (_req, res: Response, next: NextFunction): Promise<void> => {
  try {
    res.status(200).json({ success: true, data: { subjects: await SubjectService.list() } });
  } catch (error) {
    next(error);
  }
});

router.post('/', async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const subject = await SubjectService.ensure(req.body?.name, req.user!.userId);
    res.status(200).json({ success: true, data: { subject } });
  } catch (error) {
    next(error);
  }
});

export default router;
