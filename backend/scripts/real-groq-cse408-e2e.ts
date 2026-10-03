import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { createApp } from '../src/app';
import { connectDatabase, disconnectDatabase } from '../src/config/database';
import { ENV } from '../src/config/env';
import { AuditLog } from '../src/models/AuditLog';
import { Question } from '../src/models/Question';
import { Syllabus } from '../src/models/Syllabus';
import { User } from '../src/models/User';
import { validateAndExtractSyllabus } from '../src/utils/syllabusExtractor';
import { hashPassword } from '../src/utils/password';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PDF_PATH = path.resolve(__dirname, '../../test-data/CSE408.pdf');
const MODEL = 'openai/gpt-oss-120b';
const COURSE = 'B.Tech CSE';
const SEMESTER = 'Semester 1';
const SUBJECT = 'Data Structures & Algorithms';
const TOPIC = 'DAA';

type ApiResult = { status: number; body: any };

function safeMessage(error: unknown): string {
  let message = error instanceof Error ? error.message : String(error);
  const key = process.env.GROQ_API_KEY?.trim();
  if (key) message = message.replaceAll(key, '[REDACTED]');
  return message
    .replace(/gsk_[A-Za-z0-9_-]+/g, '[REDACTED]')
    .replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]')
    .slice(0, 500);
}

async function listen(): Promise<http.Server> {
  const server = http.createServer(createApp());
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return server;
}

async function close(server: http.Server | undefined): Promise<void> {
  if (!server?.listening) return;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

async function main(): Promise<void> {
  process.env.AI_PROVIDER = 'GROQ';
  assert(process.env.GROQ_API_KEY?.trim(), 'GROQ_API_KEY must be configured in the backend environment');
  const mongoUri = ENV.MONGODB_URI;
  assert(mongoUri, 'MONGODB_URI must target examx_test');
  const databaseName = new URL(mongoUri).pathname.replace(/^\/+/, '').split('?')[0];
  assert.equal(databaseName.toLowerCase(), 'examx_test', 'Refusing to access any database except examx_test');

  const pdfBuffer = await fs.readFile(PDF_PATH);
  const extracted = await validateAndExtractSyllabus({
    originalname: 'CSE408.pdf',
    mimetype: 'application/pdf',
    size: pdfBuffer.length,
    buffer: pdfBuffer
  });
  assert.equal(extracted.fileType, 'PDF');
  assert(extracted.charCount >= 80, `Insufficient PDF text extracted (${extracted.charCount} characters)`);
  assert(extracted.text.trim().split(/\s+/).length >= 12, 'Extracted syllabus has too few words');
  assert.match(extracted.text, /data\s+structures|algorithm/i, 'Extracted content does not identify the expected subject area');
  console.log(JSON.stringify({
    stage: 'pdf-extraction',
    success: true,
    file: extracted.fileName,
    characters: extracted.charCount,
    words: extracted.text.trim().split(/\s+/).length,
    expectedSubjectTermsFound: true
  }));

  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const adminUserId = `groq-test-admin-${runId}`;
  const adminEmail = `${adminUserId}@examx.test`;
  const teacherEmail = `groq-test-teacher-${runId}@examx.test`;
  const otherTeacherEmail = `groq-test-other-${runId}@examx.test`;
  const studentEmail = `groq-test-student-${runId}@examx.test`;
  const adminPassword = `Test-Only-${runId}-Admin!`;
  const userIds: string[] = [];
  const syllabusIds: string[] = [];
  const questionIds: string[] = [];
  const auditTargetIds: string[] = [];
  let server: http.Server | undefined;
  let baseUrl = '';
  let teacherPassword = '';
  let teacherToken = '';

  const request = async (
    method: string,
    route: string,
    body?: unknown,
    token?: string
  ): Promise<ApiResult> => {
    const headers: Record<string, string> = {};
    let requestBody: string | FormData | undefined;
    if (body instanceof FormData) {
      requestBody = body;
    } else if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      requestBody = JSON.stringify(body);
    }
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await fetch(`${baseUrl}${route}`, { method, headers, body: requestBody });
    const text = await response.text();
    let parsed: any;
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch {
      parsed = { message: text.slice(0, 200) };
    }
    return { status: response.status, body: parsed };
  };

  try {
    await connectDatabase();
    assert.equal(await User.countDocuments({ email: { $in: [adminEmail, teacherEmail, otherTeacherEmail, studentEmail] } }), 0);
    const admin = await User.create({
      userId: adminUserId,
      name: 'Groq Integration Test Admin',
      email: adminEmail,
      passwordHash: await hashPassword(adminPassword),
      role: 'ADMIN',
      status: 'ACTIVE',
      managedBy: [],
      teacherIds: []
    });
    userIds.push(admin.userId);

    server = await listen();
    const address = server.address();
    assert(address && typeof address === 'object');
    baseUrl = `http://127.0.0.1:${address.port}`;
    const health = await request('GET', '/api/health');
    assert.equal(health.status, 200);
    assert.equal(health.body.database, 'connected');

    const adminLogin = await request('POST', '/api/auth/login', {
      userId: adminUserId,
      password: adminPassword
    });
    assert.equal(adminLogin.status, 200, 'Temporary test administrator must log in through the API');
    const adminToken = adminLogin.body.data.token as string;

    const teacherCreate = await request('POST', '/api/users/teachers', {
      name: 'Groq CSE408 Test Teacher',
      dob: '1985-01-01',
      email: teacherEmail,
      department: 'Computer Science & Engineering',
      designation: 'Professor'
    }, adminToken);
    assert.equal(teacherCreate.status, 201, JSON.stringify(teacherCreate.body));
    const teacher = teacherCreate.body.data.teacher;
    userIds.push(teacher.userId);
    teacherPassword = teacherCreate.body.data.credentials.password;

    const otherTeacherCreate = await request('POST', '/api/users/teachers', {
      name: 'Groq CSE408 Other Teacher',
      dob: '1986-01-01',
      email: otherTeacherEmail,
      department: 'Computer Science & Engineering',
      designation: 'Professor'
    }, adminToken);
    assert.equal(otherTeacherCreate.status, 201, JSON.stringify(otherTeacherCreate.body));
    const otherTeacher = otherTeacherCreate.body.data.teacher;
    userIds.push(otherTeacher.userId);
    const otherTeacherPassword = otherTeacherCreate.body.data.credentials.password;

    const teacherLogin = await request('POST', '/api/auth/login', {
      userId: teacher.userId,
      password: teacherPassword
    });
    assert.equal(teacherLogin.status, 200);
    teacherToken = teacherLogin.body.data.token;

    const studentCreate = await request('POST', '/api/users/students', {
      name: 'Groq CSE408 Test Student',
      dob: '2005-01-01',
      email: studentEmail,
      department: 'Computer Science & Engineering',
      course: COURSE,
      semester: SEMESTER
    }, teacherToken);
    assert.equal(studentCreate.status, 201, JSON.stringify(studentCreate.body));
    const student = studentCreate.body.data.student;
    userIds.push(student.userId);
    const studentPassword = studentCreate.body.data.credentials.password;

    const otherTeacherLogin = await request('POST', '/api/auth/login', {
      userId: otherTeacher.userId,
      password: otherTeacherPassword
    });
    assert.equal(otherTeacherLogin.status, 200);
    const otherTeacherToken = otherTeacherLogin.body.data.token;
    const studentLogin = await request('POST', '/api/auth/login', {
      userId: student.userId,
      password: studentPassword
    });
    assert.equal(studentLogin.status, 200);
    const studentToken = studentLogin.body.data.token as string;

    const providerStatus = await request('GET', '/api/ai/status', undefined, teacherToken);
    assert.equal(providerStatus.status, 200);
    assert.equal(providerStatus.body.data.provider, 'GROQ');
    assert.equal(providerStatus.body.data.model, MODEL);
    assert.equal(providerStatus.body.data.configured, true);

    const upload = new FormData();
    upload.append('syllabus', new Blob([pdfBuffer], { type: 'application/pdf' }), 'CSE408.pdf');
    upload.append('course', COURSE);
    upload.append('semester', SEMESTER);
    upload.append('subject', SUBJECT);
    const syllabusUpload = await request('POST', '/api/ai/syllabus/upload', upload, teacherToken);
    assert.equal(syllabusUpload.status, 201, JSON.stringify(syllabusUpload.body));
    const syllabusId = syllabusUpload.body.data.syllabusId as string;
    assert(syllabusId);
    syllabusIds.push(syllabusId);
    auditTargetIds.push(syllabusId);
    const persistedSyllabus = await Syllabus.findOne({ syllabusId }).select('+extractedText');
    assert(persistedSyllabus);
    assert.equal(persistedSyllabus.fileName, 'CSE408.pdf');
    assert.equal(persistedSyllabus.uploadedBy, teacher.userId);
    assert.equal(persistedSyllabus.course, COURSE);
    assert.equal(persistedSyllabus.semester, SEMESTER);
    assert.equal(persistedSyllabus.subject, SUBJECT);
    assert.equal(persistedSyllabus.extractedText, extracted.text, 'API upload must use the same extracted PDF contents');

    const generation = await request('POST', '/api/ai/questions/generate', {
      syllabusId,
      course: COURSE,
      semester: SEMESTER,
      subject: SUBJECT,
      topic: TOPIC,
      difficulty: 'MEDIUM',
      marks: 2,
      count: 3
    }, teacherToken);
    if (generation.status !== 200) {
      const responseMessage = safeMessage(new Error(String(generation.body.message || generation.body.error || 'Provider request failed')));
      console.log(JSON.stringify({
        stage: 'real-groq-generation',
        success: false,
        provider: 'GROQ',
        model: MODEL,
        httpStatus: generation.status,
        error: responseMessage,
        persistedQuestionCount: await Question.countDocuments({ syllabusId })
      }));
      throw new Error('Real Groq generation failed; no fallback questions were created.');
    }
    const generated = (generation.body.data.generated || generation.body.data.questions) as any[];
    assert.equal(generated.length, 3, 'Groq must return exactly three questions');
    for (const question of generated) {
      questionIds.push(question.questionId);
      auditTargetIds.push(question.questionId);
      assert.equal(question.aiProvider, 'GROQ');
      assert.equal(question.aiModel, MODEL);
      assert.equal(question.course, COURSE);
      assert.equal(question.semester, SEMESTER);
      assert.equal(question.subject, SUBJECT);
      assert.equal(question.topic, TOPIC);
      assert.equal(question.difficulty, 'MEDIUM');
      assert.equal(question.marks, 2);
      assert.equal(question.reviewStatus, 'PENDING_TEACHER_REVIEW');
      assert.equal(question.status, 'DRAFT');
      const normalize = (text: string) => text.toLowerCase().replace(/\s+/g, ' ').trim();
      const extractedText = normalize(persistedSyllabus.extractedText);
      assert(extractedText.includes(normalize(question.sourceReference)), 'Question reference must be copied from extracted syllabus text');
      assert(extractedText.includes(normalize(question.syllabusUnit)), 'Syllabus unit must appear in extracted syllabus text');
      assert(extractedText.includes(normalize(question.syllabusTopic)), 'Syllabus topic must appear in extracted syllabus text');
      assert(question.questionText.trim().length >= 15);
    }
    assert.equal(new Set(generated.map((question) => question.questionText.toLowerCase().trim())).size, 3);
    console.log(JSON.stringify({
      stage: 'real-groq-generation',
      success: true,
      provider: 'GROQ',
      model: MODEL,
      httpStatus: generation.status,
      generatedCount: generated.length,
      syllabusGrounding: 'PASS',
      reviewStatus: 'PENDING_TEACHER_REVIEW'
    }));

    const queue = await request('GET', '/api/ai/questions/drafts', undefined, teacherToken);
    assert.equal(queue.status, 200);
    const queueQuestions = queue.body.data.drafts.filter((question: any) => question.syllabusId === syllabusId);
    assert.equal(queueQuestions.length, 3, 'Teacher Review Queue must show all three generated questions');

    const hiddenFromOtherTeacher = await request('GET', '/api/ai/questions/drafts', undefined, otherTeacherToken);
    assert.equal(hiddenFromOtherTeacher.status, 200);
    assert(!hiddenFromOtherTeacher.body.data.drafts.some((question: any) => question.syllabusId === syllabusId));
    const otherTeacherApproval = await request(
      'POST',
      `/api/ai/questions/drafts/${questionIds[0]}/approve`,
      undefined,
      otherTeacherToken
    );
    assert.equal(otherTeacherApproval.status, 403, 'Another teacher must not approve these drafts');

    const studentGeneration = await request('POST', '/api/ai/questions/generate', {
      syllabusId,
      course: COURSE,
      semester: SEMESTER,
      subject: SUBJECT,
      topic: TOPIC,
      difficulty: 'MEDIUM',
      marks: 2,
      count: 3
    }, studentToken);
    assert.equal(studentGeneration.status, 403, 'Students must not generate questions');
    const studentQueue = await request('GET', '/api/ai/questions/drafts', undefined, studentToken);
    assert.equal(studentQueue.status, 403, 'Students must not access the teacher review queue');
    const studentApproval = await request(
      'POST',
      `/api/ai/questions/drafts/${questionIds[0]}/approve`,
      undefined,
      studentToken
    );
    assert.equal(studentApproval.status, 403, 'Students must not approve questions');

    for (const questionId of questionIds) {
      const approval = await request(
        'POST',
        `/api/ai/questions/drafts/${questionId}/approve`,
        undefined,
        teacherToken
      );
      assert.equal(approval.status, 200, JSON.stringify(approval.body));
      assert.equal(approval.body.data.question.status, 'ACTIVE');
      assert.equal(approval.body.data.question.reviewStatus, 'APPROVED');
      assert.equal(approval.body.data.question.approvedBy, teacher.userId);
    }

    const adminBank = await request(
      'GET',
      `/api/questions?status=ACTIVE&subject=${encodeURIComponent(SUBJECT)}&createdBy=${encodeURIComponent(teacher.userId)}`,
      undefined,
      adminToken
    );
    assert.equal(adminBank.status, 200, 'Administrator must retain Question Bank access');
    const adminQuestionIds = new Set(adminBank.body.data.questions.map((question: any) => question.questionId));
    assert(questionIds.every((id) => adminQuestionIds.has(id)), 'Administrator Question Bank must list all three active questions');

    const activeQuestions = await Question.find({ questionId: { $in: questionIds } }).sort({ questionText: 1 });
    assert.equal(activeQuestions.length, 3);
    assert(activeQuestions.every((question) => question.status === 'ACTIVE' && question.reviewStatus === 'APPROVED'));
    assert(activeQuestions.every((question) => question.createdBy === teacher.userId));

    const bank = await request(
      'GET',
      `/api/questions?status=ACTIVE&subject=${encodeURIComponent(SUBJECT)}&course=${encodeURIComponent(COURSE)}&semester=${encodeURIComponent(SEMESTER)}&createdBy=${encodeURIComponent(teacher.userId)}`,
      undefined,
      teacherToken
    );
    assert.equal(bank.status, 200);
    const visibleIds = new Set(bank.body.data.questions.map((question: any) => question.questionId));
    assert(questionIds.every((id) => visibleIds.has(id)), 'Question Bank must list all three approved questions');
    console.log(JSON.stringify({
      stage: 'review-approval-question-bank',
      success: true,
      queuedCount: queueQuestions.length,
      approvedCount: activeQuestions.length,
      activeCount: activeQuestions.filter((question) => question.status === 'ACTIVE').length,
      questionBankCount: questionIds.filter((id) => visibleIds.has(id)).length
    }));

    const auditBeforeRestart = await AuditLog.find({
      $or: [
        { actorId: teacher.userId, action: 'AI_QUESTIONS_GENERATED', targetId: syllabusId },
        { actorId: teacher.userId, action: 'AI_QUESTION_APPROVED', targetId: { $in: questionIds } }
      ]
    });
    assert.equal(auditBeforeRestart.length, 4, 'Generation and all three approvals must be audited');
    for (const log of auditBeforeRestart) {
      assert(!log.details.includes(process.env.GROQ_API_KEY!));
      assert(!/authorization|bearer|gsk_/i.test(log.details));
    }

    const databaseQuestionsBeforeRestart = await Question.countDocuments({ questionId: { $in: questionIds } });
    assert.equal(databaseQuestionsBeforeRestart, 3);
    await close(server);
    server = undefined;
    await disconnectDatabase();
    await connectDatabase();
    server = await listen();
    const restartedAddress = server.address();
    assert(restartedAddress && typeof restartedAddress === 'object');
    baseUrl = `http://127.0.0.1:${restartedAddress.port}`;

    const restartedLogin = await request('POST', '/api/auth/login', {
      userId: teacher.userId,
      password: teacherPassword
    });
    assert.equal(restartedLogin.status, 200, 'Teacher must be able to log in after backend restart');
    teacherToken = restartedLogin.body.data.token;
    const restartedBank = await request(
      'GET',
      `/api/questions?status=ACTIVE&subject=${encodeURIComponent(SUBJECT)}&course=${encodeURIComponent(COURSE)}&semester=${encodeURIComponent(SEMESTER)}&createdBy=${encodeURIComponent(teacher.userId)}`,
      undefined,
      teacherToken
    );
    assert.equal(restartedBank.status, 200);
    const restartedIds = new Set(restartedBank.body.data.questions.map((question: any) => question.questionId));
    assert(questionIds.every((id) => restartedIds.has(id)), 'Approved questions must survive backend restart');
    assert.equal(await Question.countDocuments({ questionId: { $in: questionIds } }), 3);
    assert.equal((await AuditLog.find({
      action: { $in: ['AI_QUESTIONS_GENERATED', 'AI_QUESTION_APPROVED'] },
      targetId: { $in: [syllabusId, ...questionIds] }
    })).length, 4);
    console.log(JSON.stringify({
      stage: 'restart-persistence-and-audit',
      success: true,
      persistedQuestions: 3,
      auditRecords: 4,
      backendRestarted: true
    }));
    console.log(JSON.stringify({
      stage: 'rbac',
      success: true,
      adminQuestionBankAccess: true,
      teacherOwnReviewAndApproval: true,
      otherTeacherApprovalDenied: true,
      studentGenerationDenied: true,
      studentQueueDenied: true,
      studentApprovalDenied: true
    }));
  } finally {
    await close(server);
    if (mongooseIsConnected()) {
      await Question.deleteMany({ questionId: { $in: questionIds } });
      await Question.deleteMany({ syllabusId: { $in: syllabusIds } });
      await Syllabus.deleteMany({ syllabusId: { $in: syllabusIds } });
      await AuditLog.deleteMany({
        $or: [
          { actorId: { $in: userIds } },
          { targetId: { $in: [...auditTargetIds, ...userIds] } }
        ]
      });
      await User.deleteMany({ userId: { $in: userIds } });
      for (const email of [adminEmail, teacherEmail, otherTeacherEmail, studentEmail]) {
        await User.deleteMany({ email });
      }
      assert.equal(await Question.countDocuments({ questionId: { $in: questionIds } }), 0);
      assert.equal(await Syllabus.countDocuments({ syllabusId: { $in: syllabusIds } }), 0);
      assert.equal(await User.countDocuments({ userId: { $in: userIds } }), 0);
      await disconnectDatabase();
    }
  }
}

function mongooseIsConnected(): boolean {
  return User.db.readyState === 1;
}

main().catch((error) => {
  console.error(JSON.stringify({
    stage: 'real-groq-e2e',
    success: false,
    error: safeMessage(error)
  }));
  process.exitCode = 1;
});
