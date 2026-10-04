import assert from 'assert';
import http from 'http';
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
import { Syllabus } from '../src/models/Syllabus';
import { ENV } from '../src/config/env';
import { AiQuestionService } from '../src/services/ai.service';

async function runMasterE2ETests() {
  console.log('=== STARTING EXAMX MASTER REMAINING THREE-ROLE E2E INTEGRATION TEST ===');

  await connectDatabase();
  await seedAdmin();

  const app = createApp();
  const server = http.createServer(app);
  await new Promise<void>(resolve => server.listen(0, resolve));
  const address = server.address() as any;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  async function apiRequest(method: string, path: string, body?: any, token?: string) {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
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
    // -------------------------------------------------------------
    // STEP 1: ADMIN LOGIN & DIRECTORY PROVISIONING
    // -------------------------------------------------------------
    const adminLogin = await apiRequest('POST', '/api/auth/login', {
      userId: ENV.ADMIN_USER_ID,
      password: ENV.ADMIN_INITIAL_PASSWORD
    });
    assert.strictEqual(adminLogin.status, 200, 'Admin login must succeed');
    const adminToken = adminLogin.body.data.token;
    assert.ok(adminToken, 'Admin token must be returned');

    // Clean any previous artifacts with test emails
    await User.deleteMany({ email: { $in: ['e2e_teacher@examx.edu', 'e2e_student@examx.edu'] } });

    // Admin provisions a Teacher
    const teacherCreateRes = await apiRequest(
      'POST',
      '/api/users/teachers',
      {
        name: 'Dr. Vikram Chandra',
        dob: '1982-04-18',
        email: 'e2e_teacher@examx.edu',
        department: 'Computer Science & Engineering',
        designation: 'Professor'
      },
      adminToken
    );
    assert.strictEqual(teacherCreateRes.status, 201, 'Teacher creation must succeed');
    const teacherId = teacherCreateRes.body.data.teacher.userId;
    const teacherPass = teacherCreateRes.body.data.initialCredentials.temporaryPassword;
    assert.ok(teacherId, 'Teacher userId must be generated');
    assert.ok(teacherPass, 'Teacher initial password must be generated');

    // Teacher logs in with generated credentials
    const teacherLogin = await apiRequest('POST', '/api/auth/login', {
      userId: teacherId,
      password: teacherPass
    });
    assert.strictEqual(teacherLogin.status, 200, 'Teacher login must succeed');
    const teacherToken = teacherLogin.body.data.token;

    // Teacher provisions Student under their supervision
    const studentCreateRes = await apiRequest(
      'POST',
      '/api/users/students',
      {
        name: 'Ishaan Verma',
        dob: '2004-11-25',
        email: 'e2e_student@examx.edu',
        department: 'Computer Science & Engineering',
        course: 'B.Tech CSE',
        semester: 'Semester 4'
      },
      teacherToken
    );
    assert.strictEqual(studentCreateRes.status, 201, 'Student creation must succeed');
    const studentId = studentCreateRes.body.data.student.userId;
    const studentPass = studentCreateRes.body.data.initialCredentials.temporaryPassword;

    // Student logs in with generated credentials
    const studentLogin = await apiRequest('POST', '/api/auth/login', {
      userId: studentId,
      password: studentPass
    });
    assert.strictEqual(studentLogin.status, 200, 'Student login must succeed');
    const studentToken = studentLogin.body.data.token;

    console.log('✓ Step 1: Admin, Teacher, and Student authentication & accounts verified');

    // -------------------------------------------------------------
    // STEP 2: QUESTION BANK & AI SYLLABUS QUESTION WORKFLOW
    // -------------------------------------------------------------
    // Manual Question Creation by Teacher (5 marks)
    const manualQRes = await apiRequest(
      'POST',
      '/api/questions',
      {
        questionText: 'What is the primary objective of a database index?',
        subject: 'Database Management Systems',
        topic: 'Indexing',
        difficulty: 'MEDIUM',
        marks: 5,
        options: [
          { key: 'A', text: 'To speed up data retrieval operations' },
          { key: 'B', text: 'To encrypt sensitive tables' },
          { key: 'C', text: 'To automatically compress binary logs' },
          { key: 'D', text: 'To prevent duplicate foreign keys' }
        ],
        correctOption: 'A',
        explanation: 'Indexes minimize disk block reads during queries.'
      },
      teacherToken
    );
    assert.strictEqual(manualQRes.status, 201, 'Manual question creation must succeed');
    const manualQId = manualQRes.body.data.question.questionId;
    assert.strictEqual(manualQRes.body.data.question.marks, 5);

    const syllabusText = `UNIT IV: Transaction Management and Concurrency Control.
ACID properties: Atomicity ensures all-or-nothing execution of transactions, Consistency preserves database invariants, Isolation ensures concurrent transactions execute without interference, Durability guarantees committed changes persist.
Serializability and Concurrency: Conflict serializability and view serializability with precedence graphs.
Locking Protocols: Two-phase locking (2PL) protocol ensures conflict serializability with growing and shrinking phases; Strict 2PL prevents cascading aborts.
Deadlock Management: Deadlock prevention with wait-die and wound-wait schemes, deadlock detection using wait-for graphs, and deadlock recovery via victim selection and rollback.
Timestamp Ordering Protocol: Thomas write rule and multiversion concurrency control schemes.`;
    const syllabusUpload = await apiRequest('POST', '/api/ai/syllabus/upload', {
      fileName: 'DBMS_Unit_IV.txt',
      fileBase64: Buffer.from(syllabusText, 'utf8').toString('base64'),
      mimeType: 'text/plain',
      subject: 'Database Management Systems',
      course: 'B.Tech CSE',
      semester: 'Semester 4'
    }, teacherToken);
    assert.strictEqual(syllabusUpload.status, 201);
    const selectedQuestionIds = [manualQId];
    const expectedAnswers = [{ questionId: manualQId, selectedOption: 'A' }];

    if (!AiQuestionService.isConfigured()) {
      const noKeyResponse = await apiRequest('POST', '/api/ai/questions/generate', {
        syllabusId: syllabusUpload.body.data.syllabusId,
        subject: 'Database Management Systems',
        topic: 'Concurrency Control',
        course: 'B.Tech CSE',
        semester: 'Semester 4',
        difficulty: 'HARD',
        count: 1,
        marks: 5
      }, teacherToken);
      assert.strictEqual(noKeyResponse.status, 503);
      assert.strictEqual(noKeyResponse.body.code, 'AI_GENERATION_NOT_CONFIGURED');
      console.log('ℹ Step 2: LIVE_GEMINI_NOT_CONFIGURED; no question drafts were fabricated.');
    } else {
      const aiGenRes = await apiRequest('POST', '/api/ai/questions/generate', {
        syllabusId: syllabusUpload.body.data.syllabusId,
        subject: 'Database Management Systems',
        topic: 'Concurrency Control',
        course: 'B.Tech CSE',
        semester: 'Semester 4',
        difficulty: 'HARD',
        count: 2,
        marks: 5
      }, teacherToken);
      if (aiGenRes.status === 200) {
        const drafts = aiGenRes.body.data.generated || aiGenRes.body.data.questions || [];
        assert.strictEqual(drafts.length, 2);
        assert.strictEqual(drafts[0].reviewStatus, 'PENDING_TEACHER_REVIEW');
        assert(drafts[0].sourceReference && drafts[0].syllabusUnit && drafts[0].syllabusTopic);
        const approvalRes = await apiRequest('POST', `/api/ai/questions/drafts/${drafts[0].questionId}/approve`, undefined, teacherToken);
        assert.strictEqual(approvalRes.status, 200);
        assert.strictEqual(approvalRes.body.data.question.questionId, drafts[0].questionId);
        assert.strictEqual(approvalRes.body.data.question.status, 'ACTIVE');
        selectedQuestionIds.push(drafts[0].questionId);
        expectedAnswers.push({ questionId: drafts[0].questionId, selectedOption: drafts[0].correctOption });
      } else {
        assert([400, 401, 403, 429, 500, 502, 503].includes(aiGenRes.status), 'Provider failures must retain a real provider error status');
        assert.strictEqual(
          await Question.countDocuments({ syllabusId: syllabusUpload.body.data.syllabusId }),
          0,
          'A failed provider generation must not persist any AI questions'
        );
        console.log(`ℹ Live AI provider returned ${aiGenRes.status}; no generated questions were persisted.`);
      }
    }

    console.log('✓ Step 2: Question Bank & AI syllabus question generation review/approval verified');

    // -------------------------------------------------------------
    // STEP 3: EXAM CREATION, MARKS CALCULATION & LIFECYCLE
    // -------------------------------------------------------------
    const now = Date.now();
    const startIso = new Date(now - 300_000).toISOString(); // 5m in past
    const endIso = new Date(now + 3600_000).toISOString();   // 1 hour in future

    // Create DRAFT exam with zero questions
    const examCreateRes = await apiRequest(
      'POST',
      '/api/exams',
      {
        title: 'DBMS Comprehensive Midterm',
        subject: 'Database Management Systems',
        course: 'B.Tech CSE',
        semester: 'Semester 4',
        durationMinutes: 45,
        questionIds: [],
        startTime: startIso,
        endTime: endIso
      },
      teacherToken
    );
    assert.strictEqual(examCreateRes.status, 201, 'Exam creation must return 201');
    const exam = examCreateRes.body.data.exam;
    const examId = exam.examId;
    assert.strictEqual(exam.status, 'DRAFT', 'Default status must be DRAFT');
    assert.strictEqual(exam.totalMarks, 0, 'Zero-question DRAFT must have 0 totalMarks');

    // Attach the teacher-created question and any genuinely generated, approved AI question.
    const attachRes = await apiRequest(
      'POST',
      `/api/exams/${examId}/questions`,
      { questionIds: selectedQuestionIds },
      teacherToken
    );
    assert.strictEqual(attachRes.status, 200);
    assert.strictEqual(attachRes.body.data.exam.totalMarks, selectedQuestionIds.length * 5);
    assert.strictEqual(attachRes.body.data.exam.questionCount, selectedQuestionIds.length);

    // Assign student under supervision
    const assignRes = await apiRequest(
      'POST',
      `/api/exams/${examId}/assign`,
      { studentIds: [studentId] },
      teacherToken
    );
    assert.strictEqual(assignRes.status, 200, 'Student assignment must succeed');

    // Transition: DRAFT -> SCHEDULED
    const scheduleRes = await apiRequest(
      'PATCH',
      `/api/exams/${examId}/status`,
      { status: 'SCHEDULED' },
      teacherToken
    );
    assert.strictEqual(scheduleRes.status, 200);
    assert.strictEqual(scheduleRes.body.data.exam.status, 'SCHEDULED');

    // Transition: SCHEDULED -> LIVE
    const liveRes = await apiRequest(
      'PATCH',
      `/api/exams/${examId}/status`,
      { status: 'LIVE' },
      teacherToken
    );
    assert.strictEqual(liveRes.status, 200);
    assert.strictEqual(liveRes.body.data.exam.status, 'LIVE');

    console.log('✓ Step 3: Exam creation, marks calculation & lifecycle state transitions verified');

    // -------------------------------------------------------------
    // STEP 4: STUDENT EXAM ATTEMPT, AUTO-SAVE & PROCTORING
    // -------------------------------------------------------------
    // Student starts attempt
    const attemptStartRes = await apiRequest(
      'POST',
      `/api/student/exams/${examId}/start`,
      {},
      studentToken
    );
    assert.strictEqual(attemptStartRes.status, 201, 'Student must be able to start LIVE exam');
    const attemptId = attemptStartRes.body.data.attempt.attemptId;
    const questions = attemptStartRes.body.data.questions;
    assert.strictEqual(questions.length, selectedQuestionIds.length);
    // Ensure student does NOT see correctAnswer or correctOption
    assert.strictEqual((questions[0] as any).correctAnswer, undefined);
    assert.strictEqual((questions[0] as any).correctOption, undefined);

    // Save in-progress answers
    const saveAnswersRes = await apiRequest(
      'PATCH',
      `/api/attempts/${attemptId}/answers`,
      {
        answers: expectedAnswers.map((answer, index) => ({
          ...answer,
          markedForReview: index === 1
        }))
      },
      studentToken
    );
    assert.strictEqual(saveAnswersRes.status, 200, 'Saving in-progress answers must succeed');

    // Record browser proctoring event
    const proctorEventRes = await apiRequest(
      'POST',
      '/api/proctoring/events',
      {
        attemptId,
        examId,
        eventType: 'TAB_SWITCH',
        severity: 'MEDIUM',
        details: 'Candidate navigated away from examination tab.'
      },
      studentToken
    );
    assert.strictEqual(proctorEventRes.status, 201, 'Proctoring event logging must succeed');

    // Submit attempt
    const submitRes = await apiRequest(
      'POST',
      `/api/attempts/${attemptId}/submit`,
      {
        answers: expectedAnswers
      },
      studentToken
    );
    assert.strictEqual(submitRes.status, 200, 'Attempt submission must succeed');
    assert.strictEqual(submitRes.body.data.attempt.status, 'EVALUATED');
    const expectedScore = selectedQuestionIds.length * 5;
    assert.strictEqual(submitRes.body.data.attempt.score, expectedScore);

    console.log('✓ Step 4: Student attempt, answer save, proctoring & server-side scoring verified');

    // -------------------------------------------------------------
    // STEP 5: EXAM CLOSURE, RESULT PUBLICATION & STUDENT VISIBILITY
    // -------------------------------------------------------------
    // Teacher sets exam to ENDED
    const endExamRes = await apiRequest(
      'PATCH',
      `/api/exams/${examId}/status`,
      { status: 'ENDED' },
      teacherToken
    );
    assert.strictEqual(endExamRes.status, 200);

    // Student cannot see results before publication
    const prePubResults = await apiRequest('GET', '/api/student/results', undefined, studentToken);
    assert.strictEqual(prePubResults.status, 200);
    assert.strictEqual(
      prePubResults.body.data.results.some((r: any) => r.examId === examId),
      false,
      'Unpublished results must not be exposed to student'
    );

    // Teacher publishes results
    const publishRes = await apiRequest(
      'PATCH',
      `/api/exams/${examId}/status`,
      { status: 'RESULT_PUBLISHED', publishResults: true },
      teacherToken
    );
    assert.strictEqual(publishRes.status, 200);
    assert.strictEqual(publishRes.body.data.exam.status, 'RESULT_PUBLISHED');

    // Student can now view their published result
    const postPubResults = await apiRequest('GET', '/api/student/results', undefined, studentToken);
    assert.strictEqual(postPubResults.status, 200);
    const studentResult = postPubResults.body.data.results.find((r: any) => r.examId === examId);
    assert.ok(studentResult, 'Published result must be accessible to candidate');
    assert.strictEqual(studentResult.score, expectedScore);
    assert.strictEqual(studentResult.totalMarks, expectedScore);
    assert.strictEqual(studentResult.passed, true);

    console.log('✓ Step 5: Exam closure, result publication & candidate result access verified');

    // -------------------------------------------------------------
    // STEP 6: STUDENT QUERY SYSTEM & TEACHER RESOLUTION
    // -------------------------------------------------------------
    const createQueryRes = await apiRequest(
      'POST',
      '/api/queries',
      {
        examId,
        questionId: questions[0].questionId,
        questionText: questions[0].questionText,
        reasonType: 'AMBIGUOUS_QUESTION',
        explanation: 'Please clarify the expected interpretation of this question.'
      },
      studentToken
    );
    assert.strictEqual(createQueryRes.status, 201, 'Student query creation must return 201');
    const queryId = createQueryRes.body.data.query.queryId;

    // Teacher views queries for their exam
    const teacherQueriesRes = await apiRequest('GET', '/api/queries', undefined, teacherToken);
    assert.strictEqual(teacherQueriesRes.status, 200);
    const foundQuery = teacherQueriesRes.body.data.queries.find((q: any) => q.queryId === queryId);
    assert.ok(foundQuery, 'Teacher must see submitted query');

    // Teacher resolves query
    const resolveQueryRes = await apiRequest(
      'PATCH',
      `/api/queries/${queryId}/resolve`,
      {
        status: 'RESOLVED_ACCEPTED',
        response: 'Review complete: Option A is the standard formal textbook definition, credit awarded.',
        scoreAdjustment: 0
      },
      teacherToken
    );
    assert.strictEqual(resolveQueryRes.status, 200, 'Teacher query resolution must succeed');

    // Student checks query response
    const studentQueriesRes = await apiRequest('GET', '/api/student/queries', undefined, studentToken);
    assert.strictEqual(studentQueriesRes.status, 200);
    const resolvedStudentQuery = studentQueriesRes.body.data.queries.find((q: any) => q.queryId === queryId);
    assert.ok(resolvedStudentQuery);
    assert.strictEqual(resolvedStudentQuery.status, 'RESOLVED_ACCEPTED');

    console.log('✓ Step 6: Student query lifecycle & faculty resolution verified');

    // -------------------------------------------------------------
    // STEP 7: SECURITY & RBAC ISOLATION MATRIX
    // -------------------------------------------------------------
    // 1. Student cannot create exams
    const studentCreateExam = await apiRequest(
      'POST',
      '/api/exams',
      { title: 'Illegal Exam', subject: 'DBMS' },
      studentToken
    );
    assert.strictEqual(studentCreateExam.status, 403, 'Student must not create exams');

    // 2. Student cannot create questions
    const studentCreateQ = await apiRequest(
      'POST',
      '/api/questions',
      { questionText: 'Hacked question' },
      studentToken
    );
    assert.strictEqual(studentCreateQ.status, 403, 'Student must not create questions');

    // 3. Student cannot access Question Bank
    const studentGetQB = await apiRequest('GET', '/api/questions', undefined, studentToken);
    assert.strictEqual(studentGetQB.status, 403, 'Student must not access Question Bank');

    // 4. Student cannot access AI generation
    const studentAiGen = await apiRequest(
      'POST',
      '/api/ai/questions/generate',
      { subject: 'DBMS' },
      studentToken
    );
    assert.strictEqual(studentAiGen.status, 403, 'Student must not access AI generation');

    // 5. Student cannot resolve queries
    const studentResolveQ = await apiRequest(
      'PATCH',
      `/api/queries/${queryId}/resolve`,
      { status: 'RESOLVED_ACCEPTED' },
      studentToken
    );
    assert.strictEqual(studentResolveQ.status, 403, 'Student must not resolve queries');

    console.log('✓ Step 7: Security & RBAC isolation matrix verified');

    // Cleanup
    await Exam.deleteMany({ examId });
    await ExamAssignment.deleteMany({ examId });
    await ExamAttempt.deleteMany({ attemptId });
    await Result.deleteMany({ examId });
    await StudentQuery.deleteMany({ queryId });
    await ProctoringEvent.deleteMany({ examId });
    await Question.deleteMany({ questionId: { $in: selectedQuestionIds } });
    await Syllabus.deleteOne({ syllabusId: syllabusUpload.body.data.syllabusId });
    await User.deleteMany({ userId: { $in: [teacherId, studentId] } });

    console.log('=== ALL MASTER E2E THREE-ROLE TESTS PASSED SUCCESSFULLY! ===');
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    await disconnectDatabase();
  }
}

runMasterE2ETests().catch(err => {
  console.error('Master E2E test failed:', err);
  process.exit(1);
});
