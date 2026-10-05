import assert from 'assert';
import http from 'http';
import { createApp } from '../src/app';
import { connectDatabase, disconnectDatabase } from '../src/config/database';
import { seedAdmin } from '../scripts/seed-admin';
import { User } from '../src/models/User';
import { Question } from '../src/models/Question';
import { Exam } from '../src/models/Exam';
import { ExamAssignment } from '../src/models/ExamAssignment';
import { ENV } from '../src/config/env';

async function runPhase15Tests() {
  console.log('--- STARTING PHASE 1.5 STRICT EXAM CREATION, SCHEDULING & LIFECYCLE TEST SUITE ---');

  await connectDatabase();
  await seedAdmin();

  const app = createApp();
  const server = http.createServer(app);
  await new Promise<void>(resolve => server.listen(0, resolve));
  const address = server.address() as any;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  async function apiRequest(method: string, path: string, body?: any, token?: string) {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-ExamX-Device-Session': '00000000-0000-4000-8000-000000000001'
    };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined
    });

    const data: any = await response.json();
    return { status: response.status, body: data };
  }

  try {
    // 1. Authenticate Admin
    const adminLogin = await apiRequest('POST', '/api/auth/login', {
      userId: ENV.ADMIN_USER_ID,
      password: ENV.ADMIN_INITIAL_PASSWORD
    });
    assert.strictEqual(adminLogin.status, 200, 'Admin login should succeed');
    const adminToken = adminLogin.body.data.token;

    // Clean test users/questions/exams from previous runs if any
    await User.deleteMany({ email: { $in: ['t1_p15@examx.edu', 't2_p15@examx.edu', 's1_p15@examx.edu', 's2_p15@examx.edu'] } });

    // Create Teacher A, Teacher B, Student 1 (under Teacher A), Student 2 (under Teacher B)
    const tARes = await apiRequest(
      'POST',
      '/api/users/teachers',
      {
        name: 'ProfSharma',
        dob: '1985-05-10',
        email: 't1_p15@examx.edu',
        department: 'Computer Science & Engineering',
        designation: 'Professor'
      },
      adminToken
    );
    assert.strictEqual(tARes.status, 201);
    const teacherAId = tARes.body.data.teacher.userId;
    const teacherAPass = tARes.body.data.initialCredentials.temporaryPassword;

    const tBRes = await apiRequest(
      'POST',
      '/api/users/teachers',
      {
        name: 'ProfVerma',
        dob: '1986-06-15',
        email: 't2_p15@examx.edu',
        department: 'Information Technology',
        designation: 'Associate Professor'
      },
      adminToken
    );
    assert.strictEqual(tBRes.status, 201);
    const teacherBId = tBRes.body.data.teacher.userId;
    const teacherBPass = tBRes.body.data.initialCredentials.temporaryPassword;

    const tALogin = await apiRequest('POST', '/api/auth/login', {
      userId: teacherAId,
      password: teacherAPass
    });
    const teacherAToken = tALogin.body.data.token;

    const tBLogin = await apiRequest('POST', '/api/auth/login', {
      userId: teacherBId,
      password: teacherBPass
    });
    const teacherBToken = tBLogin.body.data.token;

    const s1Res = await apiRequest(
      'POST',
      '/api/users/students',
      {
        name: 'AaravPatel',
        dob: '2004-03-12',
        email: 's1_p15@examx.edu',
        department: 'Computer Science & Engineering',
        course: 'B.Tech CSE',
        semester: 'Semester 4'
      },
      teacherAToken
    );
    assert.strictEqual(s1Res.status, 201);
    const student1Id = s1Res.body.data.student.userId;
    const student1Pass = s1Res.body.data.initialCredentials.temporaryPassword;

    const s2Res = await apiRequest(
      'POST',
      '/api/users/students',
      {
        name: 'PriyaNair',
        dob: '2004-08-22',
        email: 's2_p15@examx.edu',
        department: 'Information Technology',
        course: 'B.Tech IT',
        semester: 'Semester 4'
      },
      teacherBToken
    );
    assert.strictEqual(s2Res.status, 201);
    const student2Id = s2Res.body.data.student.userId;
    const student2Pass = s2Res.body.data.initialCredentials.temporaryPassword;

    const s1Login = await apiRequest('POST', '/api/auth/login', {
      userId: student1Id,
      password: student1Pass
    });
    const student1Token = s1Login.body.data.token;

    const s2Login = await apiRequest('POST', '/api/auth/login', {
      userId: student2Id,
      password: student2Pass
    });
    const student2Token = s2Login.body.data.token;

    // Create 2 questions for Teacher A (4 marks and 6 marks)
    const q1Res = await apiRequest(
      'POST',
      '/api/questions',
      {
        questionText: 'Which scheduling algorithm is non-preemptive by default?',
        subject: 'Operating Systems',
        topic: 'Process Scheduling',
        difficulty: 'MEDIUM',
        marks: 4,
        options: [
          { key: 'A', text: 'Round Robin' },
          { key: 'B', text: 'FCFS' },
          { key: 'C', text: 'SRTF' },
          { key: 'D', text: 'Multilevel Feedback Queue' }
        ],
        correctOption: 'B'
      },
      teacherAToken
    );
    assert.strictEqual(q1Res.status, 201);
    const q1Id = q1Res.body.data.question.questionId;

    const q2Res = await apiRequest(
      'POST',
      '/api/questions',
      {
        questionText: 'What is thrashing in virtual memory systems?',
        subject: 'Operating Systems',
        topic: 'Memory Management',
        difficulty: 'EASY',
        marks: 6,
        options: [
          { key: 'A', text: 'Excessive page swapping activity' },
          { key: 'B', text: 'Fast cache lookup' },
          { key: 'C', text: 'Disk defragmentation' },
          { key: 'D', text: 'CPU register overflow' }
        ],
        correctOption: 'A'
      },
      teacherAToken
    );
    assert.strictEqual(q2Res.status, 201);
    const q2Id = q2Res.body.data.question.questionId;

    // 2. Validate controlled Course and Semester values
    const badCourseRes = await apiRequest(
      'POST',
      '/api/exams',
      {
        title: 'Invalid Course Exam',
        subject: 'Operating Systems',
        course: 'FakeUncontrolledCourse123',
        semester: 'Semester 4',
        durationMinutes: 60
      },
      teacherAToken
    );
    assert.strictEqual(badCourseRes.status, 400, 'Invalid course must return 400');

    const badSemesterRes = await apiRequest(
      'POST',
      '/api/exams',
      {
        title: 'Invalid Semester Exam',
        subject: 'Operating Systems',
        course: 'B.Tech CSE',
        semester: 'Semester 19',
        durationMinutes: 60
      },
      teacherAToken
    );
    assert.strictEqual(badSemesterRes.status, 400, 'Invalid semester must return 400');
    console.log('✓ 1. Controlled Course and Semester validation passed');

    // 3. Validate schedule windows
    const now = Date.now();
    const startIso = new Date(now + 3600_000).toISOString();
    const endBeforeStartIso = new Date(now + 1800_000).toISOString();

    const reversedRes = await apiRequest(
      'POST',
      '/api/exams',
      {
        title: 'Reversed Window Exam',
        subject: 'Operating Systems',
        course: 'B.Tech CSE',
        semester: 'Semester 4',
        durationMinutes: 60,
        startTime: startIso,
        endTime: endBeforeStartIso
      },
      teacherAToken
    );
    assert.strictEqual(reversedRes.status, 400, 'End time before start time must return 400');

    const tooShortEndIso = new Date(now + 3600_000 + 30 * 60_000).toISOString();
    const shortWindowRes = await apiRequest(
      'POST',
      '/api/exams',
      {
        title: 'Short Window Exam',
        subject: 'Operating Systems',
        course: 'B.Tech CSE',
        semester: 'Semester 4',
        durationMinutes: 60,
        startTime: startIso,
        endTime: tooShortEndIso
      },
      teacherAToken
    );
    assert.strictEqual(
      shortWindowRes.status,
      400,
      'Schedule window shorter than durationMinutes must return 400'
    );
    console.log('✓ 2. Schedule window validation passed');

    // 4. Create DRAFT exam, calculate marks server-side, manage questions
    const validStartIso = new Date(now - 600_000).toISOString();
    const validEndIso = new Date(now + 7200_000).toISOString();

    const createRes = await apiRequest(
      'POST',
      '/api/exams',
      {
        title: 'OS Mid-Semester Examination',
        subject: 'Operating Systems',
        course: 'B.Tech CSE',
        semester: 'Sem 4',
        durationMinutes: 45,
        totalMarks: 500,
        questionIds: [],
        startTime: validStartIso,
        endTime: validEndIso
      },
      teacherAToken
    );

    assert.strictEqual(createRes.status, 201);
    const createdExam = createRes.body.data.exam;
    assert.strictEqual(createdExam.status, 'DRAFT', 'Default exam status must be DRAFT');
    assert.strictEqual(createdExam.semester, 'Semester 4', 'Semester must normalize to Semester 4');
    assert.strictEqual(createdExam.totalMarks, 0, 'Zero-question DRAFT exam must have totalMarks = 0');

    const examId = createdExam.examId;

    // Cannot schedule without questions
    const prematureSchedule = await apiRequest(
      'PATCH',
      `/api/exams/${examId}/status`,
      { status: 'SCHEDULED' },
      teacherAToken
    );
    assert.strictEqual(prematureSchedule.status, 400, 'Cannot schedule exam with 0 questions');

    // Add Q1 (4) + Q2 (6) = 10 marks
    const addQRes = await apiRequest(
      'POST',
      `/api/exams/${examId}/questions`,
      { questionIds: [q1Id, q2Id] },
      teacherAToken
    );
    assert.strictEqual(addQRes.status, 200);
    assert.strictEqual(addQRes.body.data.exam.totalMarks, 10);

    // Update Q1 marks from 4 -> 5 via PATCH /api/exams/:id/questions/:questionId
    const editQRes = await apiRequest(
      'PATCH',
      `/api/exams/${examId}/questions/${q1Id}`,
      { marks: 5 },
      teacherAToken
    );
    assert.strictEqual(editQRes.status, 200);
    assert.strictEqual(editQRes.body.data.exam.totalMarks, 11);

    // Remove Q2 via DELETE /api/exams/:id/questions/:questionId
    const delQRes = await apiRequest(
      'DELETE',
      `/api/exams/${examId}/questions/${q2Id}`,
      undefined,
      teacherAToken
    );
    assert.strictEqual(delQRes.status, 200);
    assert.strictEqual(delQRes.body.data.exam.totalMarks, 5);

    // Create Q3 (5 marks) in Question Bank and attach to exam -> totalMarks = 5 + 5 = 10
    const q3Res = await apiRequest(
      'POST',
      '/api/questions',
      {
        questionText: 'Which system call creates a new process in Unix?',
        subject: 'Operating Systems',
        topic: 'Processes',
        difficulty: 'EASY',
        marks: 5,
        options: [
          { key: 'A', text: 'fork()' },
          { key: 'B', text: 'exec()' },
          { key: 'C', text: 'wait()' },
          { key: 'D', text: 'exit()' }
        ],
        correctOption: 'A'
      },
      teacherAToken
    );
    assert.strictEqual(q3Res.status, 201);
    const q3Id = q3Res.body.data.question.questionId;

    const addQ3Res = await apiRequest(
      'POST',
      `/api/exams/${examId}/questions`,
      { questionIds: [q3Id] },
      teacherAToken
    );
    assert.strictEqual(addQ3Res.status, 200);
    assert.strictEqual(addQ3Res.body.data.exam.totalMarks, 10);
    console.log('✓ 3. Server-side marks calculation & question management passed');

    // 5. RBAC & Lifecycle transitions
    const teacherBHack = await apiRequest(
      'PATCH',
      `/api/exams/${examId}`,
      { title: 'Hacked Title' },
      teacherBToken
    );
    assert.strictEqual(teacherBHack.status, 403, 'Teacher B must not modify Teacher A exam');

    const unauthorizedStudentAssign = await apiRequest(
      'POST',
      `/api/exams/${examId}/assign`,
      { studentIds: [student2Id] },
      teacherAToken
    );
    assert.strictEqual(
      unauthorizedStudentAssign.status,
      403,
      'Teacher A must not assign unsupervised Student 2'
    );

    const assignRes = await apiRequest(
      'POST',
      `/api/exams/${examId}/assign`,
      { studentIds: [student1Id] },
      teacherAToken
    );
    assert.strictEqual(assignRes.status, 200);

    // DRAFT exam hidden from assigned student
    const draftStudentView = await apiRequest('GET', '/api/student/exams', undefined, student1Token);
    assert.strictEqual(
      draftStudentView.body.data.exams.some((e: any) => e.examId === examId),
      false,
      'DRAFT exam must not be visible to student'
    );

    // Invalid direct jump DRAFT -> LIVE rejected
    const invalidDraftToLive = await apiRequest(
      'PATCH',
      `/api/exams/${examId}/status`,
      { status: 'LIVE' },
      teacherAToken
    );
    assert.strictEqual(invalidDraftToLive.status, 400, 'Direct DRAFT -> LIVE jump must be rejected');

    // Valid transition DRAFT -> SCHEDULED
    const scheduleRes = await apiRequest(
      'PATCH',
      `/api/exams/${examId}/status`,
      { status: 'SCHEDULED' },
      teacherAToken
    );
    assert.strictEqual(scheduleRes.status, 200);
    assert.strictEqual(scheduleRes.body.data.exam.status, 'SCHEDULED');

    // Student sees SCHEDULED exam but cannot start it yet
    const scheduledStudentView = await apiRequest(
      'GET',
      '/api/student/exams',
      undefined,
      student1Token
    );
    assert.strictEqual(
      scheduledStudentView.body.data.exams.some((e: any) => e.examId === examId),
      true,
      'SCHEDULED exam must be visible to assigned student'
    );

    const earlyStartRes = await apiRequest(
      'POST',
      `/api/student/exams/${examId}/start`,
      {},
      student1Token
    );
    assert.strictEqual(earlyStartRes.status, 400, 'Student cannot start SCHEDULED exam before LIVE');

    // Valid transition SCHEDULED -> LIVE
    const liveRes = await apiRequest(
      'PATCH',
      `/api/exams/${examId}/status`,
      { status: 'LIVE' },
      teacherAToken
    );
    assert.strictEqual(liveRes.status, 200);
    assert.strictEqual(liveRes.body.data.exam.status, 'LIVE');

    // Unassigned Student 2 cannot start LIVE exam
    const unassignedStart = await apiRequest(
      'POST',
      `/api/student/exams/${examId}/start`,
      {},
      student2Token
    );
    assert.strictEqual(unassignedStart.status, 403);

    // Assigned Student 1 starts and submits LIVE exam
    const startRes = await apiRequest(
      'POST',
      `/api/student/exams/${examId}/start`,
      {},
      student1Token
    );
    assert.strictEqual(startRes.status, 201);
    const attemptId = startRes.body.data.attempt.attemptId;
    const questionsDelivered = startRes.body.data.questions;
    assert.strictEqual(questionsDelivered.length, 2);

    const submitRes = await apiRequest(
      'POST',
      `/api/student/attempts/${attemptId}/submit`,
      {
        answers: [
          { questionId: questionsDelivered[0].questionId, selectedOption: 'B' },
          { questionId: questionsDelivered[1].questionId, selectedOption: 'A' }
        ]
      },
      student1Token
    );
    assert.strictEqual(submitRes.status, 200);

    // Valid transition LIVE -> ENDED
    const endRes = await apiRequest(
      'PATCH',
      `/api/exams/${examId}/status`,
      { status: 'ENDED' },
      teacherAToken
    );
    assert.strictEqual(endRes.status, 200);
    assert.strictEqual(endRes.body.data.exam.status, 'ENDED');

    // Valid transition ENDED -> RESULT_PUBLISHED
    const publishResultRes = await apiRequest(
      'PATCH',
      `/api/exams/${examId}/status`,
      { status: 'RESULT_PUBLISHED', publishResults: true },
      teacherAToken
    );
    assert.strictEqual(publishResultRes.status, 200);
    assert.strictEqual(publishResultRes.body.data.exam.status, 'RESULT_PUBLISHED');

    // Student 1 sees published result with 10/10 marks
    const studentResultsRes = await apiRequest(
      'GET',
      '/api/student/results',
      undefined,
      student1Token
    );
    assert.strictEqual(studentResultsRes.status, 200);
    const publishedExamResult = studentResultsRes.body.data.results.find(
      (r: any) => r.examId === examId
    );
    assert.ok(publishedExamResult, 'Published result must be returned to student');
    assert.strictEqual(publishedExamResult.score, 10);
    assert.strictEqual(publishedExamResult.totalMarks, 10);
    console.log('✓ 4. RBAC, lifecycle transitions, student attempt, and result publication passed');

    // Clean up test artifacts
    await Exam.deleteMany({ examId });
    await ExamAssignment.deleteMany({ examId });
    await Question.deleteMany({ createdBy: teacherAId });
    await User.deleteMany({ userId: { $in: [teacherAId, teacherBId, student1Id, student2Id] } });

    console.log('--- ALL PHASE 1.5 STRICT EXAM LIFECYCLE TESTS PASSED! ---');
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    await disconnectDatabase();
  }
}

runPhase15Tests().catch(err => {
  console.error('Phase 1.5 test suite failed:', err);
  process.exit(1);
});
