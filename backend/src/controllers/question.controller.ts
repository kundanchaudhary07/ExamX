import { Response, NextFunction } from 'express';
import { QuestionService } from '../services/question.service';
import { AuthenticatedRequest } from '../types/auth.types';

export class QuestionController {
  static async createQuestion(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const question = await QuestionService.createQuestion(req.body, req.user!);
      res.status(201).json({
        success: true,
        data: { question }
      });
    } catch (err) {
      next(err);
    }
  }

  static async getQuestions(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const page = req.query.page ? parseInt(req.query.page as string, 10) : undefined;
      const pageSize = req.query.pageSize || req.query.limit
        ? parseInt((req.query.pageSize || req.query.limit) as string, 10)
        : undefined;

      const result = await QuestionService.getQuestions(
        {
          subject: req.query.subject as string | undefined,
          course: req.query.course as string | undefined,
          semester: req.query.semester as string | undefined,
          difficulty: req.query.difficulty as string | undefined,
          topic: req.query.topic as string | undefined,
          status: req.query.status as string | undefined,
          search: req.query.search as string | undefined,
          createdBy: (req.query.createdBy || req.query.owner) as string | undefined,
          page,
          pageSize
        },
        req.user!
      );

      res.status(200).json({
        success: true,
        data: {
          questions: result.questions,
          total: result.total,
          page: result.page,
          pageSize: result.pageSize,
          totalPages: result.totalPages
        }
      });
    } catch (err) {
      next(err);
    }
  }

  static async getQuestionById(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const question = await QuestionService.getQuestionById(req.params.questionId as string, req.user!);
      res.status(200).json({
        success: true,
        data: { question }
      });
    } catch (err) {
      next(err);
    }
  }

  static async updateQuestion(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const question = await QuestionService.updateQuestion(
        req.params.questionId as string,
        req.body,
        req.user!
      );
      res.status(200).json({
        success: true,
        data: { question }
      });
    } catch (err) {
      next(err);
    }
  }

  static async updateQuestionStatus(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const question = await QuestionService.updateQuestionStatus(
        req.params.questionId as string,
        req.body?.status,
        req.user!
      );
      res.status(200).json({
        success: true,
        data: { question }
      });
    } catch (err) {
      next(err);
    }
  }

  static async deleteQuestion(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await QuestionService.deleteQuestion(req.params.questionId as string, req.user!);
      res.status(200).json({
        success: true,
        message: result.message,
        data: result
      });
    } catch (err) {
      next(err);
    }
  }
}
