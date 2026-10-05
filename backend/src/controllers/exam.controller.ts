import { Response, NextFunction } from 'express';
import { ExamService } from '../services/exam.service';
import { AttemptService } from '../services/attempt.service';
import { ResultService } from '../services/result.service';
import { ProctoringService } from '../services/proctoring.service';
import { QueryService } from '../services/query.service';
import { AuthenticatedRequest } from '../types/auth.types';

export class ExamController {
  // --- TEACHER & ADMIN EXAM ENDPOINTS ---

  static async createExam(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const exam = await ExamService.createExam(req.body, req.user!);
      res.status(201).json({
        success: true,
        data: { exam }
      });
    } catch (err) {
      next(err);
    }
  }

  static async getExams(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const exams = await ExamService.getExams(
        {
          subject: req.query.subject as string | undefined,
          status: req.query.status as string | undefined,
          search: req.query.search as string | undefined
        },
        req.user!
      );
      res.status(200).json({
        success: true,
        data: { exams }
      });
    } catch (err) {
      next(err);
    }
  }

  static async getExamById(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const exam = await ExamService.getExamById(req.params.examId as string, req.user!);
      res.status(200).json({
        success: true,
        data: { exam }
      });
    } catch (err) {
      next(err);
    }
  }

  static async updateExam(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const exam = await ExamService.updateExam(req.params.examId as string, req.body, req.user!);
      res.status(200).json({
        success: true,
        data: { exam }
      });
    } catch (err) {
      next(err);
    }
  }

  static async deleteExam(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      await ExamService.deleteExam(req.params.examId as string, req.user!);
      res.status(200).json({
        success: true,
        message: 'Exam deleted successfully'
      });
    } catch (err) {
      next(err);
    }
  }

  static async updateExamStatus(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const examId = req.params.examId as string;
      const exam = await ExamService.updateExam(examId, { status: req.body?.status }, req.user!);
      if (req.body?.publishResults) {
        await ResultService.publishAllExamResults(examId, req.user!);
      }
      res.status(200).json({
        success: true,
        data: { exam }
      });
    } catch (err) {
      next(err);
    }
  }

  static async attachQuestions(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const rawIds =
        req.body?.questionIds ??
        req.body?.questions ??
        (req.body?.questionId ? [req.body.questionId] : []);
      const questionIds = Array.isArray(rawIds) ? rawIds : [rawIds];
      const exam = await ExamService.addQuestionsToExam(
        req.params.examId as string,
        questionIds,
        req.user!
      );
      res.status(200).json({
        success: true,
        data: { exam }
      });
    } catch (err) {
      next(err);
    }
  }

  static async updateExamQuestion(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const exam = await ExamService.updateExamQuestion(
        req.params.examId as string,
        req.params.questionId as string,
        req.body,
        req.user!
      );
      res.status(200).json({
        success: true,
        data: { exam }
      });
    } catch (err) {
      next(err);
    }
  }

  static async removeExamQuestion(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const exam = await ExamService.removeExamQuestion(
        req.params.examId as string,
        req.params.questionId as string,
        req.user!
      );
      res.status(200).json({
        success: true,
        data: { exam }
      });
    } catch (err) {
      next(err);
    }
  }

  static async assignExam(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const rawIds =
        req.body?.studentIds ??
        req.body?.students ??
        (req.body?.studentId ? [req.body.studentId] : []);
      const studentIds = Array.isArray(rawIds) ? rawIds : [rawIds];
      const result = await ExamService.assignStudentsToExam(
        req.params.examId as string,
        studentIds,
        req.user!
      );
      res.status(200).json({
        success: true,
        data: result
      });
    } catch (err) {
      next(err);
    }
  }

  static async publishExam(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const exam = await ExamService.publishExam(req.params.examId as string, req.user!);
      res.status(200).json({
        success: true,
        data: { exam }
      });
    } catch (err) {
      next(err);
    }
  }

  static async closeExam(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const exam = await ExamService.updateExam(
        req.params.examId as string,
        { status: 'CLOSED' },
        req.user!
      );
      res.status(200).json({
        success: true,
        data: { exam }
      });
    } catch (err) {
      next(err);
    }
  }

  static async getExamAttempts(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const attempts = await AttemptService.listAttempts(
        { examId: req.params.examId as string },
        req.user!
      );
      res.status(200).json({
        success: true,
        data: { attempts }
      });
    } catch (err) {
      next(err);
    }
  }

  static async startExamAttempt(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await AttemptService.startAttempt(
        req.params.examId as string,
        req.user!,
        req.get('X-ExamX-Device-Session') || req.body?.deviceSessionId || ''
      );
      res.status(201).json({
        success: true,
        data: result
      });
    } catch (err) {
      next(err);
    }
  }

  static async getExamResults(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const results = await ResultService.getResults(
        { examId: req.params.examId as string },
        req.user!
      );
      res.status(200).json({
        success: true,
        data: { results }
      });
    } catch (err) {
      next(err);
    }
  }

  static async publishExamResults(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await ResultService.publishAllExamResults(req.params.examId as string, req.user!);
      res.status(200).json({
        success: true,
        data: result
      });
    } catch (err) {
      next(err);
    }
  }

  static async getExamProctoringEvents(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const events = await ProctoringService.getEvents(
        { examId: req.params.examId as string },
        req.user!
      );
      res.status(200).json({
        success: true,
        data: { events }
      });
    } catch (err) {
      next(err);
    }
  }

  // --- STUDENT EXAM ENDPOINTS ---

  static async getStudentExams(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const exams = await ExamService.getStudentAssignedExams(req.user!.userId);
      res.status(200).json({
        success: true,
        data: { exams }
      });
    } catch (err) {
      next(err);
    }
  }

  static async getStudentExamDetails(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const exam = await ExamService.getStudentExamDetails(req.params.examId as string, req.user!.userId);
      res.status(200).json({
        success: true,
        data: { exam }
      });
    } catch (err) {
      next(err);
    }
  }

  static async getStudentResults(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const results = await ResultService.getResults({}, req.user!);
      res.status(200).json({
        success: true,
        data: { results }
      });
    } catch (err) {
      next(err);
    }
  }

  static async getStudentQueries(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const queries = await QueryService.getQueries({}, req.user!);
      res.status(200).json({
        success: true,
        data: { queries }
      });
    } catch (err) {
      next(err);
    }
  }
}
