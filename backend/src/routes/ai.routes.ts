import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { authenticate } from '../middleware/auth.middleware';
import { requireRole } from '../middleware/role.middleware';
import { AiQuestionService } from '../services/ai.service';
import { QuestionService } from '../services/question.service';
import { SyllabusService } from '../services/syllabus.service';
import {
  getMaxSyllabusFileSizeBytes,
  validateAndExtractSyllabus
} from '../utils/syllabusExtractor';
import { AuthenticatedRequest } from '../types/auth.types';
import { AiGenerationBatchService } from '../services/ai-generation-batch.service';

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: getMaxSyllabusFileSizeBytes()
  }
});

function handleSingleFileUpload(fieldName: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const middleware = upload.fields([
      { name: fieldName, maxCount: 1 },
      { name: 'syllabus', maxCount: 1 },
      { name: 'file', maxCount: 1 },
      { name: 'syllabusFile', maxCount: 1 }
    ]);

    middleware(req, res, (err: any) => {
      if (err) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          const maxMb = Math.round(getMaxSyllabusFileSizeBytes() / (1024 * 1024));
          res.status(400).json({
            success: false,
            code: 'SYLLABUS_FILE_TOO_LARGE',
            message: `Syllabus file exceeds the maximum allowed size of ${maxMb} MB.`
          });
          return;
        }
        res.status(400).json({
          success: false,
          code: 'INVALID_SYLLABUS_UPLOAD',
          message: err.message || 'Invalid file upload request.'
        });
        return;
      }
      next();
    });
  };
}

function resolveUploadedFile(req: Request) {
  const filesMap = req.files as Record<string, Express.Multer.File[]> | undefined;
  const multerFile =
    req.file ||
    filesMap?.syllabus?.[0] ||
    filesMap?.file?.[0] ||
    filesMap?.syllabusFile?.[0];

  if (multerFile) {
    return {
      originalname: multerFile.originalname,
      mimetype: multerFile.mimetype,
      size: multerFile.size,
      buffer: multerFile.buffer
    };
  }

  if (req.body && typeof req.body.fileBase64 === 'string' && req.body.fileName) {
    const buffer = Buffer.from(req.body.fileBase64, 'base64');
    return {
      originalname: String(req.body.fileName),
      mimetype: String(req.body.mimeType || ''),
      size: buffer.length,
      buffer
    };
  }

  return null;
}

router.use(authenticate);

router.get(
  '/status',
  requireRole('TEACHER', 'ADMIN'),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const pendingReviewCount = await QuestionService.countAiDrafts(req.user!);
      const status = AiQuestionService.getStatus();
    res.status(200).json({
      success: true,
        data: { ...status, pendingReviewCount, status: !status.configured ? 'NOT_CONFIGURED' : pendingReviewCount ? 'PENDING_REVIEW' : 'READY' }
      });
    } catch (err) {
      next(err);
    }
  }
);

const handleExtractSyllabus = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const file = resolveUploadedFile(req);
    const extracted = await validateAndExtractSyllabus(file);
    const wordCount = extracted.text.trim() ? extracted.text.trim().split(/\s+/).length : 0;
    res.status(200).json({
      success: true,
      data: {
        fileName: extracted.fileName,
        fileType: extracted.fileType,
        charCount: extracted.charCount,
        wordCount,
        text: extracted.text,
        extractedText: extracted.text
      }
    });
  } catch (err) {
    next(err);
  }
};

router.post(
  '/syllabus/extract',
  requireRole('TEACHER', 'ADMIN'),
  handleSingleFileUpload('syllabus'),
  handleExtractSyllabus
);

router.post(
  '/syllabus/upload',
  requireRole('TEACHER', 'ADMIN'),
  handleSingleFileUpload('syllabus'),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const syllabus = await SyllabusService.upload(resolveUploadedFile(req), req.body || {}, req.user!);
      res.status(201).json({ success: true, data: syllabus });
    } catch (err) {
      next(err);
    }
  }
);

router.get(
  '/questions/drafts',
  requireRole('TEACHER', 'ADMIN'),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const drafts = await QuestionService.getAiDrafts(req.user!);
      res.status(200).json({ success: true, data: { drafts, count: drafts.length } });
    } catch (err) {
      next(err);
    }
  }
);

router.get(
  '/generation-batches',
  requireRole('TEACHER', 'ADMIN'),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const batches = await AiGenerationBatchService.list(req.user!);
      res.status(200).json({ success: true, data: { batches } });
    } catch (err) {
      next(err);
    }
  }
);

router.get(
  '/generation-batches/:generationId/questions',
  requireRole('TEACHER', 'ADMIN'),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const generationId = typeof req.params.generationId === 'string' ? req.params.generationId : '';
      const questions = await AiGenerationBatchService.getQuestions(generationId, req.user!);
      res.status(200).json({ success: true, data: { questions } });
    } catch (err) {
      next(err);
    }
  }
);

router.patch(
  '/questions/drafts/:questionId',
  requireRole('TEACHER', 'ADMIN'),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const questionId = typeof req.params.questionId === 'string' ? req.params.questionId : '';
      const question = await QuestionService.updateAiDraft(questionId, req.body || {}, req.user!);
      res.status(200).json({ success: true, data: { question } });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/questions/drafts/:questionId/approve',
  requireRole('TEACHER', 'ADMIN'),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const questionId = typeof req.params.questionId === 'string' ? req.params.questionId : '';
      const question = await QuestionService.approveAiDraft(questionId, req.user!);
      res.status(200).json({ success: true, data: { question } });
    } catch (err) {
      next(err);
    }
  }
);

router.delete(
  '/questions/drafts/:questionId',
  requireRole('TEACHER', 'ADMIN'),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const questionId = typeof req.params.questionId === 'string' ? req.params.questionId : '';
      await QuestionService.discardAiDraft(questionId, req.user!);
      res.status(200).json({ success: true, data: { questionId: req.params.questionId } });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/extract-syllabus',
  requireRole('TEACHER', 'ADMIN'),
  handleSingleFileUpload('syllabus'),
  handleExtractSyllabus
);

router.post(
  '/questions/generate-from-syllabus',
  requireRole('TEACHER', 'ADMIN'),
  handleSingleFileUpload('syllabus'),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const file = resolveUploadedFile(req);
      const result = await AiQuestionService.generateFromUploadedSyllabus(
        file,
        req.body || {},
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
);

const handleGenerateQuestions = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const file = resolveUploadedFile(req);
    if (file) {
      const result = await AiQuestionService.generateFromUploadedSyllabus(
        file,
        req.body || {},
        req.user!
      );
      res.status(200).json({
        success: true,
        data: result
      });
      return;
    }

    const result = await AiQuestionService.generateQuestions(req.body || {}, req.user!);
    res.status(200).json({
      success: true,
      data: result
    });
  } catch (err) {
    next(err);
  }
};

router.post(
  '/questions/generate',
  requireRole('TEACHER', 'ADMIN'),
  handleSingleFileUpload('syllabus'),
  handleGenerateQuestions
);

router.post(
  '/generate-questions',
  requireRole('TEACHER', 'ADMIN'),
  handleSingleFileUpload('syllabus'),
  handleGenerateQuestions
);

const handleApproveDraftQuestions = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const questionId = typeof req.body?.questionId === 'string' ? req.body.questionId.trim() : '';
    if (!questionId) {
      res.status(400).json({
        success: false,
        message: 'A persisted questionId is required to approve an AI draft.'
      });
      return;
    }

    const approved = await QuestionService.approveAiDraft(questionId, req.user!);

    res.status(201).json({
      success: true,
      data: {
        approved: [approved],
        questions: [approved],
        count: 1
      }
    });
  } catch (err) {
    next(err);
  }
};

router.post('/questions/approve', requireRole('TEACHER', 'ADMIN'), handleApproveDraftQuestions);
router.post('/approve', requireRole('TEACHER', 'ADMIN'), handleApproveDraftQuestions);

export default router;
