import { randomUUID } from 'crypto';
import { AiGenerationBatch, IAiGenerationBatchDocument } from '../models/AiGenerationBatch';
import { AuditLog } from '../models/AuditLog';
import { Question } from '../models/Question';
import { Syllabus } from '../models/Syllabus';
import { JwtUserPayload } from '../types/auth.types';

type BatchInput = {
  generatedBy: string;
  generatedByName: string;
  subject: string;
  course: string;
  semester: string;
  topic: string;
  selectedUnits?: string[];
  difficulty: 'EASY' | 'MEDIUM' | 'HARD' | 'MIXED';
  marksPerQuestion: number;
  requestedCount: number;
  generatedCount: number;
  syllabusId: string;
  sourceFileName: string;
  provider: 'GROQ';
  aiModel: string;
};

type BatchSummary = {
  generationId: string;
  generatedBy: string;
  generatedByName: string;
  subject: string;
  course: string;
  semester: string;
  topic: string;
  selectedUnits?: string[];
  difficulty: 'EASY' | 'MEDIUM' | 'HARD' | 'MIXED';
  marksPerQuestion: number;
  requestedCount: number;
  generatedCount: number;
  syllabusId: string;
  sourceFileName: string;
  provider: 'GROQ';
  aiModel: string;
  generatedAt: Date;
  pendingCount: number;
  approvedCount: number;
  discardedCount: number;
  reviewStatus: 'PENDING_REVIEW' | 'PARTIALLY_REVIEWED' | 'APPROVED' | 'DISCARDED';
  questionIds: string[];
  legacy?: boolean;
};

type AuditDetails = {
  generationId?: string;
  provider?: string;
  model?: string;
  teacherUserId?: string;
  syllabusId?: string;
  generatedCount?: number;
  requestedCount?: number;
};

type LegacyBatch = {
  summary: BatchSummary;
  questionIds: string[];
};

type QuestionSummary = {
  questionId: string;
  subject: string;
  topic: string;
  course?: string;
  semester?: string;
  difficulty: 'EASY' | 'MEDIUM' | 'HARD';
  marks: number;
  reviewStatus?: 'PENDING_TEACHER_REVIEW' | 'APPROVED' | 'DISCARDED';
  createdAt: Date;
};

function parseAuditDetails(details: string): AuditDetails | null {
  try {
    const parsed: unknown = JSON.parse(details);
    return parsed && typeof parsed === 'object' ? parsed as AuditDetails : null;
  } catch {
    return null;
  }
}

function errorWithStatus(message: string, statusCode: number) {
  const error = new Error(message) as Error & { statusCode: number };
  error.statusCode = statusCode;
  return error;
}

export class AiGenerationBatchService {
  static async create(input: BatchInput): Promise<IAiGenerationBatchDocument> {
    const now = new Date();
    const date = now.toISOString().slice(0, 10).replace(/-/g, '');
    const generationId = `GEN-${date}-${randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase()}`;
    return AiGenerationBatch.create({ ...input, generationId, generatedAt: now });
  }

  static async list(user: JwtUserPayload): Promise<BatchSummary[]> {
    const batchFilter = user.role === 'TEACHER' ? { generatedBy: user.userId } : {};
    const persistedBatches = await AiGenerationBatch.find(batchFilter).sort({ generatedAt: -1 }).lean();
    const persistedIds = new Set(persistedBatches.map((batch) => batch.generationId));
    const persistedSummaries = await Promise.all(
      persistedBatches.map((batch) => this.withCounts(batch, user))
    );
    const legacyBatches = await this.findLegacyBatches(user, persistedIds);
    return [...persistedSummaries, ...legacyBatches.map((batch) => batch.summary)]
      .sort((left, right) => new Date(right.generatedAt).getTime() - new Date(left.generatedAt).getTime());
  }

  static async getQuestions(generationId: string, user: JwtUserPayload) {
    if (generationId.startsWith('LEGACY-AUDIT-')) {
      const legacyBatches = await this.findLegacyBatches(user, new Set());
      const batch = legacyBatches.find((candidate) => candidate.summary.generationId === generationId);
      if (!batch) throw errorWithStatus('Generation batch was not found.', 404);

      const questions = await Question.find({
        questionId: { $in: batch.questionIds },
        createdBy: batch.summary.generatedBy,
        source: 'AI_GENERATED'
      }).sort({ createdAt: 1 });
      if (questions.length !== batch.questionIds.length) {
        throw errorWithStatus('Generation batch no longer matches its audit record.', 409);
      }
      return questions.map((question) => ({
        ...question.toObject(),
        generationId
      }));
    }

    const filter: Record<string, unknown> = { generationId };
    if (user.role === 'TEACHER') filter.createdBy = user.userId;
    const questions = await Question.find(filter).sort({ createdAt: 1 });
    if (questions.length === 0) {
      throw errorWithStatus('Generation batch was not found.', 404);
    }
    return questions;
  }

  private static async findLegacyBatches(
    user: JwtUserPayload,
    persistedIds: Set<string>
  ): Promise<LegacyBatch[]> {
    const auditFilter: Record<string, unknown> = {
      action: 'AI_QUESTIONS_GENERATED',
      actorRole: { $in: ['TEACHER', 'ADMIN'] }
    };
    if (user.role === 'TEACHER') auditFilter.actorId = user.userId;

    const audits = await AuditLog.find(auditFilter).sort({ timestamp: 1, auditId: 1 }).lean();
    const candidates = audits.flatMap((audit) => {
      const details = parseAuditDetails(audit.details);
      const generatedCount = Number(details?.generatedCount);
      const syllabusId = details?.syllabusId || audit.targetId;
      const provider = details?.provider;
      if (
        !details ||
        (details.teacherUserId && details.teacherUserId !== audit.actorId) ||
        !syllabusId ||
        !Number.isInteger(generatedCount) ||
        generatedCount < 1 ||
        generatedCount > 200 ||
        provider !== 'GROQ' ||
        typeof details.model !== 'string' ||
        !details.model.trim()
      ) {
        return [];
      }
      return [{ audit, details, syllabusId, generatedCount, provider: 'GROQ' as const }];
    });
    if (!candidates.length) return [];

    const syllabusIds = [...new Set(candidates.map((candidate) => candidate.syllabusId))];
    const syllabi = await Syllabus.find({ syllabusId: { $in: syllabusIds } })
      .select('syllabusId course semester subject fileName')
      .lean();
    const syllabusById = new Map(syllabi.map((syllabus) => [syllabus.syllabusId, syllabus]));
    const questionsByGroup = new Map<string, QuestionSummary[]>();
    const previousAuditAt = new Map<string, number>();
    const legacyBatches: LegacyBatch[] = [];

    for (const candidate of candidates) {
      const { audit, details, syllabusId, generatedCount, provider } = candidate;
      const eventAt = new Date(audit.timestamp).getTime();
      const groupKey = `${audit.actorId}\u0000${syllabusId}`;
      const priorAt = previousAuditAt.get(groupKey);
      previousAuditAt.set(groupKey, eventAt);

      if (details.generationId && persistedIds.has(details.generationId)) continue;

      let groupedQuestions: QuestionSummary[];
      if (details.generationId) {
        groupedQuestions = await Question.find<QuestionSummary>({
          generationId: details.generationId,
          createdBy: audit.actorId,
          syllabusId,
          source: 'AI_GENERATED'
        })
          .select('questionId subject topic course semester difficulty marks reviewStatus createdAt')
          .sort({ createdAt: 1 })
          .lean();
      } else {
        let availableQuestions = questionsByGroup.get(groupKey);
        if (!availableQuestions) {
          availableQuestions = await Question.find<QuestionSummary>({
            createdBy: audit.actorId,
            syllabusId,
            source: 'AI_GENERATED',
            $or: [{ generationId: { $exists: false } }, { generationId: null }, { generationId: '' }]
          })
            .select('questionId subject topic course semester difficulty marks reviewStatus createdAt')
            .sort({ createdAt: 1 })
            .lean();
          questionsByGroup.set(groupKey, availableQuestions);
        }
        groupedQuestions = availableQuestions.filter((question) => {
          const createdAt = new Date(question.createdAt).getTime();
          return (priorAt === undefined || createdAt > priorAt) && createdAt <= eventAt;
        });
      }

      if (groupedQuestions.length !== generatedCount) continue;

      const syllabus = syllabusById.get(syllabusId);
      const firstQuestion = groupedQuestions[0];
      const subjects = new Set(groupedQuestions.map((question) => question.subject));
      const courses = new Set(groupedQuestions.map((question) => question.course || syllabus?.course || ''));
      const semesters = new Set(groupedQuestions.map((question) => question.semester || syllabus?.semester || ''));
      const markValues = new Set(groupedQuestions.map((question) => question.marks));
      if (
        subjects.size !== 1 ||
        courses.size !== 1 ||
        semesters.size !== 1 ||
        markValues.size !== 1 ||
        (syllabus && (
          syllabus.subject !== firstQuestion.subject ||
          (firstQuestion.course && syllabus.course !== firstQuestion.course) ||
          (firstQuestion.semester && syllabus.semester !== firstQuestion.semester)
        ))
      ) continue;

      const topics = new Set(groupedQuestions.map((question) => question.topic).filter(Boolean));
      const difficulties = new Set(groupedQuestions.map((question) => question.difficulty));
      const generationId = details.generationId || `LEGACY-AUDIT-${audit.auditId}`;
      const questionIds = groupedQuestions.map((question) => question.questionId);
      const summary: BatchSummary = {
        generationId,
        generatedBy: audit.actorId,
        generatedByName: audit.actorName,
        subject: syllabus?.subject || firstQuestion.subject,
        course: syllabus?.course || firstQuestion.course,
        semester: syllabus?.semester || firstQuestion.semester,
        topic: topics.size === 1 ? [...topics][0] : topics.size > 1 ? 'Multiple topics' : '—',
        difficulty: difficulties.size === 1 ? firstQuestion.difficulty : 'MIXED',
        marksPerQuestion: firstQuestion.marks,
        requestedCount: Number(details.requestedCount) || generatedCount,
        generatedCount,
        syllabusId,
        sourceFileName: syllabus?.fileName || 'Syllabus file unavailable',
        provider,
        aiModel: details.model!,
        generatedAt: audit.timestamp,
        pendingCount: groupedQuestions.filter((question) => question.reviewStatus === 'PENDING_TEACHER_REVIEW').length,
        approvedCount: groupedQuestions.filter((question) => question.reviewStatus === 'APPROVED').length,
        discardedCount: groupedQuestions.filter((question) => question.reviewStatus === 'DISCARDED').length,
        reviewStatus: this.reviewStatus(
          generatedCount,
          groupedQuestions.filter((question) => question.reviewStatus === 'PENDING_TEACHER_REVIEW').length,
          groupedQuestions.filter((question) => question.reviewStatus === 'APPROVED').length,
          groupedQuestions.filter((question) => question.reviewStatus === 'DISCARDED').length
        ),
        questionIds,
        legacy: !details.generationId
      };
      legacyBatches.push({ summary, questionIds });

      if (!details.generationId) {
        questionsByGroup.set(
          groupKey,
          (questionsByGroup.get(groupKey) || []).filter((question) => !questionIds.includes(question.questionId))
        );
      }
    }

    return legacyBatches;
  }

  private static async withCounts<T extends Omit<BatchSummary, 'pendingCount' | 'approvedCount' | 'discardedCount' | 'reviewStatus' | 'questionIds' | 'legacy'>>(
    batch: T,
    user: JwtUserPayload
  ): Promise<BatchSummary> {
    const questionFilter: Record<string, unknown> = { generationId: batch.generationId };
    if (user.role === 'TEACHER') questionFilter.createdBy = user.userId;
    const questions = await Question.find(questionFilter)
      .select('questionId reviewStatus')
      .lean();
    const pendingCount = questions.filter((question) => question.reviewStatus === 'PENDING_TEACHER_REVIEW').length;
    const approvedCount = questions.filter((question) => question.reviewStatus === 'APPROVED').length;
    const discardedCount = questions.filter((question) => question.reviewStatus === 'DISCARDED').length;
    return {
      ...batch,
      pendingCount,
      approvedCount,
      discardedCount,
      reviewStatus: this.reviewStatus(batch.generatedCount, pendingCount, approvedCount, discardedCount),
      questionIds: questions.map((question) => question.questionId)
    };
  }

  private static reviewStatus(
    generatedCount: number,
    pendingCount: number,
    approvedCount: number,
    discardedCount: number
  ): BatchSummary['reviewStatus'] {
    if (pendingCount > 0) return approvedCount > 0 || discardedCount > 0 ? 'PARTIALLY_REVIEWED' : 'PENDING_REVIEW';
    return discardedCount === generatedCount ? 'DISCARDED' : 'APPROVED';
  }
}
