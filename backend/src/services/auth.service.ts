import { User } from '../models/User';
import { hashPassword, verifyPassword } from '../utils/password';
import { signToken } from '../utils/token';
import { logger } from '../utils/logger';
import { AuditService } from './audit.service';
import { isUsingEmbeddedDatabase } from '../config/database';
import { isPersistenceEnabled, scheduleSnapshotSave } from '../config/persistence';
import {
  TEACHER_ID_REGEX,
  STUDENT_ID_REGEX,
  createStudentWithGeneratedId,
  generateInitialPassword,
  isValidTeacherId,
  validateDateOfBirth
} from '../utils/credential.generator';
import { emitAdminEvent, emitTeacherAndAdmin } from '../realtime/socket';

const INITIAL_CREDENTIAL_PASSWORD_REGEX = /^([A-Za-z][A-Za-z0-9._-]*)@([12][0-9]{3})$/;

export class AuthService {
  static async signUpStudent(data: {
    name: unknown;
    email: unknown;
    phone: unknown;
    dob: unknown;
    course: unknown;
    department: unknown;
    semester: unknown;
    facultyId: unknown;
  }): Promise<{ user: any; credentials: { studentId: string; initialPassword: string } }> {
    const name = typeof data?.name === 'string' ? data.name.trim().replace(/\s+/g, ' ') : '';
    const email = typeof data?.email === 'string' ? data.email.trim().toLocaleLowerCase() : '';
    const phone = typeof data?.phone === 'string' ? data.phone.trim() : '';
    const rawDob = typeof data?.dob === 'string' ? data.dob.trim() : '';
    const course = typeof data?.course === 'string' ? data.course.trim().replace(/\s+/g, ' ') : '';
    const semester = typeof data?.semester === 'string' ? data.semester.trim() : '';
    const department = typeof data?.department === 'string' ? data.department.trim().replace(/\s+/g, ' ') : '';
    const facultyId = typeof data?.facultyId === 'string' ? data.facultyId.trim() : '';

    if (name.length < 2 || name.length > 120) {
      const error: any = new Error('Enter a name up to 120 characters.');
      error.statusCode = 400;
      throw error;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
      const error: any = new Error('Enter a valid email address.');
      error.statusCode = 400;
      throw error;
    }
    if (!/^[+]?[\d\s().-]{7,20}$/.test(phone) || phone.replace(/\D/g, '').length < 7) {
      const error: any = new Error('Enter a valid phone number.');
      error.statusCode = 400;
      throw error;
    }
    if (!course || course.length > 120) {
      const error: any = new Error('Select or enter a valid course.');
      error.statusCode = 400;
      throw error;
    }
    if (!/^Semester [1-8]$/.test(semester)) {
      const error: any = new Error('Select a valid semester.');
      error.statusCode = 400;
      throw error;
    }
    if (!department || department.length > 120) {
      const error: any = new Error('Enter a department up to 120 characters.');
      error.statusCode = 400;
      throw error;
    }
    if (!isValidTeacherId(facultyId)) {
      const error: any = new Error('Enter a valid Faculty ID.');
      error.statusCode = 400;
      throw error;
    }

    const { dob, year: dobYear } = validateDateOfBirth(rawDob);
    const faculty = await User.findOne({
      userId: facultyId,
      role: 'TEACHER',
      status: 'ACTIVE'
    }).select('userId');
    if (!faculty) {
      const error: any = new Error('Faculty ID does not belong to an active teacher.');
      error.statusCode = 400;
      throw error;
    }

    if (await User.exists({ email })) {
      const error: any = new Error('An account with this email already exists.');
      error.statusCode = 409;
      throw error;
    }

    const initialPassword = generateInitialPassword(name, dobYear);
    const passwordHash = await hashPassword(initialPassword);
    let student;
    try {
      student = await createStudentWithGeneratedId(studentId =>
        User.create({
          userId: studentId,
          name,
          email,
          phone,
          dob,
          dobYear,
          passwordHash,
          role: 'STUDENT',
          status: 'ACTIVE',
          department,
          course,
          semester,
          enrollmentNo: studentId,
          managedBy: [faculty.userId],
          teacherIds: [faculty.userId],
          createdBy: faculty.userId
        })
      );
    } catch (error: any) {
      if (error?.code === 11000 && (error?.keyPattern?.email || error?.keyValue?.email)) {
        const conflict: any = new Error('An account with this email already exists. Please sign in instead.');
        conflict.statusCode = 409;
        throw conflict;
      }
      throw error;
    }

    await AuditService.record({
      actorId: student.userId,
      actorName: student.name,
      actorRole: 'STUDENT',
      action: 'STUDENT_SELF_SIGNUP',
      targetType: 'USER',
      targetId: student.userId,
      details: `Student account created through public self-signup and assigned to faculty ${faculty.userId}; course=${course}; semester=${semester}; department=${department}`
    });

    emitTeacherAndAdmin([faculty.userId], 'student.created', { student: student.toJSON() });
    logger.info(`Student self-signup completed: ${student.userId}`);
    return {
      user: student.toJSON(),
      credentials: { studentId: student.userId, initialPassword }
    };
  }

  static async changeStudentPassword(
    userId: string,
    currentPassword: unknown,
    newPassword: unknown
  ): Promise<{ success: true }> {
    if (
      typeof currentPassword !== 'string' ||
      typeof newPassword !== 'string' ||
      newPassword.length < 8 ||
      Buffer.byteLength(newPassword, 'utf8') > 72
    ) {
      const error: any = new Error('New password must be at least 8 characters and no more than 72 UTF-8 bytes.');
      error.statusCode = 400;
      throw error;
    }

    const student = await User.findOne({ userId, role: 'STUDENT' }).select('+passwordHash');
    if (!student || !(await verifyPassword(currentPassword, student.passwordHash))) {
      const error: any = new Error('Current password is incorrect.');
      error.statusCode = 400;
      throw error;
    }

    student.passwordHash = await hashPassword(newPassword);
    await student.save();
    await AuditService.record({
      actorId: student.userId,
      actorName: student.name,
      actorRole: 'STUDENT',
      action: 'USER_PASSWORD_CHANGED',
      targetType: 'USER',
      targetId: student.userId,
      details: 'Student changed their own password'
    });
    logger.info(`Student password changed: ${student.userId}`);
    return { success: true };
  }

  static async login(userId: string, plainTextPassword: string): Promise<{ token: string; user: any }> {
    if (
      !userId ||
      typeof userId !== 'string' ||
      !userId.trim() ||
      !plainTextPassword ||
      typeof plainTextPassword !== 'string'
    ) {
      const err: any = new Error('User ID and Password are required');
      err.statusCode = 400;
      throw err;
    }

    const sanitizedUserId = userId.trim();
    const trimmedPassword = plainTextPassword.trim();

    // Explicitly select passwordHash which is hidden by default
    let user = await User.findOne({ userId: sanitizedUserId }).select('+passwordHash');

    // Automatic session recovery for valid generated Teacher/Student credentials after an embedded DB reset
    if (!user && isPersistenceEnabled() && isUsingEmbeddedDatabase()) {
      const credMatch = trimmedPassword.match(INITIAL_CREDENTIAL_PASSWORD_REGEX);
      const isTeacherId = TEACHER_ID_REGEX.test(sanitizedUserId);
      const isStudentId = STUDENT_ID_REGEX.test(sanitizedUserId);

      if (credMatch && (isTeacherId || isStudentId)) {
        const extractedName = credMatch[1];
        const extractedYear = parseInt(credMatch[2], 10);
        const passwordHash = await hashPassword(trimmedPassword);

        if (isTeacherId) {
          user = await User.create({
            userId: sanitizedUserId,
            name: extractedName,
            email: `${extractedName.toLowerCase()}.${sanitizedUserId}@faculty.examx.local`,
            dob: String(extractedYear),
            dobYear: extractedYear,
            passwordHash,
            role: 'TEACHER',
            status: 'ACTIVE',
            department: 'General Academics',
            createdBy: '12412699'
          });
          emitAdminEvent('teacher.created', { teacher: user.toJSON() });
        } else {
          const firstTeacher = await User.findOne({ role: 'TEACHER' }).select('userId').lean();
          const managerIds = firstTeacher?.userId ? [firstTeacher.userId] : [];
          user = await User.create({
            userId: sanitizedUserId,
            name: extractedName,
            email: `${extractedName.toLowerCase()}.${sanitizedUserId}@student.examx.local`,
            dob: String(extractedYear),
            dobYear: extractedYear,
            passwordHash,
            role: 'STUDENT',
            status: 'ACTIVE',
            department: 'General Academics',
            course: 'General',
            managedBy: managerIds,
            teacherIds: managerIds,
            createdBy: firstTeacher?.userId || '12412699'
          });
          emitTeacherAndAdmin(managerIds, 'student.created', { student: user.toJSON() });
        }

        scheduleSnapshotSave(10);
        user = await User.findOne({ userId: sanitizedUserId }).select('+passwordHash');
      }
    }

    if (!user) {
      logger.info(`Sign-in rejected: User ID not registered (${sanitizedUserId})`);
      const err: any = new Error('Invalid User ID or password.');
      err.statusCode = 401;
      throw err;
    }

    let isMatch = await verifyPassword(plainTextPassword, user.passwordHash);
    if (!isMatch && trimmedPassword !== plainTextPassword) {
      isMatch = await verifyPassword(trimmedPassword, user.passwordHash);
    }
    if (!isMatch) {
      logger.info(`Sign-in rejected: credential mismatch for user (${sanitizedUserId})`);
      const err: any = new Error('Invalid User ID or password.');
      err.statusCode = 401;
      throw err;
    }

    if (user.status !== 'ACTIVE') {
      logger.info(`Sign-in rejected: account status ${user.status} for user (${sanitizedUserId})`);
      const err: any = new Error(
        user.status === 'BLOCKED'
          ? 'Account is blocked due to proctoring violation or administrative action'
          : 'Account is inactive. Please contact your examination authority'
      );
      err.statusCode = 403;
      throw err;
    }

    const token = signToken({
      id: user._id.toString(),
      userId: user.userId,
      name: user.name,
      role: user.role
    });

    await AuditService.record({
      actorId: user.userId,
      actorName: user.name,
      actorRole: user.role,
      action: 'USER_LOGIN',
      targetType: 'USER',
      targetId: user.userId,
      details: `${user.role} [${user.userId}] authenticated`
    });

    logger.info(`Successful login: ${user.userId} (${user.role})`);

    const userObj = user.toJSON();

    return {
      token,
      user: userObj
    };
  }

  static async getMe(userId: string): Promise<any> {
    const user = await User.findOne({ userId });
    if (!user) {
      const err: any = new Error('User profile not found');
      err.statusCode = 404;
      throw err;
    }
    return user.toJSON();
  }
}
