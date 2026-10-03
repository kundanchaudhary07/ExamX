import { Router } from 'express';
import { ExamController } from '../controllers/exam.controller';
import { authenticate } from '../middleware/auth.middleware';
import { requireRole } from '../middleware/role.middleware';
import attemptRoutes from './attempt.routes';

const router = Router();

// All student routes require authentication and STUDENT role
router.use(authenticate);
router.use(requireRole('STUDENT'));

router.use('/attempts', attemptRoutes);
router.get('/exams', ExamController.getStudentExams);
router.get('/exams/:examId', ExamController.getStudentExamDetails);
router.post('/exams/:examId/start', ExamController.startExamAttempt);
router.get('/results', ExamController.getStudentResults);
router.get('/queries', ExamController.getStudentQueries);

export default router;
