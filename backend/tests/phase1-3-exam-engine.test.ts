import assert from 'node:assert';
import http from 'node:http';
import { createApp } from '../src/app';
import { connectDatabase, disconnectDatabase } from '../src/config/database';
import { seedAdmin } from '../scripts/seed-admin';
import { User } from '../src/models/User';
import { Question } from '../src/models/Question';
import { Exam } from '../src/models/Exam';
import { ExamAssignment } from '../src/models/ExamAssignment';
import { ExamAttempt } from '../src/models/ExamAttempt';
import { Result } from '../src/models/Result';
import { StudentQuery } from '../src/models/StudentQuery';
import { ProctoringEvent } from '../src/models/ProctoringEvent';
import { AuditLog } from '../src/models/AuditLog';

let server: http.Server;
let baseUrl = '';

async function apiRequest(
  method: string,
  path: string,
  body?: unknown,
  token?: string
): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json'
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined
  });

  const json = await response.json().catch(() => ({}));
  return { status: response.status, body: json };
}

async function runPhase13Tests() {
  console.log('\n--- STARTING PHASE 1.3 EXAMINATION ENGINE, PROCTORING, QUERIES & SECURITY SUITE ---');

  await connectDatabase();
  await Promise.all([
    User.deleteMany({}),
    Question.deleteMany({}),
    Exam.deleteMany({}),
    ExamAssignment.deleteMany({}),
    ExamAttempt.deleteMany({}),
    Result.deleteMany({}),
    StudentQuery.deleteMany({}),
    ProctoringEvent.deleteMany({}),
    AuditLog.deleteMany({})
  ]);

  await seedAdmin();

  const app = createApp();
  server = await new Promise<http.Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const addr = server.address() as { port: number };
  baseUrl = `http://127.0.0.1:${addr.port}`;

  const adminPassword = process.env.ADMIN_INITIAL_PASSWORD;
  if (!adminPassword) {
    throw new Error('ADMIN_INITIAL_PASSWORD must be set for integration tests.');
  }

  // 1. Login Admin & Provision Teachers and Students
  const adminLogin = await apiRequest('POST', '/api/auth/login', {
    userId: '12412699',
    password: adminPassword
  });
  assert.strictEqual(adminLogin.status, 200);
  const adminToken = adminLogin.body.data.token;

  const t1Res = await apiRequest(
    'POST',
    '/api/users/teachers',
    { name: 'Arjun', dobYear: 1984, department: 'Computer Science' },
    adminToken
  );
  const t1Id = t1Res.body.data.teacher.userId;
  const t1Login = await apiRequest('POST', '/api/auth/login', {
    userId: t1Id,
    password: 'Arjun@1984'
  });
  const t1Token = t1Login.body.data.token;

  const t2Res = await apiRequest(
    'POST',
    '/api/users/teachers',
    { name: 'Meera', dobYear: 1987, department: 'Mathematics' },
    adminToken
  );
  const t2Id = t2Res.body.data.teacher.userId;
  const t2Login = await apiRequest('POST', '/api/auth/login', {
    userId: t2Id,
    password: 'Meera@1987'
  });
  const t2Token = t2Login.body.data.token;

  const s1Res = await apiRequest(
    'POST',
    '/api/users/students',
    { name: 'Karan', dobYear: 2004, department: 'Computer Science' },
    t1Token
  );
  const s1Id = s1Res.body.data.student.userId;
  const s1Login = await apiRequest('POST', '/api/auth/login', {
    userId: s1Id,
    password: 'Karan@2004'
  });
  const s1Token = s1Login.body.data.token;

  const s2Res = await apiRequest(
    'POST',
    '/api/users/students',
    { name: 'Divya', dobYear: 2005, department: 'Computer Science' },
    t1Token
  );
  const s2Id = s2Res.body.data.student.userId;
  const s2Login = await apiRequest('POST', '/api/auth/login', {
    userId: s2Id,
    password: 'Divya@2005'
  });
  const s2Token = s2Login.body.data.token;

  console.log('✔ Test 1 Passed: Provisioned Admin, Teacher 1, Teacher 2, Student 1, Student 2');

  // 2. Server-Side AI Question Generation & Question Bank Creation
  {
    const stuAiAttempt = await apiRequest(
      'POST',
      '/api/ai/questions/generate',
      { subject: 'Algorithms', topic: 'Graphs', count: 2 },
      s1Token
    );
    assert.strictEqual(stuAiAttempt.status, 403, 'Student must be forbidden from AI question generation');

    const syllabusText = 'UNIT II: Graph algorithms and dynamic programming. Graphs contain vertices and edges. Breadth-first search and depth-first search traverse graph structures. Dynamic programming solves overlapping subproblems using memoization or tabulation. Shortest paths include Dijkstra and Bellman-Ford algorithms.';
    const syllabusUpload = await apiRequest(
      'POST',
      '/api/ai/syllabus/upload',
      {
        fileName: 'Algorithms_Unit_II.txt',
        fileBase64: Buffer.from(syllabusText, 'utf8').toString('base64'),
        mimeType: 'text/plain',
        subject: 'Algorithms',
        course: 'B.Tech CSE',
        semester: 'Semester 3'
      },
      t1Token
    );
    assert.strictEqual(syllabusUpload.status, 201);

    const aiGenRes = await apiRequest(
      'POST',
      '/api/ai/questions/generate',
      {
        syllabusId: syllabusUpload.body.data.syllabusId,
        subject: 'Algorithms',
        topic: 'Dynamic Programming',
        course: 'B.Tech CSE',
        semester: 'Semester 3',
        difficulty: 'MEDIUM',
        count: 2,
        marks: 2
      },
      t1Token
    );
    if (!process.env.GEMINI_API_KEY) {
      assert.strictEqual(aiGenRes.status, 503);
      assert.strictEqual(aiGenRes.body.code, 'AI_GENERATION_NOT_CONFIGURED');
    } else {
      assert.strictEqual(aiGenRes.status, 200);
      assert.strictEqual(aiGenRes.body.data.generated.length, 2);
      assert(aiGenRes.body.data.generated.every((draft: any) => draft.reviewStatus === 'PENDING_TEACHER_REVIEW'));
    }
    console.log('✔ Test 2 Passed: Syllabus-grounded AI generation enforces RBAC and reports real provider status');
  }

  // Create 2 questions in Question Bank for Teacher 1
  const q1Res = await apiRequest(
    'POST',
    '/api/questions',
    {
      questionText: 'What is the time complexity of binary search on a sorted array of size n?',
      subject: 'Algorithms',
      topic: 'Searching',
      difficulty: 'EASY',
      marks: 5,
      negativeMarks: 1,
      options: [
        { id: 'A', text: 'O(log n)' },
        { id: 'B', text: 'O(n)' },
        { id: 'C', text: 'O(n log n)' },
        { id: 'D', text: 'O(1)' }
      ],
      correctOption: 'A',
      explanation: 'Binary search halves the search space each step.'
    },
    t1Token
  );
  assert.strictEqual(q1Res.status, 201);
  const q1Id = q1Res.body.data.question.questionId;

  const q2Res = await apiRequest(
    'POST',
    '/api/questions',
    {
      questionText: 'Which data structure uses LIFO ordering?',
      subject: 'Algorithms',
      topic: 'Data Structures',
      difficulty: 'EASY',
      marks: 5,
      negativeMarks: 1,
      options: [
        { id: 'A', text: 'Queue' },
        { id: 'B', text: 'Stack' },
        { id: 'C', text: 'Heap' },
        { id: 'D', text: 'Graph' }
      ],
      correctOption: 'B',
      explanation: 'Stack is Last-In-First-Out.'
    },
    t1Token
  );
  assert.strictEqual(q2Res.status, 201);
  const q2Id = q2Res.body.data.question.questionId;

  // 3. Create, Assign (ONLY to Student 1), and Publish Exam with attemptLimit = 1
  const examRes = await apiRequest(
    'POST',
    '/api/exams',
    {
      title: 'Phase 1.3 Algorithms Assessment',
      subject: 'Algorithms',
      durationMinutes: 30,
      totalMarks: 10,
      passingMarks: 4,
      attemptLimit: 1,
      questions: [q1Id, q2Id],
      assignedStudentIds: [s1Id]
    },
    t1Token
  );
  assert.strictEqual(examRes.status, 201);
  const examId = examRes.body.data.exam.examId;

  const pubRes = await apiRequest('POST', `/api/exams/${examId}/publish`, {}, t1Token);
  assert.strictEqual(pubRes.status, 200);
  assert.strictEqual(pubRes.body.data.exam.status, 'PUBLISHED');
  console.log('✔ Test 3 Passed: Exam created, assigned to Student 1, and published');

  // 4. Unassigned Student (Student 2) cannot start attempt; Assigned Student (Student 1) starts attempt & receives sanitized questions
  let attemptId = '';
  {
    const s2Start = await apiRequest('POST', '/api/attempts/start', { examId }, s2Token);
    assert.strictEqual(s2Start.status, 403, 'Unassigned student must be blocked from starting exam');

    const s1Start = await apiRequest('POST', '/api/attempts/start', { examId }, s1Token);
    assert.strictEqual(s1Start.status, 201);
    attemptId = s1Start.body.data.attempt.attemptId;
    assert.ok(attemptId.startsWith('ATT'));
    assert.ok(s1Start.body.data.remainingSeconds > 0);

    // Verify sanitized questions NEVER leak correctOption, correctAnswer, or explanation
    const returnedQuestions = s1Start.body.data.questions;
    assert.strictEqual(returnedQuestions.length, 2);
    for (const q of returnedQuestions) {
      assert.strictEqual(q.correctOption, undefined, 'correctOption must never be exposed to student');
      assert.strictEqual(q.correctAnswer, undefined, 'correctAnswer must never be exposed to student');
      assert.strictEqual(q.explanation, undefined, 'explanation must never be exposed to student');
    }
    console.log('✔ Test 4 Passed: Attempt started with server timer; questions sanitized against answer leakage');
  }

  // 5. Proctoring Event Recording & Ownership Isolation
  {
    const s2Proc = await apiRequest(
      'POST',
      '/api/proctoring/events',
      { examId, attemptId, eventType: 'TAB_SWITCH', severity: 'HIGH' },
      s2Token
    );
    assert.strictEqual(s2Proc.status, 403, 'Student 2 cannot log proctoring events on Student 1 attempt');

    const s1Proc = await apiRequest(
      'POST',
      '/api/proctoring/events',
      { examId, attemptId, eventType: 'TAB_SWITCH', severity: 'HIGH', details: 'Switched browser tab' },
      s1Token
    );
    assert.strictEqual(s1Proc.status, 201);

    const stuGetProc = await apiRequest('GET', '/api/proctoring/events', undefined, s1Token);
    assert.strictEqual(stuGetProc.status, 403, 'Students cannot list global proctoring events');

    const t2GetProc = await apiRequest('GET', `/api/proctoring/events?examId=${examId}`, undefined, t2Token);
    assert.strictEqual(t2GetProc.status, 403, 'Teacher 2 cannot view proctoring events for Teacher 1 exam');

    const t1GetProc = await apiRequest('GET', `/api/proctoring/events?examId=${examId}`, undefined, t1Token);
    assert.strictEqual(t1GetProc.status, 200);
    assert.strictEqual(t1GetProc.body.data.events.length, 1);
    console.log('✔ Test 5 Passed: Proctoring event persistence and RBAC isolation verified');
  }

  // 6. Answer Validation, Server-Side Scoring & Attempt Limit Control
  let resultId = '';
  {
    // Invalid questionId must be rejected
    const badSubmit = await apiRequest(
      'POST',
      `/api/attempts/${attemptId}/submit`,
      { answers: [{ questionId: 'QST9999999', selectedOption: 'A' }] },
      s1Token
    );
    assert.strictEqual(badSubmit.status, 400, 'Invalid questionId must be rejected');

    // Student 2 cannot submit Student 1's attempt
    const hijackSubmit = await apiRequest(
      'POST',
      `/api/attempts/${attemptId}/submit`,
      { answers: [{ questionId: q1Id, selectedOption: 'A' }] },
      s2Token
    );
    assert.strictEqual(hijackSubmit.status, 403, 'Cross-student attempt submission must be rejected');

    // Valid submission: Q1 correct ('A' -> +5 marks), Q2 wrong ('A' instead of 'B' -> -1 negative mark) => expected score = 4 / 10 (40%)
    // Also inject fake score=999 to prove server ignores client score manipulation
    const validSubmit = await apiRequest(
      'POST',
      `/api/attempts/${attemptId}/submit`,
      {
        score: 999,
        percentage: 100,
        answers: [
          { questionId: q1Id, selectedOption: 'A' },
          { questionId: q2Id, selectedOption: 'A' }
        ]
      },
      s1Token
    );
    assert.strictEqual(validSubmit.status, 200);
    resultId = validSubmit.body.data.resultId;
    assert.ok(resultId.startsWith('RES'));
    assert.strictEqual(validSubmit.body.data.status, 'PENDING');

    // Attempt limit = 1: starting a second attempt must be rejected with 400
    const secondAttempt = await apiRequest('POST', '/api/attempts/start', { examId }, s1Token);
    assert.strictEqual(secondAttempt.status, 400, 'Second attempt must be blocked when attemptLimit=1');
    console.log('✔ Test 6 Passed: Server-side scoring, client score injection defense, and attemptLimit=1 verified');
  }

  // 7. Unpublished Result Protection & Result Publication Gating
  {
    // Before publication, Student 1 must see 0 published results and receive 403 on GET /api/results/:resultId
    const s1MyResultsBefore = await apiRequest('GET', '/api/results/my', undefined, s1Token);
    assert.strictEqual(s1MyResultsBefore.status, 200);
    assert.strictEqual(
      s1MyResultsBefore.body.data.results.length,
      0,
      'Unpublished results must never appear in student results list'
    );

    const s1DirectResultBefore = await apiRequest('GET', `/api/results/${resultId}`, undefined, s1Token);
    assert.strictEqual(
      s1DirectResultBefore.status,
      403,
      'Student must receive 403 when requesting an unpublished result by ID'
    );

    // Teacher 2 cannot publish Teacher 1's exam result
    const t2Publish = await apiRequest('PATCH', `/api/results/${resultId}/publish`, {}, t2Token);
    assert.strictEqual(t2Publish.status, 403, 'Teacher 2 cannot publish Teacher 1 result');

    // Teacher 1 publishes the result
    const t1Publish = await apiRequest('PATCH', `/api/results/${resultId}/publish`, {}, t1Token);
    assert.strictEqual(t1Publish.status, 200);
    assert.strictEqual(t1Publish.body.data.result.status, 'PUBLISHED');
    assert.strictEqual(t1Publish.body.data.result.score, 4);
    assert.strictEqual(t1Publish.body.data.result.percentage, 40);

    // Now Student 1 can access their published result
    const s1DirectResultAfter = await apiRequest('GET', `/api/results/${resultId}`, undefined, s1Token);
    assert.strictEqual(s1DirectResultAfter.status, 200);
    assert.strictEqual(s1DirectResultAfter.body.data.result.score, 4);

    // Student 2 still receives 403 when trying to view Student 1's published result
    const s2DirectResult = await apiRequest('GET', `/api/results/${resultId}`, undefined, s2Token);
    assert.strictEqual(s2DirectResult.status, 403, 'Student 2 must never access Student 1 result');
    console.log('✔ Test 7 Passed: Unpublished result protection, teacher publication, and cross-student isolation verified');
  }

  // 8. Student Query Creation & Faculty Adjudication with Score Adjustment
  {
    const s2Query = await apiRequest(
      'POST',
      '/api/queries',
      { examId, questionId: q2Id, explanation: 'Unassigned query attempt' },
      s2Token
    );
    assert.strictEqual(s2Query.status, 403, 'Unassigned student cannot create query for exam');

    const s1Query = await apiRequest(
      'POST',
      '/api/queries',
      {
        examId,
        questionId: q2Id,
        reasonType: 'AMBIGUOUS_QUESTION',
        message: 'Option A and B wording was ambiguous in Q2.'
      },
      s1Token
    );
    assert.strictEqual(s1Query.status, 201);
    const queryId = s1Query.body.data.query.queryId;

    // Student cannot resolve their own query
    const stuResolve = await apiRequest(
      'PATCH',
      `/api/queries/${queryId}/resolve`,
      { status: 'APPROVED', response: 'Self approve' },
      s1Token
    );
    assert.strictEqual(stuResolve.status, 403);

    // Teacher 2 cannot resolve Teacher 1's query
    const t2Resolve = await apiRequest(
      'PATCH',
      `/api/queries/${queryId}/resolve`,
      { status: 'APPROVED', response: 'Unauthorized teacher' },
      t2Token
    );
    assert.strictEqual(t2Resolve.status, 403);

    // Teacher 1 resolves query and awards +2 bonus marks (4 -> 6)
    const t1Resolve = await apiRequest(
      'PATCH',
      `/api/queries/${queryId}/resolve`,
      { status: 'APPROVED', response: 'Granted 2 marks credit for Q2.', scoreAdjustment: 2 },
      t1Token
    );
    assert.strictEqual(t1Resolve.status, 200);

    const updatedResult = await apiRequest('GET', `/api/results/${resultId}`, undefined, s1Token);
    assert.strictEqual(updatedResult.body.data.result.score, 6);
    console.log('✔ Test 8 Passed: Student query workflow, teacher isolation, and score adjustment verified');
  }

  // 9. Admin-Only Audit Logs Verification
  {
    const t1Audit = await apiRequest('GET', '/api/audit-logs', undefined, t1Token);
    assert.strictEqual(t1Audit.status, 403, 'Teacher must be forbidden from viewing system audit logs');

    const s1Audit = await apiRequest('GET', '/api/audit-logs', undefined, s1Token);
    assert.strictEqual(s1Audit.status, 403, 'Student must be forbidden from viewing system audit logs');

    const adminAudit = await apiRequest('GET', '/api/audit-logs', undefined, adminToken);
    assert.strictEqual(adminAudit.status, 200);
    const actions = adminAudit.body.data.logs.map((l: any) => l.action);
    assert.ok(actions.includes('USER_LOGIN'));
    assert.ok(actions.includes('TEACHER_CREATED'));
    assert.ok(actions.includes('STUDENT_CREATED'));
    assert.ok(actions.includes('EXAM_CREATED'));
    assert.ok(actions.includes('EXAM_PUBLISHED'));
    assert.ok(actions.includes('ATTEMPT_SUBMITTED'));
    assert.ok(actions.includes('RESULT_PUBLISHED'));
    assert.ok(actions.includes('QUERY_CREATED'));
    assert.ok(actions.includes('QUERY_RESOLVED'));
    console.log('✔ Test 9 Passed: Admin-only audit logs record all lifecycle events accurately');
  }

  console.log('\n====================================================================');
  console.log('ALL PHASE 1.3 EXAMINATION ENGINE, PROCTORING & SECURITY TESTS PASSED');
  console.log('====================================================================\n');

  await new Promise<void>((resolve) => server.close(() => resolve()));
  await disconnectDatabase();
}

runPhase13Tests().catch(async (err) => {
  console.error('\n❌ Phase 1.3 Test Suite Failed:\n', err);
  await disconnectDatabase();
  process.exit(1);
});
