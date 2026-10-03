import { Response, NextFunction } from 'express';
import { CommunicationService } from '../services/communication.service';
import { AuthenticatedRequest } from '../types/auth.types';

export class CommunicationController {
  static async getContacts(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const contacts = await CommunicationService.listContacts(req.user!);
      res.status(200).json({
        success: true,
        data: { contacts }
      });
    } catch (err) {
      next(err);
    }
  }

  static async getConversations(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const type = req.query.type as 'DIRECT' | 'EXAM_LIVE' | undefined;
      const conversations = await CommunicationService.listConversations(req.user!, type);
      res.status(200).json({
        success: true,
        data: { conversations }
      });
    } catch (err) {
      next(err);
    }
  }

  static async getMessages(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const messages = await CommunicationService.getConversationMessages(
        req.params.conversationId as string,
        req.user!
      );
      res.status(200).json({
        success: true,
        data: { messages }
      });
    } catch (err) {
      next(err);
    }
  }

  static async sendMessage(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await CommunicationService.sendMessage(req.body, req.user!);
      res.status(201).json({
        success: true,
        data: result
      });
    } catch (err) {
      next(err);
    }
  }
}
