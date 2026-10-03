import { ENV } from '../src/config/env';

async function testE2E() {
  const baseUrl = `http://localhost:${ENV.PORT || 3000}`;
  console.log(`Testing against running server at ${baseUrl}...`);

  // 1. Admin Login
  console.log('Step 1: Admin Login request...');
  const adminLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userId: ENV.ADMIN_USER_ID,
      password: ENV.ADMIN_INITIAL_PASSWORD
    })
  });

  const adminLoginData = (await adminLoginRes.json()) as any;
  if (!adminLoginRes.ok || !adminLoginData.success) {
    throw new Error(`Admin login failed: ${JSON.stringify(adminLoginData)}`);
  }

  const adminToken = adminLoginData.data.token;
  const adminUser = adminLoginData.data.user;

  console.log('✔ Admin login succeeded:', {
    userId: adminUser.userId,
    role: adminUser.role,
    status: adminUser.status,
    hasToken: !!adminToken
  });

  if (adminUser.userId !== '12412699' || adminUser.role !== 'ADMIN') {
    throw new Error('Admin user payload invalid');
  }

  // 2. /api/users/me for Admin
  console.log('Step 2: Admin GET /api/users/me...');
  const adminMeRes = await fetch(`${baseUrl}/api/users/me`, {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  const adminMeData = (await adminMeRes.json()) as any;
  if (!adminMeRes.ok || !adminMeData.success) {
    throw new Error(`Admin /api/users/me failed: ${JSON.stringify(adminMeData)}`);
  }
  console.log('✔ Admin /api/users/me succeeded:', {
    userId: adminMeData.data.user.userId,
    role: adminMeData.data.user.role
  });

  // 3. Admin creates Teacher
  console.log('Step 3: Admin provisions Teacher...');
  const createTeacherRes = await fetch(`${baseUrl}/api/users/teachers`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminToken}`
    },
    body: JSON.stringify({
      name: 'Dr. Evelyn Reed',
      dobYear: 1982,
      email: 'evelyn.reed@university.edu',
      department: 'Computer Science & Engineering',
      qualification: 'Ph.D. in Artificial Intelligence',
      designation: 'Associate Professor'
    })
  });
  const createTeacherData = (await createTeacherRes.json()) as any;
  if (!createTeacherRes.ok || !createTeacherData.success) {
    throw new Error(`Teacher creation failed: ${JSON.stringify(createTeacherData)}`);
  }

  const teacherCreds = createTeacherData.data.initialCredentials;
  console.log('✔ Teacher provisioned:', {
    userId: teacherCreds.userId,
    role: 'TEACHER',
    passwordFormat: teacherCreds.temporaryPassword ? 'valid' : 'missing'
  });

  // 4. Teacher Login
  console.log('Step 4: Teacher Login with generated credentials...');
  const teacherLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userId: teacherCreds.userId,
      password: teacherCreds.temporaryPassword
    })
  });
  const teacherLoginData = (await teacherLoginRes.json()) as any;
  if (!teacherLoginRes.ok || !teacherLoginData.success) {
    throw new Error(`Teacher login failed: ${JSON.stringify(teacherLoginData)}`);
  }
  const teacherToken = teacherLoginData.data.token;
  const teacherUser = teacherLoginData.data.user;
  console.log('✔ Teacher login succeeded:', {
    userId: teacherUser.userId,
    role: teacherUser.role
  });

  // 5. Teacher provisions Student
  console.log('Step 5: Teacher provisions Student...');
  const createStudentRes = await fetch(`${baseUrl}/api/users/students`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${teacherToken}`
    },
    body: JSON.stringify({
      name: 'Samantha Vance',
      dobYear: 2003,
      email: 'samantha.v@students.edu',
      department: 'Computer Science & Engineering',
      course: 'B.Tech CS',
      academicYear: '2024-2025',
      semester: '6',
      section: 'A'
    })
  });
  const createStudentData = (await createStudentRes.json()) as any;
  if (!createStudentRes.ok || !createStudentData.success) {
    throw new Error(`Student creation failed: ${JSON.stringify(createStudentData)}`);
  }
  const studentCreds = createStudentData.data.initialCredentials;
  console.log('✔ Student provisioned:', {
    userId: studentCreds.userId,
    role: 'STUDENT',
    passwordFormat: studentCreds.temporaryPassword ? 'valid' : 'missing'
  });

  // 6. Student Login
  console.log('Step 6: Student Login with generated credentials...');
  const studentLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userId: studentCreds.userId,
      password: studentCreds.temporaryPassword
    })
  });
  const studentLoginData = (await studentLoginRes.json()) as any;
  if (!studentLoginRes.ok || !studentLoginData.success) {
    throw new Error(`Student login failed: ${JSON.stringify(studentLoginData)}`);
  }
  const studentUser = studentLoginData.data.user;
  console.log('✔ Student login succeeded:', {
    userId: studentUser.userId,
    role: studentUser.role
  });

  console.log('====================================================');
  console.log('ALL E2E ROLES AUTHENTICATION VERIFIED SUCCESSFULLY:');
  console.log('- ADMIN:   ' + adminUser.userId + ' -> ' + adminUser.role);
  console.log('- TEACHER: ' + teacherUser.userId + ' -> ' + teacherUser.role);
  console.log('- STUDENT: ' + studentUser.userId + ' -> ' + studentUser.role);
  console.log('====================================================');
}

testE2E()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('E2E TEST FAILED:', err.message);
    process.exit(1);
  });
