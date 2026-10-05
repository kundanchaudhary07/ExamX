import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import {
  AiQuestionService,
  callProviderWithTransientRetries,
  GroqContentClient
} from '../src/services/ai.service';
import { AuditLog } from '../src/models/AuditLog';
import { AiGenerationBatch } from '../src/models/AiGenerationBatch';
import { Question } from '../src/models/Question';
import { Syllabus } from '../src/models/Syllabus';
import { JwtUserPayload } from '../src/types/auth.types';
import { QuestionService } from '../src/services/question.service';
import { checkSyllabusSubjectCompatibility } from '../src/utils/syllabusSubjectCompatibility';

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

const mediumLengthDbmsSyllabus = Array.from(
  { length: 13 },
  () =>
    'UNIT I: Database management systems organize relational information within tables. Tables contain records and attributes. ' +
    'Primary keys alongside foreign keys connect related records. SQL queries retrieve and update information. ' +
    'Normalization reduces redundancy. Transactions preserve consistency. Concurrency control coordinates practitioners. ' +
    'Recovery restores data after failures.'
).join(' ');

async function run(): Promise<void> {
  const originalGroqKey = process.env.GROQ_API_KEY;
  const mongoUri = process.env.MONGODB_URI;
  let syllabusId = '';
  let questionIds: string[] = [];

  process.env.GROQ_API_KEY = 'test-only-groq-placeholder';

  try {
    {
      assert.equal(
        checkSyllabusSubjectCompatibility(
          'Artificial Intelligence',
          'UNIT I: Artificial Intelligence covers intelligent agents and knowledge representation.'
        ).compatible,
        true,
        'An AI syllabus is accepted for the AI subject'
      );
      assert.equal(
        checkSyllabusSubjectCompatibility(
          'Database Management Systems',
          'DBMS introduces SQL, relational databases, normalization, and transactions.'
        ).compatible,
        true,
        'DBMS abbreviations and terminology are accepted for Database Management Systems'
      );
      assert.equal(
        checkSyllabusSubjectCompatibility(
          'Operating Systems',
          'Operating System Concepts: processes, threads, process scheduling, memory management, and file systems.'
        ).compatible,
        true,
        'An Operating Systems syllabus is accepted'
      );
      assert.deepEqual(
        checkSyllabusSubjectCompatibility(
          'Artificial Intelligence',
          'INT363: CLOUD MICROSERVICES. Cloud computing, microservices, Docker, Kubernetes, cloud-native deployments, and AWS.'
        ),
        {
          compatible: false,
          selectedSubject: 'Artificial Intelligence',
          detectedTopic: 'Cloud Microservices'
        },
        'A strong cloud/microservices syllabus conflicts with Artificial Intelligence'
      );
      assert.equal(
        checkSyllabusSubjectCompatibility(
          'Artificial Intelligence',
          'Machine Learning studies neural networks, knowledge representation, natural language processing, and computer vision.'
        ).compatible,
        true,
        'AI-related terminology is accepted without the exact subject phrase'
      );
      assert.equal(
        checkSyllabusSubjectCompatibility(
          'Database Management Systems',
          'DBMS: relational databases use SQL; normalization and primary keys organize records.'
        ).compatible,
        true,
        'DBMS shorthand is accepted'
      );
      assert.equal(
        checkSyllabusSubjectCompatibility(
          'Artificial Intelligence',
          'The syllabus describes foundational concepts and learning outcomes for the course.'
        ).compatible,
        false,
        'A syllabus without evidence for the selected subject must be rejected'
      );

      let providerCalls = 0;
      const client = groqClient(async () => {
        providerCalls++;
        return { choices: [{ message: { content: JSON.stringify(generatedResponse()) } }] };
      });
      await assert.rejects(
        () => AiQuestionService.generateQuestionsForReview({
          ...generationParams,
          subject: 'Artificial Intelligence',
          topic: 'all',
          syllabusText: 'INT363: CLOUD MICROSERVICES. Cloud computing, microservices, Docker, Kubernetes, cloud-native deployments, and AWS.'
        }, client, noWait),
        (error: any) =>
          error.statusCode === 422 &&
          error.code === 'SYLLABUS_SUBJECT_MISMATCH' &&
          error.message === 'You have uploaded/selected the wrong subject. Please upload the syllabus for the selected subject.'
      );
      assert.equal(providerCalls, 0, 'A high-confidence mismatch is rejected before the Groq request');
    }

    {
      const scopedSyllabus = [
        'UNIT I: Data structures',
        'Arrays store values in contiguous memory locations.',
        'UNIT II: Graph algorithms',
        'Graphs contain vertices and edges. Breadth-first search traverses graph structures.'
      ].join('\n');
      let submittedPrompt = '';
      const scopedClient = groqClient(async (request) => {
        submittedPrompt = request.messages[1].content;
        return {
          choices: [{
            message: {
              content: JSON.stringify({
                questions: [{
                  ...generatedResponse().questions[0],
                  topic: 'all',
                  syllabusUnit: 'UNIT 2',
                  syllabusTopic: 'Breadth-first search',
                  sourceReference: 'Breadth-first search traverses graph structures.'
                }]
              })
            }
          }]
        };
      });
      const scoped = await AiQuestionService.generateQuestionsForReview({
        ...generationParams,
        topic: 'all',
        syllabusText: scopedSyllabus,
        selectedUnits: ['UNIT II']
      }, scopedClient, noWait);
      assert.equal(scoped.drafts[0].syllabusUnit, 'UNIT 2');
      assert(submittedPrompt.includes('UNIT II: Graph algorithms'));
      assert(!submittedPrompt.includes('Arrays store values'));
      await assert.rejects(
        () => AiQuestionService.generateQuestionsForReview({
          ...generationParams,
          topic: 'all',
          syllabusText: scopedSyllabus,
          selectedUnits: ['UNIT III']
        }, scopedClient, noWait),
        (error: any) => error.statusCode === 400 && error.code === 'AI_INVALID_REQUEST'
      );
      const crossUnitClient = groqClient(async () => ({
        choices: [{
          message: {
            content: JSON.stringify({
              questions: [{
                ...generatedResponse().questions[0],
                topic: 'all',
                syllabusUnit: 'UNIT I',
                syllabusTopic: 'Arrays',
                sourceReference: 'Breadth-first search traverses graph structures.'
              }]
            })
          }
        }]
      }));
      await assert.rejects(
        () => AiQuestionService.generateQuestionsForReview({
          ...generationParams,
          topic: 'all',
          syllabusText: scopedSyllabus,
          selectedUnits: ['UNIT II']
        }, crossUnitClient, noWait),
        (error: any) => error.statusCode === 502 && error.code === 'AI_INVALID_RESPONSE'
      );
    }

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

    {
      const mediumLengthWords = mediumLengthDbmsSyllabus.split(/\s+/).filter(Boolean).length;
      assert(mediumLengthWords >= 500 && mediumLengthWords <= 600);
      assert(mediumLengthDbmsSyllabus.length >= 4000);

      const allTopicParams = {
        ...generationParams,
        subject: 'Database Management Systems',
        topic: 'all',
        course: 'B.Tech CS',
        semester: 'Semester 2',
        count: 20,
        syllabusText: mediumLengthDbmsSyllabus
      };
      let capturedRequest: any;
      let providerCalls = 0;
      const response = {
        questions: Array.from({ length: allTopicParams.count }, (_, index) => ({
          ...generatedResponse().questions[0],
          questionText: `Which syllabus concept is covered by database question ${index + 1}?`,
          subject: allTopicParams.subject,
          course: allTopicParams.course,
          semester: allTopicParams.semester,
          topic: 'all',
          syllabusUnit: 'UNIT I',
          syllabusTopic: 'Database management systems',
          sourceReference: 'Primary keys alongside foreign keys connect related records.'
        }))
      };
      const client = groqClient(async (input) => {
        providerCalls++;
        capturedRequest = input;
        return { choices: [{ message: { content: JSON.stringify(response) } }] };
      });
      const result = await AiQuestionService.generateQuestionsForReview(allTopicParams, client, noWait);

      assert.equal(providerCalls, 1, 'A 500+ word syllabus reaches the configured provider');
      assert.equal(capturedRequest.model, 'openai/gpt-oss-120b');
      assert.match(capturedRequest.messages[1].content, /Generate 20 rigorous/);
      assert.match(capturedRequest.messages[1].content, /across all relevant units and topics/);
      assert.doesNotMatch(capturedRequest.messages[1].content, /focusing on topic\/unit "all"/i);
      assert(capturedRequest.messages[1].content.includes(mediumLengthDbmsSyllabus));
      assert.equal(result.drafts.length, 20);
      assert(result.drafts.every(draft => draft.topic === 'all'));
      assert(result.drafts.every(draft => draft.reviewStatus === 'PENDING_TEACHER_REVIEW'));
    }

    {
      let calls = 0;
      const client = groqClient(async () => {
        calls++;
        return { choices: [{ message: { content: JSON.stringify({ questions: [] }) } }] };
      });
      await assert.rejects(
        () => AiQuestionService.generateQuestionsForReview(generationParams, client, noWait),
        (error: any) =>
          error.code === 'AI_INVALID_RESPONSE' &&
          error.statusCode === 502 &&
          /GROQ returned no questions/.test(error.message) &&
          !/does not provide enough information/.test(error.message)
      );
      assert.equal(calls, 1);
    }

    for (const invalidText of ['', ' \n\t  ']) {
      let calls = 0;
      const client = groqClient(async () => {
        calls++;
        return { choices: [{ message: { content: JSON.stringify(generatedResponse()) } }] };
      });
      await assert.rejects(
        () => AiQuestionService.generateQuestionsForReview({
          ...generationParams,
          syllabusText: invalidText
        }, client, noWait),
        (error: any) => error.code === 'INSUFFICIENT_SYLLABUS_CONTEXT'
      );
      assert.equal(calls, 0, 'Empty or whitespace-only syllabus must not reach the provider');
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
        }, noWait, 'openai/gpt-oss-120b'),
        (error: any) => error.status === status
      );
      assert.equal(calls, 3, `Transient HTTP ${status} retries are bounded at three attempts`);
    }
    assert.equal(
      await callProviderWithTransientRetries(async () => 'recovered', noWait, 'openai/gpt-oss-120b'),
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
      assert.deepEqual(result.generationBatch.selectedUnits, ['UNIT 1']);
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
      await AiGenerationBatch.deleteMany({ syllabusId });
      await Syllabus.deleteOne({ syllabusId });
      await AuditLog.deleteMany({ targetId: syllabusId, actorId: { $regex: /^groq-teacher-/ } });
      if (questionIds.length) {
        await AuditLog.deleteMany({ targetId: { $in: questionIds } });
      }
    }
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
    if (originalGroqKey === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = originalGroqKey;
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
