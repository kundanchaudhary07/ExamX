import { Router, Response, NextFunction } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import { requireRole } from '../middleware/role.middleware';
import { AuthenticatedRequest } from '../types/auth.types';
import { User } from '../models/User';
import { Exam } from '../models/Exam';
import { Question } from '../models/Question';
import { Result } from '../models/Result';
import { StudentQuery } from '../models/StudentQuery';
import { AuditLog } from '../models/AuditLog';
import { ProctoringEvent } from '../models/ProctoringEvent';
import { ExamAttempt } from '../models/ExamAttempt';
import { ExamAssignment } from '../models/ExamAssignment';

const router = Router();

router.use(authenticate);

router.get(
  '/stats',
  requireRole('ADMIN', 'TEACHER', 'STUDENT'),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = req.user!;

      if (user.role === 'ADMIN') {
        const [
          totalTeachers,
          activeTeachers,
          totalStudents,
          activeStudents,
          totalExams,
          publishedExams,
          liveExams,
          draftExams,
          completedExams,
          totalQuestions,
          totalResults,
          publishedResults,
          pendingResults,
          totalQueries,
          pendingQueries,
          resolvedQueries,
          totalAuditLogs,
          totalProctoringEvents,
          activeAttempts
        ] = await Promise.all([
          User.countDocuments({ role: 'TEACHER' }),
          User.countDocuments({ role: 'TEACHER', status: 'ACTIVE' }),
          User.countDocuments({ role: 'STUDENT' }),
          User.countDocuments({ role: 'STUDENT', status: 'ACTIVE' }),
          Exam.countDocuments({}),
          Exam.countDocuments({ status: 'PUBLISHED' }),
          Exam.countDocuments({ status: 'LIVE' }),
          Exam.countDocuments({ status: 'DRAFT' }),
          Exam.countDocuments({ status: { $in: ['ENDED', 'CLOSED'] } }),
          Question.countDocuments({ status: { $ne: 'ARCHIVED' } }),
          Result.countDocuments({}),
          Result.countDocuments({ status: { $in: ['PUBLISHED', 'QUERIED', 'REVISED'] } }),
          Result.countDocuments({ status: { $in: ['PENDING', 'VERIFIED'] } }),
          StudentQuery.countDocuments({}),
          StudentQuery.countDocuments({ status: 'PENDING' }),
          StudentQuery.countDocuments({ status: { $in: ['RESOLVED_ACCEPTED', 'RESOLVED_REJECTED'] } }),
          AuditLog.countDocuments({}),
          ProctoringEvent.countDocuments({}),
          ExamAttempt.countDocuments({ status: 'IN_PROGRESS' })
        ]);

        res.status(200).json({
          success: true,
          data: {
            role: 'ADMIN',
            totalTeachers,
            activeTeachers,
            inactiveTeachers: Math.max(0, totalTeachers - activeTeachers),
            totalStudents,
            activeStudents,
            inactiveStudents: Math.max(0, totalStudents - activeStudents),
            totalExams,
            publishedExams,
            liveExams,
            draftExams,
            completedExams,
            totalQuestions,
            totalResults,
            publishedResults,
            pendingResults,
            totalQueries,
            pendingQueries,
            resolvedQueries,
            totalAuditLogs,
            totalProctoringEvents,
            activeAttempts
          }
        });
        return;
      }

      if (user.role === 'TEACHER') {
        const teacherExams = await Exam.find({ createdBy: user.userId }).select('examId status').lean();
        const teacherExamIds = teacherExams.map(e => e.examId);

        const [
          totalStudents,
          activeStudents,
          totalQuestions,
          totalResults,
          publishedResults,
          pendingResults,
          totalQueries,
          pendingQueries,
          resolvedQueries,
          totalProctoringEvents,
          activeAttempts
        ] = await Promise.all([
          User.countDocuments({
            role: 'STUDENT',
            $or: [{ managedBy: user.userId }, { teacherIds: user.userId }]
          }),
          User.countDocuments({
            role: 'STUDENT',
            status: 'ACTIVE',
            $or: [{ managedBy: user.userId }, { teacherIds: user.userId }]
          }),
          Question.countDocuments({ createdBy: user.userId, status: { $ne: 'ARCHIVED' } }),
          Result.countDocuments({ examId: { $in: teacherExamIds } }),
          Result.countDocuments({
            examId: { $in: teacherExamIds },
            status: { $in: ['PUBLISHED', 'QUERIED', 'REVISED'] }
          }),
          Result.countDocuments({
            examId: { $in: teacherExamIds },
            status: { $in: ['PENDING', 'VERIFIED'] }
          }),
          StudentQuery.countDocuments({ examId: { $in: teacherExamIds } }),
          StudentQuery.countDocuments({ examId: { $in: teacherExamIds }, status: 'PENDING' }),
          StudentQuery.countDocuments({
            examId: { $in: teacherExamIds },
            status: { $in: ['RESOLVED_ACCEPTED', 'RESOLVED_REJECTED'] }
          }),
          ProctoringEvent.countDocuments({ examId: { $in: teacherExamIds } }),
          ExamAttempt.countDocuments({ examId: { $in: teacherExamIds }, status: 'IN_PROGRESS' })
        ]);

        const totalExams = teacherExams.length;
        const publishedExams = teacherExams.filter(e => e.status === 'PUBLISHED').length;
        const liveExams = teacherExams.filter(e => e.status === 'LIVE').length;
        const draftExams = teacherExams.filter(e => e.status === 'DRAFT').length;
        const completedExams = teacherExams.filter(
          e => e.status === 'ENDED' || e.status === 'CLOSED'
        ).length;

        res.status(200).json({
          success: true,
          data: {
            role: 'TEACHER',
            totalStudents,
            activeStudents,
            inactiveStudents: Math.max(0, totalStudents - activeStudents),
            totalExams,
            publishedExams,
            liveExams,
            draftExams,
            completedExams,
            totalQuestions,
            totalResults,
            publishedResults,
            pendingResults,
            totalQueries,
            pendingQueries,
            resolvedQueries,
            totalProctoringEvents,
            activeAttempts
          }
        });
        return;
      }

      // STUDENT
      const assignments = await ExamAssignment.find({ studentId: user.userId }).select('examId').lean();
      const assignedExamIds = assignments.map(a => a.examId);

      const [
        assignedExams,
        availableExams,
        completedAttempts,
        publishedResults,
        totalQueries,
        pendingQueries,
        resolvedQueries,
        proctoringEvents
      ] = await Promise.all([
        Exam.countDocuments({
          $or: [
            { examId: { $in: assignedExamIds } },
            { assignedStudents: user.userId },
            { assignedStudentIds: user.userId }
          ],
          status: { $in: ['PUBLISHED', 'LIVE', 'SCHEDULED', 'ENDED'] }
        }),
        Exam.countDocuments({
          $or: [
            { examId: { $in: assignedExamIds } },
            { assignedStudents: user.userId },
            { assignedStudentIds: user.userId }
          ],
          status: { $in: ['PUBLISHED', 'LIVE'] }
        }),
        ExamAttempt.countDocuments({
          studentId: user.userId,
          status: { $in: ['SUBMITTED', 'AUTO_SUBMITTED', 'EXPIRED', 'EVALUATED', 'TERMINATED', 'FORCE_SUBMITTED'] }
        }),
        Result.countDocuments({
          studentId: user.userId,
          status: { $in: ['PUBLISHED', 'QUERIED', 'REVISED'] }
        }),
        StudentQuery.countDocuments({ studentId: user.userId }),
        StudentQuery.countDocuments({ studentId: user.userId, status: 'PENDING' }),
        StudentQuery.countDocuments({
          studentId: user.userId,
          status: { $in: ['RESOLVED_ACCEPTED', 'RESOLVED_REJECTED'] }
        }),
        ProctoringEvent.countDocuments({ studentId: user.userId })
      ]);

      res.status(200).json({
        success: true,
        data: {
          role: 'STUDENT',
          assignedExams,
          availableExams,
          completedAttempts,
          publishedResults,
          totalQueries,
          pendingQueries,
          resolvedQueries,
          proctoringEvents
        }
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
