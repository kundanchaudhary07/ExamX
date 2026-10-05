import assert from 'node:assert/strict';
import http from 'http';
import { io as createClient, Socket as ClientSocket } from 'socket.io-client';
import { createApp } from '../src/app';
import { connectDatabase, disconnectDatabase } from '../src/config/database';
import { seedAdmin } from '../scripts/seed-admin';
import { initSocketServer, RealtimeEventPayload } from '../src/realtime/socket';
import { User } from '../src/models/User';
import { Exam } from '../src/models/Exam';
import { Question } from '../src/models/Question';
import { ExamAssignment } from '../src/models/ExamAssignment';
import { ExamAttempt } from '../src/models/ExamAttempt';
import { Result } from '../src/models/Result';
import { StudentQuery } from '../src/models/StudentQuery';
import { ProctoringEvent } from '../src/models/ProctoringEvent';
import { AuditLog } from '../src/models/AuditLog';

let server: http.Server;
let baseUrl = '';

async function request(
  method: string,
  path: string,
  options: { token?: string; body?: any } = {}
): Promise<{ status: number; json: any }> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-ExamX-Device-Session': '00000000-0000-4000-8000-000000000001'
  };
  if (options.token) {
    headers['Authorization'] = `Bearer ${options.token}`;
  }

  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

function connectRealtimeClient(token: string): Promise<{
  socket: ClientSocket;
  events: RealtimeEventPayload[];
}> {
  return new Promise((resolve, reject) => {
    const events: RealtimeEventPayload[] = [];
    const socket = createClient(baseUrl, {
      path: '/socket.io',
      auth: { token },
      transports: ['websocket']
    });

    const timeout = setTimeout(() => {
      socket.disconnect();
      reject(new Error('Timed out connecting Socket.IO client'));
    }, 5000);

    socket.on('realtime:event', (payload: RealtimeEventPayload) => {
      events.push(payload);
    });

    socket.on('connect', () => {
      clearTimeout(timeout);
      resolve({ socket, events });
    });

    socket.on('connect_error', err => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

function waitForEvent(
  events: RealtimeEventPayload[],
  predicate: (e: RealtimeEventPayload) => boolean,
  timeoutMs = 3000
): Promise<RealtimeEventPayload> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      const found = events.find(predicate);
      if (found) {
        resolve(found);
        return;
      }
      if (Date.now() - start >= timeoutMs) {
        reject(
          new Error(
            `Timed out waiting for realtime event. Received: ${events.map(e => e.event).join(', ')}`
          )
        );
        return;
      }
      setTimeout(check, 40);
    };
    check();
  });
}

async function runPhase14Tests() {
  console.log('\n======================================================');
  console.log(' STARTING PHASE 1.4 REAL-TIME & RBAC ISOLATION TESTS');
  console.log('======================================================\n');

  await connectDatabase();

  await User.deleteMany({});
  await Exam.deleteMany({});
  await Question.deleteMany({});
  await ExamAssignment.deleteMany({});
  await ExamAttempt.deleteMany({});
  await Result.deleteMany({});
  await StudentQuery.deleteMany({});
  await ProctoringEvent.deleteMany({});
  await AuditLog.deleteMany({});

  await seedAdmin();

  const app = createApp();
  server = http.createServer(app);
  initSocketServer(server);

  await new Promise<void>(resolve => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (addr && typeof addr === 'object') {
        baseUrl = `http://127.0.0.1:${addr.port}`;
      }
      resolve();
    });
  });

  const activeSockets: ClientSocket[] = [];

  const adminPassword = process.env.ADMIN_INITIAL_PASSWORD;
  if (!adminPassword) {
    throw new Error('ADMIN_INITIAL_PASSWORD must be set for realtime RBAC tests.');
  }

  try {
    // 1. Admin Login & Socket Connection
    console.log('[TEST 1] Admin authentication and real-time socket connection...');
    const adminLogin = await request('POST', '/api/auth/login', {
      body: { userId: '12412699', password: adminPassword }
    });
    assert.equal(adminLogin.status, 200);
    const adminToken = adminLogin.json.data.token;

    const adminClient = await connectRealtimeClient(adminToken);
    activeSockets.push(adminClient.socket);
    console.log('  ✓ Admin authenticated & connected to Socket.IO');

    // 2. Unauthenticated Socket Rejection
    console.log('[TEST 2] Rejecting unauthenticated Socket.IO connection...');
    let unauthRejected = false;
    try {
      await connectRealtimeClient('invalid.jwt.token');
    } catch {
      unauthRejected = true;
    }
    assert.equal(unauthRejected, true);
    console.log('  ✓ Unauthenticated Socket.IO connection rejected');

    // 3. Admin Creates Teacher A & Teacher B -> Real-Time Events
    console.log('[TEST 3] Admin creates Teacher A and Teacher B with real-time events...');
    const createTeacherA = await request('POST', '/api/users/teachers', {
      token: adminToken,
      body: {
        name: 'Faculty Alpha',
        dobYear: 1985,
        department: 'Engineering',
        email: 'alpha@examx.edu'
      }
    });
    assert.equal(createTeacherA.status, 201);
    const teacherACreds = createTeacherA.json.data.credentials;

    const teacherCreatedEv = await waitForEvent(
      adminClient.events,
      e => e.event === 'teacher.created' && e.data?.teacher?.userId === teacherACreds.userId
    );
    assert.ok(teacherCreatedEv);

    const createTeacherB = await request('POST', '/api/users/teachers', {
      token: adminToken,
      body: {
        name: 'Faculty Beta',
        dobYear: 1987,
        department: 'Mathematics',
        email: 'beta@examx.edu'
      }
    });
    assert.equal(createTeacherB.status, 201);
    const teacherBCreds = createTeacherB.json.data.credentials;

    const loginTeacherA = await request('POST', '/api/auth/login', {
      body: { userId: teacherACreds.userId, password: teacherACreds.password }
    });
    assert.equal(loginTeacherA.status, 200);
    const teacherAToken = loginTeacherA.json.data.token;

    const loginTeacherB = await request('POST', '/api/auth/login', {
      body: { userId: teacherBCreds.userId, password: teacherBCreds.password }
    });
    assert.equal(loginTeacherB.status, 200);
    const teacherBToken = loginTeacherB.json.data.token;

    const teacherAClient = await connectRealtimeClient(teacherAToken);
    const teacherBClient = await connectRealtimeClient(teacherBToken);
    activeSockets.push(teacherAClient.socket, teacherBClient.socket);
    console.log('  ✓ Teacher A & Teacher B created, logged in, and connected to Socket.IO');

    // 4. Teacher A creates Student A; Teacher B creates Student B -> Strict Isolation
    console.log('[TEST 4] Teacher-Student ownership & RBAC isolation...');
    const createStudentA = await request('POST', '/api/users/students', {
      token: teacherAToken,
      body: {
        name: 'Candidate One',
        dobYear: 2004,
        department: 'Engineering',
        course: 'CS'
      }
    });
    assert.equal(createStudentA.status, 201);
    const studentACreds = createStudentA.json.data.credentials;

    await waitForEvent(
      teacherAClient.events,
      e => e.event === 'student.created' && e.data?.student?.userId === studentACreds.userId
    );
    await waitForEvent(
      adminClient.events,
      e => e.event === 'student.created' && e.data?.student?.userId === studentACreds.userId
    );
    // Verify Teacher B did NOT receive Student A creation event
    const leakedToTeacherB = teacherBClient.events.some(
      e => e.event === 'student.created' && e.data?.student?.userId === studentACreds.userId
    );
    assert.equal(leakedToTeacherB, false, 'Teacher B must not receive Teacher A student events');

    const createStudentB = await request('POST', '/api/users/students', {
      token: teacherBToken,
      body: {
        name: 'Candidate Two',
        dobYear: 2005,
        department: 'Mathematics',
        course: 'Math'
      }
    });
    assert.equal(createStudentB.status, 201);
    const studentBCreds = createStudentB.json.data.credentials;

    // Teacher A lists students -> only sees Student A
    const teacherAStudents = await request('GET', '/api/users/students', { token: teacherAToken });
    assert.equal(teacherAStudents.status, 200);
    assert.equal(teacherAStudents.json.data.students.length, 1);
    assert.equal(teacherAStudents.json.data.students[0].userId, studentACreds.userId);

    // Teacher A tries to GET Student B by ID -> 403 Forbidden
    const crossGetStudent = await request('GET', `/api/users/students/${studentBCreds.userId}`, {
      token: teacherAToken
    });
    assert.equal(crossGetStudent.status, 403);

    // Teacher A tries to PATCH Student B -> 403 Forbidden
    const crossPatchStudent = await request('PATCH', `/api/users/students/${studentBCreds.userId}`, {
      token: teacherAToken,
      body: { name: 'Unauthorized Edit' }
    });
    assert.equal(crossPatchStudent.status, 403);
    console.log('  ✓ Strict Teacher-Student ownership & RBAC isolation enforced');

    // 5. Connect Student A & Student B to Socket.IO and test Exam + Result + Query Real-Time Sync
    console.log('[TEST 5] Real-time Exam, Proctoring, Result, and Query synchronization...');
    const loginStudentA = await request('POST', '/api/auth/login', {
      body: { userId: studentACreds.userId, password: studentACreds.password }
    });
    const studentAToken = loginStudentA.json.data.token;

    const loginStudentB = await request('POST', '/api/auth/login', {
      body: { userId: studentBCreds.userId, password: studentBCreds.password }
    });
    const studentBToken = loginStudentB.json.data.token;

    const studentAClient = await connectRealtimeClient(studentAToken);
    const studentBClient = await connectRealtimeClient(studentBToken);
    activeSockets.push(studentAClient.socket, studentBClient.socket);

    // Teacher A creates a question
    const createQ = await request('POST', '/api/questions', {
      token: teacherAToken,
      body: {
        questionText: 'What is the time complexity of binary search?',
        subject: 'Algorithms',
        topic: 'Searching',
        difficulty: 'EASY',
        marks: 5,
        options: [
          { id: 'A', text: 'O(log n)' },
          { id: 'B', text: 'O(n)' },
          { id: 'C', text: 'O(n log n)' },
          { id: 'D', text: 'O(1)' }
        ],
        correctOption: 'A'
      }
    });
    assert.equal(createQ.status, 201);
    const questionId = createQ.json.data.question.questionId;

    await waitForEvent(
      teacherAClient.events,
      e => e.event === 'question.created' && e.data?.question?.questionId === questionId
    );

    // Teacher A creates an exam assigned to Student A
    const createExam = await request('POST', '/api/exams', {
      token: teacherAToken,
      body: {
        title: 'Algorithms Assessment',
        subject: 'Algorithms',
        durationMinutes: 30,
        totalMarks: 5,
        passingMarks: 2,
        questions: [questionId],
        assignedStudentIds: [studentACreds.userId]
      }
    });
    assert.equal(createExam.status, 201);
    const examId = createExam.json.data.exam.examId;

    // Teacher A publishes the exam -> Student A receives exam.published & notification.created
    const publishExam = await request('POST', `/api/exams/${examId}/publish`, {
      token: teacherAToken
    });
    assert.equal(publishExam.status, 200);

    await waitForEvent(
      studentAClient.events,
      e => e.event === 'exam.published' && e.data?.exam?.examId === examId
    );
    await waitForEvent(studentAClient.events, e => e.event === 'notification.created');

    // Student B (not assigned) must NOT receive exam.published
    const examLeakedToStudentB = studentBClient.events.some(
      e => e.event === 'exam.published' && e.data?.exam?.examId === examId
    );
    assert.equal(examLeakedToStudentB, false, 'Unassigned Student B must not receive exam.published');

    // Student A starts attempt, logs proctoring event, and submits
    const startAtt = await request('POST', '/api/attempts/start', {
      token: studentAToken,
      body: { examId }
    });
    assert.equal(startAtt.status, 201);
    const attemptId = startAtt.json.data.attempt.attemptId;

    await waitForEvent(
      teacherAClient.events,
      e => e.event === 'proctoring.started' && e.data?.attemptId === attemptId
    );

    const logProctor = await request('POST', '/api/proctoring/events', {
      token: studentAToken,
      body: {
        examId,
        attemptId,
        eventType: 'TAB_SWITCH',
        severity: 'MEDIUM',
        details: 'Switched browser tab'
      }
    });
    assert.equal(logProctor.status, 201);

    await waitForEvent(
      teacherAClient.events,
      e => e.event === 'proctoring.event' && e.data?.event?.attemptId === attemptId
    );

    for (let warning = 2; warning <= 5; warning += 1) {
      const warningEvent = await request('POST', '/api/proctoring/events', {
        token: studentAToken,
        body: {
          examId,
          attemptId,
          eventType: 'TAB_SWITCH',
          severity: 'MEDIUM',
          details: `Suspension warning ${warning}`
        }
      });
      assert.equal(warningEvent.status, 201);
    }
    await waitForEvent(
      teacherAClient.events,
      e => e.event === 'attempt.suspended' && e.data?.attemptId === attemptId
    );

    const assistanceRequest = await request('POST', '/api/proctoring/unblock-requests', {
      token: studentAToken,
      body: { attemptId, examId, reason: 'Please review my suspended attempt.' }
    });
    assert.equal(assistanceRequest.status, 201);
    const requestId = assistanceRequest.json.data.request.requestId;

    const rejectAssistance = await request(
      'PATCH',
      `/api/proctoring/unblock-requests/${requestId}`,
      {
        token: teacherAToken,
        body: { status: 'REJECTED', remarks: 'Attempt submitted after rejection.' }
      }
    );
    assert.equal(rejectAssistance.status, 200);
    await waitForEvent(
      studentAClient.events,
      e => e.event === 'unblock.updated' &&
        e.data?.request?.requestId === requestId &&
        e.data?.request?.status === 'REJECTED'
    );
    await waitForEvent(
      studentAClient.events,
      e => e.event === 'attempt.submitted' && e.data?.attemptId === attemptId
    );
    const finalizedAttempt = await ExamAttempt.findOne({ attemptId });
    assert.equal(finalizedAttempt?.status, 'SUBMITTED');
    assert.equal(finalizedAttempt?.warningCount, 5);
    assert.equal(finalizedAttempt?.cameraStatus, 'OFFLINE');
    const submittedResult = await Result.findOne({ attemptId });
    assert.ok(submittedResult);
    const resultId = submittedResult!.resultId;

    await waitForEvent(
      teacherAClient.events,
      e => e.event === 'result.created' && e.data?.result?.resultId === resultId
    );

    // Teacher A publishes result -> Student A receives result.published
    const pubRes = await request('PATCH', `/api/results/${resultId}/publish`, {
      token: teacherAToken,
      body: { feedback: 'Well done' }
    });
    assert.equal(pubRes.status, 200);

    await waitForEvent(
      studentAClient.events,
      e => e.event === 'result.published' && e.data?.result?.resultId === resultId
    );

    // Student A raises query -> Teacher A & Admin receive query.created
    const createQuery = await request('POST', '/api/queries', {
      token: studentAToken,
      body: {
        examId,
        questionId,
        questionText: 'Binary search question',
        explanation: 'Requesting clarification on step count.'
      }
    });
    assert.equal(createQuery.status, 201);
    const queryId = createQuery.json.data.query.queryId;

    await waitForEvent(
      teacherAClient.events,
      e => e.event === 'query.created' && e.data?.query?.queryId === queryId
    );

    // Teacher A resolves query -> Student A receives query.resolved
    const resolveQuery = await request('PATCH', `/api/queries/${queryId}/resolve`, {
      token: teacherAToken,
      body: {
        decision: 'ACCEPT',
        teacherRemarks: 'Clarified in solution notes.'
      }
    });
    assert.equal(resolveQuery.status, 200);

    await waitForEvent(
      studentAClient.events,
      e => e.event === 'query.resolved' && e.data?.query?.queryId === queryId
    );
    console.log('  ✓ Real-time Exam, Proctoring, Result, and Query events verified');

    // 6. Verify /api/dashboard/stats for Admin, Teacher A, Teacher B, Student A
    console.log('[TEST 6] Verifying /api/dashboard/stats role-scoped metrics...');
    const adminStats = await request('GET', '/api/dashboard/stats', { token: adminToken });
    assert.equal(adminStats.status, 200);
    assert.equal(adminStats.json.data.totalTeachers, 2);
    assert.equal(adminStats.json.data.totalStudents, 2);

    const teacherAStats = await request('GET', '/api/dashboard/stats', { token: teacherAToken });
    assert.equal(teacherAStats.status, 200);
    assert.equal(teacherAStats.json.data.totalStudents, 1);
    assert.equal(teacherAStats.json.data.totalExams, 1);

    const teacherBStats = await request('GET', '/api/dashboard/stats', { token: teacherBToken });
    assert.equal(teacherBStats.status, 200);
    assert.equal(teacherBStats.json.data.totalStudents, 1);
    assert.equal(teacherBStats.json.data.totalExams, 0);

    const studentAStats = await request('GET', '/api/dashboard/stats', { token: studentAToken });
    assert.equal(studentAStats.status, 200);
    assert.equal(studentAStats.json.data.assignedExams, 1);
    assert.equal(studentAStats.json.data.publishedResults, 1);
    console.log('  ✓ /api/dashboard/stats role-scoped metrics verified');

    console.log('\n======================================================');
    console.log(' ALL PHASE 1.4 REAL-TIME & RBAC TESTS PASSED!');
    console.log('======================================================\n');
  } finally {
    for (const s of activeSockets) {
      s.disconnect();
    }
    await new Promise<void>(resolve => server.close(() => resolve()));
    await disconnectDatabase();
  }
}

runPhase14Tests().catch(err => {
  console.error('Phase 1.4 test suite failed:', err);
  process.exit(1);
});
