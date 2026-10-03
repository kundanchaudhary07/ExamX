import { Router } from 'express';
import { QuestionController } from '../controllers/question.controller';
import { authenticate } from '../middleware/auth.middleware';
import { requireRole } from '../middleware/role.middleware';

const router = Router();

// All question routes require authentication and TEACHER or ADMIN role
router.use(authenticate);
router.use(requireRole('TEACHER', 'ADMIN'));

router.post('/', QuestionController.createQuestion);
router.get('/', QuestionController.getQuestions);
router.get('/:questionId', QuestionController.getQuestionById);
router.patch('/:questionId', QuestionController.updateQuestion);
router.patch('/:questionId/status', QuestionController.updateQuestionStatus);
router.delete('/:questionId', QuestionController.deleteQuestion);

export default router;
