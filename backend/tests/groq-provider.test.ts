import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import {
  AiQuestionService,
  callProviderWithTransientRetries,
  GroqContentClient
} from '../src/services/ai.service';
import { AuditLog } from '../src/models/AuditLog';
import { Question } from '../src/models/Question';
import { Syllabus } from '../src/models/Syllabus';
import { JwtUserPayload } from '../src/types/auth.types';
import { QuestionService } from '../src/services/question.service';

const syllabusText =
  'UNIT 1: Data structures include arrays and linked lists. Arrays use contiguous memory locations. ' +
  'Linked lists store nodes connected by pointers. The syllabus also covers algorithm design and analysis.';
const generationParams = {
  syllabusId: `SYL-groq-${Date.now()}`,
  subject: 'Data Structures & Algorithms',
  topic: 'DAA',
  course: 'B.Tech CSE',
  semester: 'Semester 1',
  count: 1,
  marks: 2,
  difficulty: 'MEDIUM' as const,
  syllabusText
};

function generatedResponse() {
  return {
    questions: [{
      questionText: 'Which memory arrangement is specified for arrays in the syllabus?',
      subject: generationParams.subject,
      course: generationParams.course,
      semester: generationParams.semester,
      topic: 'DAA',
      syllabusUnit: 'UNIT 1',
      syllabusTopic: 'Arrays',
      sourceReference: 'Arrays use contiguous memory locations.',
      difficulty: 'MEDIUM',
      options: [
        { id: 'A', text: 'Contiguous memory locations' },
        { id: 'B', text: 'Nodes connected by pointers' },
        { id: 'C', text: 'Unspecified memory placement' },
        { id: 'D', text: 'Only disk-based storage' }
      ],
      correctOption: 'A',
      marks: 2,
      explanation: 'The supplied syllabus states that arrays use contiguous memory locations.'
    }]
  };
}

function groqClient(
  callback: (request: any) => Promise<{ choices?: Array<{ message?: { content?: string | null } }> }>
): GroqContentClient {
  return { chat: { completions: { create: callback } } };
}

const noWait = {
  wait: async () => undefined,
  random: () => 0
};

async function run(): Promise<void> {
  const originalProvider = process.env.AI_PROVIDER;
  const originalGroqKey = process.env.GROQ_API_KEY;
  const originalGeminiKey = process.env.GEMINI_API_KEY;
  const mongoUri = process.env.MONGODB_URI;
  let syllabusId = '';
  let questionIds: string[] = [];

  process.env.AI_PROVIDER = 'GROQ';
  process.env.GROQ_API_KEY = 'test-only-groq-placeholder';

  try {
    {
      delete process.env.GROQ_API_KEY;
      assert.equal(AiQuestionService.getStatus().configured, false);
      await assert.rejects(
        () => AiQuestionService.generateQuestionsForReview(generationParams),
        (error: any) => error.code === 'AI_GENERATION_NOT_CONFIGURED' && error.statusCode === 503
      );
      process.env.GROQ_API_KEY = 'test-only-groq-placeholder';
    }

    {
      let request: any;
      const client = groqClient(async (input) => {
        request = input;
        return { choices: [{ message: { content: JSON.stringify(generatedResponse()) } }] };
      });
      const result = await AiQuestionService.generateQuestionsForReview(generationParams, client, noWait);
      assert.equal(result.provider, 'GROQ');
      assert.equal(result.drafts.length, 1);
      assert.equal(result.drafts[0].aiModel, 'openai/gpt-oss-120b');
      assert.equal(result.drafts[0].aiProvider, 'GROQ');
      assert.equal(result.drafts[0].reviewStatus, 'PENDING_TEACHER_REVIEW');
      assert.equal(result.drafts[0].course, 'B.Tech CSE');
      assert.equal(result.drafts[0].semester, 'Semester 1');
      assert.equal(result.drafts[0].subject, 'Data Structures & Algorithms');
      assert.equal(result.drafts[0].topic, 'DAA');
      assert.equal(result.drafts[0].marks, 2);
      assert.equal(request.model, 'openai/gpt-oss-120b');
      assert.equal(request.response_format.type, 'json_schema');
      assert.equal(request.response_format.json_schema.strict, true);
      assert.match(request.messages[1].content, /sole source for this request/);
      assert.match(request.messages[1].content, /Arrays use contiguous memory locations/);
    }

    {
      let calls = 0;
      const client = groqClient(async () => {
        calls += 1;
        return { choices: [{ message: { content: '{malformed' } }] };
      });
      await assert.rejects(
        () => AiQuestionService.generateQuestionsForReview(generationParams, client, noWait),
        (error: any) => error.code === 'AI_INVALID_RESPONSE' && error.statusCode === 502
      );
      assert.equal(calls, 1, 'Malformed schema responses are not retried');
    }

    for (const status of [401, 403]) {
      let calls = 0;
      const client = groqClient(async () => {
        calls += 1;
        throw Object.assign(new Error(`provider status ${status}`), { status });
      });
      await assert.rejects(
        () => AiQuestionService.generateQuestionsForReview(generationParams, client, noWait),
        (error: any) => error.statusCode === status && error.code === 'AI_PROVIDER_REQUEST_FAILED'
      );
      assert.equal(calls, 1, `HTTP ${status} is not retried`);
    }

    for (const status of [429, 500]) {
      let calls = 0;
      await assert.rejects(
        () => callProviderWithTransientRetries(async () => {
          calls += 1;
          throw Object.assign(new Error(`provider status ${status}`), { status });
        }, noWait, 'openai/gpt-oss-120b', 'GROQ'),
        (error: any) => error.status === status
      );
      assert.equal(calls, 3, `Transient HTTP ${status} retries are bounded at three attempts`);
    }
    assert.equal(
      await callProviderWithTransientRetries(async () => 'recovered', noWait, 'openai/gpt-oss-120b', 'GROQ'),
      'recovered'
    );

    assert(mongoUri, 'MONGODB_URI must target the isolated test database');
    const databaseName = new URL(mongoUri).pathname.replace(/^\/+/, '').split('?')[0];
    assert.equal(databaseName.toLowerCase(), 'examx_test', 'Refusing to run against non-test MongoDB data');
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 5000 });
    }

    const teacher: JwtUserPayload = {
      id: `groq-test-${Date.now()}`,
      userId: `groq-teacher-${Date.now()}`,
      name: 'Groq Test Teacher',
      role: 'TEACHER'
    };
    syllabusId = generationParams.syllabusId;
    await Syllabus.create({
      syllabusId,
      uploadedBy: teacher.userId,
      uploadedByRole: 'TEACHER',
      course: generationParams.course,
      semester: generationParams.semester,
      subject: generationParams.subject,
      fileName: 'groq-provider-test.txt',
      fileType: 'TXT',
      charCount: syllabusText.length,
      wordCount: syllabusText.split(/\s+/).length,
      extractedText: syllabusText
    });

    {
      let calls = 0;
      const failingClient = groqClient(async () => {
        calls += 1;
        throw Object.assign(new Error('temporary provider failure'), { status: 500 });
      });
      await assert.rejects(
        () => AiQuestionService.generateQuestions(generationParams, teacher, failingClient, noWait),
        (error: any) => error.statusCode === 500 && error.code === 'AI_GENERATION_TEMPORARILY_UNAVAILABLE'
      );
      assert.equal(calls, 3);
      assert.equal(await Question.countDocuments({ syllabusId }), 0, 'Provider failure persists zero questions');
    }

    {
      let release!: () => void;
      const blocker = new Promise<void>((resolve) => { release = resolve; });
      const client = groqClient(async () => {
        await blocker;
        return { choices: [{ message: { content: JSON.stringify(generatedResponse()) } }] };
      });
      const firstGeneration = AiQuestionService.generateQuestions(generationParams, teacher, client, noWait);
      assert.equal(AiQuestionService.isUserGenerating(teacher.userId), true);
      await assert.rejects(
        () => AiQuestionService.generateQuestions(generationParams, teacher, client, noWait),
        (error: any) => error.code === 'AI_GENERATION_IN_PROGRESS' && error.statusCode === 409
      );
      release();
      const result = await firstGeneration;
      assert.equal(result.generated.length, 1);
      questionIds = result.generated.map((question) => question.questionId);
      const draft = result.generated[0];
      assert.equal(draft.status, 'DRAFT');
      assert.equal(draft.reviewStatus, 'PENDING_TEACHER_REVIEW');
      assert.equal(draft.createdBy, teacher.userId);
      assert.equal(draft.aiProvider, 'GROQ');
      assert.equal(draft.aiModel, 'openai/gpt-oss-120b');

      const otherTeacher: JwtUserPayload = { ...teacher, userId: `${teacher.userId}-other` };
      const student: JwtUserPayload = { ...teacher, userId: `${teacher.userId}-student`, role: 'STUDENT' };
      await assert.rejects(
        () => QuestionService.approveAiDraft(draft.questionId, otherTeacher),
        (error: any) => error.statusCode === 403
      );
      await assert.rejects(
        () => QuestionService.approveAiDraft(draft.questionId, student),
        (error: any) => error.statusCode === 403
      );
      await assert.rejects(
        () => QuestionService.getAiDrafts(student),
        (error: any) => error.statusCode === 403
      );

      const generatedAudit = await AuditLog.findOne({
        action: 'AI_QUESTIONS_GENERATED',
        targetId: syllabusId,
        actorId: teacher.userId
      });
      assert(generatedAudit);
      const generationDetails = JSON.parse(generatedAudit.details);
      assert.equal(generationDetails.provider, 'GROQ');
      assert.equal(generationDetails.model, 'openai/gpt-oss-120b');
      assert.equal(generationDetails.teacherUserId, teacher.userId);
      assert.equal(generationDetails.generatedCount, 1);
      assert.equal(generationDetails.approvalStatus, 'PENDING_TEACHER_REVIEW');
      assert(Number.isFinite(Date.parse(generationDetails.timestamp)));

      const approved = await QuestionService.approveAiDraft(draft.questionId, teacher);
      assert.equal(approved.status, 'ACTIVE');
      assert.equal(approved.reviewStatus, 'APPROVED');
      assert.equal(approved.approvedBy, teacher.userId);
      const approvalAudit = await AuditLog.findOne({
        action: 'AI_QUESTION_APPROVED',
        targetId: draft.questionId,
        actorId: teacher.userId
      });
      assert(approvalAudit);
      const approvalDetails = JSON.parse(approvalAudit.details);
      assert.equal(approvalDetails.provider, 'GROQ');
      assert.equal(approvalDetails.model, 'openai/gpt-oss-120b');
      assert.equal(approvalDetails.teacherUserId, teacher.userId);
      assert.equal(approvalDetails.syllabusId, syllabusId);
      assert.equal(approvalDetails.generatedCount, 1);
      assert.equal(approvalDetails.approvalStatus, 'APPROVED');
      assert(Number.isFinite(Date.parse(approvalDetails.timestamp)));
    }

    console.log('Groq provider, schema, retry, persistence, ownership, and approval tests passed');
  } finally {
    if (questionIds.length) {
      await Question.deleteMany({ questionId: { $in: questionIds } });
    }
    if (syllabusId) {
      await Question.deleteMany({ syllabusId });
      await Syllabus.deleteOne({ syllabusId });
      await AuditLog.deleteMany({ targetId: syllabusId, actorId: { $regex: /^groq-teacher-/ } });
      if (questionIds.length) {
        await AuditLog.deleteMany({ targetId: { $in: questionIds } });
      }
    }
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
    if (originalProvider === undefined) delete process.env.AI_PROVIDER;
    else process.env.AI_PROVIDER = originalProvider;
    if (originalGroqKey === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = originalGroqKey;
    if (originalGeminiKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalGeminiKey;
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
