import { Router } from 'express';
import { AuthController } from '../controllers/auth.controller';
import { authMiddleware } from '../middleware/auth.middleware';
import { requireRole } from '../middleware/role.middleware';
import rateLimit from 'express-rate-limit';

const router = Router();

// Rate limiting for login endpoint: 30 attempts per 15 minutes per IP
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 6,
  message: {
    success: false,
    message: 'Too many authentication attempts. Please try again after 15 minutes.'
  },
  standardHeaders: true,
  legacyHeaders: false,
  validate: false
});

const studentSignupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 30,
  message: {
    success: false,
    message: 'Too many account creation attempts. Please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false,
  validate: false
});

router.post('/signup/student', studentSignupLimiter, AuthController.signUpStudent);
router.post('/login', loginLimiter, AuthController.login);
router.get('/me', authMiddleware, AuthController.getMe);
router.post('/password', authMiddleware, requireRole('STUDENT'), AuthController.changePassword);

export default router;
