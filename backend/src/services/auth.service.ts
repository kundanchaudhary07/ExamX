import { User } from '../models/User';
import { hashPassword, verifyPassword } from '../utils/password';
import { signToken } from '../utils/token';
import { logger } from '../utils/logger';
import { AuditService } from './audit.service';
import { isUsingEmbeddedDatabase } from '../config/database';
import { isPersistenceEnabled, scheduleSnapshotSave } from '../config/persistence';
import { TEACHER_ID_REGEX, STUDENT_ID_REGEX } from '../utils/credential.generator';
import { emitAdminEvent, emitTeacherAndAdmin } from '../realtime/socket';

const INITIAL_CREDENTIAL_PASSWORD_REGEX = /^([A-Za-z][A-Za-z0-9._-]*)@([12][0-9]{3})$/;

export class AuthService {
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
