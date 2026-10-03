import { Response, NextFunction } from 'express';
import { UserService } from '../services/user.service';
import { AuthenticatedRequest } from '../types/auth.types';

export class UserController {
  // --- UNIFIED NEXT ID ---

  static async getNextUserId(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const role = String(req.query.role || 'STUDENT').toUpperCase();
      const nextUserId =
        role === 'TEACHER'
          ? await UserService.getNextTeacherId()
          : await UserService.getNextStudentId();
      res.status(200).json({
        success: true,
        data: { role, nextUserId }
      });
    } catch (err) {
      next(err);
    }
  }

  // --- TEACHERS (ADMIN ONLY) ---

  static async getNextTeacherId(_req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const nextUserId = await UserService.getNextTeacherId();
      res.status(200).json({
        success: true,
        data: { role: 'TEACHER', nextUserId }
      });
    } catch (err) {
      next(err);
    }
  }

  static async createTeacher(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await UserService.createTeacher(req.body, req.user!.userId);
      res.status(201).json({
        success: true,
        data: result
      });
    } catch (err) {
      next(err);
    }
  }

  static async getTeachers(_req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const teachers = await UserService.getTeachers();
      res.status(200).json({
        success: true,
        data: { teachers }
      });
    } catch (err) {
      next(err);
    }
  }

  static async getTeacherDetails(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const details = await UserService.getTeacherDetails(req.params.userId as string, req.user!);
      const assignedStudents = (details.allStudents || details.assignedStudents || details.recentStudents || []).map((s: any) => ({
        ...s,
        id: s.userId || s.id || s._id
      }));

      const createdExams = (details.allExams || details.createdExams || details.recentExams || []).map((ex: any) => {
        let scheduledDate = 'Flexible';
        let startTime = 'Anytime';
        if (ex.scheduledStart) {
          const d = new Date(ex.scheduledStart);
          if (!isNaN(d.getTime())) {
            scheduledDate = d.toISOString().split('T')[0];
            startTime = d.toTimeString().slice(0, 5);
          }
        }
        return {
          ...ex,
          id: ex.examId || ex.id,
          subjectTitle: ex.subject || ex.subjectTitle || 'General',
          scheduledDate,
          startTime
        };
      });

      res.status(200).json({
        success: true,
        data: {
          ...details.teacher,
          teacher: details.teacher,
          kpis: {
            ...details.kpis,
            students: details.kpis.students ?? assignedStudents.length,
            exams: details.kpis.exams ?? createdExams.length,
            assignedStudentsCount: details.kpis.students ?? assignedStudents.length,
            createdExamsCount: details.kpis.exams ?? createdExams.length,
            evaluatedResultsCount: details.kpis.questions ?? 0,
            pendingQueriesCount: details.kpis.queries ?? 0
          },
          assignedStudents,
          recentStudents: assignedStudents.slice(0, 20),
          createdExams,
          recentExams: createdExams.slice(0, 20),
          recentActivity: details.recentActivity || []
        }
      });
    } catch (err) {
      next(err);
    }
  }

  static async updateTeacher(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const teacher = await UserService.updateTeacher(req.params.userId as string, req.body, req.user!.userId);
      res.status(200).json({
        success: true,
        data: { teacher }
      });
    } catch (err) {
      next(err);
    }
  }

  static async resetTeacherPassword(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const newPass = req.body?.password ?? req.body?.newPassword;
      const result = await UserService.resetTeacherPassword(req.params.userId as string, newPass, req.user!.userId);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }

  // --- STUDENTS (ADMIN & TEACHER) ---

  static async getNextStudentId(_req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const nextUserId = await UserService.getNextStudentId();
      res.status(200).json({
        success: true,
        data: { role: 'STUDENT', nextUserId }
      });
    } catch (err) {
      next(err);
    }
  }

  static async createStudent(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await UserService.createStudent(req.body, req.user!);
      res.status(201).json({
        success: true,
        data: result
      });
    } catch (err) {
      next(err);
    }
  }

  static async getStudents(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const students = await UserService.getStudents(req.user!);
      res.status(200).json({
        success: true,
        data: { students }
      });
    } catch (err) {
      next(err);
    }
  }

  static async getStudentById(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const details = await UserService.getStudentDetails(req.params.userId as string, req.user!);
      const rawResults = details.results || [];
      const mappedResults = rawResults.map((r: any) => {
        let evaluatedAt = '—';
        const rawDate = r.publishedAt || r.createdAt || r.evaluatedAt;
        if (rawDate) {
          const d = new Date(rawDate);
          evaluatedAt = !isNaN(d.getTime()) ? d.toISOString() : '—';
        }
        return {
          ...r,
          id: r.resultId || r._id?.toString() || r.id,
          subjectTitle: r.examTitle || r.subject || r.subjectTitle || 'Assessment',
          evaluatedAt
        };
      });
      const avgPct =
        mappedResults.length > 0
          ? Math.round(
              mappedResults.reduce((acc: number, r: any) => acc + (Number(r.percentage) || 0), 0) /
                mappedResults.length
            )
          : 0;
      const firstAssignedTeacher =
        Array.isArray(details.student?.assignedTeachers) && details.student.assignedTeachers.length > 0
          ? details.student.assignedTeachers[0]
          : null;

      res.status(200).json({
        success: true,
        data: {
          ...details.student,
          student: details.student,
          assignedTeacher: firstAssignedTeacher,
          kpis: {
            ...details.kpis,
            examsTakenCount: details.kpis.completedExams ?? mappedResults.length,
            averagePercentage: avgPct,
            publishedResultsCount: details.kpis.publishedResults ?? mappedResults.length,
            queriesCount: (details.queries || []).length
          },
          recentExams: details.recentExams || [],
          results: mappedResults,
          queries: details.queries || []
        }
      });
    } catch (err) {
      next(err);
    }
  }

  static async getUserById(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = await UserService.getUserById(req.params.userId as string, req.user!);
      res.status(200).json({
        success: true,
        data: { user }
      });
    } catch (err) {
      next(err);
    }
  }

  static async updateStudent(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const student = await UserService.updateStudent(req.params.userId as string, req.body, req.user!);
      res.status(200).json({
        success: true,
        data: { student }
      });
    } catch (err) {
      next(err);
    }
  }

  static async resetStudentPassword(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const newPass = req.body?.password ?? req.body?.newPassword;
      const result = await UserService.resetStudentPassword(req.params.userId as string, newPass, req.user!);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }

  static async updateUserStatus(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = await UserService.updateUserStatus(
        req.params.userId as string,
        req.body?.status,
        req.user!
      );
      res.status(200).json({
        success: true,
        data: { user }
      });
    } catch (err) {
      next(err);
    }
  }
}
