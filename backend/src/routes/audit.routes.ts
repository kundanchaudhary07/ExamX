import { Router, Response, NextFunction } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import { requireRole } from '../middleware/role.middleware';
import { AuditService } from '../services/audit.service';
import { AuthenticatedRequest } from '../types/auth.types';

const router = Router();

// System Audit Logs are strictly ADMIN-only
router.use(authenticate);
router.use(requireRole('ADMIN'));

router.get(
  '/',
  async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const limit = req.query.limit ? Number(req.query.limit) : 100;
      const logs = await AuditService.getAuditLogs(limit);
      res.status(200).json({
        success: true,
        data: { logs }
      });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
