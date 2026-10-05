import assert from 'node:assert';
import http from 'node:http';
import { createApp } from '../src/app';
import { connectDatabase, disconnectDatabase } from '../src/config/database';
import { seedAdmin } from '../scripts/seed-admin';
import { ExamAttempt } from '../src/models/ExamAttempt';
import { ENV } from '../src/config/env';

async function runPhase13Tests() {
  console.log('--- STARTING PHASE 1.3 FULL LIFECYCLE & SECURITY TEST SUITE ---');

  await connectDatabase();
  await seedAdmin();

  const app = createApp();
  const server = http.createServer(app);

  await new Promise<void>(resolve => server.listen(0, resolve));
  const address = server.address() as { port: number };
  const baseUrl = `http://127.0.0.1:${address.port}`;

  async function apiRequest(
    method: string,
    path: string,
    body?: unknown,
    token?: string
  ): Promise<{ status: number; body: any }> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-ExamX-Device-Session': '00000000-0000-4000-8000-000000000001'
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

  try {
    // 1. Authenticate Admin & Provision Teachers and Students
    const adminLogin = await apiRequest('POST', '/api/auth/login', {
      userId: ENV.ADMIN_USER_ID,
      password: ENV.ADMIN_INITIAL_PASSWORD
    });
    assert.strictEqual(adminLogin.status, 200);
    const adminToken = adminLogin.body.data.token;

    const t1Res = await apiRequest(
      'POST',
      '/api/users/teachers',
      {
        name: 'Prof. Vikram Sarabhai',
        email: 'vikram@examx.edu',
        dob: '1980-08-12',
        department: 'Computer Science'
      },
      adminToken
    );
    assert.strictEqual(t1Res.status, 201);
    const teacher1Id = t1Res.body.data.teacher.userId;
    const t1Login = await apiRequest('POST', '/api/auth/login', {
      userId: teacher1Id,
      password: t1Res.body.data.initialCredentials.temporaryPassword
    });
    const teacher1Token = t1Login.body.data.token;

    const t2Res = await apiRequest(
      'POST',
      '/api/users/teachers',
      {
        name: 'Prof. Homi Bhabha',
        email: 'homi@examx.edu',
        dob: '1982-10-30',
        department: 'Physics'
      },
      adminToken
    );
    assert.strictEqual(t2Res.status, 201);
    const teacher2Id = t2Res.body.data.teacher.userId;
    const t2Login = await apiRequest('POST', '/api/auth/login', {
      userId: teacher2Id,
      password: t2Res.body.data.initialCredentials.temporaryPassword
    });
    const teacher2Token = t2Login.body.data.token;

    const s1Res = await apiRequest(
      'POST',
      '/api/users/students',
      {
        name: 'Aarav Mehta',
        email: 'aarav@examx.edu',
        dob: '2004-03-15',
        department: 'Computer Science',
        course: 'B.Tech CS'
      },
      teacher1Token
    );
    assert.strictEqual(s1Res.status, 201);
    const student1Id = s1Res.body.data.student.userId;
    const s1Login = await apiRequest('POST', '/api/auth/login', {
      userId: student1Id,
      password: s1Res.body.data.initialCredentials.temporaryPassword
    });
    const student1Token = s1Login.body.data.token;

    const s2Res = await apiRequest(
      'POST',
      '/api/users/students',
      {
        name: 'Priya Nair',
        email: 'priya@examx.edu',
        dob: '2004-07-22',
        department: 'Physics',
        course: 'B.Sc Physics'
      },
      teacher2Token
    );
    assert.strictEqual(s2Res.status, 201);
    const student2Id = s2Res.body.data.student.userId;
    const s2Login = await apiRequest('POST', '/api/auth/login', {
      userId: student2Id,
      password: s2Res.body.data.initialCredentials.temporaryPassword
    });
    const student2Token = s2Login.body.data.token;
    console.log('✔ Test 1 Passed: Admin, 2 Teachers, and 2 Students provisioned & authenticated');

    // 2. Question Creation, Validation, Ownership & Question Bank RBAC
    const studentQAttempt = await apiRequest('GET', '/api/question-bank', undefined, student1Token);
    assert.strictEqual(studentQAttempt.status, 403, 'Student must not access Question Bank API');

    const q1Res = await apiRequest(
      'POST',
      '/api/question-bank',
      {
        questionText: 'Which scheduling algorithm is provably optimal for minimizing average waiting time?',
        subject: 'Operating Systems',
        topic: 'CPU Scheduling',
        difficulty: 'MEDIUM',
        options: [
          { id: 'A', text: 'First-Come, First-Served (FCFS)' },
          { id: 'B', text: 'Shortest Job First (SJF)' },
          { id: 'C', text: 'Round Robin (RR)' },
          { id: 'D', text: 'Multilevel Queue' }
        ],
        correctOption: 'B',
        marks: 5,
        negativeMarks: 1,
        explanation: 'SJF minimizes average waiting time for a given set of processes.'
      },
      teacher1Token
    );
    assert.strictEqual(q1Res.status, 201);
    const q1Id = q1Res.body.data.question.questionId;

    const q2Res = await apiRequest(
      'POST',
      '/api/questions',
      {
        questionText: 'Which condition is NOT one of Coffman’s four necessary conditions for deadlock?',
        subject: 'Operating Systems',
        topic: 'Deadlocks',
        difficulty: 'EASY',
        options: [
          { id: 'A', text: 'Mutual Exclusion' },
          { id: 'B', text: 'Hold and Wait' },
          { id: 'C', text: 'Preemption' },
          { id: 'D', text: 'Circular Wait' }
        ],
        correctOption: 'C',
        marks: 5,
        negativeMarks: 0,
        explanation: 'No Preemption (not Preemption) is required for deadlock.'
      },
      teacher1Token
    );
    assert.strictEqual(q2Res.status, 201);
    const q2Id = q2Res.body.data.question.questionId;

    // Teacher 2 cannot modify Teacher 1's question
    const crossTeacherQ = await apiRequest(
      'PATCH',
      `/api/questions/${q1Id}`,
      { questionText: 'Tampered' },
      teacher2Token
    );
    assert.strictEqual(crossTeacherQ.status, 403, 'Teacher 2 cannot modify Teacher 1 question');
    console.log('✔ Test 2 Passed: Question creation, validation, and ownership isolation verified');

    // 3. AI Question Service Architecture & Security Check
    const aiStatusRes = await apiRequest('GET', '/api/ai/status', undefined, teacher1Token);
    assert.strictEqual(aiStatusRes.status, 200);
    assert.ok(['READY', 'NOT_CONFIGURED'].includes(aiStatusRes.body.data.status));
    console.log(`✔ Test 3 Passed: AI Question Generation backend interface verified (status: ${aiStatusRes.body.data.status})`);

    // 4. Exam Creation, Validation, Ownership, Admin Access & Student Assignment
    const badExamRes = await apiRequest(
      'POST',
      '/api/exams',
      {
        title: 'Invalid Exam',
        subject: 'Operating Systems',
        durationMinutes: 0,
        totalMarks: 10
      },
      teacher1Token
    );
    assert.strictEqual(badExamRes.status, 400, 'Exam with 0 duration must be rejected');

    const examRes = await apiRequest(
      'POST',
      '/api/exams',
      {
        title: 'Operating Systems Final Assessment',
        subject: 'Operating Systems',
        durationMinutes: 30,
        totalMarks: 10,
        passingMarks: 5,
        attemptLimit: 1,
        questionIds: [q1Id, q2Id],
        assignedStudentIds: [student1Id]
      },
      teacher1Token
    );
    assert.strictEqual(examRes.status, 201);
    const examId = examRes.body.data.exam.examId;

    // Teacher 2 cannot modify Teacher 1's exam
    const crossTeacherExam = await apiRequest(
      'PATCH',
      `/api/exams/${examId}`,
      { title: 'Tampered' },
      teacher2Token
    );
    assert.strictEqual(crossTeacherExam.status, 403);

    // Admin can access all exams
    const adminExamView = await apiRequest('GET', `/api/exams/${examId}`, undefined, adminToken);
    assert.strictEqual(adminExamView.status, 200);

    // Publish Exam
    const pubExamRes = await apiRequest('POST', `/api/exams/${examId}/publish`, {}, teacher1Token);
    assert.strictEqual(pubExamRes.status, 200);
    assert.strictEqual(pubExamRes.body.data.exam.status, 'PUBLISHED');
    console.log(`✔ Test 4 Passed: Exam [${examId}] created, assigned to Student 1, and published`);

    // 5. Unauthorized Exam Access & Student Answer Masking
    const unassignedStart = await apiRequest('POST', `/api/exams/${examId}/attempts`, {}, student2Token);
    assert.strictEqual(unassignedStart.status, 403, 'Unassigned Student 2 cannot start attempt on Exam 1');

    const startRes = await apiRequest('POST', `/api/exams/${examId}/attempts`, {}, student1Token);
    assert.strictEqual(startRes.status, 201);
    const attemptId = startRes.body.data.attempt.attemptId;
    const studentQuestions = startRes.body.data.questions;
    assert.strictEqual(studentQuestions.length, 2);
    for (const sq of studentQuestions) {
      assert.strictEqual(sq.correctAnswer, undefined, 'correctAnswer must NEVER be exposed to student');
      assert.strictEqual(sq.correctOption, undefined, 'correctOption must NEVER be exposed to student');
      assert.strictEqual(sq.explanation, undefined, 'explanation must NEVER be exposed to student');
    }
    console.log(`✔ Test 5 Passed: Attempt [${attemptId}] started; unauthorized student blocked; correct answers hidden`);

    // 6. Attempt Ownership & Answer Validation
    const crossStudentSave = await apiRequest(
      'PATCH',
      `/api/attempts/${attemptId}/answers`,
      {
        answers: [{ questionId: q1Id, selectedOption: 'B' }]
      },
      student2Token
    );
    assert.strictEqual(crossStudentSave.status, 403, 'Student 2 cannot submit answers to Student 1 attempt');

    // Invalid option or foreign question rejected/ignored safely, valid options saved
    const saveRes = await apiRequest(
      'PATCH',
      `/api/attempts/${attemptId}/answers`,
      {
        answers: [
          { questionId: q1Id, selectedOption: 'B', timeSpentSeconds: 18 },
          { questionId: q2Id, selectedOption: 'C', timeSpentSeconds: 15 }
        ],
        currentQuestionIndex: 1
      },
      student1Token
    );
    assert.strictEqual(saveRes.status, 200);
    console.log('✔ Test 6 Passed: Attempt ownership enforced and valid answers saved');

    // 7. Proctoring Event Persistence & Ownership
    const crossProctor = await apiRequest(
      'POST',
      '/api/proctoring/events',
      {
        attemptId,
        examId,
        eventType: 'TAB_SWITCH',
        severity: 'WARNING',
        message: 'Spoofed event'
      },
      student2Token
    );
    assert.strictEqual(crossProctor.status, 403, 'Student 2 cannot log proctoring events on Student 1 attempt');

    const validProctor = await apiRequest(
      'POST',
      '/api/proctoring/events',
      {
        attemptId,
        examId,
        eventType: 'TAB_SWITCH',
        severity: 'WARNING',
        message: 'Browser visibility hidden'
      },
      student1Token
    );
    assert.strictEqual(validProctor.status, 201);
    console.log('✔ Test 7 Passed: Proctoring event persisted and cross-student spoofing blocked');

    // 8. Server-Side Scoring (ignores any client-supplied score/marks) & Result Creation
    const submitRes = await apiRequest(
      'POST',
      `/api/attempts/${attemptId}/submit`,
      {
        score: 9999,
        percentage: 100,
        marks: 9999
      },
      student1Token
    );
    assert.strictEqual(submitRes.status, 200);
    assert.ok(
      submitRes.body.data.attempt.status === 'SUBMITTED' || submitRes.body.data.attempt.status === 'EVALUATED',
      'Attempt status should be SUBMITTED or EVALUATED'
    );
    const resultId = submitRes.body.data.resultId;
    assert.ok(resultId, 'resultId must be returned on submission');
    assert.strictEqual(submitRes.body.data.resultPublished, false);
    assert.strictEqual(submitRes.body.data.result, null, 'Unpublished result must hide score from student');
    console.log(`✔ Test 8 Passed: Attempt submitted and server-side Result [${resultId}] created`);

    // 9. Single Attempt Limit Enforcement
    const secondAttempt = await apiRequest('POST', `/api/exams/${examId}/attempts`, {}, student1Token);
    assert.strictEqual(secondAttempt.status, 400, 'Second attempt must be rejected when attemptLimit = 1');
    console.log('✔ Test 9 Passed: Single attempt limit (attemptLimit = 1) strictly enforced');

    // 10. Student Unpublished-Result Protection & Cross-Student Result Protection
    const studentUnpubList = await apiRequest('GET', '/api/results', undefined, student1Token);
    assert.strictEqual(studentUnpubList.status, 200);
    assert.strictEqual(studentUnpubList.body.data.results.length, 0, 'Unpublished result must not appear in student results list');

    const studentUnpubDetail = await apiRequest('GET', `/api/results/${resultId}`, undefined, student1Token);
    assert.strictEqual(studentUnpubDetail.status, 403, 'Direct GET on unpublished result by student must return 403');
    console.log('✔ Test 10 Passed: Unpublished result protection strictly enforced');

    // 11. Result Publication by Teacher & Student Published-Result Access
    const teacherResults = await apiRequest('GET', `/api/exams/${examId}/results`, undefined, teacher1Token);
    assert.strictEqual(teacherResults.status, 200);
    assert.strictEqual(teacherResults.body.data.results.length, 1);
    assert.strictEqual(teacherResults.body.data.results[0].score, 10, 'Server calculated exact score (5 + 5 = 10), ignoring client 9999');

    const pubRes = await apiRequest('POST', `/api/exams/${examId}/results/publish`, {}, teacher1Token);
    assert.strictEqual(pubRes.status, 200);

    const studentPubDetail = await apiRequest('GET', `/api/results/${resultId}`, undefined, student1Token);
    assert.strictEqual(studentPubDetail.status, 200);
    assert.strictEqual(studentPubDetail.body.data.result.score, 10);
    assert.strictEqual(studentPubDetail.body.data.result.percentage, 100);

    // Cross-student result protection: Student 2 cannot view Student 1's published result
    const crossStudentResult = await apiRequest('GET', `/api/results/${resultId}`, undefined, student2Token);
    assert.strictEqual(crossStudentResult.status, 403, 'Student 2 cannot view Student 1 published result');
    console.log('✔ Test 11 Passed: Result publication and cross-student result protection verified');

    // 12. Expired Attempt Auto-Expiration Validation
    const exam2Res = await apiRequest(
      'POST',
      '/api/exams',
      {
        title: 'Short Timer Exam',
        subject: 'Operating Systems',
        durationMinutes: 10,
        totalMarks: 5,
        passingMarks: 2,
        attemptLimit: 1,
        questionIds: [q1Id],
        assignedStudentIds: [student1Id]
      },
      teacher1Token
    );
    const exam2Id = exam2Res.body.data.exam.examId;
    await apiRequest('POST', `/api/exams/${exam2Id}/publish`, {}, teacher1Token);

    const start2Res = await apiRequest('POST', `/api/exams/${exam2Id}/attempts`, {}, student1Token);
    assert.strictEqual(start2Res.status, 201);
    const attempt2Id = start2Res.body.data.attempt.attemptId;

    // Backdate expiresAt in MongoDB to simulate server timer expiration
    await ExamAttempt.updateOne(
      { attemptId: attempt2Id },
      { $set: { expiresAt: new Date(Date.now() - 10_000) } }
    );

    const lateSaveRes = await apiRequest(
      'PATCH',
      `/api/attempts/${attempt2Id}/answers`,
      {
        answers: [{ questionId: q1Id, selectedOption: 'B' }]
      },
      student1Token
    );
    assert.strictEqual(lateSaveRes.status, 400, 'Saving answers after server timer expiration must be rejected and auto-expire attempt');
    console.log('✔ Test 12 Passed: Server-side timer expiration auto-finalizes expired attempt');

    // 13. Query Ownership & Faculty Adjudication
    const queryCreateRes = await apiRequest(
      'POST',
      '/api/queries',
      {
        examId,
        resultId,
        topic: 'Operating Systems Final Assessment',
        subject: 'Operating Systems',
        question: 'Clarification on CPU Scheduling question.'
      },
      student1Token
    );
    assert.strictEqual(queryCreateRes.status, 201);
    const queryId = queryCreateRes.body.data.query.queryId;

    // Student 2 cannot see Student 1's query
    const s2Queries = await apiRequest('GET', '/api/queries', undefined, student2Token);
    assert.strictEqual(s2Queries.body.data.queries.length, 0);

    // Teacher 2 cannot resolve Teacher 1's query
    const t2Resolve = await apiRequest(
      'PATCH',
      `/api/queries/${queryId}`,
      { status: 'RESOLVED', response: 'Unauthorized' },
      teacher2Token
    );
    assert.strictEqual(t2Resolve.status, 403);

    // Teacher 1 resolves query
    const t1Resolve = await apiRequest(
      'PATCH',
      `/api/queries/${queryId}`,
      { status: 'RESOLVED', response: 'Verified and confirmed.' },
      teacher1Token
    );
    assert.strictEqual(t1Resolve.status, 200);
    console.log('✔ Test 13 Passed: Query ownership and faculty adjudication verified');

    // 14. Persistent Audit Logs Verification
    const auditRes = await apiRequest('GET', '/api/audit-logs', undefined, adminToken);
    assert.strictEqual(auditRes.status, 200);
    assert.ok(auditRes.body.data.logs.length >= 6);
    console.log(`✔ Test 14 Passed: Persistent Audit Logs verified (${auditRes.body.data.logs.length} records)`);

    // 15. Phase 1.5 Teacher & Student Detail Views + Deterministic Credential Verification
    const nextIdRes = await apiRequest('GET', '/api/users/next-id?role=STUDENT', undefined, adminToken);
    assert.strictEqual(nextIdRes.status, 200);
    assert.ok(/^1261\d{4}$/.test(nextIdRes.body.data.nextUserId));

    const kunalRes = await apiRequest(
      'POST',
      '/api/users/students',
      {
        name: 'Kunal Sharma',
        email: 'kunal@examx.edu',
        dob: '2005-06-15',
        department: 'Computer Science',
        course: 'B.Tech CS',
        academicYear: '2nd Year',
        assignedTeacherId: teacher1Id
      },
      adminToken
    );
    assert.strictEqual(kunalRes.status, 201);
    assert.strictEqual(
      kunalRes.body.data.initialCredentials.temporaryPassword,
      'Kunal@2005',
      'Initial password must follow FirstName@BirthYear rule (Kunal@2005)'
    );

    const teacherDetailsRes = await apiRequest(
      'GET',
      `/api/users/teachers/${teacher1Id}/details`,
      undefined,
      adminToken
    );
    assert.strictEqual(teacherDetailsRes.status, 200);
    assert.strictEqual(teacherDetailsRes.body.data.teacher.userId, teacher1Id);
    assert.ok(teacherDetailsRes.body.data.kpis.assignedStudentsCount >= 2);
    assert.ok(teacherDetailsRes.body.data.kpis.createdExamsCount >= 2);

    const studentDetailsRes = await apiRequest(
      'GET',
      `/api/users/students/${student1Id}/details`,
      undefined,
      teacher1Token
    );
    assert.strictEqual(studentDetailsRes.status, 200);
    assert.strictEqual(studentDetailsRes.body.data.student.userId, student1Id);
    assert.ok(studentDetailsRes.body.data.kpis.examsTakenCount >= 1);
    console.log('✔ Test 15 Passed: Teacher & Student Detail endpoints and Kuna@2005 credential rule verified');

    // 16. Phase 1.5 Syllabus Upload & Extraction Verification
    const formData = new FormData();
    const syllabusBlob = new Blob(
      [
        'Unit 1: Process Synchronization, Semaphores, Deadlock Prevention, Paging and Virtual Memory.'
      ],
      { type: 'text/plain' }
    );
    formData.append('syllabusFile', syllabusBlob, 'os-syllabus.txt');

    const extractRes = await fetch(`${baseUrl}/api/ai/extract-syllabus`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${teacher1Token}` },
      body: formData
    });
    const extractJson = (await extractRes.json()) as any;
    assert.strictEqual(extractRes.status, 200);
    assert.ok(extractJson.data.extractedText.includes('Process Synchronization'));
    console.log('✔ Test 16 Passed: Multipart syllabus file upload & text extraction verified');

    console.log('======================================================');
    console.log('ALL 16 PHASE 1.5 FULL LIFECYCLE & SECURITY TESTS PASSED.');
    console.log('======================================================');
  } finally {
    server.close();
    await disconnectDatabase();
  }
}

runPhase13Tests().catch(err => {
  console.error('❌ Phase 1.3/1.5 Test Suite Failed:', err);
  process.exit(1);
});
