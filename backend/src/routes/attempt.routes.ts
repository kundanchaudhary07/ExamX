import { Router, Response, NextFunction } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import { requireRole } from '../middleware/role.middleware';
import { AttemptService } from '../services/attempt.service';
import { AuthenticatedRequest } from '../types/auth.types';

const router = Router();

router.use(authenticate);

// Student starts or resumes an attempt via POST /api/attempts/start { examId }
router.post(
  '/start',
  requireRole('STUDENT'),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const examId = req.body?.examId;
      if (!examId || typeof examId !== 'string') {
        res.status(400).json({
          success: false,
          error: { message: 'examId is required' }
        });
        return;
      }
      const deviceSessionId = req.get('X-ExamX-Device-Session') || req.body?.deviceSessionId || '';
      const result = await AttemptService.startAttempt(examId, req.user!, deviceSessionId);
      res.status(201).json({
        success: true,
        data: result
      });
    } catch (err) {
      next(err);
    }
  }
);

// List attempts for authenticated user with strict RBAC (Teacher gets own exam attempts, Admin gets platform attempts, Student gets own attempts)
router.get(
  '/',
  async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const filters = {
        examId: typeof req.query.examId === 'string' ? req.query.examId.trim() : undefined
      };
      const attempts = await AttemptService.listAttempts(filters, req.user!);
      res.status(200).json({
        success: true,
        data: { attempts }
      });
    } catch (err) {
      next(err);
    }
  }
);

// Student lists their own attempts
router.get(
  '/my',
  requireRole('STUDENT'),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const attempts = await AttemptService.listAttempts({}, req.user!);
      res.status(200).json({
        success: true,
        data: { attempts }
      });
    } catch (err) {
      next(err);
    }
  }
);

// Get attempt by attemptId (student owner, exam teacher, or admin)
router.get(
  '/:attemptId',
  async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await AttemptService.getAttemptById(
        req.params.attemptId as string,
        req.user!,
        req.get('X-ExamX-Device-Session') || ''
      );
      res.status(200).json({
        success: true,
        data: result
      });
    } catch (err) {
      next(err);
    }
  }
);

// Save in-progress answers (student owner only, enforces active attempt & timer)
router.patch(
  '/:attemptId/answers',
  requireRole('STUDENT'),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const answers = Array.isArray(req.body?.answers) ? req.body.answers : [];
      const result = await AttemptService.saveProgressAnswers(
        req.params.attemptId as string,
        answers,
        req.user!,
        {
          currentQuestionIndex: req.body?.currentQuestionIndex,
          cameraStatus: req.body?.cameraStatus,
          faceStatus: req.body?.faceStatus,
          fullscreenActive: req.body?.fullscreenActive,
          deviceSessionId: req.get('X-ExamX-Device-Session') || ''
        }
      );
      res.status(200).json({
        success: true,
        data: result
      });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/:attemptId/save',
  requireRole('STUDENT'),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const answers = Array.isArray(req.body?.answers) ? req.body.answers : [];
      const result = await AttemptService.saveProgressAnswers(
        req.params.attemptId as string,
        answers,
        req.user!,
        {
          currentQuestionIndex: req.body?.currentQuestionIndex,
          cameraStatus: req.body?.cameraStatus,
          faceStatus: req.body?.faceStatus,
          fullscreenActive: req.body?.fullscreenActive,
          deviceSessionId: req.get('X-ExamX-Device-Session') || ''
        }
      );
      res.status(200).json({
        success: true,
        data: result
      });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/:attemptId/heartbeat',
  requireRole('STUDENT'),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await AttemptService.recordHeartbeat(
        req.params.attemptId as string,
        req.user!,
        {
          cameraStatus: req.body?.cameraStatus,
          faceStatus: req.body?.faceStatus,
          fullscreenActive: req.body?.fullscreenActive,
          deviceSessionId: req.get('X-ExamX-Device-Session') || ''
        }
      );
      res.status(200).json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }
);

// Submit attempt (student owner only, server-side timer & server-side scoring)
router.post(
  '/:attemptId/submit',
  requireRole('STUDENT'),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const terminateReason =
        req.body?.terminateReason ||
        (req.body?.terminatedByProctor ? req.body?.terminationReason || 'Proctoring violation' : undefined);

      const result = await AttemptService.submitAttempt(
        req.params.attemptId as string,
        {
          answers: req.body?.answers,
          terminateReason
        },
        req.user!,
        req.get('X-ExamX-Device-Session') || ''
      );
      res.status(200).json({
        success: true,
        data: {
          ...result,
          resultStatus: result.status,
          resultPublished: result.status === 'PUBLISHED',
          result: null,
          message: 'Exam attempt submitted and evaluated server-side. Results will be visible once published by faculty.'
        }
      });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
