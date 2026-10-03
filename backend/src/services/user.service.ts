import mongoose from 'mongoose';
import { User } from '../models/User';
import { Exam } from '../models/Exam';
import { Question } from '../models/Question';
import { Result } from '../models/Result';
import { StudentQuery } from '../models/StudentQuery';
import { AuditLog } from '../models/AuditLog';
import { ExamAttempt } from '../models/ExamAttempt';
import { ExamAssignment } from '../models/ExamAssignment';
import { hashPassword } from '../utils/password';
import { JwtUserPayload, UserStatus } from '../types/auth.types';
import { logger } from '../utils/logger';
import { AuditService } from './audit.service';
import {
  emitAdminEvent,
  emitTeacherAndAdmin,
  emitStudentTeacherAdmin,
  emitNotification
} from '../realtime/socket';
import {
  generateNextTeacherId,
  generateNextStudentId,
  generateInitialPassword,
  extractBirthYear
} from '../utils/credential.generator';

const VALID_STATUSES: UserStatus[] = ['ACTIVE', 'INACTIVE', 'BLOCKED'];

export class UserService {
  // --- TEACHER MANAGEMENT (ADMIN ONLY) ---

  static async createTeacher(
    data: {
      name: string;
      dobYear?: number | string;
      dob?: string;
      email?: string;
      phone?: string;
      department?: string;
      qualification?: string;
      specialization?: string;
      designation?: string;
      experienceYears?: number;
    },
    adminUserId: string
  ) {
    if (!data || !data.name || typeof data.name !== 'string' || !data.name.trim()) {
      const err: any = new Error('Teacher name is required');
      err.statusCode = 400;
      throw err;
    }

    const dobInput = data.dobYear ?? data.dob;
    if (!dobInput) {
      const err: any = new Error('DOB or DOB Year is required to generate teacher initial credentials');
      err.statusCode = 400;
      throw err;
    }

    const parsedYear = extractBirthYear(dobInput);

    // 1. Authoritative Backend Generation of Teacher ID (^1251[0-9]{4}$)
    const teacherId = await generateNextTeacherId();

    // 2. Authoritative Backend Generation of Initial Password (Name@DOB-Year)
    const initialPlainPassword = generateInitialPassword(data.name, parsedYear);

    // 3. Immediately Hash with bcrypt
    const passwordHash = await hashPassword(initialPlainPassword);

    // 4. Persist in MongoDB (strictly only passwordHash, never plaintext password)
    const teacher = await User.create({
      userId: teacherId,
      name: data.name.trim(),
      email: typeof data.email === 'string' ? data.email.trim() : '',
      phone: typeof data.phone === 'string' ? data.phone.trim() : '',
      dob: typeof data.dob === 'string' ? data.dob.trim() : String(parsedYear),
      dobYear: parsedYear,
      passwordHash,
      role: 'TEACHER',
      status: 'ACTIVE',
      department: typeof data.department === 'string' ? data.department.trim() : '',
      qualification: typeof data.qualification === 'string' ? data.qualification.trim() : '',
      specialization: typeof data.specialization === 'string' ? data.specialization.trim() : '',
      designation: typeof data.designation === 'string' ? data.designation.trim() : '',
      experienceYears: typeof data.experienceYears === 'number' ? data.experienceYears : 0,
      createdBy: adminUserId
    });

    await AuditService.record({
      actorId: adminUserId,
      actorName: 'Administrator',
      actorRole: 'ADMIN',
      action: 'TEACHER_CREATED',
      targetType: 'USER',
      targetId: teacher.userId,
      details: `Provisioned teacher account ${teacher.name} (${teacher.userId})`
    });

    // 5. Safe Logging: NEVER log plaintext password
    logger.info(`Teacher account provisioned: ${teacher.userId} by admin: ${adminUserId}`);

    const userObj = teacher.toJSON();

    // 6. Emit real-time event (sanitized user only, never plaintext password)
    emitAdminEvent('teacher.created', { teacher: userObj }, adminUserId);
    emitNotification(
      ['role:ADMIN'],
      {
        id: `notif-${Date.now()}-${teacher.userId}`,
        title: `Teacher created: ${teacher.name} (${teacher.userId})`
      },
      adminUserId
    );

    return {
      user: userObj,
      teacher: userObj,
      initialCredentials: {
        userId: teacher.userId,
        temporaryPassword: initialPlainPassword
      },
      credentials: {
        userId: teacher.userId,
        password: initialPlainPassword
      }
    };
  }

  static async getNextTeacherId(): Promise<string> {
    return generateNextTeacherId();
  }

  static async getNextStudentId(): Promise<string> {
    return generateNextStudentId();
  }

  static async getTeachers() {
    const [teachers, students] = await Promise.all([
      User.find({ role: 'TEACHER' }).sort({ createdAt: -1 }),
      User.find({ role: 'STUDENT' }).select('userId managedBy teacherIds').lean()
    ]);

    const countMap: Record<string, number> = {};
    for (const stu of students) {
      const ids = Array.from(new Set([...(stu.managedBy || []), ...(stu.teacherIds || [])]));
      for (const tid of ids) {
        countMap[tid] = (countMap[tid] || 0) + 1;
      }
    }

    return teachers.map(t => {
      const obj: any = t.toJSON();
      obj.studentsCount = countMap[t.userId] || 0;
      return obj;
    });
  }

  static async getTeacherDetails(teacherUserId: string, requester: JwtUserPayload) {
    if (requester.role !== 'ADMIN' && requester.userId !== teacherUserId) {
      const err: any = new Error('Forbidden: Only ADMIN can access teacher details');
      err.statusCode = 403;
      throw err;
    }

    const teacher = await User.findOne({
      $or: [
        { userId: teacherUserId },
        ...(mongoose.Types.ObjectId.isValid(teacherUserId) ? [{ _id: teacherUserId }] : [])
      ],
      role: 'TEACHER'
    });
    if (!teacher) {
      const err: any = new Error('Teacher not found');
      err.statusCode = 404;
      throw err;
    }

    const resolvedUserId = teacher.userId;

    const exams = await Exam.find({ createdBy: resolvedUserId }).sort({ createdAt: -1 });
    const examIds = exams.map(e => e.examId);

    const [assignedFromExams, directExamAssigned] = await Promise.all([
      ExamAssignment.find({ examId: { $in: examIds } }).select('studentId').lean(),
      Promise.resolve(
        exams.flatMap(e => [
          ...((e as any).assignedStudents || []),
          ...((e as any).assignedStudentIds || [])
        ])
      )
    ]);

    const examStudentIds = Array.from(
      new Set([
        ...assignedFromExams.map(a => a.studentId),
        ...directExamAssigned
      ])
    ).filter(Boolean);

    const [students, questionsCount, recentActivity] = await Promise.all([
      User.find({
        role: 'STUDENT',
        $or: [
          { managedBy: resolvedUserId },
          { teacherIds: resolvedUserId },
          { createdBy: resolvedUserId },
          ...(examStudentIds.length > 0 ? [{ userId: { $in: examStudentIds } }] : [])
        ]
      }).sort({ createdAt: -1 }),
      Question.countDocuments({ createdBy: resolvedUserId, status: { $ne: 'ARCHIVED' } }),
      AuditLog.find({
        $or: [{ actorId: resolvedUserId }, { targetId: resolvedUserId }]
      })
        .sort({ timestamp: -1 })
        .limit(20)
    ]);

    const queriesCount = await StudentQuery.countDocuments({
      $or: [{ examId: { $in: examIds } }, { resolvedBy: resolvedUserId }]
    });

    const teacherObj: any = teacher.toJSON();
    teacherObj.studentsCount = students.length;

    const allStudentsJson = students.map(s => s.toJSON());
    const allExamsJson = exams.map(e => e.toJSON());

    return {
      teacher: teacherObj,
      kpis: {
        students: students.length,
        exams: exams.length,
        questions: questionsCount,
        queries: queriesCount,
        assignedStudentsCount: students.length,
        createdExamsCount: exams.length,
        evaluatedResultsCount: questionsCount,
        pendingQueriesCount: queriesCount
      },
      assignedStudents: allStudentsJson,
      allStudents: allStudentsJson,
      recentStudents: allStudentsJson.slice(0, 20),
      createdExams: allExamsJson,
      allExams: allExamsJson,
      recentExams: allExamsJson.slice(0, 20),
      recentActivity: recentActivity.map(a => a.toJSON())
    };
  }

  static async updateTeacher(
    targetUserId: string,
    updates: {
      name?: string;
      email?: string;
      phone?: string;
      status?: UserStatus;
      department?: string;
      qualification?: string;
      specialization?: string;
      designation?: string;
      experienceYears?: number;
    },
    adminUserId: string
  ) {
    const teacher = await User.findOne({ userId: targetUserId, role: 'TEACHER' });
    if (!teacher) {
      const err: any = new Error('Teacher not found');
      err.statusCode = 404;
      throw err;
    }

    if (updates.status !== undefined && !VALID_STATUSES.includes(updates.status)) {
      const err: any = new Error(`Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}`);
      err.statusCode = 400;
      throw err;
    }

    const previousStatus = teacher.status;
    if (typeof updates.name === 'string' && updates.name.trim()) teacher.name = updates.name.trim();
    if (typeof updates.email === 'string') teacher.email = updates.email.trim();
    if (typeof updates.phone === 'string') teacher.phone = updates.phone.trim();
    if (typeof updates.department === 'string' && updates.department.trim()) teacher.department = updates.department.trim();
    if (typeof updates.qualification === 'string') teacher.qualification = updates.qualification.trim();
    if (typeof updates.specialization === 'string') teacher.specialization = updates.specialization.trim();
    if (typeof updates.designation === 'string') teacher.designation = updates.designation.trim();
    if (typeof updates.experienceYears === 'number') teacher.experienceYears = updates.experienceYears;
    if (updates.status) teacher.status = updates.status;

    await teacher.save();
    const userObj = teacher.toJSON();

    if (updates.status && updates.status !== previousStatus) {
      await AuditService.record({
        actorId: adminUserId,
        actorName: 'Administrator',
        actorRole: 'ADMIN',
        action: 'USER_STATUS_CHANGED',
        targetType: 'USER',
        targetId: targetUserId,
        details: `Teacher ${targetUserId} status changed from ${previousStatus} to ${updates.status}`
      });
      emitTeacherAndAdmin(
        targetUserId,
        'teacher.statusChanged',
        { teacher: userObj, previousStatus, status: teacher.status },
        adminUserId
      );
    }

    emitTeacherAndAdmin(targetUserId, 'teacher.updated', { teacher: userObj }, adminUserId);

    logger.info(`Teacher ${targetUserId} updated by admin ${adminUserId}`);
    return userObj;
  }

  static async resetTeacherPassword(targetUserId: string, newPassword: string | undefined, adminUserId: string) {
    const teacher = await User.findOne({ userId: targetUserId, role: 'TEACHER' });
    if (!teacher) {
      const err: any = new Error('Teacher not found');
      err.statusCode = 404;
      throw err;
    }

    const resolvedPassword =
      newPassword && typeof newPassword === 'string' && newPassword.trim().length >= 6
        ? newPassword.trim()
        : generateInitialPassword(teacher.name, teacher.dobYear || teacher.dob || 1985);

    teacher.passwordHash = await hashPassword(resolvedPassword);
    await teacher.save();
    logger.info(`Teacher ${targetUserId} password reset by admin ${adminUserId}`);
    return {
      success: true,
      message: 'Password reset successfully',
      data: {
        initialCredentials: {
          userId: teacher.userId,
          temporaryPassword: resolvedPassword
        }
      }
    };
  }

  // --- STUDENT MANAGEMENT (ADMIN & TEACHER) ---

  static async createStudent(
    data: {
      name: string;
      dobYear?: number | string;
      dob?: string;
      email?: string;
      phone?: string;
      enrollmentNo?: string;
      course?: string;
      department?: string;
      academicYear?: string;
      semester?: string;
      section?: string;
      assignedTeachers?: string[];
      managedBy?: string[];
      assignedTeacherId?: string;
    },
    requester: JwtUserPayload
  ) {
    if (!data || !data.name || typeof data.name !== 'string' || !data.name.trim()) {
      const err: any = new Error('Student name is required');
      err.statusCode = 400;
      throw err;
    }

    const dobInput = data.dobYear ?? data.dob;
    if (!dobInput) {
      const err: any = new Error('DOB or DOB Year is required to generate student initial credentials');
      err.statusCode = 400;
      throw err;
    }

    const parsedYear = extractBirthYear(dobInput);

    // 1. Authoritative Backend Generation of Student ID (^1261[0-9]{4}$)
    const studentId = await generateNextStudentId();

    // 2. Authoritative Backend Generation of Initial Password (Name@DOB-Year)
    const initialPlainPassword = generateInitialPassword(data.name, parsedYear);

    // 3. Immediately Hash with bcrypt
    const passwordHash = await hashPassword(initialPlainPassword);

    // 4. Strict Ownership: Teacher-created students are assigned to that teacher
    const rawAssigned =
      data.assignedTeachers ??
      data.managedBy ??
      (data.assignedTeacherId ? [data.assignedTeacherId] : []);
    const managedBy =
      requester.role === 'TEACHER'
        ? [requester.userId]
        : Array.isArray(rawAssigned)
        ? rawAssigned.map(s => String(s).trim()).filter(Boolean)
        : [];

    // 5. Persist in MongoDB (strictly only passwordHash)
    const student = await User.create({
      userId: studentId,
      name: data.name.trim(),
      email: typeof data.email === 'string' ? data.email.trim() : '',
      phone: typeof data.phone === 'string' ? data.phone.trim() : '',
      dob: typeof data.dob === 'string' ? data.dob.trim() : String(parsedYear),
      dobYear: parsedYear,
      passwordHash,
      role: 'STUDENT',
      status: 'ACTIVE',
      enrollmentNo:
        typeof data.enrollmentNo === 'string' && data.enrollmentNo.trim()
          ? data.enrollmentNo.trim()
          : studentId,
      course: typeof data.course === 'string' ? data.course.trim() : '',
      department: typeof data.department === 'string' ? data.department.trim() : '',
      academicYear: typeof data.academicYear === 'string' ? data.academicYear.trim() : '',
      semester: typeof data.semester === 'string' ? data.semester.trim() : '',
      section: typeof data.section === 'string' ? data.section.trim() : '',
      managedBy,
      teacherIds: managedBy,
      createdBy: requester.userId
    });

    await AuditService.record({
      actorId: requester.userId,
      actorName: requester.name,
      actorRole: requester.role,
      action: 'STUDENT_CREATED',
      targetType: 'USER',
      targetId: student.userId,
      details: `Provisioned student account ${student.name} (${student.userId})`
    });

    if (managedBy.length > 0) {
      await AuditService.record({
        actorId: requester.userId,
        actorName: requester.name,
        actorRole: requester.role,
        action: 'STUDENT_ASSIGNED',
        targetType: 'USER',
        targetId: student.userId,
        details: `Assigned student ${student.userId} to teacher(s): ${managedBy.join(', ')}`
      });
    }

    // 6. Safe Logging: NEVER log plaintext password
    logger.info(`Student account provisioned: ${student.userId} by ${requester.role}: ${requester.userId}`);

    const userObj = student.toJSON();

    // 7. Emit real-time events to Admin and assigned teacher rooms
    emitTeacherAndAdmin(managedBy, 'student.created', { student: userObj }, requester.userId);
    if (managedBy.length > 0) {
      emitStudentTeacherAdmin(
        student.userId,
        managedBy,
        'student.assigned',
        { student: userObj, teacherIds: managedBy },
        requester.userId
      );
    }
    emitNotification(
      ['role:ADMIN', ...managedBy.map(id => `teacher:${id}`)],
      {
        id: `notif-${Date.now()}-${student.userId}`,
        title: `Student created: ${student.name} (${student.userId})`
      },
      requester.userId
    );

    return {
      user: userObj,
      student: userObj,
      initialCredentials: {
        userId: student.userId,
        temporaryPassword: initialPlainPassword
      },
      credentials: {
        userId: student.userId,
        password: initialPlainPassword
      }
    };
  }

  static async getStudents(requester: JwtUserPayload) {
    let filter: any = { role: 'STUDENT' as const };

    if (requester.role === 'TEACHER') {
      const teacherExams = await Exam.find({ createdBy: requester.userId })
        .select('examId assignedStudents assignedStudentIds')
        .lean();
      const teacherExamIds = teacherExams.map(e => e.examId);
      const [assignedFromExams, directAssigned] = await Promise.all([
        ExamAssignment.find({ examId: { $in: teacherExamIds } }).select('studentId').lean(),
        Promise.resolve(
          teacherExams.flatMap(e => [
            ...((e as any).assignedStudents || []),
            ...((e as any).assignedStudentIds || [])
          ])
        )
      ]);
      const examStudentIds = Array.from(
        new Set([...assignedFromExams.map(a => a.studentId), ...directAssigned])
      ).filter(Boolean);

      filter = {
        role: 'STUDENT' as const,
        $or: [
          { managedBy: requester.userId },
          { teacherIds: requester.userId },
          { createdBy: requester.userId },
          ...(examStudentIds.length > 0 ? [{ userId: { $in: examStudentIds } }] : [])
        ]
      };
    }

    const [students, teachers, exams, assignments] = await Promise.all([
      User.find(filter).sort({ createdAt: -1 }),
      User.find({ role: 'TEACHER' }).select('userId name').lean(),
      Exam.find({ status: { $ne: 'ARCHIVED' } })
        .select('examId assignedStudents assignedStudentIds')
        .lean(),
      ExamAssignment.find({}).select('examId studentId').lean()
    ]);

    const teacherNameMap: Record<string, string> = {};
    for (const t of teachers) {
      teacherNameMap[t.userId] = t.name;
    }

    const studentExamSetMap: Record<string, Set<string>> = {};
    for (const a of assignments) {
      if (!studentExamSetMap[a.studentId]) studentExamSetMap[a.studentId] = new Set();
      studentExamSetMap[a.studentId].add(a.examId);
    }
    for (const ex of exams) {
      const assignedList = [
        ...((ex as any).assignedStudents || []),
        ...((ex as any).assignedStudentIds || [])
      ];
      for (const sid of assignedList) {
        if (!studentExamSetMap[sid]) studentExamSetMap[sid] = new Set();
        studentExamSetMap[sid].add(ex.examId);
      }
    }

    return students.map(s => {
      const obj: any = s.toJSON();
      const teacherIds = Array.from(new Set([...(s.managedBy || []), ...(s.teacherIds || [])]));
      obj.assignedTeachers = teacherIds.map(tid => ({
        userId: tid,
        name: teacherNameMap[tid] || tid
      }));
      obj.assignedTeacherNames = obj.assignedTeachers.map((t: any) => t.name);
      obj.examsCount = studentExamSetMap[s.userId]?.size || 0;
      return obj;
    });
  }

  static async getStudentDetails(studentUserId: string, requester: JwtUserPayload) {
    const student = await User.findOne({
      $or: [
        { userId: studentUserId },
        ...(mongoose.Types.ObjectId.isValid(studentUserId) ? [{ _id: studentUserId }] : [])
      ],
      role: 'STUDENT'
    });
    if (!student) {
      const err: any = new Error('Student not found');
      err.statusCode = 404;
      throw err;
    }

    const resolvedStudentId = student.userId;

    if (requester.role === 'STUDENT' && requester.userId !== resolvedStudentId) {
      const err: any = new Error('Forbidden: Students cannot access another student profile');
      err.statusCode = 403;
      throw err;
    }

    if (requester.role === 'TEACHER') {
      const ownsDirectly =
        (Array.isArray(student.managedBy) && student.managedBy.includes(requester.userId)) ||
        (Array.isArray(student.teacherIds) && student.teacherIds.includes(requester.userId)) ||
        student.createdBy === requester.userId;

      let owns = ownsDirectly;
      if (!owns) {
        const teacherExams = await Exam.find({ createdBy: requester.userId })
          .select('examId assignedStudents assignedStudentIds')
          .lean();
        const teacherExamIds = teacherExams.map(e => e.examId);
        const [hasAssignment, hasAttempt] = await Promise.all([
          ExamAssignment.exists({ examId: { $in: teacherExamIds }, studentId: resolvedStudentId }),
          ExamAttempt.exists({ examId: { $in: teacherExamIds }, studentId: resolvedStudentId })
        ]);
        const hasDirectExam = teacherExams.some(e =>
          (Array.isArray(e.assignedStudents) && e.assignedStudents.includes(resolvedStudentId)) ||
          (Array.isArray(e.assignedStudentIds) && e.assignedStudentIds.includes(resolvedStudentId))
        );
        owns = Boolean(hasAssignment || hasAttempt || hasDirectExam);
      }

      if (!owns) {
        const err: any = new Error('Forbidden: You are not assigned to manage this student');
        err.statusCode = 403;
        throw err;
      }
    }

    const teacherIds = Array.from(
      new Set([...(student.managedBy || []), ...(student.teacherIds || [])])
    );

    const [teachers, assignments, attempts, results, queries] = await Promise.all([
      User.find({ role: 'TEACHER', userId: { $in: teacherIds } }).select('userId name department').lean(),
      ExamAssignment.find({ studentId: resolvedStudentId }).select('examId').lean(),
      ExamAttempt.find({ studentId: resolvedStudentId }).sort({ createdAt: -1 }).lean(),
      Result.find(
        requester.role === 'STUDENT'
          ? { studentId: resolvedStudentId, status: { $in: ['PUBLISHED', 'QUERIED', 'REVISED'] } }
          : { studentId: resolvedStudentId }
      )
        .sort({ createdAt: -1 })
        .lean(),
      StudentQuery.find({ studentId: resolvedStudentId }).sort({ createdAt: -1 }).lean()
    ]);

    const assignedExamIds = assignments.map(a => a.examId);
    const assignedExamsDocs = await Exam.find({
      $or: [
        { examId: { $in: assignedExamIds } },
        { assignedStudents: resolvedStudentId },
        { assignedStudentIds: resolvedStudentId }
      ],
      status: { $ne: 'ARCHIVED' }
    })
      .sort({ createdAt: -1 })
      .lean();

    const completedExamIds = new Set(
      attempts
        .filter(a => ['SUBMITTED', 'EXPIRED', 'EVALUATED', 'TERMINATED'].includes(a.status))
        .map(a => a.examId)
    );

    const assignedCount = assignedExamsDocs.length;
    const completedCount = assignedExamsDocs.filter(e => completedExamIds.has(e.examId)).length;
    const pendingCount = Math.max(0, assignedCount - completedCount);
    const publishedResultsCount = results.filter(r =>
      ['PUBLISHED', 'QUERIED', 'REVISED'].includes(r.status)
    ).length;

    const studentObj: any = student.toJSON();
    studentObj.assignedTeachers = teachers.map(t => ({
      userId: t.userId,
      name: t.name,
      department: t.department
    }));
    studentObj.assignedTeacherNames = teachers.map(t => t.name);

    return {
      student: studentObj,
      kpis: {
        assignedExams: assignedCount,
        completedExams: completedCount,
        pendingExams: pendingCount,
        publishedResults: publishedResultsCount
      },
      recentExams: assignedExamsDocs.map(ex => {
        const latestAttempt = attempts.find(a => a.examId === ex.examId);
        return {
          ...ex,
          id: ex.examId,
          attemptStatus: latestAttempt?.status || 'NOT_STARTED'
        };
      }),
      results,
      queries
    };
  }

  static async getStudentById(studentUserId: string, requester: JwtUserPayload) {
    const details = await this.getStudentDetails(studentUserId, requester);
    return {
      ...details.student,
      kpis: details.kpis,
      recentExams: details.recentExams,
      results: details.results,
      queries: details.queries
    };
  }

  static async getUserById(targetUserId: string, requester: JwtUserPayload) {
    const user = await User.findOne({ userId: targetUserId });
    if (!user) {
      const err: any = new Error('User not found');
      err.statusCode = 404;
      throw err;
    }

    if (requester.role === 'ADMIN') {
      return user.toJSON();
    }

    if (requester.userId === targetUserId) {
      return user.toJSON();
    }

    if (requester.role === 'TEACHER' && user.role === 'STUDENT') {
      const owns =
        user.managedBy.includes(requester.userId) ||
        (Array.isArray(user.teacherIds) && user.teacherIds.includes(requester.userId));
      if (owns) {
        return user.toJSON();
      }
    }

    const err: any = new Error('Forbidden: You do not have permission to access this user');
    err.statusCode = 403;
    throw err;
  }

  static async updateStudent(
    studentUserId: string,
    updates: {
      name?: string;
      email?: string;
      phone?: string;
      status?: UserStatus;
      enrollmentNo?: string;
      course?: string;
      department?: string;
      academicYear?: string;
      semester?: string;
      section?: string;
      managedBy?: string[];
      teacherIds?: string[];
    },
    requester: JwtUserPayload
  ) {
    const student = await User.findOne({ userId: studentUserId, role: 'STUDENT' });
    if (!student) {
      const err: any = new Error('Student not found');
      err.statusCode = 404;
      throw err;
    }

    // RBAC: If teacher, must be managing this student
    if (requester.role === 'TEACHER') {
      if (!student.managedBy.includes(requester.userId)) {
        const err: any = new Error('Unauthorized: You are not assigned to manage this student');
        err.statusCode = 403;
        throw err;
      }
    }

    if (updates.status !== undefined && !VALID_STATUSES.includes(updates.status)) {
      const err: any = new Error(`Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}`);
      err.statusCode = 400;
      throw err;
    }

    const previousStatus = student.status;
    const previousManagedBy = [...(student.managedBy || [])];
    if (typeof updates.name === 'string' && updates.name.trim()) student.name = updates.name.trim();
    if (typeof updates.email === 'string') student.email = updates.email.trim();
    if (typeof updates.phone === 'string') student.phone = updates.phone.trim();
    if (typeof updates.enrollmentNo === 'string') student.enrollmentNo = updates.enrollmentNo.trim();
    if (typeof updates.course === 'string') student.course = updates.course.trim();
    if (typeof updates.department === 'string' && updates.department.trim()) student.department = updates.department.trim();
    if (typeof updates.academicYear === 'string') student.academicYear = updates.academicYear.trim();
    if (typeof updates.semester === 'string') student.semester = updates.semester.trim();
    if (typeof updates.section === 'string') student.section = updates.section.trim();

    const nextTeachers = updates.managedBy ?? updates.teacherIds;
    let assignmentChanged = false;
    if (requester.role === 'ADMIN' && Array.isArray(nextTeachers)) {
      const cleaned = nextTeachers.map(t => String(t).trim()).filter(Boolean);
      assignmentChanged = cleaned.join(',') !== previousManagedBy.join(',');
      student.managedBy = cleaned;
      student.teacherIds = cleaned;
    }
    if (updates.status) student.status = updates.status;

    await student.save();
    const userObj = student.toJSON();
    const allNotifyTeachers = Array.from(new Set([...previousManagedBy, ...(student.managedBy || [])]));

    if (assignmentChanged) {
      await AuditService.record({
        actorId: requester.userId,
        actorName: requester.name,
        actorRole: requester.role,
        action: 'STUDENT_ASSIGNED',
        targetType: 'USER',
        targetId: studentUserId,
        details: `Assigned student ${studentUserId} to teacher(s): ${student.managedBy.join(', ') || 'None'}`
      });
      emitStudentTeacherAdmin(
        studentUserId,
        allNotifyTeachers,
        'student.assigned',
        { student: userObj, teacherIds: student.managedBy },
        requester.userId
      );
    }

    if (updates.status && updates.status !== previousStatus) {
      await AuditService.record({
        actorId: requester.userId,
        actorName: requester.name,
        actorRole: requester.role,
        action: 'USER_STATUS_CHANGED',
        targetType: 'USER',
        targetId: studentUserId,
        details: `Student ${studentUserId} status changed from ${previousStatus} to ${updates.status}`
      });
      emitStudentTeacherAdmin(
        studentUserId,
        allNotifyTeachers,
        'student.statusChanged',
        { student: userObj, previousStatus, status: student.status },
        requester.userId
      );
    }

    emitStudentTeacherAdmin(studentUserId, allNotifyTeachers, 'student.updated', { student: userObj }, requester.userId);

    logger.info(`Student ${studentUserId} updated by ${requester.role}: ${requester.userId}`);
    return userObj;
  }

  static async resetStudentPassword(
    studentUserId: string,
    newPassword: string | undefined,
    requester: JwtUserPayload
  ) {
    const student = await User.findOne({ userId: studentUserId, role: 'STUDENT' });
    if (!student) {
      const err: any = new Error('Student not found');
      err.statusCode = 404;
      throw err;
    }

    // RBAC: If teacher, must be managing this student
    if (requester.role === 'TEACHER') {
      if (!student.managedBy.includes(requester.userId)) {
        const err: any = new Error('Unauthorized: You are not assigned to manage this student');
        err.statusCode = 403;
        throw err;
      }
    }

    const resolvedPassword =
      newPassword && typeof newPassword === 'string' && newPassword.trim().length >= 6
        ? newPassword.trim()
        : generateInitialPassword(student.name, student.dobYear || student.dob || 2004);

    student.passwordHash = await hashPassword(resolvedPassword);
    await student.save();
    logger.info(`Student ${studentUserId} password reset by ${requester.role}: ${requester.userId}`);
    return {
      success: true,
      message: 'Student password reset successfully',
      data: {
        initialCredentials: {
          userId: student.userId,
          temporaryPassword: resolvedPassword
        }
      }
    };
  }

  static async updateUserStatus(
    targetUserId: string,
    status: UserStatus,
    requester: JwtUserPayload
  ) {
    if (!status || !VALID_STATUSES.includes(status)) {
      const err: any = new Error(`Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}`);
      err.statusCode = 400;
      throw err;
    }

    const target = await User.findOne({ userId: targetUserId });
    if (!target) {
      const err: any = new Error('User not found');
      err.statusCode = 404;
      throw err;
    }

    if (target.role === 'ADMIN') {
      const err: any = new Error('Forbidden: Cannot change status of an Admin account');
      err.statusCode = 403;
      throw err;
    }

    if (target.role === 'TEACHER') {
      if (requester.role !== 'ADMIN') {
        const err: any = new Error('Forbidden: Only ADMIN can change Teacher status');
        err.statusCode = 403;
        throw err;
      }
      return this.updateTeacher(targetUserId, { status }, requester.userId);
    }

    return this.updateStudent(targetUserId, { status }, requester);
  }
}


