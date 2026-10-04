import { GoogleGenAI, Type } from '@google/genai';
import Groq from 'groq-sdk';
import { QuestionDifficulty, QuestionOption } from '../types/exam.types';
import { JwtUserPayload } from '../types/auth.types';
import { QuestionService } from './question.service';
import { ExamService } from './exam.service';
import { SyllabusService } from './syllabus.service';
import { AuditService } from './audit.service';
import { AiGenerationBatchService } from './ai-generation-batch.service';
import { SubjectService } from './subject.service';
import {
  UploadedSyllabusInput,
  getMaxSyllabusFileSizeBytes
} from '../utils/syllabusExtractor';
import {
  checkSyllabusSubjectCompatibility,
  createSyllabusSubjectMismatchError
} from '../utils/syllabusSubjectCompatibility';
import { logger } from '../utils/logger';

export interface IGeneratedQuestionDraft {
  questionText: string;
  subject: string;
  topic: string;
  course: string;
  semester: string;
  questionType: 'MCQ';
  difficulty: QuestionDifficulty;
  options: QuestionOption[];
  correctOption: string;
  correctAnswer: string;
  marks: number;
  negativeMarks: number;
  explanation: string;
  source: 'AI_GENERATED';
  syllabusId: string;
  syllabusUnit: string;
  syllabusTopic: string;
  sourceReference: string;
  aiProvider: 'GEMINI' | 'GROQ';
  aiModel: string;
  reviewStatus: 'PENDING_TEACHER_REVIEW';
}

type GenerationParams = {
  syllabusId?: string;
  subject?: string;
  topic?: string;
  unit?: string;
  course?: string;
  semester?: string;
  difficulty?: QuestionDifficulty | 'MIXED';
  questionType?: string;
  count?: number;
  marks?: number;
  negativeMarks?: number;
};

export interface GeminiContentClient {
  models: {
    generateContent(request: any): Promise<{ text?: string }>;
  };
}

export interface GeminiRetryHooks {
  wait?: (milliseconds: number) => Promise<void>;
  random?: () => number;
}

export interface GroqContentClient {
  chat: {
    completions: {
      create(request: any): Promise<{
        choices?: Array<{ message?: { content?: string | null } }>;
      }>;
    };
  };
}

type AiProvider = 'GEMINI' | 'GROQ';
type AiProviderClient = GeminiContentClient | GroqContentClient;
type RetryHooks = GeminiRetryHooks;
type GenerationProviderResponse = {
  text?: string;
  choices?: Array<{ message?: { content?: string | null } }>;
};

export function validateQuestionCount(value: unknown): number {
  const count = Number(value);
  if (!Number.isInteger(count) || count < 1 || count > 200) {
    const err: any = new Error('Question count must be an integer between 1 and 200.');
    err.statusCode = 400;
    err.code = 'AI_INVALID_REQUEST';
    throw err;
  }
  return count;
}

const GROQ_MODEL = 'openai/gpt-oss-120b';
const GEMINI_MODEL = 'gemini-3.8-flash';

function resolveAiProvider(): AiProvider {
  const configuredProvider = process.env.AI_PROVIDER?.trim().toUpperCase();
  if (configuredProvider && configuredProvider !== 'GEMINI' && configuredProvider !== 'GROQ') {
    const err: any = new Error('AI_PROVIDER must be set to GEMINI or GROQ.');
    err.statusCode = 500;
    err.code = 'AI_PROVIDER_INVALID_CONFIG';
    throw err;
  }
  if (configuredProvider === 'GEMINI' || configuredProvider === 'GROQ') return configuredProvider;
  return 'GEMINI';
}

function providerModel(provider: AiProvider): string {
  return provider === 'GROQ' ? GROQ_MODEL : GEMINI_MODEL;
}

const GROQ_QUESTION_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    questions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          questionText: { type: 'string' },
          subject: { type: 'string' },
          course: { type: 'string' },
          semester: { type: 'string' },
          topic: { type: 'string' },
          syllabusUnit: { type: 'string' },
          syllabusTopic: { type: 'string' },
          sourceReference: { type: 'string' },
          difficulty: { type: 'string', enum: ['EASY', 'MEDIUM', 'HARD'] },
          options: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                id: { type: 'string', enum: ['A', 'B', 'C', 'D'] },
                text: { type: 'string' }
              },
              required: ['id', 'text']
            }
          },
          correctOption: { type: 'string', enum: ['A', 'B', 'C', 'D'] },
          marks: { type: 'number' },
          explanation: { type: 'string' }
        },
        required: [
          'questionText', 'subject', 'course', 'semester', 'topic', 'syllabusUnit',
          'syllabusTopic', 'sourceReference', 'difficulty', 'options', 'correctOption',
          'marks', 'explanation'
        ]
      }
    }
  },
  required: ['questions']
};

const RETRYABLE_PROVIDER_STATUSES = new Set([408, 429, 500, 502, 503, 504]);
const RETRYABLE_NETWORK_CODES = new Set(['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'ECONNREFUSED']);
const RETRYABLE_TEXT_PATTERNS = [
  'currently experiencing high demand',
  'temporarily overloaded',
  'service unavailable',
  'unavailable',
  'high demand',
  'model is overloaded'
];

export function isTransientProviderError(error: any): boolean {
  if (!error) return false;
  if (/(timeout|connection)/i.test(String(error?.name || ''))) return true;

  const nonRetryableCodes = new Set([
    'AI_INVALID_REQUEST',
    'AI_GENERATION_NOT_CONFIGURED',
    'AI_INVALID_RESPONSE',
    'INSUFFICIENT_SYLLABUS_CONTEXT'
  ]);
  if (nonRetryableCodes.has(error?.code)) {
    return false;
  }

  let status = Number(error?.status ?? error?.statusCode ?? error?.response?.status ?? error?.error?.code);
  let statusText = String(error?.statusText ?? error?.error?.status ?? error?.code ?? error?.cause?.code ?? '');
  let message = String(error?.message || '');

  if (message.trim().startsWith('{')) {
    try {
      const parsed = JSON.parse(message);
      if (parsed?.error) {
        if (!Number.isInteger(status) && Number.isInteger(parsed.error.code)) {
          status = Number(parsed.error.code);
        }
        if (!statusText && parsed.error.status) {
          statusText = String(parsed.error.status);
        }
        if (parsed.error.message) {
          message += ' ' + String(parsed.error.message);
        }
      }
    } catch {
      // not JSON
    }
  }

  // Explicit non-retryable client HTTP statuses: 400, 401, 403, 404, 422
  if ([400, 401, 403, 404, 422].includes(status)) {
    return false;
  }

  // Transient HTTP statuses: 503, 502, 500, 504, 429, 408
  if (Number.isInteger(status) && RETRYABLE_PROVIDER_STATUSES.has(status)) {
    return true;
  }

  // Transient gRPC / network status codes
  const upperStatusText = statusText.toUpperCase();
  if (
    upperStatusText === 'UNAVAILABLE' ||
    upperStatusText === 'RESOURCE_EXHAUSTED' ||
    upperStatusText === 'DEADLINE_EXCEEDED' ||
    RETRYABLE_NETWORK_CODES.has(statusText)
  ) {
    return true;
  }

  // Some SDKs omit the HTTP status but return a transient provider error message.
  const lowerMsg = message.toLowerCase();
  for (const pattern of RETRYABLE_TEXT_PATTERNS) {
    if (lowerMsg.includes(pattern)) {
      return true;
    }
  }

  return false;
}

export async function callProviderWithTransientRetries<T>(
  operation: (attempt?: number) => Promise<T>,
  hooks: RetryHooks = {},
  modelName = GEMINI_MODEL,
  provider: AiProvider = 'GEMINI'
): Promise<T> {
  const wait = hooks.wait || ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const random = hooks.random || Math.random;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      if (attempt > 1) {
        logger.info(`[AI Question Gen] Retrying ${provider} attempt ${attempt}/3 for model "${modelName}"...`);
      }
      const result = await operation(attempt);
      if (attempt > 1) {
        logger.info(`[AI Question Gen] ${provider} attempt ${attempt}/3 succeeded for model "${modelName}".`);
      }
      return result;
    } catch (error: any) {
      const retryable = isTransientProviderError(error);

      if (!retryable || attempt === 3) {
        const rawStatus = error?.status ?? error?.statusCode ?? error?.response?.status ?? error?.error?.code ?? (retryable ? 503 : 'NON_RETRYABLE');
        logger.error(
          `[AI Question Gen] ${provider} request failed on attempt ${attempt}/3 for model "${modelName}" (HTTP/Status: ${rawStatus}, Retryable: ${retryable}).`
        );
        throw error;
      }

      const rawStatus = error?.status ?? error?.statusCode ?? error?.response?.status ?? error?.error?.code ?? 503;
      const jitter = Math.floor(Math.max(0, Math.min(1, random())) * 250);
      const delay = 1000 * (2 ** (attempt - 1)) + jitter;

      logger.warn(
        `[AI Question Gen] ${provider} attempt ${attempt}/3 encountered transient failure (status: ${rawStatus}) for model "${modelName}". Retrying in ${delay}ms...`
      );

      await wait(delay);
    }
  }

  throw new Error(`${provider} retry loop exited unexpectedly.`);
}

export const isTransientGeminiError = isTransientProviderError;
export const callGeminiWithTransientRetries = callProviderWithTransientRetries;

export class AiQuestionService {
  private static activeGenerations = new Set<string>();

  static isUserGenerating(userId: string): boolean {
    return this.activeGenerations.has(userId);
  }

  static clearActiveGenerations(): void {
    this.activeGenerations.clear();
  }

  private static async withGenerationLock<T>(userId: string, operation: () => Promise<T>): Promise<T> {
    const key = userId || 'anonymous';
    if (this.activeGenerations.has(key)) {
      const err: any = new Error('A question generation request is already in progress. Please wait for it to complete.');
      err.statusCode = 409;
      err.code = 'AI_GENERATION_IN_PROGRESS';
      throw err;
    }
    this.activeGenerations.add(key);
    try {
      return await operation();
    } finally {
      this.activeGenerations.delete(key);
    }
  }

  static isConfigured(): boolean {
    try {
      const provider = resolveAiProvider();
      const key = provider === 'GROQ' ? process.env.GROQ_API_KEY : process.env.GEMINI_API_KEY;
      return Boolean(key?.trim());
    } catch {
      return false;
    }
  }

  static getStatus(): {
    configured: boolean;
    provider: AiProvider;
    model: string;
    status: 'READY' | 'GENERATING' | 'PENDING_REVIEW' | 'NOT_CONFIGURED' | 'ERROR';
    pendingReviewCount: number;
    maxFileSizeMb: number;
    supportedFormats: string[];
    supportedQuestionTypes: string[];
    message: string;
  } {
    const configured = this.isConfigured();
    let provider: AiProvider = 'GEMINI';
    try {
      provider = resolveAiProvider();
    } catch {
      // An invalid provider is reported as unconfigured without exposing environment values.
    }
    const isGenerating = this.activeGenerations.size > 0;
    const maxFileSizeMb = Math.round(getMaxSyllabusFileSizeBytes() / (1024 * 1024));
    return {
      configured,
      provider,
      model: providerModel(provider),
      status: !configured ? 'NOT_CONFIGURED' : (isGenerating ? 'GENERATING' : 'READY'),
      pendingReviewCount: 0,
      maxFileSizeMb,
      supportedFormats: ['PDF', 'DOCX', 'TXT'],
      supportedQuestionTypes: ['MCQ'],
      message: configured
        ? (isGenerating ? 'Generating syllabus-grounded questions...' : 'AI Question Generation with Syllabus Upload is active.')
        : `AI Question Generation is not configured. Set ${provider}_API_KEY in the backend environment or choose a configured AI_PROVIDER.`
    };
  }

  static async generateQuestionsForReview(params: {
    subject?: string;
    topic?: string;
    unit?: string;
    course?: string;
    semester?: string;
    difficulty?: QuestionDifficulty | 'MIXED';
    questionType?: string;
    count?: number;
    marks?: number;
    negativeMarks?: number;
    syllabusId?: string;
    syllabusText?: string;
    syllabusFileName?: string;
  }, providerClient?: AiProviderClient, retryHooks?: RetryHooks): Promise<{
    drafts: IGeneratedQuestionDraft[];
    provider: AiProvider;
    status: 'READY';
    syllabusSummary?: { fileName?: string; charCount: number };
  }> {
    const questionType = String(params.questionType || 'MCQ').toUpperCase().trim();
    if (questionType !== 'MCQ') {
      const err: any = new Error('Unsupported question type. Only MCQ is supported.');
      err.statusCode = 400;
      throw err;
    }

    const syllabusText = (params.syllabusText || '').trim();
    const topicOrUnit = (params.topic || params.unit || '').trim();
    const isAllTopics = topicOrUnit.toLocaleLowerCase() === 'all';
    const subject = (params.subject || '').trim();

    if (!params.syllabusId || syllabusText.length < 80) {
      const err: any = new Error('The uploaded syllabus does not contain enough extracted content for grounded question generation.');
      err.statusCode = 400;
      err.code = 'INSUFFICIENT_SYLLABUS_CONTEXT';
      throw err;
    }

    if (!subject) {
      const err: any = new Error('Subject is required for syllabus-grounded question generation.');
      err.statusCode = 400;
      throw err;
    }
    const subjectCompatibility = checkSyllabusSubjectCompatibility(subject, syllabusText);
    if (!subjectCompatibility.compatible) {
      throw createSyllabusSubjectMismatchError(subjectCompatibility);
    }

    const resolvedSubject = subject;
    const resolvedTopic = topicOrUnit || resolvedSubject;
    const count = validateQuestionCount(params.count);
    const rawDiff = String(params.difficulty || 'MEDIUM').toUpperCase();
    if (!['EASY', 'MEDIUM', 'HARD', 'MIXED'].includes(rawDiff)) {
      const err: any = new Error('Difficulty must be EASY, MEDIUM, HARD, or MIXED.');
      err.statusCode = 400;
      err.code = 'AI_INVALID_REQUEST';
      throw err;
    }
    const difficulty = rawDiff as QuestionDifficulty | 'MIXED';
    const marks = Number(params.marks);
    if (!Number.isInteger(marks) || marks < 1 || marks > 10) {
      const err: any = new Error('Marks per question must be an integer between 1 and 10.');
      err.statusCode = 400;
      err.code = 'AI_INVALID_REQUEST';
      throw err;
    }
    const negativeMarks = params.negativeMarks === undefined ? 0 : Number(params.negativeMarks);
    if (!Number.isFinite(negativeMarks) || negativeMarks < 0) {
      const err: any = new Error('Negative marks must be zero or greater.');
      err.statusCode = 400;
      err.code = 'AI_INVALID_REQUEST';
      throw err;
    }

    const provider = resolveAiProvider();
    const modelName = providerModel(provider);
    const apiKey = (provider === 'GROQ' ? process.env.GROQ_API_KEY : process.env.GEMINI_API_KEY)?.trim();
    if (!apiKey) {
      const err: any = new Error(
        `AI question generation is not configured. Set ${provider}_API_KEY in the server environment before requesting syllabus-based question generation.`
      );
      err.statusCode = 503;
      err.code = 'AI_GENERATION_NOT_CONFIGURED';
      throw err;
    }

    const safeCourse = ExamService.normalizeCourse(params.course);
    const safeSemester = ExamService.normalizeSemester(params.semester);
    if (!safeCourse || !safeSemester) {
      const err: any = new Error('Course and semester are required for question generation.');
      err.statusCode = 400;
      err.code = 'AI_INVALID_REQUEST';
      throw err;
    }

    try {
      const geminiClient = provider === 'GEMINI'
        ? (providerClient as GeminiContentClient | undefined) || new GoogleGenAI({
            apiKey,
            httpOptions: {
              headers: {
                'User-Agent': 'aistudio-build'
              }
            }
          })
        : undefined;
      const groqClient = provider === 'GROQ'
        ? (providerClient as GroqContentClient | undefined) || new Groq({ apiKey, timeout: 30000, maxRetries: 0 })
        : undefined;

      const difficultyInstruction =
        difficulty === 'MIXED'
          ? 'Use a balanced mix of EASY, MEDIUM, and HARD difficulty levels.'
          : `All questions must be at "${difficulty}" difficulty.`;

      const syllabusContext = `\n\nSYLLABUS CONTENT (the sole source for this request):\n"""\n${syllabusText}\n"""`;

      const systemInstruction = `You are a distinguished university professor and academic examination board expert.
Your job is to generate rigorous, authentic university-level multiple-choice questions (MCQs).
Rules:
1. Each question must test genuine conceptual understanding or problem solving.
2. Provide exactly 4 distinct, plausible options labeled "A", "B", "C", and "D". Never output duplicates or placeholders.
3. Exactly one option must be the correct answer, indicated by "correctOption".
4. Provide a clear, educational academic explanation that substantiates why the correctOption is right and why distractors are inaccurate.
5. Generate examination questions strictly from the supplied syllabus.
6. Use only topics, concepts, definitions, terminology, and information supported by the supplied syllabus.
7. Do not introduce outside concepts or use general knowledge to fill missing information.
8. If the syllabus does not contain enough information, return no questions; do not invent content.`;

      const scopeInstruction = isAllTopics
        ? 'Generate across all relevant units and topics present in the supplied syllabus. Do not interpret "all" as a literal syllabus topic. For the topic metadata field only, use the exact value "all"; syllabusTopic must name an actual topic present in the content.'
        : topicOrUnit
          ? `Focus on topic/unit "${topicOrUnit}".`
          : '';
      const prompt = `Generate ${count} rigorous university-level multiple-choice questions (MCQs) for the subject "${resolvedSubject}". ${scopeInstruction} Use exact metadata values subject="${resolvedSubject}", course="${safeCourse}", semester="${safeSemester}", and topic="${resolvedTopic}". ${difficultyInstruction} Each question must have exactly 4 distinct options with IDs "A", "B", "C", and "D", a single valid correctOption ("A", "B", "C", or "D"), difficulty ("EASY", "MEDIUM", or "HARD"), a syllabus unit and syllabus topic supported by the supplied content, a sourceReference copied exactly from the syllabus, marks (${marks}), and a concise academic explanation. If the syllabus is insufficient, return an empty array. Do not invent any value to fill a required field.${syllabusContext}`;

      const response = await callProviderWithTransientRetries<GenerationProviderResponse>(() => {
        if (provider === 'GEMINI') {
          return geminiClient!.models.generateContent({
            model: modelName,
            contents: prompt,
            config: {
              systemInstruction,
              responseMimeType: 'application/json',
              responseSchema: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    questionText: { type: Type.STRING },
                    subject: { type: Type.STRING },
                    course: { type: Type.STRING },
                    semester: { type: Type.STRING },
                    topic: { type: Type.STRING },
                    syllabusUnit: { type: Type.STRING },
                    syllabusTopic: { type: Type.STRING },
                    sourceReference: { type: Type.STRING },
                    difficulty: { type: Type.STRING },
                    options: {
                      type: Type.ARRAY,
                      items: {
                        type: Type.OBJECT,
                        properties: {
                          id: { type: Type.STRING },
                          text: { type: Type.STRING }
                        },
                        required: ['id', 'text']
                      }
                    },
                    correctOption: { type: Type.STRING },
                    marks: { type: Type.NUMBER },
                    explanation: { type: Type.STRING }
                  },
                  required: [
                    'questionText', 'subject', 'course', 'semester', 'topic', 'syllabusUnit',
                    'syllabusTopic', 'sourceReference', 'difficulty', 'options', 'correctOption',
                    'marks', 'explanation'
                  ]
                }
              }
            }
          });
        }
        return groqClient!.chat.completions.create({
          model: modelName,
          messages: [
            { role: 'system', content: systemInstruction },
            { role: 'user', content: prompt }
          ],
          response_format: {
            type: 'json_schema',
            json_schema: {
              name: 'examx_generated_questions',
              strict: true,
              schema: GROQ_QUESTION_JSON_SCHEMA
            }
          },
          temperature: 0,
          max_completion_tokens: Math.min(49152, Math.max(8192, count * 256))
        });
      }, retryHooks, modelName, provider);

      const rawText = provider === 'GEMINI'
        ? response.text?.trim()
        : response.choices?.[0]?.message?.content?.trim();
      if (!rawText) {
        const err: any = new Error(`${provider} returned an empty response.`);
        err.statusCode = 502;
        err.code = 'AI_INVALID_RESPONSE';
        throw err;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(rawText);
      } catch {
        const err: any = new Error(`${provider} returned malformed structured data.`);
        err.statusCode = 502;
        err.code = 'AI_INVALID_RESPONSE';
        throw err;
      }

      if (provider === 'GROQ' && parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        parsed = (parsed as { questions?: unknown }).questions;
      }
      if (!Array.isArray(parsed)) {
        const err: any = new Error(`${provider} response did not match the required question structure.`);
        err.statusCode = 502;
        err.code = 'AI_INVALID_RESPONSE';
        throw err;
      }
      if (parsed.length === 0) {
        const err: any = new Error(`${provider} returned no questions for the supplied syllabus and request.`);
        err.statusCode = 502;
        err.code = 'AI_INVALID_RESPONSE';
        throw err;
      }
      if (parsed.length !== count) {
        const err: any = new Error(`${provider} returned an unexpected number of questions.`);
        err.statusCode = 502;
        err.code = 'AI_INVALID_RESPONSE';
        throw err;
      }

      const validatedDrafts: IGeneratedQuestionDraft[] = [];
      const seenQuestions = new Set<string>();

      for (let idx = 0; idx < parsed.length; idx++) {
        const item: any = parsed[idx];
        if (!item || typeof item !== 'object' || Array.isArray(item)) {
          const err: any = new Error(`${provider} question ${idx + 1} is malformed.`);
          err.statusCode = 502;
          err.code = 'AI_INVALID_RESPONSE';
          throw err;
        }

        const qText = typeof item.questionText === 'string' ? item.questionText.trim() : '';
        const itemSubject = typeof item.subject === 'string' ? item.subject.trim() : '';
        const itemCourse = typeof item.course === 'string' ? item.course.trim() : '';
        const itemSemester = typeof item.semester === 'string' ? item.semester.trim() : '';
        const topic = typeof item.topic === 'string' ? item.topic.trim() : '';
        const syllabusUnit = typeof item.syllabusUnit === 'string' ? item.syllabusUnit.trim() : '';
        const syllabusTopic = typeof item.syllabusTopic === 'string' ? item.syllabusTopic.trim() : '';
        const sourceReference = typeof item.sourceReference === 'string' ? item.sourceReference.trim() : '';
        const itemDiffRaw = String(item.difficulty || '').toUpperCase();
        const optionValues = Array.isArray(item.options) ? item.options : [];
        const correctOption = String(item.correctOption || '').toUpperCase().trim();
        const explanation = typeof item.explanation === 'string' ? item.explanation.trim() : '';
        const sourceText = syllabusText.toLowerCase().replace(/\s+/g, ' ');
        const normalizedReference = sourceReference.toLowerCase().replace(/\s+/g, ' ');
        const normalizedQuestion = qText.toLowerCase().replace(/\s+/g, ' ');
        const normalizedUnit = syllabusUnit.toLowerCase().replace(/\s+/g, ' ');
        const normalizedTopic = syllabusTopic.toLowerCase().replace(/\s+/g, ' ');

        if (
          qText.length < 15 || !topic || !syllabusUnit || !syllabusTopic || !sourceReference ||
          !explanation || seenQuestions.has(normalizedQuestion)
        ) {
          const err: any = new Error(`${provider} question ${idx + 1} is missing required content or provenance.`);
          err.statusCode = 502;
          err.code = 'AI_INVALID_RESPONSE';
          throw err;
        }
        if (
          itemSubject.toLowerCase() !== resolvedSubject.toLowerCase() ||
          itemCourse.toLowerCase() !== safeCourse.toLowerCase() ||
          itemSemester.toLowerCase() !== safeSemester.toLowerCase() ||
          topic.toLowerCase() !== resolvedTopic.toLowerCase()
        ) {
          const err: any = new Error(`${provider} question ${idx + 1} does not match the requested course context.`);
          err.statusCode = 502;
          err.code = 'AI_INVALID_RESPONSE';
          throw err;
        }
        if (
          !['EASY', 'MEDIUM', 'HARD'].includes(itemDiffRaw) ||
          (difficulty !== 'MIXED' && itemDiffRaw !== difficulty)
        ) {
          const err: any = new Error(`${provider} question ${idx + 1} has invalid difficulty.`);
          err.statusCode = 502;
          err.code = 'AI_INVALID_RESPONSE';
          throw err;
        }
        if (optionValues.length !== 4) {
          const err: any = new Error(`${provider} question ${idx + 1} must contain exactly four options.`);
          err.statusCode = 502;
          err.code = 'AI_INVALID_RESPONSE';
          throw err;
        }

        const options: QuestionOption[] = optionValues.map((option: any, optionIndex: number) => ({
          id: typeof option?.id === 'string' ? option.id.trim() : '',
          text: typeof option?.text === 'string' ? option.text.trim() : ''
        }));
        const expectedOptionIds = ['A', 'B', 'C', 'D'];
        const optionTexts = options.map((option) => option.text.toLowerCase());
        if (
          options.some((option, optionIndex) => option.id !== expectedOptionIds[optionIndex] || !option.text) ||
          new Set(optionTexts).size !== 4 || !expectedOptionIds.includes(correctOption)
        ) {
          const err: any = new Error(`${provider} question ${idx + 1} has invalid MCQ options or answer.`);
          err.statusCode = 502;
          err.code = 'AI_INVALID_RESPONSE';
          throw err;
        }
        if (
          Number(item.marks) !== marks ||
          !sourceText.includes(normalizedReference) ||
          !sourceText.includes(normalizedUnit) ||
          (!isAllTopics && !sourceText.includes(normalizedTopic))
        ) {
          const err: any = new Error(`${provider} question ${idx + 1} has invalid marks or an unsupported source reference.`);
          err.statusCode = 502;
          err.code = 'AI_INVALID_RESPONSE';
          throw err;
        }

        const draft: IGeneratedQuestionDraft = {
          questionText: qText,
          subject: resolvedSubject,
          topic,
          course: safeCourse,
          semester: safeSemester,
          questionType: 'MCQ',
          difficulty: itemDiffRaw as QuestionDifficulty,
          options,
          correctOption,
          correctAnswer: correctOption,
          marks,
          negativeMarks,
          explanation,
          source: 'AI_GENERATED',
          syllabusId: params.syllabusId!,
          syllabusUnit,
          syllabusTopic,
          sourceReference,
          aiProvider: provider,
          aiModel: modelName,
          reviewStatus: 'PENDING_TEACHER_REVIEW'
        };
        try {
          QuestionService.validateQuestionInput(draft);
        } catch {
          const err: any = new Error(`${provider} question ${idx + 1} failed server validation.`);
          err.statusCode = 502;
          err.code = 'AI_INVALID_RESPONSE';
          throw err;
        }
        seenQuestions.add(normalizedQuestion);
        validatedDrafts.push(draft);
      }

      return {
        drafts: validatedDrafts,
        provider,
        status: 'READY',
        syllabusSummary: { fileName: params.syllabusFileName, charCount: syllabusText.length }
      };
    } catch (err: any) {
      const error = err as Error & { status?: number; statusCode?: number; code?: string; cause?: { code?: string } };
      if (
        error.code === 'AI_INVALID_RESPONSE' ||
        error.code === 'INSUFFICIENT_SYLLABUS_CONTEXT' ||
        error.code === 'AI_INVALID_REQUEST' ||
        error.code === 'AI_GENERATION_NOT_CONFIGURED' ||
        error.code === 'AI_PROVIDER_INVALID_CONFIG' ||
        error.statusCode === 400 ||
        error.statusCode === 401 ||
        error.statusCode === 403 ||
        error.statusCode === 404 ||
        error.statusCode === 422
      ) {
        throw error;
      }
      const providerStatus = Number(error.status ?? error.statusCode);
      const retryable = isTransientProviderError(error);
      const statusCode = provider === 'GEMINI' && retryable
        ? 503
        : Number.isInteger(providerStatus) && providerStatus >= 400 && providerStatus <= 599
          ? providerStatus
          : retryable
            ? 503
            : 502;
      logger.error(`${provider} provider request failed (${error.name || 'Error'}, status ${statusCode}).`);
      const wrapped: any = new Error(
        provider === 'GEMINI' && statusCode === 503
          ? 'Gemini is temporarily unavailable due to high demand. Please try again in a moment.'
          : `${provider} provider request failed with HTTP ${statusCode}.`
      );
      wrapped.statusCode = statusCode;
      wrapped.code = retryable
        ? 'AI_GENERATION_TEMPORARILY_UNAVAILABLE'
        : 'AI_PROVIDER_REQUEST_FAILED';
      throw wrapped;
    }
  }

  static async generateFromUploadedSyllabus(
    file: UploadedSyllabusInput | undefined | null,
    params: GenerationParams,
    user: JwtUserPayload
  ) {
    return this.withGenerationLock(user.userId, async () => {
      const syllabus = await SyllabusService.upload(file, params, user);
      return this.generateQuestionsInternal({ ...params, syllabusId: syllabus.syllabusId }, user);
    });
  }

  static async generateQuestions(
    params: GenerationParams,
    user: JwtUserPayload,
    providerClient?: AiProviderClient,
    retryHooks?: RetryHooks
  ) {
    return this.withGenerationLock(user.userId, async () => {
      return this.generateQuestionsInternal(params, user, providerClient, retryHooks);
    });
  }

  private static async generateQuestionsInternal(
    params: GenerationParams,
    user: JwtUserPayload,
    providerClient?: AiProviderClient,
    retryHooks?: RetryHooks
  ) {
    if (!params.syllabusId) {
      const err: any = new Error('A persisted syllabus upload is required for question generation.');
      err.statusCode = 400;
      err.code = 'INSUFFICIENT_SYLLABUS_CONTEXT';
      throw err;
    }

    const syllabus = await SyllabusService.getForUser(params.syllabusId, user);
    const course = params.course ? ExamService.normalizeCourse(params.course) : syllabus.course;
    const semester = params.semester ? ExamService.normalizeSemester(params.semester) : syllabus.semester;
    const subject = await SubjectService.ensure(params.subject?.trim() || syllabus.subject, user.userId);
    if (
      course !== syllabus.course || semester !== syllabus.semester ||
      subject.toLowerCase() !== syllabus.subject.toLowerCase()
    ) {
      const err: any = new Error('Generation context must match the uploaded syllabus course, semester, and subject.');
      err.statusCode = 400;
      err.code = 'AI_INVALID_REQUEST';
      throw err;
    }

    const { drafts, provider, status, syllabusSummary } = await this.generateQuestionsForReview({
      ...params,
      syllabusId: syllabus.syllabusId,
      subject: syllabus.subject,
      course: syllabus.course,
      semester: syllabus.semester,
      syllabusText: syllabus.extractedText,
      syllabusFileName: syllabus.fileName
    }, providerClient, retryHooks);
    const batch = await AiGenerationBatchService.create({
      generatedBy: user.userId,
      generatedByName: user.name,
      subject,
      course: syllabus.course,
      semester: syllabus.semester,
      topic: params.topic?.trim() || params.unit?.trim() || subject,
      difficulty: String(params.difficulty || 'MEDIUM').toUpperCase() as 'EASY' | 'MEDIUM' | 'HARD' | 'MIXED',
      marksPerQuestion: Number(params.marks),
      requestedCount: Number(params.count),
      generatedCount: drafts.length,
      syllabusId: syllabus.syllabusId,
      sourceFileName: syllabus.fileName,
      provider,
      aiModel: providerModel(provider)
    });
    const savedDrafts = await QuestionService.createAiDrafts(drafts, user, batch.generationId);
    await AuditService.record({
      actorId: user.userId,
      actorName: user.name,
      actorRole: user.role,
      action: 'AI_QUESTIONS_GENERATED',
      targetType: 'SYLLABUS',
      targetId: syllabus.syllabusId,
      details: JSON.stringify({
        generationId: batch.generationId,
        provider,
        model: providerModel(provider),
        teacherUserId: user.userId,
        syllabusId: syllabus.syllabusId,
        generatedCount: savedDrafts.length,
        timestamp: new Date().toISOString(),
        approvalStatus: 'PENDING_TEACHER_REVIEW'
      })
    });
    return {
      syllabus: SyllabusService.toMetadata(syllabus),
      syllabusSummary,
      generationBatch: batch,
      generated: savedDrafts,
      questions: savedDrafts,
      savedQuestions: [],
      provider,
      status: status === 'READY' ? 'PENDING_REVIEW' : status
    };
  }
}
