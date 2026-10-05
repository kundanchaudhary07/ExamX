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

async function runPhase12Tests() {
  console.log('--- STARTING PHASE 1.2 EXAMINATION CORE & QUESTION BANK TEST SUITE ---');

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
    let adminToken = '';
    {
      const res = await apiRequest('POST', '/api/auth/login', {
        userId: ENV.ADMIN_USER_ID,
        password: ENV.ADMIN_INITIAL_PASSWORD
      });
      assert.strictEqual(res.status, 200, 'Admin login failed');
      adminToken = res.body.data.token;
      console.log('✔ Setup 1: Admin authenticated');
    }

    // 2. Provision Teacher 1 and Teacher 2
    let teacher1Token = '';
    let teacher1Id = '';
    let teacher2Token = '';
    let teacher2Id = '';
    {
      const t1Res = await apiRequest('POST', '/api/users/teachers', {
        name: 'Dr. Alan',
        dob: '1980-03-15',
        department: 'Computer Science',
        email: 'alan@faculty.edu'
      }, adminToken);
      assert.strictEqual(t1Res.status, 201);
      teacher1Id = t1Res.body.data.teacher.userId;
      const t1Login = await apiRequest('POST', '/api/auth/login', {
        userId: teacher1Id,
        password: t1Res.body.data.initialCredentials.temporaryPassword
      });
      teacher1Token = t1Login.body.data.token;

      const t2Res = await apiRequest('POST', '/api/users/teachers', {
        name: 'Dr. Grace',
        dob: '1982-12-09',
        department: 'Information Technology',
        email: 'grace@faculty.edu'
      }, adminToken);
      assert.strictEqual(t2Res.status, 201);
      teacher2Id = t2Res.body.data.teacher.userId;
      const t2Login = await apiRequest('POST', '/api/auth/login', {
        userId: teacher2Id,
        password: t2Res.body.data.initialCredentials.temporaryPassword
      });
      teacher2Token = t2Login.body.data.token;
      console.log('✔ Setup 2: Teacher 1 and Teacher 2 provisioned & authenticated');
    }

    // 3. Provision Student 1 (managed by Teacher 1) and Student 2 (managed by Teacher 2)
    let student1Token = '';
    let student1Id = '';
    let student2Token = '';
    let student2Id = '';
    {
      const s1Res = await apiRequest('POST', '/api/users/students', {
        name: 'Charlie',
        dobYear: 2004,
        department: 'Computer Science',
        course: 'B.Tech'
      }, teacher1Token);
      assert.strictEqual(s1Res.status, 201);
      student1Id = s1Res.body.data.student.userId;
      const s1Login = await apiRequest('POST', '/api/auth/login', {
        userId: student1Id,
        password: s1Res.body.data.initialCredentials.temporaryPassword
      });
      student1Token = s1Login.body.data.token;

      const s2Res = await apiRequest('POST', '/api/users/students', {
        name: 'Diana',
        dobYear: 2004,
        department: 'Information Technology',
        course: 'B.Tech'
      }, teacher2Token);
      assert.strictEqual(s2Res.status, 201);
      student2Id = s2Res.body.data.student.userId;
      const s2Login = await apiRequest('POST', '/api/auth/login', {
        userId: student2Id,
        password: s2Res.body.data.initialCredentials.temporaryPassword
      });
      student2Token = s2Login.body.data.token;
      console.log('✔ Setup 3: Student 1 (under Teacher 1) & Student 2 (under Teacher 2) provisioned');
    }

    // --- SECTION 1: QUESTION BANK VALIDATION & RBAC ---

    // Test 1: Reject malformed questions (empty text, <2 options, duplicate option ids, invalid correctAnswer, negative marks)
    {
      const resEmpty = await apiRequest('POST', '/api/questions', {
        questionText: '   ',
        subject: 'Algorithms'
      }, teacher1Token);
      assert.strictEqual(resEmpty.status, 400);

      const resBadOptions = await apiRequest('POST', '/api/questions', {
        questionText: 'What is the time complexity of binary search?',
        subject: 'Algorithms',
        options: [{ id: 'A', text: 'O(log n)' }],
        correctAnswer: 'A'
      }, teacher1Token);
      assert.strictEqual(resBadOptions.status, 400);

      const resDuplicateOptions = await apiRequest('POST', '/api/questions', {
        questionText: 'What is the time complexity of binary search?',
        subject: 'Algorithms',
        options: [
          { id: 'A', text: 'O(log n)' },
          { id: 'A', text: 'O(n)' }
        ],
        correctAnswer: 'A'
      }, teacher1Token);
      assert.strictEqual(resDuplicateOptions.status, 400);

      const resMismatchedAnswer = await apiRequest('POST', '/api/questions', {
        questionText: 'What is the time complexity of binary search?',
        subject: 'Algorithms',
        options: [
          { id: 'A', text: 'O(log n)' },
          { id: 'B', text: 'O(n)' }
        ],
        correctAnswer: 'C'
      }, teacher1Token);
      assert.strictEqual(resMismatchedAnswer.status, 400);

      const resNegativeMarks = await apiRequest('POST', '/api/questions', {
        questionText: 'What is the time complexity of binary search?',
        subject: 'Algorithms',
        options: [
          { id: 'A', text: 'O(log n)' },
          { id: 'B', text: 'O(n)' }
        ],
        correctAnswer: 'A',
        marks: -5
      }, teacher1Token);
      assert.strictEqual(resNegativeMarks.status, 400);

      console.log('✔ Test 1 Passed: Question validation rejects malformed question structures');
    }

    // Test 2: Teacher 1 successfully creates valid MCQ question
    let question1Id = '';
    {
      const res = await apiRequest('POST', '/api/questions', {
        questionText: 'Which data structure operates on a Last-In, First-Out (LIFO) basis?',
        subject: 'Data Structures',
        topic: 'Stacks & Queues',
        difficulty: 'EASY',
        marks: 2,
        options: [
          { id: 'A', text: 'Queue' },
          { id: 'B', text: 'Stack' },
          { id: 'C', text: 'Linked List' },
          { id: 'D', text: 'Binary Tree' }
        ],
        correctAnswer: 'B',
        explanation: 'A stack is a linear data structure following the LIFO principle.'
      }, teacher1Token);

      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.body.success, true);
      assert.match(res.body.data.question.questionId, /^QST-[0-9]{5}$/);
      assert.strictEqual(res.body.data.question.createdBy, teacher1Id);
      question1Id = res.body.data.question.questionId;
      console.log(`✔ Test 2 Passed: Teacher creates question [${question1Id}]`);
    }

    // Test 3: Teacher 2 creates Question 2
    let question2Id = '';
    {
      const res = await apiRequest('POST', '/api/questions', {
        questionText: 'Which layer of OSI model is responsible for routing?',
        subject: 'Computer Networks',
        topic: 'OSI Model',
        difficulty: 'MEDIUM',
        marks: 2,
        options: [
          { id: 'A', text: 'Data Link Layer' },
          { id: 'B', text: 'Network Layer' },
          { id: 'C', text: 'Transport Layer' },
          { id: 'D', text: 'Session Layer' }
        ],
        correctAnswer: 'B'
      }, teacher2Token);

      assert.strictEqual(res.status, 201);
      question2Id = res.body.data.question.questionId;
      console.log(`✔ Test 3 Passed: Teacher 2 creates question [${question2Id}]`);
    }

    // Test 4: Question Bank Isolation (Teacher 1 only sees own questions)
    {
      const res1 = await apiRequest('GET', '/api/questions', undefined, teacher1Token);
      assert.strictEqual(res1.status, 200);
      const qIds = res1.body.data.questions.map((q: any) => q.questionId);
      assert.ok(qIds.includes(question1Id), 'Teacher 1 must see own question');
      assert.ok(!qIds.includes(question2Id), 'Teacher 1 must NOT see Teacher 2 question');

      const res2 = await apiRequest('GET', '/api/questions', undefined, teacher2Token);
      assert.strictEqual(res2.status, 200);
      const q2Ids = res2.body.data.questions.map((q: any) => q.questionId);
      assert.ok(!q2Ids.includes(question1Id), 'Teacher 2 must NOT see Teacher 1 question');
      assert.ok(q2Ids.includes(question2Id), 'Teacher 2 must see own question');

      console.log('✔ Test 4 Passed: Question Bank isolation enforces teacher ownership');
    }

    // Test 5: Teacher 2 cannot access, update, or delete Teacher 1's question (403 Forbidden)
    {
      const getRes = await apiRequest('GET', `/api/questions/${question1Id}`, undefined, teacher2Token);
      assert.strictEqual(getRes.status, 403, 'Teacher 2 cannot view Teacher 1 question');

      const patchRes = await apiRequest('PATCH', `/api/questions/${question1Id}`, {
        questionText: 'Tampered question text'
      }, teacher2Token);
      assert.strictEqual(patchRes.status, 403, 'Teacher 2 cannot update Teacher 1 question');

      const delRes = await apiRequest('DELETE', `/api/questions/${question1Id}`, undefined, teacher2Token);
      assert.strictEqual(delRes.status, 403, 'Teacher 2 cannot delete Teacher 1 question');

      console.log('✔ Test 5 Passed: Cross-teacher question access/modification strictly forbidden');
    }

    // Test 6: Students cannot access Question Bank API (403 Forbidden)
    {
      const res = await apiRequest('GET', '/api/questions', undefined, student1Token);
      assert.strictEqual(res.status, 403, 'Student cannot access /api/questions');

      const postRes = await apiRequest('POST', '/api/questions', {
        questionText: 'Unauthorized student question'
      }, student1Token);
      assert.strictEqual(postRes.status, 403, 'Student cannot post to /api/questions');

      console.log('✔ Test 6 Passed: Student access to Question Bank rejected with 403');
    }

    // --- SECTION 2: EXAM CREATION, OWNERSHIP & LIFECYCLE ---

    // Test 7: Exam validation rejects invalid inputs (duration <= 0, totalMarks <= 0, passingMarks > totalMarks)
    {
      const resBadDuration = await apiRequest('POST', '/api/exams', {
        title: 'Midterm Exam',
        subject: 'Data Structures',
        durationMinutes: 0,
        totalMarks: 50
      }, teacher1Token);
      assert.strictEqual(resBadDuration.status, 400);

      const resBadMarks = await apiRequest('POST', '/api/exams', {
        title: 'Midterm Exam',
        subject: 'Data Structures',
        durationMinutes: 60,
        totalMarks: 0
      }, teacher1Token);
      assert.strictEqual(resBadMarks.status, 400);

      const resBadPassing = await apiRequest('POST', '/api/exams', {
        title: 'Midterm Exam',
        subject: 'Data Structures',
        durationMinutes: 60,
        totalMarks: 50,
        passingMarks: 60
      }, teacher1Token);
      assert.strictEqual(resBadPassing.status, 400);

      console.log('✔ Test 7 Passed: Exam validation rejects invalid duration and marks parameters');
    }

    // Test 8: Teacher 1 creates Exam 1 in DRAFT status
    let exam1Id = '';
    {
      const res = await apiRequest('POST', '/api/exams', {
        title: 'Data Structures & Algorithms Midterm',
        description: 'Comprehensive examination covering stacks, queues, and trees.',
        subject: 'Data Structures',
        course: 'B.Tech CSE',
        department: 'Computer Science',
        academicYear: '2024-2025',
        semester: '4',
        durationMinutes: 60,
        totalMarks: 50,
        passingMarks: 20
      }, teacher1Token);

      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.body.success, true);
      assert.match(res.body.data.exam.examId, /^EXM-[0-9]{5}$/);
      assert.strictEqual(res.body.data.exam.status, 'DRAFT', 'Initial exam status must be DRAFT');
      assert.strictEqual(res.body.data.exam.createdBy, teacher1Id);
      exam1Id = res.body.data.exam.examId;
      console.log(`✔ Test 8 Passed: Exam 1 created in DRAFT status [${exam1Id}]`);
    }

    // Test 9: Exam Ownership Isolation (Teacher 2 cannot edit or delete Teacher 1's exam)
    {
      const patchRes = await apiRequest('PATCH', `/api/exams/${exam1Id}`, {
        title: 'Unauthorized Tamper'
      }, teacher2Token);
      assert.strictEqual(patchRes.status, 403, 'Teacher 2 cannot modify Teacher 1 exam');

      const delRes = await apiRequest('DELETE', `/api/exams/${exam1Id}`, undefined, teacher2Token);
      assert.strictEqual(delRes.status, 403, 'Teacher 2 cannot delete Teacher 1 exam');

      console.log('✔ Test 9 Passed: Cross-teacher exam modification strictly forbidden');
    }

    // Test 10: Question Assignment to Exam (Teacher 1 adds Question 1; prevents duplicates; prevents cross-teacher question)
    {
      // Cannot add Teacher 2's question
      const badCrossRes = await apiRequest('POST', `/api/exams/${exam1Id}/questions`, {
        questionId: question2Id
      }, teacher1Token);
      assert.strictEqual(badCrossRes.status, 403, 'Cannot add another faculty question to exam');

      // Successfully add Question 1
      const addRes = await apiRequest('POST', `/api/exams/${exam1Id}/questions`, {
        questionId: question1Id
      }, teacher1Token);
      assert.strictEqual(addRes.status, 200);
      assert.ok(addRes.body.data.exam.questions.includes(question1Id));

      // Duplicate question addition rejected
      const dupRes = await apiRequest('POST', `/api/exams/${exam1Id}/questions`, {
        questionId: question1Id
      }, teacher1Token);
      assert.strictEqual(dupRes.status, 400, 'Duplicate question in exam must be rejected');

      console.log('✔ Test 10 Passed: Question assignment validates ownership and prevents duplicates');
    }

    // Test 11: Exam Assignment to Students (Teacher 1 assigns Student 1; Teacher 1 CANNOT assign Student 2)
    {
      // Assigning Student 2 (managed by Teacher 2) must be REJECTED with 403
      const badAssignRes = await apiRequest('POST', `/api/exams/${exam1Id}/assign`, {
        studentIds: [student2Id]
      }, teacher1Token);
      assert.strictEqual(badAssignRes.status, 403, 'Teacher 1 cannot assign student supervised by Teacher 2');

      // Assigning Student 1 (managed by Teacher 1) must SUCCEED
      const goodAssignRes = await apiRequest('POST', `/api/exams/${exam1Id}/assign`, {
        studentIds: [student1Id]
      }, teacher1Token);
      assert.strictEqual(goodAssignRes.status, 200);
      assert.strictEqual(goodAssignRes.body.data.assignedCount, 1);

      // Verify ExamAssignment database record exists
      const assignmentRecord = await ExamAssignment.findOne({ examId: exam1Id, studentId: student1Id });
      assert.ok(assignmentRecord, 'ExamAssignment record must exist in MongoDB');
      assert.strictEqual(assignmentRecord.assignedBy, teacher1Id);

      console.log('✔ Test 11 Passed: Student exam assignment enforces teacher supervision rules');
    }

    // Test 12: Publishing Exam (Validates prerequisites: title, duration, marks, >=1 question)
    {
      // Create empty exam with 0 questions
      const emptyExamRes = await apiRequest('POST', '/api/exams', {
        title: 'Empty Exam',
        subject: 'Algorithms',
        durationMinutes: 30,
        totalMarks: 20
      }, teacher1Token);
      const emptyExamId = emptyExamRes.body.data.exam.examId;

      // Attempting to publish empty exam must FAIL
      const failPublish = await apiRequest('POST', `/api/exams/${emptyExamId}/publish`, undefined, teacher1Token);
      assert.strictEqual(failPublish.status, 400, 'Publishing exam with 0 questions must fail');

      // Publishing Exam 1 (which has Question 1) must SUCCEED
      const pubRes = await apiRequest('POST', `/api/exams/${exam1Id}/publish`, undefined, teacher1Token);
      assert.strictEqual(pubRes.status, 200);
      assert.strictEqual(pubRes.body.data.exam.status, 'PUBLISHED');

      // Idempotent publish succeeds
      const pubAgain = await apiRequest('POST', `/api/exams/${exam1Id}/publish`, undefined, teacher1Token);
      assert.strictEqual(pubAgain.status, 200);

      console.log('✔ Test 12 Passed: Exam publishing requires active questions and transitions status');
    }

    // Test 13: Lifecycle Transition Constraints (PUBLISHED -> DRAFT rejected; CLOSED -> DRAFT rejected)
    {
      const revertRes = await apiRequest('PATCH', `/api/exams/${exam1Id}`, {
        status: 'DRAFT'
      }, teacher1Token);
      assert.strictEqual(revertRes.status, 400, 'Reverting PUBLISHED exam to DRAFT must be rejected');

      // Close the exam
      const closeRes = await apiRequest('PATCH', `/api/exams/${exam1Id}`, {
        status: 'CLOSED'
      }, teacher1Token);
      assert.strictEqual(closeRes.status, 200);
      assert.strictEqual(closeRes.body.data.exam.status, 'CLOSED');

      // Re-opening closed exam to draft must be rejected
      const reopenRes = await apiRequest('PATCH', `/api/exams/${exam1Id}`, {
        status: 'DRAFT'
      }, teacher1Token);
      assert.strictEqual(reopenRes.status, 400, 'Transition from CLOSED to DRAFT must be rejected');

      // Re-publish for student access test
      await Exam.updateOne({ examId: exam1Id }, { status: 'PUBLISHED' });

      console.log('✔ Test 13 Passed: Lifecycle state transitions strictly enforced');
    }

    // --- SECTION 3: STUDENT EXAM ACCESS & DATA PROTECTION ---

    // Test 14: Student 1 sees assigned published exam; Student 2 (unassigned) sees 0 exams
    {
      const s1Exams = await apiRequest('GET', '/api/student/exams', undefined, student1Token);
      assert.strictEqual(s1Exams.status, 200);
      assert.strictEqual(s1Exams.body.data.exams.length, 1);
      assert.strictEqual(s1Exams.body.data.exams[0].examId, exam1Id);

      const s2Exams = await apiRequest('GET', '/api/student/exams', undefined, student2Token);
      assert.strictEqual(s2Exams.status, 200);
      assert.strictEqual(s2Exams.body.data.exams.length, 0, 'Unassigned student must see 0 exams');

      console.log('✔ Test 14 Passed: Student exam list only returns assigned, published exams');
    }

    // Test 15: Student Data Privacy (Response DTO NEVER contains correctAnswer, explanations, or internal credentials)
    {
      const s1Exams = await apiRequest('GET', '/api/student/exams', undefined, student1Token);
      const studentExam = s1Exams.body.data.exams[0];

      assert.strictEqual(studentExam.correctAnswer, undefined, 'correctAnswer must NEVER be in student exam DTO');
      assert.strictEqual(studentExam.passwordHash, undefined, 'passwordHash must NEVER be in student exam DTO');
      assert.strictEqual(studentExam.explanation, undefined, 'explanation must NEVER be in student exam DTO');
      assert.ok(studentExam.questionCount > 0, 'Question count summary present without exposing answers');

      console.log('✔ Test 15 Passed: Student data privacy masks correct answers and internal metadata');
    }

    // Test 16: Admin can view all exams and questions across all teachers
    {
      const adminExams = await apiRequest('GET', '/api/exams', undefined, adminToken);
      assert.strictEqual(adminExams.status, 200);
      assert.ok(adminExams.body.data.exams.length >= 1, 'Admin can view all exams');

      const adminQuestions = await apiRequest('GET', '/api/questions', undefined, adminToken);
      assert.strictEqual(adminQuestions.status, 200);
      assert.ok(adminQuestions.body.data.questions.length >= 2, 'Admin can view all questions');

      console.log('✔ Test 16 Passed: Admin RBAC permits administrative visibility');
    }

    console.log('======================================================');
    console.log('ALL PHASE 1.2 EXAMINATION CORE & QUESTION BANK TESTS PASSED.');
    console.log('======================================================');
  } finally {
    server.close();
    await disconnectDatabase();
  }
}

runPhase12Tests().catch(err => {
  console.error('❌ Phase 1.2 Test Suite Failed:', err);
  process.exit(1);
});
