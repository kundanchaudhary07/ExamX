import assert from 'node:assert/strict';
import http from 'node:http';
import mongoose from 'mongoose';
import { createApp } from '../src/app';
import { connectDatabase, disconnectDatabase } from '../src/config/database';
import { AuditLog } from '../src/models/AuditLog';
import { User } from '../src/models/User';
import { AuthService } from '../src/services/auth.service';
import {
  createStudentWithGeneratedId,
  generateNextStudentId,
  STUDENT_ID_REGEX,
  generateNextTeacherId
} from '../src/utils/credential.generator';
import { hashPassword, verifyPassword } from '../src/utils/password';

async function run(): Promise<void> {
  const uri = process.env.MONGODB_URI;
  assert(uri, 'MONGODB_URI is required');
  const databaseName = new URL(uri).pathname.replace(/^\/+/, '').split('?')[0];
  assert(databaseName.toLowerCase().endsWith('_test'), 'Refusing student signup tests outside an isolated test database');

  await connectDatabase();
  const server = http.createServer(createApp());
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert(address && typeof address !== 'string');
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const createdStudentIds: string[] = [];
  let activeFacultyId = '';
  let otherFacultyId = '';
  let inactiveFacultyId = '';

  async function request(method: string, route: string, body?: Record<string, unknown>, token?: string) {
    const response = await fetch(`${baseUrl}${route}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      body: body ? JSON.stringify(body) : undefined
    });
    return { status: response.status, body: await response.json() as any };
  }

  function signupPayload(email: string, facultyId = activeFacultyId) {
    return {
      name: '  New   Student ',
      email,
      phone: '+1 (555) 123-4567',
      dob: '2004-04-10',
      course: 'B.Tech CSE',
      department: 'Computer Science',
      semester: 'Semester 1',
      facultyId,
      role: 'ADMIN',
      userId: '12412699'
    };
  }

  try {
    const facultyPassword = await hashPassword('Faculty-Test-Password-2026');
    activeFacultyId = await generateNextTeacherId();
    await User.create({
      userId: activeFacultyId,
      name: 'Signup Faculty',
      email: `faculty-${activeFacultyId}@example.test`,
      passwordHash: facultyPassword,
      role: 'TEACHER',
      status: 'ACTIVE',
      department: 'Computer Science'
    });
    otherFacultyId = await generateNextTeacherId();
    await User.create({
      userId: otherFacultyId,
      name: 'Other Faculty',
      email: `faculty-${otherFacultyId}@example.test`,
      passwordHash: facultyPassword,
      role: 'TEACHER',
      status: 'ACTIVE',
      department: 'Computer Science'
    });
    inactiveFacultyId = await generateNextTeacherId();
    await User.create({
      userId: inactiveFacultyId,
      name: 'Inactive Faculty',
      email: `faculty-${inactiveFacultyId}@example.test`,
      passwordHash: facultyPassword,
      role: 'TEACHER',
      status: 'INACTIVE',
      department: 'Computer Science'
    });

    const email = `student-signup-${Date.now()}@example.test`;
    const signup = await request('POST', '/api/auth/signup/student', signupPayload(email));
    const signupData = signup.body?.data;
    const createdUserId = signupData?.user?.userId || '';
    if (createdUserId) createdStudentIds.push(createdUserId);
    assert.equal(signup.status, 201);
    assert.equal(signupData.user.role, 'STUDENT');
    assert.equal(signupData.user.name, 'New Student');
    assert.equal(signupData.user.email, email);
    assert.equal(signupData.user.phone, '+1 (555) 123-4567');
    assert.equal(signupData.user.dob, '2004-04-10');
    assert.equal(signupData.user.dobYear, 2004);
    assert.equal(signupData.user.course, 'B.Tech CSE');
    assert.equal(signupData.user.department, 'Computer Science');
    assert.equal(signupData.user.semester, 'Semester 1');
    assert.equal(signupData.user.academicYear, '');
    assert.equal(signupData.user.section, '');
    assert.deepEqual(signupData.user.managedBy, [activeFacultyId]);
    assert.deepEqual(signupData.user.teacherIds, [activeFacultyId]);
    assert.equal(signupData.user.createdBy, activeFacultyId);
    assert.match(signupData.user.userId, STUDENT_ID_REGEX);
    assert.equal(signupData.user.passwordHash, undefined);
    assert.equal(signupData.token, undefined, 'Public signup must not create an authenticated session');
    assert.equal(signupData.credentials.studentId, signupData.user.userId);
    assert.equal(signupData.credentials.initialPassword, 'New@2004');

    const storedUser = await User.findOne({ userId: createdUserId }).select('+passwordHash');
    assert(storedUser);
    assert(await verifyPassword(signupData.credentials.initialPassword, storedUser.passwordHash));
    assert.equal(storedUser.managedBy.includes(activeFacultyId), true);
    assert(await AuditLog.exists({
      actorId: createdUserId,
      targetId: createdUserId,
      action: 'STUDENT_SELF_SIGNUP',
      details: { $regex: activeFacultyId }
    }));

    const nextStudentIdPreview = await generateNextStudentId();
    assert.equal(await generateNextStudentId(), nextStudentIdPreview, 'ID previews must not consume sequence values');

    const assignedFacultyLogin = await request('POST', '/api/auth/login', {
      userId: activeFacultyId,
      password: 'Faculty-Test-Password-2026'
    });
    const otherFacultyLogin = await request('POST', '/api/auth/login', {
      userId: otherFacultyId,
      password: 'Faculty-Test-Password-2026'
    });
    assert.equal(assignedFacultyLogin.status, 200);
    assert.equal(otherFacultyLogin.status, 200);
    const assignedFacultyUpdate = await request(
      'PATCH',
      `/api/users/students/${createdUserId}`,
      { phone: '+1 555 765 4321' },
      assignedFacultyLogin.body.data.token
    );
    assert.equal(assignedFacultyUpdate.status, 200);
    const otherFacultyUpdate = await request(
      'PATCH',
      `/api/users/students/${createdUserId}`,
      { phone: '+1 555 000 0000' },
      otherFacultyLogin.body.data.token
    );
    assert.equal(otherFacultyUpdate.status, 403);

    const login = await request('POST', '/api/auth/login', {
      userId: signupData.credentials.studentId,
      password: signupData.credentials.initialPassword
    });
    assert.equal(login.status, 200);
    const studentToken = login.body.data.token as string;

    const wrongCurrentPassword = await request('POST', '/api/auth/password', {
      currentPassword: 'incorrect',
      newPassword: 'New-Student-Password-2026'
    }, studentToken);
    assert.equal(wrongCurrentPassword.status, 400);

    const changedPassword = await request('POST', '/api/auth/password', {
      currentPassword: signupData.credentials.initialPassword,
      newPassword: 'New-Student-Password-2026'
    }, studentToken);
    assert.equal(changedPassword.status, 200);
    const oldPasswordLogin = await request('POST', '/api/auth/login', {
      userId: signupData.credentials.studentId,
      password: signupData.credentials.initialPassword
    });
    assert.equal(oldPasswordLogin.status, 401);
    const newPasswordLogin = await request('POST', '/api/auth/login', {
      userId: signupData.credentials.studentId,
      password: 'New-Student-Password-2026'
    });
    assert.equal(newPasswordLogin.status, 200);
    assert(await AuditLog.exists({
      actorId: createdUserId,
      targetId: createdUserId,
      action: 'USER_PASSWORD_CHANGED'
    }));

    const studentCannotGenerateAi = await request(
      'GET',
      '/api/ai/questions/drafts',
      undefined,
      studentToken
    );
    assert.equal(studentCannotGenerateAi.status, 403);
    const studentCannotManageQuestions = await request(
      'POST',
      '/api/questions',
      { questionText: 'Not allowed' },
      studentToken
    );
    assert.equal(studentCannotManageQuestions.status, 403);

    const duplicate = await request('POST', '/api/auth/signup/student', signupPayload(email));
    assert.equal(duplicate.status, 409);
    const inactiveFaculty = await request(
      'POST',
      '/api/auth/signup/student',
      signupPayload(`inactive-${Date.now()}@example.test`, inactiveFacultyId)
    );
    assert.equal(inactiveFaculty.status, 400);
    const invalidFaculty = await request(
      'POST',
      '/api/auth/signup/student',
      signupPayload(`invalid-faculty-${Date.now()}@example.test`, '12412699')
    );
    assert.equal(invalidFaculty.status, 400);
    const invalidDob = await request('POST', '/api/auth/signup/student', {
      ...signupPayload(`invalid-dob-${Date.now()}@example.test`),
      dob: '2099-02-31'
    });
    assert.equal(invalidDob.status, 400);

    const concurrentSignups = await Promise.allSettled(
      Array.from({ length: 20 }, (_, index) =>
        AuthService.signUpStudent(signupPayload(`concurrent-${Date.now()}-${index}@example.test`))
      )
    );
    const successfulConcurrentSignups = concurrentSignups.filter(
      (result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof AuthService.signUpStudent>>> =>
        result.status === 'fulfilled'
    );
    const concurrentIds = successfulConcurrentSignups.map(result => result.value.user.userId);
    createdStudentIds.push(...concurrentIds);
    assert(concurrentSignups.every(result => result.status === 'fulfilled'));
    assert.equal(concurrentIds.length, 20);
    assert.equal(new Set(concurrentIds).size, 20, 'Concurrent registrations must receive unique IDs');
    assert(concurrentIds.every(id => STUDENT_ID_REGEX.test(id)));
    const persistedConcurrentCount = await User.countDocuments({ userId: { $in: concurrentIds } });
    assert.equal(persistedConcurrentCount, 20);

    const collisionAttempts: string[] = [];
    const collisionRecoveryId = await createStudentWithGeneratedId(async studentId => {
      collisionAttempts.push(studentId);
      if (collisionAttempts.length === 1) {
        const collision: any = new Error('simulated unique student ID collision');
        collision.code = 11000;
        collision.keyPattern = { userId: 1 };
        throw collision;
      }
      return studentId;
    });
    assert.equal(collisionAttempts.length, 2);
    assert.equal(collisionRecoveryId, collisionAttempts[1]);
    assert.notEqual(collisionAttempts[0], collisionAttempts[1]);

    console.log('Student signup credentials, faculty ownership, password change, audit, RBAC, and concurrent ID tests passed');
  } finally {
    const temporaryUserIds = [
      ...createdStudentIds,
      activeFacultyId,
      otherFacultyId,
      inactiveFacultyId
    ].filter(Boolean);
    let remainingTemporaryUsers = 0;
    let remainingTemporaryAudits = 0;
    if (temporaryUserIds.length) {
      await User.deleteMany({ userId: { $in: temporaryUserIds } });
      await AuditLog.deleteMany({
        $or: [
          { actorId: { $in: temporaryUserIds } },
          { targetId: { $in: temporaryUserIds } }
        ]
      });
      remainingTemporaryUsers = await User.countDocuments({ userId: { $in: temporaryUserIds } });
      remainingTemporaryAudits = await AuditLog.countDocuments({
        $or: [
          { actorId: { $in: temporaryUserIds } },
          { targetId: { $in: temporaryUserIds } }
        ]
      });
    }
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
    await disconnectDatabase();
    assert.equal(mongoose.connection.readyState, 0);
    assert.equal(remainingTemporaryUsers, 0);
    assert.equal(remainingTemporaryAudits, 0);
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
