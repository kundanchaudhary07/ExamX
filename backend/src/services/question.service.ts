import { createHash } from 'crypto';
import { Question, IQuestionDocument } from '../models/Question';
import { AiGenerationBatch } from '../models/AiGenerationBatch';
import { Exam } from '../models/Exam';
import { ExamService } from './exam.service';
import { AuditService } from './audit.service';
import { IQuestionInput, QuestionOption, QuestionStatus, QuestionDifficulty } from '../types/exam.types';
import { JwtUserPayload } from '../types/auth.types';
import { generateNextQuestionId } from '../utils/exam-id.generator';
import { emitTeacherAndAdmin } from '../realtime/socket';
import { logger } from '../utils/logger';

export class QuestionService {
  /**
   * Validate question ID format strictly: 3-64 alphanumeric, dash, or underscore characters
   */
  static validateQuestionId(questionId: unknown): string {
    if (typeof questionId !== 'string' || !questionId.trim()) {
      const err: any = new Error('Question ID is required and cannot be empty');
      err.statusCode = 400;
      throw err;
    }
    const cleanId = questionId.trim();
    if (!/^[A-Za-z0-9_-]{3,64}$/.test(cleanId)) {
      const err: any = new Error(
        `Malformed question ID "${cleanId}". Must be 3 to 64 valid alphanumeric, dash, or underscore characters.`
      );
      err.statusCode = 400;
      throw err;
    }
    return cleanId;
  }

  static normalizeOptions(options?: any[]): QuestionOption[] | undefined {
    if (!Array.isArray(options)) return undefined;
    return options.map((opt: any) => ({
      id: typeof (opt?.id ?? opt?.key) === 'string' ? (opt.id ?? opt.key).trim() : '',
      text: typeof opt?.text === 'string' ? opt.text.trim() : ''
    }));
  }

  /**
   * Validate question structure authoritatively
   */
  static validateQuestionInput(input: Partial<IQuestionInput>, isUpdate = false): void {
    if (!isUpdate || input.questionText !== undefined) {
      if (!input.questionText || typeof input.questionText !== 'string' || !input.questionText.trim()) {
        const err: any = new Error('Question text is required and cannot be empty');
        err.statusCode = 400;
        throw err;
      }
    }

    if (!isUpdate || input.subject !== undefined) {
      if (!input.subject || typeof input.subject !== 'string' || !input.subject.trim()) {
        const err: any = new Error('Subject is required and cannot be empty');
        err.statusCode = 400;
        throw err;
      }
    }

    if (input.questionType !== undefined) {
      const qType = String(input.questionType).toUpperCase().trim();
      if (qType !== 'MCQ') {
        const err: any = new Error('Unsupported question type. Only MCQ is supported.');
        err.statusCode = 400;
        throw err;
      }
    }

    if (input.course !== undefined && input.course !== null && input.course !== '') {
      ExamService.normalizeCourse(input.course);
    }

    if (input.semester !== undefined && input.semester !== null && input.semester !== '') {
      ExamService.normalizeSemester(input.semester);
    }

    if (input.difficulty !== undefined) {
      if (!['EASY', 'MEDIUM', 'HARD'].includes(input.difficulty)) {
        const err: any = new Error('Difficulty must be one of: EASY, MEDIUM, HARD');
        err.statusCode = 400;
        throw err;
      }
    }

    if (input.marks !== undefined) {
      if (typeof input.marks !== 'number' || isNaN(input.marks) || input.marks <= 0) {
        const err: any = new Error('Marks must be a positive number greater than 0');
        err.statusCode = 400;
        throw err;
      }
    }

    if (input.negativeMarks !== undefined) {
      if (typeof input.negativeMarks !== 'number' || isNaN(input.negativeMarks) || input.negativeMarks < 0) {
        const err: any = new Error('Negative marks cannot be less than 0');
        err.statusCode = 400;
        throw err;
      }
    }

    if (input.status !== undefined) {
      const validStatuses: QuestionStatus[] = ['DRAFT', 'ACTIVE', 'INACTIVE', 'ARCHIVED'];
      if (!validStatuses.includes(input.status)) {
        const err: any = new Error(`Invalid question status "${input.status}"`);
        err.statusCode = 400;
        throw err;
      }
    }

    const answerCandidate = input.correctOption ?? input.correctAnswer;
    const normalizedOptions = this.normalizeOptions(input.options);

    if (normalizedOptions !== undefined) {
      if (!Array.isArray(normalizedOptions) || normalizedOptions.length < 2) {
        const err: any = new Error('MCQ questions require at least 2 options');
        err.statusCode = 400;
        throw err;
      }

      const optionIds = new Set<string>();
      for (const opt of normalizedOptions) {
        if (!opt || typeof opt.id !== 'string' || !opt.id.trim()) {
          const err: any = new Error('Each option must possess a valid ID (e.g., "A", "B", "1", "2")');
          err.statusCode = 400;
          throw err;
        }
        if (!opt.text || typeof opt.text !== 'string' || !opt.text.trim()) {
          const err: any = new Error('Option text cannot be empty');
          err.statusCode = 400;
          throw err;
        }
        const cleanId = opt.id.trim();
        if (optionIds.has(cleanId)) {
          const err: any = new Error(`Duplicate option ID detected: "${cleanId}"`);
          err.statusCode = 400;
          throw err;
        }
        optionIds.add(cleanId);
      }

      if (answerCandidate !== undefined) {
        if (typeof answerCandidate !== 'string' || !answerCandidate.trim()) {
          const err: any = new Error('A valid correct option/answer must be specified');
          err.statusCode = 400;
          throw err;
        }
        const cleanAnswer = answerCandidate.trim();
        if (!optionIds.has(cleanAnswer)) {
          const err: any = new Error(`Correct answer "${cleanAnswer}" does not match any provided option ID`);
          err.statusCode = 400;
          throw err;
        }
      }
    } else if (answerCandidate !== undefined) {
      const err: any = new Error('Options must be provided when specifying correct answer');
      err.statusCode = 400;
      throw err;
    }
  }

  /**
   * Create a new question in the Question Bank
   */
  static async createQuestion(
    input: IQuestionInput,
    user: JwtUserPayload,
    options: { allowAiDraft?: boolean } = {}
  ): Promise<IQuestionDocument> {
    if (input.source === 'AI_GENERATED' && !options.allowAiDraft) {
      const err: any = new Error('AI-generated questions must enter through the syllabus generation and teacher review workflow.');
      err.statusCode = 400;
      throw err;
    }
    if (
      input.source === 'AI_GENERATED' &&
      (input.status !== 'DRAFT' || input.reviewStatus !== 'PENDING_TEACHER_REVIEW' ||
        !input.syllabusId || !input.syllabusUnit || !input.syllabusTopic || !input.sourceReference)
    ) {
      const err: any = new Error('AI question drafts require pending review and complete syllabus provenance.');
      err.statusCode = 400;
      throw err;
    }
    const normalizedOptions = this.normalizeOptions(input.options);
    const normalizedInput: IQuestionInput = {
      ...input,
      options: normalizedOptions || []
    };

    this.validateQuestionInput(normalizedInput, false);

    if (!normalizedOptions || normalizedOptions.length < 2) {
      const err: any = new Error('MCQ questions require at least 2 options');
      err.statusCode = 400;
      throw err;
    }

    const resolvedAnswer = (input.correctOption || input.correctAnswer || '').trim();
    if (!resolvedAnswer) {
      const err: any = new Error('Correct option/answer is required');
      err.statusCode = 400;
      throw err;
    }

    const questionId = await generateNextQuestionId();

    const cleanOptions: QuestionOption[] = normalizedOptions.map((o) => ({
      id: o.id.trim(),
      text: o.text.trim()
    }));

    const normalizedCourse = input.course ? ExamService.normalizeCourse(input.course) : '';
    const normalizedSemester = input.semester ? ExamService.normalizeSemester(input.semester) : '';

    const question = await Question.create({
      questionId,
      questionText: input.questionText.trim(),
      subject: input.subject.trim(),
      topic: (input.topic || '').trim(),
      course: normalizedCourse,
      semester: normalizedSemester,
      questionType: 'MCQ',
      difficulty: input.difficulty || 'MEDIUM',
      options: cleanOptions,
      correctAnswer: resolvedAnswer,
      correctOption: resolvedAnswer,
      marks: input.marks || 1,
      negativeMarks: input.negativeMarks !== undefined ? input.negativeMarks : 0,
      explanation: (input.explanation || '').trim(),
      createdBy: user.userId, // Authoritatively derived from JWT
      source: input.source || 'MANUAL',
      status: input.status || 'ACTIVE',
      reviewStatus: input.reviewStatus,
      syllabusId: input.syllabusId,
      syllabusUnit: input.syllabusUnit,
      syllabusTopic: input.syllabusTopic,
      sourceReference: input.sourceReference,
      generationId: input.generationId,
      aiProvider: input.aiProvider,
      aiModel: input.aiModel,
      dedupeKey:
        input.source === 'AI_GENERATED'
          ? createHash('sha256')
              .update(
                [
                  user.userId,
                  normalizedCourse.toLowerCase(),
                  normalizedSemester.toLowerCase(),
                  input.subject.trim().toLowerCase(),
                  input.questionText.trim().toLowerCase().replace(/\s+/g, ' ')
                ].join('|')
              )
              .digest('hex')
          : undefined
    });

    emitTeacherAndAdmin(user.userId, 'question.created', { question: question.toJSON() }, user.userId);
    await AuditService.record({
      actorId: user.userId,
      actorName: user.name,
      actorRole: user.role,
      action: 'QUESTION_CREATED',
      targetType: 'QUESTION',
      targetId: questionId,
      details: `Created question "${questionId}" (${question.subject}) with ${question.marks} marks`
    });

    logger.info(`Question ${questionId} created by ${user.role} [${user.userId}]`);
    return question;
  }

  static async createAiDrafts(
    inputs: IQuestionInput[],
    user: JwtUserPayload,
    generationId: string
  ): Promise<IQuestionDocument[]> {
    const created: IQuestionDocument[] = [];
    try {
      for (const input of inputs) {
        const draft = await this.createQuestion(
          {
            ...input,
            source: 'AI_GENERATED',
            status: 'DRAFT',
            reviewStatus: 'PENDING_TEACHER_REVIEW',
            generationId
          },
          user,
          { allowAiDraft: true }
        );
        created.push(draft);
      }
      return created;
    } catch (err) {
      if (created.length) {
        await Question.deleteMany({ _id: { $in: created.map((draft) => draft._id) } });
      }
      await AiGenerationBatch.deleteOne({ generationId, generatedBy: user.userId });
      throw err;
    }
  }

  static async getAiDrafts(user: JwtUserPayload): Promise<IQuestionDocument[]> {
    if (user.role === 'STUDENT') {
      const err: any = new Error('Students cannot access AI question drafts.');
      err.statusCode = 403;
      throw err;
    }
    const query: Record<string, unknown> = {
      source: 'AI_GENERATED',
      status: 'DRAFT',
      reviewStatus: 'PENDING_TEACHER_REVIEW'
    };
    if (user.role === 'TEACHER') query.createdBy = user.userId;
    return Question.find(query).sort({ createdAt: -1 });
  }

  static async countAiDrafts(user: JwtUserPayload): Promise<number> {
    if (user.role === 'STUDENT') return 0;
    const query: Record<string, unknown> = {
      source: 'AI_GENERATED',
      status: 'DRAFT',
      reviewStatus: 'PENDING_TEACHER_REVIEW'
    };
    if (user.role === 'TEACHER') query.createdBy = user.userId;
    return Question.countDocuments(query);
  }

  static async updateAiDraft(
    questionId: string,
    updates: Partial<IQuestionInput>,
    user: JwtUserPayload
  ): Promise<IQuestionDocument> {
    const question = await Question.findOne({ questionId, source: 'AI_GENERATED' });
    if (!question) {
      const err: any = new Error(`AI draft ${questionId} was not found.`);
      err.statusCode = 404;
      throw err;
    }
    this.assertAiDraftOwner(question, user);
    if (question.status !== 'DRAFT' || question.reviewStatus !== 'PENDING_TEACHER_REVIEW') {
      const err: any = new Error('Only pending AI drafts can be edited.');
      err.statusCode = 409;
      throw err;
    }
    const editableUpdates: Partial<IQuestionInput> = {
      questionText: updates.questionText,
      topic: updates.topic,
      difficulty: updates.difficulty,
      options: updates.options,
      correctOption: updates.correctOption,
      correctAnswer: updates.correctAnswer,
      marks: updates.marks,
      negativeMarks: updates.negativeMarks,
      explanation: updates.explanation
    };
    delete (editableUpdates as any).undefined;
    return this.updateQuestion(questionId, editableUpdates, user);
  }

  static async approveAiDraft(questionId: string, user: JwtUserPayload): Promise<IQuestionDocument> {
    const question = await Question.findOne({ questionId, source: 'AI_GENERATED' });
    if (!question) {
      const err: any = new Error(`AI draft ${questionId} was not found.`);
      err.statusCode = 404;
      throw err;
    }
    this.assertAiDraftOwner(question, user);
    if (question.status !== 'DRAFT' || question.reviewStatus !== 'PENDING_TEACHER_REVIEW') {
      const err: any = new Error('Only pending AI drafts can be approved.');
      err.statusCode = 409;
      throw err;
    }

    const approved = await Question.findOneAndUpdate(
      { _id: question._id, status: 'DRAFT', reviewStatus: 'PENDING_TEACHER_REVIEW' },
      { $set: { status: 'ACTIVE', reviewStatus: 'APPROVED', approvedBy: user.userId, approvedAt: new Date() } },
      { new: true, runValidators: true }
    );
    if (!approved) {
      const err: any = new Error('This AI draft has already been reviewed.');
      err.statusCode = 409;
      throw err;
    }

    emitTeacherAndAdmin(approved.createdBy, 'question.updated', { question: approved.toJSON() }, user.userId);
    await AuditService.record({
      actorId: user.userId,
      actorName: user.name,
      actorRole: user.role,
      action: 'AI_QUESTION_APPROVED',
      targetType: 'QUESTION',
      targetId: approved.questionId,
      details: JSON.stringify({
        generationId: approved.generationId || '',
        provider: approved.aiProvider || 'unknown',
        model: approved.aiModel || 'unknown',
        teacherUserId: approved.createdBy,
        syllabusId: approved.syllabusId || 'unknown',
        generatedCount: 1,
        timestamp: new Date().toISOString(),
        approvalStatus: 'APPROVED'
      })
    });
    return approved;
  }

  static async discardAiDraft(questionId: string, user: JwtUserPayload): Promise<void> {
    const question = await Question.findOne({ questionId, source: 'AI_GENERATED' });
    if (!question) {
      const err: any = new Error(`AI draft ${questionId} was not found.`);
      err.statusCode = 404;
      throw err;
    }
    this.assertAiDraftOwner(question, user);
    if (question.status !== 'DRAFT' || question.reviewStatus !== 'PENDING_TEACHER_REVIEW') {
      const err: any = new Error('Only pending AI drafts can be discarded.');
      err.statusCode = 409;
      throw err;
    }
    question.status = 'ARCHIVED';
    question.reviewStatus = 'DISCARDED';
    await question.save();
    emitTeacherAndAdmin(question.createdBy, 'question.updated', { question: question.toJSON() }, user.userId);
    await AuditService.record({
      actorId: user.userId,
      actorName: user.name,
      actorRole: user.role,
      action: 'AI_QUESTION_DISCARDED',
      targetType: 'QUESTION',
      targetId: questionId,
      details: JSON.stringify({
        generationId: question.generationId || '',
        provider: question.aiProvider || 'unknown',
        model: question.aiModel || 'unknown',
        teacherUserId: question.createdBy,
        syllabusId: question.syllabusId || 'unknown',
        approvalStatus: 'DISCARDED'
      })
    });
  }

  private static assertAiDraftOwner(question: IQuestionDocument, user: JwtUserPayload): void {
    if (user.role === 'STUDENT') {
      const err: any = new Error('Students cannot manage AI question drafts.');
      err.statusCode = 403;
      throw err;
    }
    if (user.role === 'TEACHER' && question.createdBy !== user.userId) {
      const err: any = new Error('You are not authorized to manage this AI draft.');
      err.statusCode = 403;
      throw err;
    }
  }

  /**
   * List questions with RBAC, ownership, search, filtering, and pagination
   */
  static async getQuestions(
    filters: {
      subject?: string;
      course?: string;
      semester?: string;
      topic?: string;
      difficulty?: string;
      status?: string;
      search?: string;
      createdBy?: string;
      owner?: string;
      page?: number;
      pageSize?: number;
      limit?: number;
    },
    user: JwtUserPayload
  ): Promise<{
    questions: IQuestionDocument[];
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  }> {
    const query: any = {};

    if (user.role === 'TEACHER') {
      // Teachers can only see their own questions
      query.createdBy = user.userId;
    } else if (user.role === 'ADMIN') {
      // Admin can filter by specific teacher / owner if requested
      const requestedOwner = (filters.createdBy || filters.owner || '').trim();
      if (requestedOwner) {
        query.createdBy = requestedOwner;
      }
    }

    if (filters.subject && filters.subject !== 'ALL') {
      query.subject = { $regex: new RegExp(`^${filters.subject.trim()}$`, 'i') };
    }
    if (filters.course && filters.course !== 'ALL') {
      query.course = { $regex: new RegExp(`^${filters.course.trim()}$`, 'i') };
    }
    if (filters.semester && filters.semester !== 'ALL') {
      query.semester = { $regex: new RegExp(`^${filters.semester.trim()}$`, 'i') };
    }
    if (filters.topic) {
      query.topic = { $regex: filters.topic.trim(), $options: 'i' };
    }
    if (filters.difficulty && filters.difficulty !== 'ALL') {
      query.difficulty = filters.difficulty.toUpperCase().trim();
    }
    query.reviewStatus = { $ne: 'PENDING_TEACHER_REVIEW' };
    if (filters.status && filters.status !== 'ALL') {
      query.status = filters.status.toUpperCase().trim();
    } else {
      query.status = { $ne: 'ARCHIVED' };
    }
    if (filters.search && filters.search.trim()) {
      const searchRegex = { $regex: filters.search.trim(), $options: 'i' };
      query.$or = [
        { questionText: searchRegex },
        { topic: searchRegex },
        { subject: searchRegex },
        { questionId: searchRegex }
      ];
    }

    const total = await Question.countDocuments(query);
    const hasPagination = filters.page !== undefined || filters.pageSize !== undefined || filters.limit !== undefined;

    if (hasPagination) {
      const page = Math.max(1, Number(filters.page) || 1);
      const limit = Math.min(100, Math.max(1, Number(filters.pageSize || filters.limit) || 20));
      const skip = (page - 1) * limit;

      const questions = await Question.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit);
      return {
        questions,
        total,
        page,
        pageSize: limit,
        totalPages: Math.ceil(total / limit) || 1
      };
    }

    // Default backward compatible: returns all matching records
    const questions = await Question.find(query).sort({ createdAt: -1 });
    return {
      questions,
      total,
      page: 1,
      pageSize: questions.length,
      totalPages: 1
    };
  }

  /**
   * Get single question by questionId with ownership verification
   */
  static async getQuestionById(questionId: string, user: JwtUserPayload): Promise<IQuestionDocument> {
    const cleanId = this.validateQuestionId(questionId);
    const question = await Question.findOne({ questionId: cleanId });
    if (!question) {
      const err: any = new Error(`Question with ID ${cleanId} not found`);
      err.statusCode = 404;
      throw err;
    }

    if (user.role === 'TEACHER' && question.createdBy !== user.userId) {
      const err: any = new Error('Forbidden: You are not authorized to view this question');
      err.statusCode = 403;
      throw err;
    }

    return question;
  }

  /**
   * Update question by questionId with ownership verification and exam-safety protections
   */
  static async updateQuestion(
    questionId: string,
    updates: Partial<IQuestionInput>,
    user: JwtUserPayload
  ): Promise<IQuestionDocument> {
    const cleanId = this.validateQuestionId(questionId);
    const question = await Question.findOne({ questionId: cleanId });
    if (!question) {
      const err: any = new Error(`Question with ID ${cleanId} not found`);
      err.statusCode = 404;
      throw err;
    }

    if (user.role === 'TEACHER' && question.createdBy !== user.userId) {
      const err: any = new Error('Forbidden: You are not authorized to edit this question');
      err.statusCode = 403;
      throw err;
    }

    if (
      question.source === 'AI_GENERATED' &&
      question.reviewStatus === 'PENDING_TEACHER_REVIEW' &&
      updates.status !== undefined &&
      updates.status !== 'DRAFT'
    ) {
      const err: any = new Error('AI drafts can only be activated through explicit teacher approval.');
      err.statusCode = 409;
      throw err;
    }

    // Safety Protection (Requirement 19): Protect finalized and live exam questions
    const attachedFinalizedExams = await Exam.find({
      questions: cleanId,
      status: { $in: ['LIVE', 'ENDED', 'CLOSED', 'RESULT_PUBLISHED'] }
    });
    if (attachedFinalizedExams.length > 0) {
      const isCoreModified =
        updates.questionText !== undefined ||
        updates.options !== undefined ||
        updates.correctOption !== undefined ||
        updates.correctAnswer !== undefined ||
        updates.marks !== undefined;
      if (isCoreModified) {
        const err: any = new Error(
          `Cannot modify core question properties (text, options, answer, or marks): Question is attached to active or concluded examination "${attachedFinalizedExams[0].title}" (${attachedFinalizedExams[0].examId})`
        );
        err.statusCode = 400;
        throw err;
      }
    }

    const normalizedOptions =
      updates.options !== undefined ? this.normalizeOptions(updates.options) : question.options;
    const nextAnswer =
      updates.correctOption ??
      updates.correctAnswer ??
      question.correctOption ??
      question.correctAnswer;

    const mergedInput: Partial<IQuestionInput> = {
      questionText: updates.questionText ?? question.questionText,
      subject: updates.subject ?? question.subject,
      course: updates.course ?? question.course,
      semester: updates.semester ?? question.semester,
      questionType: updates.questionType ?? question.questionType,
      difficulty: updates.difficulty ?? question.difficulty,
      marks: updates.marks ?? question.marks,
      negativeMarks: updates.negativeMarks ?? question.negativeMarks,
      options: normalizedOptions,
      correctOption: nextAnswer,
      correctAnswer: nextAnswer,
      status: updates.status ?? question.status
    };

    this.validateQuestionInput(mergedInput, true);

    if (updates.questionText !== undefined) question.questionText = updates.questionText.trim();
    if (updates.subject !== undefined) question.subject = updates.subject.trim();
    if (updates.topic !== undefined) question.topic = updates.topic.trim();
    if (updates.course !== undefined) {
      question.course = updates.course ? ExamService.normalizeCourse(updates.course) : '';
    }
    if (updates.semester !== undefined) {
      question.semester = updates.semester ? ExamService.normalizeSemester(updates.semester) : '';
    }
    if (updates.difficulty !== undefined) question.difficulty = updates.difficulty;
    if (updates.negativeMarks !== undefined) question.negativeMarks = updates.negativeMarks;
    if (updates.explanation !== undefined) question.explanation = updates.explanation.trim();
    if (updates.options !== undefined && normalizedOptions) {
      question.options = normalizedOptions.map((o) => ({ id: o.id.trim(), text: o.text.trim() }));
    }
    if (updates.correctOption !== undefined || updates.correctAnswer !== undefined) {
      const cleanAns = String(updates.correctOption ?? updates.correctAnswer).trim();
      question.correctAnswer = cleanAns;
      question.correctOption = cleanAns;
    }
    if (updates.status !== undefined) {
      question.status = updates.status;
    }

    const previousMarks = question.marks;
    if (updates.marks !== undefined) {
      question.marks = updates.marks;
    }

    await question.save();

    // If marks changed, recalculate totalMarks on attached draft/scheduled exams
    if (updates.marks !== undefined && updates.marks !== previousMarks) {
      const pendingExams = await Exam.find({
        questions: cleanId,
        status: { $in: ['DRAFT', 'SCHEDULED'] }
      });
      for (const pExam of pendingExams) {
        const newTotal = await ExamService.calculateMarksFromQuestionIds(pExam.questions);
        pExam.totalMarks = newTotal;
        if (pExam.passingMarks > newTotal || pExam.passingMarks === 0) {
          pExam.passingMarks = Math.max(1, Math.round(newTotal * 0.4));
        }
        await pExam.save();
      }
    }

    emitTeacherAndAdmin(question.createdBy, 'question.updated', { question: question.toJSON() }, user.userId);
    await AuditService.record({
      actorId: user.userId,
      actorName: user.name,
      actorRole: user.role,
      action: 'QUESTION_UPDATED',
      targetType: 'QUESTION',
      targetId: cleanId,
      details: `Updated question "${cleanId}" (${question.subject})`
    });

    logger.info(`Question ${cleanId} updated by ${user.role} [${user.userId}]`);
    return question;
  }

  static async updateQuestionStatus(
    questionId: string,
    status: QuestionStatus,
    user: JwtUserPayload
  ): Promise<IQuestionDocument> {
    return this.updateQuestion(questionId, { status }, user);
  }

  /**
   * Delete or deactivate question by questionId with ownership verification and safety protections
   */
  static async deleteQuestion(
    questionId: string,
    user: JwtUserPayload
  ): Promise<{ status: 'DELETED' | 'INACTIVE'; deactivated: boolean; message: string }> {
    const cleanId = this.validateQuestionId(questionId);
    const question = await Question.findOne({ questionId: cleanId });
    if (!question) {
      const err: any = new Error(`Question with ID ${cleanId} not found`);
      err.statusCode = 404;
      throw err;
    }

    if (user.role === 'TEACHER' && question.createdBy !== user.userId) {
      const err: any = new Error('Forbidden: You are not authorized to delete this question');
      err.statusCode = 403;
      throw err;
    }

    // Safety Protection (Requirement 20): Soft deactivate if referenced in any exam
    const isAttachedToExam = await Exam.exists({ questions: cleanId });
    if (isAttachedToExam) {
      question.status = 'INACTIVE';
      await question.save();
      emitTeacherAndAdmin(question.createdBy, 'question.updated', { question: question.toJSON() }, user.userId);
      await AuditService.record({
        actorId: user.userId,
        actorName: user.name,
        actorRole: user.role,
        action: 'QUESTION_DEACTIVATED',
        targetType: 'QUESTION',
        targetId: cleanId,
        details: `Question ${cleanId} deactivated (preserved because it is referenced by existing examinations)`
      });
      logger.info(`Question ${cleanId} deactivated by ${user.role} [${user.userId}] due to exam references`);
      return {
        status: 'INACTIVE',
        deactivated: true,
        message: 'Question was safely deactivated to preserve existing examination records.'
      };
    }

    // Otherwise permanently delete if not referenced
    await Question.deleteOne({ questionId: cleanId });
    emitTeacherAndAdmin(question.createdBy, 'question.deleted', { questionId: cleanId }, user.userId);
    await AuditService.record({
      actorId: user.userId,
      actorName: user.name,
      actorRole: user.role,
      action: 'QUESTION_DELETED',
      targetType: 'QUESTION',
      targetId: cleanId,
      details: `Question ${cleanId} permanently deleted`
    });

    logger.info(`Question ${cleanId} deleted by ${user.role} [${user.userId}]`);
    return {
      status: 'DELETED',
      deactivated: false,
      message: 'Question deleted successfully'
    };
  }
}
