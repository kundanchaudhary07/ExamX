import assert from 'assert';
import http from 'http';
import bcrypt from 'bcryptjs';
import { createApp } from '../src/app';
import { connectDatabase, disconnectDatabase } from '../src/config/database';
import { seedAdmin } from '../scripts/seed-admin';
import { User } from '../src/models/User';
import { ENV } from '../src/config/env';
import {
  isValidTeacherId,
  isValidStudentId,
  generateInitialPassword,
  extractBirthYear,
  TEACHER_ID_REGEX,
  STUDENT_ID_REGEX
} from '../src/utils/credential.generator';

async function runTests() {
  console.log('\n--- STARTING PHASE 1.1 CREDENTIAL, AUTHENTICATION & RBAC VERIFICATION SUITE ---\n');

  // =========================================================================
  // SECTION 1: UNIT TESTS FOR CREDENTIAL RULES
  // =========================================================================
  console.log('--- SECTION 1: UNIT TESTS FOR CREDENTIAL RULES ---');

  // 1. Teacher ID validation: ^1251[0-9]{4}$
  assert.strictEqual(isValidTeacherId('12510001'), true, 'Teacher ID 12510001 should be valid');
  assert.strictEqual(isValidTeacherId('12519999'), true, 'Teacher ID 12519999 should be valid');
  assert.strictEqual(isValidTeacherId('1251000'), false, 'Teacher ID 1251000 (7 digits) should be invalid');
  assert.strictEqual(isValidTeacherId('125100001'), false, 'Teacher ID 125100001 (9 digits) should be invalid');
  assert.strictEqual(isValidTeacherId('1251ABCD'), false, 'Teacher ID 1251ABCD (non-digits) should be invalid');
  console.log('✔ Unit Test 1 Passed: Teacher ID validation (12510001, 12519999 valid; 1251000, 125100001, 1251ABCD invalid)');

  // 2. Student ID validation: ^1261[0-9]{4}$
  assert.strictEqual(isValidStudentId('12610001'), true, 'Student ID 12610001 should be valid');
  assert.strictEqual(isValidStudentId('12619999'), true, 'Student ID 12619999 should be valid');
  assert.strictEqual(isValidStudentId('1261000'), false, 'Student ID 1261000 (7 digits) should be invalid');
  assert.strictEqual(isValidStudentId('126100001'), false, 'Student ID 126100001 (9 digits) should be invalid');
  assert.strictEqual(isValidStudentId('1261ABCD'), false, 'Student ID 1261ABCD (non-digits) should be invalid');
  console.log('✔ Unit Test 2 Passed: Student ID validation (12610001, 12619999 valid; 1261000, 126100001, 1261ABCD invalid)');

  // 3. Password generation: Name + "@" + DOB Year (both YYYY and YYYY-MM-DD supported)
  assert.strictEqual(generateInitialPassword('Ravi', extractBirthYear('1985-06-14')), 'Ravi@1985', 'Password for Ravi (1985-06-14) must be Ravi@1985');
  assert.strictEqual(generateInitialPassword('Rahul', extractBirthYear('2004-09-10')), 'Rahul@2004', 'Password for Rahul (2004-09-10) must be Rahul@2004');
  assert.strictEqual(generateInitialPassword('Ravi', 1985), 'Ravi@1985');
  assert.strictEqual(generateInitialPassword('Rahul', 2004), 'Rahul@2004');
  console.log('✔ Unit Test 3 Passed: Password generation (Ravi + 1985-06-14 -> Ravi@1985, Rahul + 2004-09-10 -> Rahul@2004)');

  // =========================================================================
  // SECTION 2: INTEGRATION TESTS FOR AUTH, CREDENTIALS & RBAC
  // =========================================================================
  console.log('\n--- SECTION 2: END-TO-END REST API & RBAC SUITE ---');

  await connectDatabase();
  await seedAdmin();

  // Verify idempotency of seedAdmin()
  await seedAdmin();
  const adminCount = await User.countDocuments({ userId: '12412699' });
  assert.strictEqual(adminCount, 1, 'seedAdmin() must be idempotent and never create duplicates');
  console.log('✔ Integration Test 4 Passed: seedAdmin() is idempotent and seeds Admin 12412699');

  const app = createApp();
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address: any = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  async function apiRequest(method: string, endpoint: string, body?: any, token?: string) {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(`${baseUrl}${endpoint}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined
    });

    const data: any = await response.json();
    return { status: response.status, body: data };
  }

  let adminToken = '';
  let teacherToken = '';
  let teacher2Token = '';
  let studentToken = '';

  // 5. Admin login succeeds with configured credentials
  {
    const res = await apiRequest('POST', '/api/auth/login', {
      userId: '12412699',
      password: ENV.ADMIN_INITIAL_PASSWORD
    });
    assert.strictEqual(res.status, 200, `Admin login status was ${res.status}`);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.data.user.userId, '12412699');
    assert.strictEqual(res.body.data.user.role, 'ADMIN');
    assert.strictEqual(res.body.data.user.passwordHash, undefined, 'Login response must never expose passwordHash');
    adminToken = res.body.data.token;
    console.log('✔ Integration Test 5 Passed: Admin login succeeds (12412699)');
  }

  // 6. Admin login failure with wrong password
  {
    const res = await apiRequest('POST', '/api/auth/login', {
      userId: '12412699',
      password: 'WrongPassword999'
    });
    assert.strictEqual(res.status, 401, 'Invalid password must return 401');
    assert.strictEqual(res.body.success, false);
    console.log('✔ Integration Test 6 Passed: Admin login failure returns 401');
  }

  // 7. GET /api/users/me returns authenticated profile without passwordHash
  {
    const res = await apiRequest('GET', '/api/users/me', undefined, adminToken);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.data.user.userId, '12412699');
    assert.strictEqual(res.body.data.user.passwordHash, undefined);
    console.log('✔ Integration Test 7 Passed: GET /api/users/me returns authenticated profile without passwordHash');
  }

  // 8. Missing JWT and Invalid JWT fail with 401
  {
    const missingRes = await apiRequest('GET', '/api/users/me');
    assert.strictEqual(missingRes.status, 401, 'Missing JWT must return 401');

    const invalidRes = await apiRequest('GET', '/api/users/me', undefined, 'invalid.jwt.token');
    assert.strictEqual(invalidRes.status, 401, 'Invalid JWT must return 401');
    console.log('✔ Integration Test 8 Passed: Missing JWT and Invalid JWT fail with 401');
  }

  // 9. Admin creates Teacher (Ravi, DOB: 1985-06-14): Backend generates ID (^1251[0-9]{4}$) and password (Ravi@1985)
  let generatedTeacher1Id = '';
  {
    const res = await apiRequest('POST', '/api/users/teachers', {
      name: 'Ravi',
      dob: '1985-06-14',
      department: 'Computer Science & Engineering',
      email: 'ravi@faculty.edu',
      phone: '9876543210',
      qualification: 'Ph.D.',
      specialization: 'Machine Learning',
      designation: 'Professor',
      experienceYears: 10
    }, adminToken);

    assert.strictEqual(res.status, 201, `Teacher creation failed: ${res.status}`);
    assert.strictEqual(res.body.success, true);

    const teacher = res.body.data.teacher;
    generatedTeacher1Id = teacher.userId;
    assert.match(generatedTeacher1Id, TEACHER_ID_REGEX, `Teacher ID ${generatedTeacher1Id} must match ^1251[0-9]{4}$`);
    assert.strictEqual(teacher.name, 'Ravi');
    assert.strictEqual(teacher.role, 'TEACHER');
    assert.strictEqual(teacher.qualification, 'Ph.D.');
    assert.strictEqual(teacher.specialization, 'Machine Learning');
    assert.strictEqual(teacher.designation, 'Professor');
    assert.strictEqual(teacher.experienceYears, 10);

    const creds = res.body.data.initialCredentials;
    assert.ok(creds, 'Initial credentials must be returned in response');
    assert.strictEqual(creds.userId, generatedTeacher1Id);
    assert.strictEqual(creds.temporaryPassword, 'Ravi@1985');

    // Verify plaintext password is NOT in MongoDB and bcrypt hash is valid
    const dbDoc = await User.findOne({ userId: generatedTeacher1Id }).select('+passwordHash');
    assert.ok(dbDoc?.passwordHash, 'Password hash must be in MongoDB');
    assert.notStrictEqual(dbDoc?.passwordHash, 'Ravi@1985', 'Plaintext password must NOT be in MongoDB');
    assert.ok(dbDoc?.passwordHash.startsWith('$2'), 'Must be a bcrypt hash');

    const isMatch = await bcrypt.compare('Ravi@1985', dbDoc!.passwordHash);
    assert.strictEqual(isMatch, true, 'bcrypt.compare must succeed with generated password Ravi@1985');

    console.log(`✔ Integration Test 9 Passed: Admin creates Teacher (ID=${generatedTeacher1Id}, password=Ravi@1985, bcrypt verified)`);
  }

  // 10. Teacher 1 logs in using generated credentials
  {
    const res = await apiRequest('POST', '/api/auth/login', {
      userId: generatedTeacher1Id,
      password: 'Ravi@1985'
    });
    assert.strictEqual(res.status, 200, `Teacher login failed with status ${res.status}`);
    assert.strictEqual(res.body.data.user.userId, generatedTeacher1Id);
    assert.strictEqual(res.body.data.user.role, 'TEACHER');
    teacherToken = res.body.data.token;
    console.log(`✔ Integration Test 10 Passed: Teacher logs in with generated credentials (${generatedTeacher1Id})`);
  }

  // 11. Teacher CANNOT create another Teacher (403 Forbidden)
  {
    const res = await apiRequest('POST', '/api/users/teachers', {
      name: 'UnauthorizedTeacher',
      dobYear: 1988
    }, teacherToken);
    assert.strictEqual(res.status, 403, 'Teacher must not be allowed to create Teacher accounts');
    console.log('✔ Integration Test 11 Passed: Teacher cannot create Teacher (403 Forbidden)');
  }

  // 12. Admin creates Teacher 2: Verify ID uniqueness (^1251[0-9]{4}$)
  let generatedTeacher2Id = '';
  {
    const res = await apiRequest('POST', '/api/users/teachers', {
      name: 'Sunita',
      dobYear: 1980,
      department: 'Electrical Engineering'
    }, adminToken);

    assert.strictEqual(res.status, 201);
    generatedTeacher2Id = res.body.data.teacher.userId;
    assert.match(generatedTeacher2Id, TEACHER_ID_REGEX);
    assert.notStrictEqual(generatedTeacher2Id, generatedTeacher1Id, 'Teacher IDs must be unique');
    assert.strictEqual(res.body.data.initialCredentials.temporaryPassword, 'Sunita@1980');

    const loginRes = await apiRequest('POST', '/api/auth/login', {
      userId: generatedTeacher2Id,
      password: 'Sunita@1980'
    });
    assert.strictEqual(loginRes.status, 200);
    teacher2Token = loginRes.body.data.token;
    console.log(`✔ Integration Test 12 Passed: Teacher 2 generated unique ID (${generatedTeacher2Id})`);
  }

  // 13. Teacher 1 creates Student (Rahul, DOB: 2004-09-10): Backend generates ID (^1261[0-9]{4}$) and password (Rahul@2004)
  let generatedStudent1Id = '';
  {
    const res = await apiRequest('POST', '/api/users/students', {
      name: 'Rahul',
      dob: '2004-09-10',
      department: 'Computer Science & Engineering',
      email: 'rahul@student.edu',
      phone: '9123456780',
      course: 'B.Tech',
      academicYear: '2024-2025',
      semester: '5',
      section: 'A'
    }, teacherToken);

    assert.strictEqual(res.status, 201, `Student creation failed: ${res.status}`);
    assert.strictEqual(res.body.success, true);

    const student = res.body.data.student;
    generatedStudent1Id = student.userId;
    assert.match(generatedStudent1Id, STUDENT_ID_REGEX, `Student ID ${generatedStudent1Id} must match ^1261[0-9]{4}$`);
    assert.strictEqual(student.name, 'Rahul');
    assert.strictEqual(student.role, 'STUDENT');
    assert.strictEqual(student.course, 'B.Tech');
    assert.strictEqual(student.semester, '5');
    assert.strictEqual(student.section, 'A');

    const creds = res.body.data.initialCredentials;
    assert.ok(creds);
    assert.strictEqual(creds.userId, generatedStudent1Id);
    assert.strictEqual(creds.temporaryPassword, 'Rahul@2004');
    assert.deepStrictEqual(student.managedBy, [generatedTeacher1Id]);

    const dbDoc = await User.findOne({ userId: generatedStudent1Id }).select('+passwordHash');
    assert.ok(dbDoc?.passwordHash);
    assert.notStrictEqual(dbDoc?.passwordHash, 'Rahul@2004');
    const isMatch = await bcrypt.compare('Rahul@2004', dbDoc!.passwordHash);
    assert.strictEqual(isMatch, true, 'bcrypt.compare must succeed with generated password Rahul@2004');

    console.log(`✔ Integration Test 13 Passed: Teacher creates Student (ID=${generatedStudent1Id}, password=Rahul@2004, bcrypt verified)`);
  }

  // 14. Student 1 logs in using generated credentials
  {
    const res = await apiRequest('POST', '/api/auth/login', {
      userId: generatedStudent1Id,
      password: 'Rahul@2004'
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.data.user.userId, generatedStudent1Id);
    assert.strictEqual(res.body.data.user.role, 'STUDENT');
    studentToken = res.body.data.token;
    console.log(`✔ Integration Test 14 Passed: Student logs in with generated credentials (${generatedStudent1Id})`);
  }

  // 15. Student cannot create Teachers or Students (403 Forbidden)
  {
    const resTeacher = await apiRequest('POST', '/api/users/teachers', { name: 'Fake', dobYear: 1990 }, studentToken);
    assert.strictEqual(resTeacher.status, 403);

    const resStudent = await apiRequest('POST', '/api/users/students', { name: 'FakeStu', dobYear: 2005 }, studentToken);
    assert.strictEqual(resStudent.status, 403);
    console.log('✔ Integration Test 15 Passed: Student cannot create Teacher or Student accounts (403 Forbidden)');
  }

  // 16. Student isolation & ownership: Teacher 2 CANNOT modify Teacher 1's student
  {
    const res = await apiRequest('PATCH', `/api/users/students/${generatedStudent1Id}`, {
      status: 'BLOCKED'
    }, teacher2Token);
    assert.strictEqual(res.status, 403, 'Teacher 2 must receive 403 when modifying Teacher 1 student');
    console.log("✔ Integration Test 16 Passed: Teacher 2 cannot modify Teacher 1's student (403 Forbidden)");
  }

  // 17. Inactive user and Blocked user cannot log in (403 Forbidden)
  {
    // Admin sets Teacher 2 to INACTIVE
    const patchInactive = await apiRequest('PATCH', `/api/users/teachers/${generatedTeacher2Id}`, {
      status: 'INACTIVE'
    }, adminToken);
    assert.strictEqual(patchInactive.status, 200);

    const loginInactive = await apiRequest('POST', '/api/auth/login', {
      userId: generatedTeacher2Id,
      password: 'Sunita@1980'
    });
    assert.strictEqual(loginInactive.status, 403, 'INACTIVE user must not be allowed to log in');

    // Teacher 1 sets Student 1 to BLOCKED
    const patchBlocked = await apiRequest('PATCH', `/api/users/students/${generatedStudent1Id}`, {
      status: 'BLOCKED'
    }, teacherToken);
    assert.strictEqual(patchBlocked.status, 200);

    const loginBlocked = await apiRequest('POST', '/api/auth/login', {
      userId: generatedStudent1Id,
      password: 'Rahul@2004'
    });
    assert.strictEqual(loginBlocked.status, 403, 'BLOCKED user must not be allowed to log in');

    // Restore both to ACTIVE
    await apiRequest('PATCH', `/api/users/teachers/${generatedTeacher2Id}`, { status: 'ACTIVE' }, adminToken);
    await apiRequest('PATCH', `/api/users/students/${generatedStudent1Id}`, { status: 'ACTIVE' }, teacherToken);
    console.log('✔ Integration Test 17 Passed: INACTIVE and BLOCKED users cannot log in (403 Forbidden)');
  }

  // 18. Password reset endpoints work and re-hash passwords with bcrypt
  {
    const resetStu = await apiRequest('POST', `/api/users/students/${generatedStudent1Id}/reset-password`, {
      newPassword: 'RahulNew@2026'
    }, teacherToken);
    assert.strictEqual(resetStu.status, 200);

    const loginReset = await apiRequest('POST', '/api/auth/login', {
      userId: generatedStudent1Id,
      password: 'RahulNew@2026'
    });
    assert.strictEqual(loginReset.status, 200);
    console.log('✔ Integration Test 18 Passed: Password reset endpoint hashes new password and allows login');
  }

  // 19. Backend ignores manual ID/password overrides
  {
    const res = await apiRequest('POST', '/api/users/teachers', {
      userId: '12519999',
      password: 'MyCustomPassword123',
      name: 'Vikram',
      dobYear: 1982
    }, adminToken);

    assert.strictEqual(res.status, 201);
    const teacher = res.body.data.teacher;
    assert.notStrictEqual(teacher.userId, '12519999', 'Backend must not allow manual ID injection');
    assert.match(teacher.userId, TEACHER_ID_REGEX);
    assert.strictEqual(res.body.data.initialCredentials.temporaryPassword, 'Vikram@1982');
    console.log('✔ Integration Test 19 Passed: Backend authoritatively generates ID and password; ignores client overrides');
  }

  // 20. Plaintext passwords never stored in DB and passwordHash never returned in API
  {
    const allUsers = await User.find({}).select('+passwordHash');
    for (const u of allUsers) {
      assert.ok(u.passwordHash, `User ${u.userId} must have passwordHash`);
      assert.ok(u.passwordHash.startsWith('$2'), `User ${u.userId} must have bcrypt hash`);
      assert.doesNotMatch(u.passwordHash, /@\d{4}$/, `User ${u.userId} passwordHash must NOT be plaintext`);
    }

    const listRes = await apiRequest('GET', '/api/users/students', undefined, adminToken);
    for (const stu of listRes.body.data.students) {
      assert.strictEqual(stu.passwordHash, undefined, 'Student list must not expose passwordHash');
    }
    console.log('✔ Integration Test 20 Passed: All passwords stored as bcrypt hashes; API never serializes passwordHash');
  }

  // 21. System health check
  {
    const healthRes = await apiRequest('GET', '/api/health');
    assert.strictEqual(healthRes.status, 200);
    assert.strictEqual(healthRes.body.success, true);
    assert.strictEqual(healthRes.body.database, 'connected');
    console.log('✔ Integration Test 21 Passed: GET /api/health confirms MongoDB connectivity & service status');
  }

  console.log('\n======================================================');
  console.log('ALL 21 CREDENTIAL, AUTHENTICATION & RBAC TESTS PASSED.');
  console.log('======================================================\n');

  await new Promise<void>((resolve) => server.close(() => resolve()));
  await disconnectDatabase();
}

runTests().catch(async (err) => {
  console.error('\n❌ Test Suite Failed with Error:\n', err);
  await disconnectDatabase();
  process.exit(1);
});
