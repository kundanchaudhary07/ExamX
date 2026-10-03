import assert from 'assert';
import http from 'http';
import { createApp } from '../src/app';
import { connectDatabase, disconnectDatabase } from '../src/config/database';
import { seedAdmin } from '../scripts/seed-admin';
import { User } from '../src/models/User';
import { Question } from '../src/models/Question';
import { Syllabus } from '../src/models/Syllabus';
import { Exam } from '../src/models/Exam';
import { ENV } from '../src/config/env';

async function runPhase17QuestionBankAiTests() {
  console.log('--- STARTING PHASE 1.7 QUESTION BANK & AI SYLLABUS GENERATION TEST SUITE ---');

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
    // 1. SETUP: Authenticate Admin & Provision Teacher A, Teacher B, Student 1
    const adminLogin = await apiRequest('POST', '/api/auth/login', {
      userId: ENV.ADMIN_USER_ID,
      password: ENV.ADMIN_INITIAL_PASSWORD
    });
    assert.strictEqual(adminLogin.status, 200, 'Admin login should succeed');
    const adminToken = adminLogin.body.data.token;

    // Clean any prior test accounts
    await User.deleteMany({
      email: { $in: ['t1_p17@examx.edu', 't2_p17@examx.edu', 's1_p17@examx.edu'] }
    });

    const tARes = await apiRequest(
      'POST',
      '/api/users/teachers',
      {
        name: 'Prof. Ada Lovelace',
        dob: '1980-12-10',
        email: 't1_p17@examx.edu',
        department: 'Computer Science & Engineering',
        designation: 'Professor'
      },
      adminToken
    );
    assert.strictEqual(tARes.status, 201);
    const teacherAId = tARes.body.data.teacher.userId;
    const teacherAPass = tARes.body.data.credentials.password;

    const tBRes = await apiRequest(
      'POST',
      '/api/users/teachers',
      {
        name: 'Prof. Alan Turing',
        dob: '1982-06-23',
        email: 't2_p17@examx.edu',
        department: 'Information Technology',
        designation: 'Associate Professor'
      },
      adminToken
    );
    assert.strictEqual(tBRes.status, 201);
    const teacherBId = tBRes.body.data.teacher.userId;
    const teacherBPass = tBRes.body.data.credentials.password;

    const tALogin = await apiRequest('POST', '/api/auth/login', { userId: teacherAId, password: teacherAPass });
    assert.strictEqual(tALogin.status, 200);
    const teacherAToken = tALogin.body.data.token;

    const tBLogin = await apiRequest('POST', '/api/auth/login', { userId: teacherBId, password: teacherBPass });
    assert.strictEqual(tBLogin.status, 200);
    const teacherBToken = tBLogin.body.data.token;

    const s1Res = await apiRequest(
      'POST',
      '/api/users/students',
      {
        name: 'Student Alice',
        dob: '2004-01-15',
        email: 's1_p17@examx.edu',
        department: 'Computer Science & Engineering',
        course: 'B.Tech CSE',
        semester: 'Semester 4'
      },
      teacherAToken
    );
    assert.strictEqual(s1Res.status, 201);
    const student1Id = s1Res.body.data.student.userId;
    const student1Pass = s1Res.body.data.credentials.password;

    const s1Login = await apiRequest('POST', '/api/auth/login', { userId: student1Id, password: student1Pass });
    assert.strictEqual(s1Login.status, 200);
    const student1Token = s1Login.body.data.token;

    console.log('✓ 1. Roles and authentication setup passed');

    // 2. QUESTION VALIDATION TESTS
    // 2.1 Missing / empty questionText
    const emptyTextRes = await apiRequest('POST', '/api/questions', {
      questionText: '   ',
      subject: 'Data Structures',
      options: [{ id: 'A', text: 'Option 1' }, { id: 'B', text: 'Option 2' }],
      correctOption: 'A',
      marks: 2
    }, teacherAToken);
    assert.strictEqual(emptyTextRes.status, 400);

    // 2.2 Missing / empty subject
    const emptySubRes = await apiRequest('POST', '/api/questions', {
      questionText: 'Valid Question Text Here',
      subject: '   ',
      options: [{ id: 'A', text: 'Option 1' }, { id: 'B', text: 'Option 2' }],
      correctOption: 'A',
      marks: 2
    }, teacherAToken);
    assert.strictEqual(emptySubRes.status, 400);

    // 2.3 Invalid questionType
    const badTypeRes = await apiRequest('POST', '/api/questions', {
      questionText: 'What is a Red-Black Tree?',
      subject: 'Data Structures',
      questionType: 'ESSAY',
      options: [{ id: 'A', text: 'Balanced BST' }, { id: 'B', text: 'Hash Table' }],
      correctOption: 'A',
      marks: 2
    }, teacherAToken);
    assert.strictEqual(badTypeRes.status, 400);

    // 2.4 Invalid marks (zero, negative, NaN)
    const zeroMarksRes = await apiRequest('POST', '/api/questions', {
      questionText: 'Valid Question Text Here',
      subject: 'Data Structures',
      options: [{ id: 'A', text: 'Option 1' }, { id: 'B', text: 'Option 2' }],
      correctOption: 'A',
      marks: 0
    }, teacherAToken);
    assert.strictEqual(zeroMarksRes.status, 400);

    // 2.5 Invalid options (fewer than 2, duplicate ids, missing text)
    const singleOptionRes = await apiRequest('POST', '/api/questions', {
      questionText: 'What is the time complexity of quicksort?',
      subject: 'Algorithms',
      options: [{ id: 'A', text: 'O(N log N)' }],
      correctOption: 'A',
      marks: 2
    }, teacherAToken);
    assert.strictEqual(singleOptionRes.status, 400);

    const dupOptionRes = await apiRequest('POST', '/api/questions', {
      questionText: 'What is the time complexity of quicksort?',
      subject: 'Algorithms',
      options: [{ id: 'A', text: 'O(N log N)' }, { id: 'A', text: 'O(N^2)' }],
      correctOption: 'A',
      marks: 2
    }, teacherAToken);
    assert.strictEqual(dupOptionRes.status, 400);

    // 2.6 Mismatched correctOption
    const mismatchRes = await apiRequest('POST', '/api/questions', {
      questionText: 'What is the time complexity of quicksort?',
      subject: 'Algorithms',
      options: [{ id: 'A', text: 'O(N log N)' }, { id: 'B', text: 'O(N^2)' }],
      correctOption: 'Z',
      marks: 2
    }, teacherAToken);
    assert.strictEqual(mismatchRes.status, 400);

    // 2.7 Invalid canonical course
    const badCourseRes = await apiRequest('POST', '/api/questions', {
      questionText: 'Which data structure uses LIFO ordering?',
      subject: 'Data Structures',
      course: 'NonExistentProgramXYZ',
      options: [{ id: 'A', text: 'Stack' }, { id: 'B', text: 'Queue' }],
      correctOption: 'A',
      marks: 2
    }, teacherAToken);
    assert.strictEqual(badCourseRes.status, 400);

    // 2.8 Invalid canonical semester
    const badSemRes = await apiRequest('POST', '/api/questions', {
      questionText: 'Which data structure uses LIFO ordering?',
      subject: 'Data Structures',
      semester: 'Semester 99',
      options: [{ id: 'A', text: 'Stack' }, { id: 'B', text: 'Queue' }],
      correctOption: 'A',
      marks: 2
    }, teacherAToken);
    assert.strictEqual(badSemRes.status, 400);

    // 2.9 Malformed Question ID in route
    const malformedIdRes = await apiRequest('GET', '/api/questions/invalid!@#$question%id', undefined, teacherAToken);
    assert.strictEqual(malformedIdRes.status, 400);

    console.log('✓ 2. Strict backend question validation passed');

    // 3. QUESTION CREATION & RBAC OWNERSHIP
    // 3.1 Teacher A creates Question 1
    const createQ1Res = await apiRequest('POST', '/api/questions', {
      questionText: 'Which data structure operates on a First-In-First-Out (FIFO) basis?',
      subject: 'Data Structures',
      topic: 'Linear Structures',
      course: 'B.Tech CSE',
      semester: 'Semester 4',
      difficulty: 'EASY',
      options: [
        { id: 'A', text: 'Queue' },
        { id: 'B', text: 'Stack' },
        { id: 'C', text: 'Binary Tree' },
        { id: 'D', text: 'Graph' }
      ],
      correctOption: 'A',
      marks: 2,
      explanation: 'Queue maintains FIFO order.'
    }, teacherAToken);
    assert.strictEqual(createQ1Res.status, 201);
    const q1 = createQ1Res.body.data.question;
    assert.strictEqual(q1.createdBy, teacherAId, 'CreatedBy must be authoritatively derived from Teacher A JWT');
    assert.strictEqual(q1.status, 'ACTIVE');
    assert.strictEqual(q1.course, 'B.Tech CSE');
    assert.strictEqual(q1.semester, 'Semester 4');
    const q1Id = q1.questionId;

    // 3.2 Teacher B creates Question 2
    const createQ2Res = await apiRequest('POST', '/api/questions', {
      questionText: 'Which protocol functions at the Transport layer of the OSI model?',
      subject: 'Computer Networks',
      topic: 'Transport Layer',
      course: 'B.Tech IT',
      semester: 'Semester 5',
      difficulty: 'MEDIUM',
      options: [
        { id: 'A', text: 'TCP' },
        { id: 'B', text: 'IP' },
        { id: 'C', text: 'HTTP' },
        { id: 'D', text: 'Ethernet' }
      ],
      correctOption: 'A',
      marks: 3,
      explanation: 'TCP operates at layer 4 (Transport).'
    }, teacherBToken);
    assert.strictEqual(createQ2Res.status, 201);
    const q2Id = createQ2Res.body.data.question.questionId;

    // 3.3 Student attempts to access /api/questions -> Must be 403 Forbidden
    const studentGetRes = await apiRequest('GET', '/api/questions', undefined, student1Token);
    assert.strictEqual(studentGetRes.status, 403, 'Student must receive 403 on Question Bank GET');
    const studentPostRes = await apiRequest('POST', '/api/questions', {
      questionText: 'Hacked question',
      subject: 'Math',
      options: [{ id: 'A', text: '1' }, { id: 'B', text: '2' }],
      correctOption: 'A'
    }, student1Token);
    assert.strictEqual(studentPostRes.status, 403, 'Student must receive 403 on Question Bank POST');

    // 3.4 Teacher A cannot view Teacher B question
    const crossViewRes = await apiRequest('GET', `/api/questions/${q2Id}`, undefined, teacherAToken);
    assert.strictEqual(crossViewRes.status, 403, 'Teacher A must receive 403 when trying to view Teacher B question');

    // 3.5 Teacher A cannot edit Teacher B question
    const crossEditRes = await apiRequest('PATCH', `/api/questions/${q2Id}`, { marks: 5 }, teacherAToken);
    assert.strictEqual(crossEditRes.status, 403, 'Teacher A must receive 403 when trying to edit Teacher B question');

    // 3.6 Teacher A cannot delete Teacher B question
    const crossDeleteRes = await apiRequest('DELETE', `/api/questions/${q2Id}`, undefined, teacherAToken);
    assert.strictEqual(crossDeleteRes.status, 403, 'Teacher A must receive 403 when trying to delete Teacher B question');

    console.log('✓ 3. Question creation, RBAC and ownership isolation passed');

    // 4. SEARCH, FILTERING & PAGINATION
    // 4.1 Teacher A lists questions (only sees own questions)
    const listRes = await apiRequest('GET', '/api/questions', undefined, teacherAToken);
    assert.strictEqual(listRes.status, 200);
    assert(Array.isArray(listRes.body.data.questions));
    assert(listRes.body.data.questions.every((q: any) => q.createdBy === teacherAId));

    // 4.2 Search by text
    const searchRes = await apiRequest('GET', '/api/questions?search=FIFO', undefined, teacherAToken);
    assert.strictEqual(searchRes.status, 200);
    assert.strictEqual(searchRes.body.data.questions.length, 1);
    assert.strictEqual(searchRes.body.data.questions[0].questionId, q1Id);

    // 4.3 Filter by course and semester
    const filterCourseRes = await apiRequest('GET', '/api/questions?course=B.Tech%20CSE&semester=Semester%204', undefined, teacherAToken);
    assert.strictEqual(filterCourseRes.status, 200);
    assert.strictEqual(filterCourseRes.body.data.questions.length, 1);

    // 4.4 Pagination parameters
    const pageRes = await apiRequest('GET', '/api/questions?page=1&pageSize=5', undefined, teacherAToken);
    assert.strictEqual(pageRes.status, 200);
    assert.strictEqual(pageRes.body.data.page, 1);
    assert.strictEqual(pageRes.body.data.pageSize, 5);
    assert(pageRes.body.data.total >= 1);
    assert(pageRes.body.data.totalPages >= 1);

    // 4.5 Admin can view all questions across all faculty
    const adminListRes = await apiRequest('GET', '/api/questions', undefined, adminToken);
    assert.strictEqual(adminListRes.status, 200);
    const adminQIds = adminListRes.body.data.questions.map((q: any) => q.questionId);
    assert(adminQIds.includes(q1Id), 'Admin must be able to view Teacher A question');
    assert(adminQIds.includes(q2Id), 'Admin must be able to view Teacher B question');

    console.log('✓ 4. Search, filtering, and pagination passed');

    // 5. QUESTION UPDATE SAFETY & DELETION SAFETY
    // 5.1 Owner edits own question
    const editRes = await apiRequest('PATCH', `/api/questions/${q1Id}`, {
      marks: 4,
      explanation: 'Updated explanation: Queue maintains FIFO order strictly.'
    }, teacherAToken);
    assert.strictEqual(editRes.status, 200);
    assert.strictEqual(editRes.body.data.question.marks, 4);

    // 5.2 Attach Q1 to an exam and transition exam to LIVE
    const examCreateRes = await apiRequest('POST', '/api/exams', {
      title: 'Operating Systems & Structures Midterm',
      subject: 'Data Structures',
      course: 'B.Tech CSE',
      semester: 'Semester 4',
      durationMinutes: 45,
      questions: [q1Id],
      assignedStudents: [student1Id],
      status: 'SCHEDULED',
      startTime: new Date(Date.now() - 600000).toISOString(),
      endTime: new Date(Date.now() + 7200000).toISOString()
    }, teacherAToken);
    assert.strictEqual(examCreateRes.status, 201);
    const examId = examCreateRes.body.data.exam.examId;
    assert.strictEqual(examCreateRes.body.data.exam.totalMarks, 4, 'Exam totalMarks should be 4 from question 1');

    // Transition exam to LIVE
    const liveRes = await apiRequest('PATCH', `/api/exams/${examId}/status`, { status: 'LIVE' }, teacherAToken);
    assert.strictEqual(liveRes.status, 200);

    // 5.3 Safety Check: Modifying marks/content on question attached to LIVE exam must be BLOCKED
    const blockedEditRes = await apiRequest('PATCH', `/api/questions/${q1Id}`, { marks: 10 }, teacherAToken);
    assert.strictEqual(blockedEditRes.status, 400, 'Modifying question in active/live exam must be rejected with 400');

    // 5.4 Deletion Safety Check: Deleting question attached to exam must NOT break exam; must soft-deactivate to INACTIVE
    const deleteAttachedRes = await apiRequest('DELETE', `/api/questions/${q1Id}`, undefined, teacherAToken);
    assert.strictEqual(deleteAttachedRes.status, 200);
    assert.strictEqual(deleteAttachedRes.body.data.status, 'INACTIVE');
    assert.strictEqual(deleteAttachedRes.body.data.deactivated, true);

    const recheckQ1 = await Question.findOne({ questionId: q1Id });
    assert(recheckQ1 !== null, 'Question document must still exist in DB for exam historical integrity');
    assert.strictEqual(recheckQ1.status, 'INACTIVE', 'Question status must be INACTIVE');

    // 5.5 INACTIVE question cannot be attached to newly created exams
    const createWithInactiveRes = await apiRequest('POST', '/api/exams', {
      title: 'New Exam With Inactive Question',
      subject: 'Data Structures',
      course: 'B.Tech CSE',
      semester: 'Semester 4',
      durationMinutes: 30,
      questions: [q1Id],
      status: 'SCHEDULED'
    }, teacherAToken);
    assert.strictEqual(createWithInactiveRes.status, 400, 'Cannot attach INACTIVE question to new exam');

    console.log('✓ 5. Question update safety and deletion safety passed');

    // 6. AI SYLLABUS GENERATION & APPROVAL WORKFLOW
    // 6.1 Status endpoint check
    const aiStatusRes = await apiRequest('GET', '/api/ai/status', undefined, teacherAToken);
    assert.strictEqual(aiStatusRes.status, 200);
    const expectedAiStatus = process.env.GEMINI_API_KEY ? 'READY' : 'NOT_CONFIGURED';
    assert.strictEqual(aiStatusRes.body.data.status, expectedAiStatus, 'AI status must reflect whether the Gemini provider is configured');

    // 6.2 Student access to AI generation is denied (403)
    const studentAiRes = await apiRequest('POST', '/api/ai/questions/generate', { subject: 'AI Basics' }, student1Token);
    assert.strictEqual(studentAiRes.status, 403, 'Student must not have access to AI question generation');

    // 6.3 Syllabus file extraction via plain text syllabus
    const validSyllabusText = `
UNIT I: ADVANCED DATA STRUCTURES AND ALGORITHMIC COMPLEXITY
Red-Black Trees, B-Trees, AVL Trees and Splay Trees. Invariants, rotations, amortized analysis.
Graph Algorithms: Dijkstra, Bellman-Ford, Floyd-Warshall. Minimum Spanning Trees with Kruskal and Prim.
Dynamic Programming: Matrix Chain Multiplication, Longest Common Subsequence, Knapsack Problem.
`;
    const syllabusBase64 = Buffer.from(validSyllabusText, 'utf8').toString('base64');

    const uploadRes = await apiRequest('POST', '/api/ai/syllabus/upload', {
      fileName: 'CSE301_Syllabus.txt',
      fileBase64: syllabusBase64,
      mimeType: 'text/plain',
      course: 'B.Tech CSE',
      semester: 'Semester 4',
      subject: 'Advanced Data Structures'
    }, teacherAToken);
    assert.strictEqual(uploadRes.status, 201);
    assert(uploadRes.body.data.charCount > 100);
    assert(uploadRes.body.data.syllabusId);
    assert.strictEqual(uploadRes.body.data.uploadedBy, undefined, 'Upload response must not expose private extracted source identity');
    const storedSyllabus = await Syllabus.findOne({ syllabusId: uploadRes.body.data.syllabusId }).select('+extractedText');
    assert(storedSyllabus, 'Validated syllabus must be stored in MongoDB');
    assert.strictEqual(storedSyllabus.uploadedBy, teacherAId);
    assert.strictEqual(storedSyllabus.course, 'B.Tech CSE');
    assert.strictEqual(storedSyllabus.semester, 'Semester 4');
    assert.strictEqual(storedSyllabus.subject, 'Advanced Data Structures');
    assert(storedSyllabus.extractedText.includes('Red-Black Trees'));

    const otherTeacherDrafts = await apiRequest('GET', '/api/ai/questions/drafts', undefined, teacherBToken);
    assert.strictEqual(otherTeacherDrafts.status, 200);
    assert(!otherTeacherDrafts.body.data.drafts.some((draft: any) => draft.syllabusId === uploadRes.body.data.syllabusId));
    const otherTeacherGenerate = await apiRequest('POST', '/api/ai/questions/generate', {
      syllabusId: uploadRes.body.data.syllabusId,
      subject: 'Advanced Data Structures',
      course: 'B.Tech CSE',
      semester: 'Semester 4',
      count: 1,
      marks: 3,
      difficulty: 'MEDIUM'
    }, teacherBToken);
    assert.strictEqual(otherTeacherGenerate.status, 403, 'A teacher cannot generate from another teacher\'s syllabus');
    const studentDrafts = await apiRequest('GET', '/api/ai/questions/drafts', undefined, student1Token);
    assert.strictEqual(studentDrafts.status, 403, 'Students cannot access AI review drafts');

    // 6.4 Generate only from the persisted, owner-authorized syllabus
    if (!process.env.GEMINI_API_KEY) {
      const genRes = await apiRequest('POST', '/api/ai/questions/generate', {
        syllabusId: uploadRes.body.data.syllabusId,
        subject: 'Advanced Data Structures',
        topic: 'Red-Black Trees & AVL Trees',
        course: 'B.Tech CSE',
        semester: 'Semester 4',
        difficulty: 'MEDIUM',
        count: 3,
        marks: 3
      }, teacherAToken);
      assert.strictEqual(genRes.status, 503);
      assert.strictEqual(genRes.body.code, 'AI_GENERATION_NOT_CONFIGURED');
      assert.strictEqual(await Question.countDocuments({ syllabusId: uploadRes.body.data.syllabusId }), 0);
      console.log('ℹ 6. LIVE_GEMINI_NOT_CONFIGURED; backend returned AI_GENERATION_NOT_CONFIGURED without creating drafts.');
    } else {
      const genRes = await apiRequest('POST', '/api/ai/questions/generate', {
        syllabusId: uploadRes.body.data.syllabusId,
        subject: 'Advanced Data Structures',
        topic: 'Red-Black Trees & AVL Trees',
        course: 'B.Tech CSE',
        semester: 'Semester 4',
        difficulty: 'MEDIUM',
        count: 3,
        marks: 3
      }, teacherAToken);
      if (genRes.status === 503) {
        assert.strictEqual(genRes.body.code, 'AI_GENERATION_TEMPORARILY_UNAVAILABLE');
        console.log('ℹ 6. Live Gemini temporarily unavailable (503); verified AI_GENERATION_TEMPORARILY_UNAVAILABLE handling.');
      } else {
        assert.strictEqual(genRes.status, 200);
        const drafts = genRes.body.data.generated || genRes.body.data.questions;
        assert.strictEqual(drafts.length, 3);

        // Drafts are persisted immediately but remain unavailable in Question Bank until approved.
        assert.strictEqual(drafts[0].reviewStatus, 'PENDING_TEACHER_REVIEW');
        assert.strictEqual(drafts[0].status, 'DRAFT');
        assert.strictEqual(drafts[0].syllabusId, uploadRes.body.data.syllabusId);
        assert(drafts[0].syllabusUnit && drafts[0].syllabusTopic && drafts[0].sourceReference);
        const dbDraftCheck = await Question.findOne({ questionId: drafts[0].questionId });
        assert(dbDraftCheck, 'Generated review draft must be stored in MongoDB');
        assert.strictEqual(dbDraftCheck.status, 'DRAFT');
        assert.strictEqual(dbDraftCheck.createdBy, teacherAId);
        const draftsInQuestionBank = await apiRequest('GET', '/api/questions', undefined, teacherAToken);
        assert(!draftsInQuestionBank.body.data.questions.some((question: any) => question.questionId === drafts[0].questionId));

        // 6.5 Teacher approves the persisted record by ID
        const draftToApprove = drafts[0];
        const approveRes = await apiRequest('POST', `/api/ai/questions/drafts/${draftToApprove.questionId}/approve`, undefined, teacherAToken);
        assert.strictEqual(approveRes.status, 200);
        const approvedQ = approveRes.body.data.question;
        assert.strictEqual(approvedQ.source, 'AI_GENERATED');
        assert.strictEqual(approvedQ.status, 'ACTIVE');
        assert.strictEqual(approvedQ.reviewStatus, 'APPROVED');
        assert.strictEqual(approvedQ.createdBy, teacherAId, 'Approved question must belong to approving teacher');
        const approvedQId = approvedQ.questionId;
        const approvedRecord = await Question.findOne({ questionId: approvedQId });
        assert.equal(String(approvedRecord?._id), String(dbDraftCheck._id), 'Approval must update the same MongoDB record');
        assert(approvedRecord?.approvedAt);

        // 6.6 Verify approved question now exists in DB and appears in Teacher A Question Bank
        const bankCheckRes = await apiRequest('GET', `/api/questions/${approvedQId}`, undefined, teacherAToken);
        assert.strictEqual(bankCheckRes.status, 200);
        assert.strictEqual(bankCheckRes.body.data.question.questionId, approvedQId);

        const contextMismatchExam = await apiRequest('POST', '/api/exams', {
          title: 'AI Question Context Mismatch',
          subject: 'Operating Systems',
          course: 'B.Tech CSE',
          semester: 'Semester 4',
          durationMinutes: 60,
          questions: [approvedQId],
          status: 'DRAFT'
        }, teacherAToken);
        assert.strictEqual(contextMismatchExam.status, 400, 'AI questions cannot cross subjects');

        // 6.7 Use approved question in Exam Scheduler
        const newExamRes = await apiRequest('POST', '/api/exams', {
          title: 'AI Approved Questions Final Exam',
          subject: 'Advanced Data Structures',
          course: 'B.Tech CSE',
          semester: 'Semester 4',
          durationMinutes: 60,
          questions: [approvedQId],
          assignedStudents: [student1Id],
          status: 'SCHEDULED'
        }, teacherAToken);
        assert.strictEqual(newExamRes.status, 201);
        assert.strictEqual(newExamRes.body.data.exam.totalMarks, 3, 'Exam totalMarks must match approved question marks (3)');
      }
    }

    console.log('✓ 6. AI syllabus processing, teacher review queue, and approval workflow passed');

    // 7. THREE-ROLE END-TO-END VERIFICATION
    // Admin: manages Question Bank and verifies database persistence
    const adminQBRes = await apiRequest('GET', '/api/questions', undefined, adminToken);
    assert.strictEqual(adminQBRes.status, 200);
    assert(adminQBRes.body.data.total >= 2);

    // Teacher: creates manual question, generates AI drafts, approves, schedules exam
    const teacherQBRes = await apiRequest('GET', '/api/questions', undefined, teacherAToken);
    assert.strictEqual(teacherQBRes.status, 200);
    assert(teacherQBRes.body.data.questions.every((q: any) => q.createdBy === teacherAId));

    // Student: cannot access Question Bank or AI generation; only assigned exams
    const studentForbiddenQB = await apiRequest('GET', '/api/questions', undefined, student1Token);
    assert.strictEqual(studentForbiddenQB.status, 403);
    const studentForbiddenAI = await apiRequest('POST', '/api/ai/questions/generate', { subject: 'Test' }, student1Token);
    assert.strictEqual(studentForbiddenAI.status, 403);

    console.log('✓ 7. Three-role end-to-end verification passed');
    console.log('================================================================');
    console.log('ALL PHASE 1.7 QUESTION BANK & AI SYLLABUS GENERATION TESTS PASSED');
    console.log('================================================================');

  } finally {
    server.close();
    await disconnectDatabase();
  }
}

runPhase17QuestionBankAiTests().catch(err => {
  console.error('Test Suite Failed:', err);
  process.exit(1);
});
