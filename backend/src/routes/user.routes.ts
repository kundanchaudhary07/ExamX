import { Router } from 'express';
import { UserController } from '../controllers/user.controller';
import { AuthController } from '../controllers/auth.controller';
import { authenticate } from '../middleware/auth.middleware';
import { requireRole } from '../middleware/role.middleware';

const router = Router();

// All user management routes require authentication
router.use(authenticate);

// Authenticated profile alias (/api/users/me)
router.get('/me', AuthController.getMe);

// Unified Next-ID preview endpoint (/api/users/next-id?role=TEACHER|STUDENT)
router.get('/next-id', requireRole('ADMIN', 'TEACHER'), UserController.getNextUserId);

// --- TEACHER MANAGEMENT (ADMIN ONLY) ---
router.get('/teachers/next-id', requireRole('ADMIN'), UserController.getNextTeacherId);
router.post('/teachers', requireRole('ADMIN'), UserController.createTeacher);
router.get('/teachers', requireRole('ADMIN'), UserController.getTeachers);
router.get('/teachers/:userId', UserController.getTeacherDetails);
router.get('/teachers/:userId/details', UserController.getTeacherDetails);
router.patch('/teachers/:userId', requireRole('ADMIN'), UserController.updateTeacher);
router.patch('/teachers/:userId/reset-password', requireRole('ADMIN'), UserController.resetTeacherPassword);
router.post('/teachers/:userId/reset-password', requireRole('ADMIN'), UserController.resetTeacherPassword);

// --- STUDENT MANAGEMENT (ADMIN & TEACHER) ---
router.get('/students/next-id', requireRole('ADMIN', 'TEACHER'), UserController.getNextStudentId);
router.post('/students', requireRole('ADMIN', 'TEACHER'), UserController.createStudent);
router.get('/students', requireRole('ADMIN', 'TEACHER'), UserController.getStudents);
router.get('/students/:userId', UserController.getStudentById);
router.get('/students/:userId/details', UserController.getStudentById);
router.patch('/students/:userId', requireRole('ADMIN', 'TEACHER'), UserController.updateStudent);
router.patch('/students/:userId/reset-password', requireRole('ADMIN', 'TEACHER'), UserController.resetStudentPassword);
router.post('/students/:userId/reset-password', requireRole('ADMIN', 'TEACHER'), UserController.resetStudentPassword);

// --- UNIFIED STATUS & USER PROFILE ENDPOINTS ---
router.get('/:userId', UserController.getUserById);
router.patch('/:userId/status', requireRole('ADMIN', 'TEACHER'), UserController.updateUserStatus);

export default router;
