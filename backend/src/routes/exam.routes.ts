import { Router } from 'express';
import { ExamController } from '../controllers/exam.controller';
import { authenticate } from '../middleware/auth.middleware';
import { requireRole } from '../middleware/role.middleware';

const router = Router();

// All exam routes require authentication
router.use(authenticate);

// Student-accessible exam attempt start endpoints
router.post('/:examId/attempts', requireRole('STUDENT'), ExamController.startExamAttempt);
router.post('/:examId/attempts/start', requireRole('STUDENT'), ExamController.startExamAttempt);

// All remaining /api/exams routes require TEACHER or ADMIN role
router.use(requireRole('TEACHER', 'ADMIN'));

router.post('/', ExamController.createExam);
router.get('/', ExamController.getExams);
router.get('/:examId', ExamController.getExamById);
router.patch('/:examId', ExamController.updateExam);
router.delete('/:examId', requireRole('ADMIN'), ExamController.deleteExam);
router.patch('/:examId/status', ExamController.updateExamStatus);
router.post('/:examId/questions', ExamController.attachQuestions);
router.patch('/:examId/questions/:questionId', ExamController.updateExamQuestion);
router.delete('/:examId/questions/:questionId', ExamController.removeExamQuestion);
router.post('/:examId/assign', ExamController.assignExam);
router.post('/:examId/publish', ExamController.publishExam);
router.post('/:examId/close', ExamController.closeExam);
router.get('/:examId/attempts', ExamController.getExamAttempts);
router.get('/:examId/results', ExamController.getExamResults);
router.post('/:examId/results/publish', ExamController.publishExamResults);
router.get('/:examId/proctoring', ExamController.getExamProctoringEvents);

export default router;
