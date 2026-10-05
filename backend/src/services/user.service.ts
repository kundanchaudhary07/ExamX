import mongoose from 'mongoose';
import { User } from '../models/User';
import { Exam } from '../models/Exam';
import { Question } from '../models/Question';
import { Result } from '../models/Result';
import { StudentQuery } from '../models/StudentQuery';
import { AuditLog } from '../models/AuditLog';
import { ExamAttempt } from '../models/ExamAttempt';
import { ExamAssignment } from '../models/ExamAssignment';
import { ProctoringEvent } from '../models/ProctoringEvent';
import { UnblockRequest } from '../models/UnblockRequest';
import { createInitialPasswordCredential, hashPassword } from '../utils/password';
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
  extractBirthYear,
  createStudentWithGeneratedId
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
    const passwordHash = await hashPassword(initialPlainPassword);

    // 3. Persist in MongoDB (strictly only passwordHash, never plaintext password)
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
    // 2. Authoritative Backend Generation of Initial Password (Name@DOB-Year)
    const initialCredential = await createInitialPasswordCredential(data.name, parsedYear);

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
    const student = await createStudentWithGeneratedId(async studentId =>
      User.create({
        userId: studentId,
        name: data.name.trim(),
        email: typeof data.email === 'string' ? data.email.trim() : '',
        phone: typeof data.phone === 'string' ? data.phone.trim() : '',
        dob: typeof data.dob === 'string' ? data.dob.trim() : String(parsedYear),
        dobYear: parsedYear,
        passwordHash: initialCredential.passwordHash,
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
      })
    );

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
        temporaryPassword: initialCredential.password
      },
      credentials: {
        userId: student.userId,
        password: initialCredential.password
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

    const visibleResultStatuses = ['PUBLISHED', 'QUERIED', 'REVISED'] as const;
    const [teachers, assignments, attempts, allResults, queries, unblockRequests, proctoringGroups, overallRankRows] = await Promise.all([
      User.find({ role: 'TEACHER', userId: { $in: teacherIds } }).select('userId name department').lean(),
      ExamAssignment.find({ studentId: resolvedStudentId }).select('examId').lean(),
      ExamAttempt.find({ studentId: resolvedStudentId }).sort({ createdAt: -1 }).lean(),
      Result.find({ studentId: resolvedStudentId }).sort({ submittedAt: -1, _id: -1 }).lean(),
      StudentQuery.find({ studentId: resolvedStudentId }).sort({ createdAt: -1 }).lean(),
      UnblockRequest.find({ studentId: resolvedStudentId }).sort({ createdAt: -1 }).lean(),
      ProctoringEvent.aggregate([
        { $match: { studentId: resolvedStudentId } },
        {
          $group: {
            _id: { examId: '$examId', eventType: '$eventType', severity: '$severity' },
            count: { $sum: 1 }
          }
        }
      ]),
      Result.aggregate([
        { $match: { status: { $in: visibleResultStatuses } } },
        { $sort: { submittedAt: -1, _id: -1 } },
        {
          $group: {
            _id: { studentId: '$studentId', examId: '$examId' },
            percentage: { $first: '$percentage' }
          }
        },
        {
          $group: {
            _id: '$_id.studentId',
            averagePercentage: { $avg: '$percentage' }
          }
        }
      ])
    ]);

    const visibleResultStatusSet = new Set<string>(visibleResultStatuses);
    const results = allResults.filter(result => visibleResultStatusSet.has(result.status));
    const assignedExamIds = Array.from(new Set([
      ...assignments.map(a => a.examId),
      ...attempts.map(attempt => attempt.examId),
      ...results.map(result => result.examId)
    ]));
    const assignedExamsDocs = await Exam.find({
      $or: [
        { examId: { $in: assignedExamIds } },
        { assignedStudents: resolvedStudentId },
        { assignedStudentIds: resolvedStudentId }
      ],
      deleting: { $ne: true }
    })
      .sort({ createdAt: -1 })
      .lean();

    const latestAttemptByExam = new Map<string, typeof attempts[number]>();
    for (const attempt of attempts) {
      if (!latestAttemptByExam.has(attempt.examId)) latestAttemptByExam.set(attempt.examId, attempt);
    }
    const latestResultByExam = new Map<string, typeof results[number]>();
    for (const result of results) {
      if (!latestResultByExam.has(result.examId)) latestResultByExam.set(result.examId, result);
    }

    const assignedCount = assignedExamsDocs.length;
    const attemptedExamIds = new Set(attempts.map(attempt => attempt.examId));
    const completedExamIds = new Set(
      attempts
        .filter(attempt =>
          ['SUBMITTED', 'AUTO_SUBMITTED', 'EXPIRED', 'EVALUATED', 'TERMINATED', 'FORCE_SUBMITTED']
            .includes(attempt.status)
        )
        .map(attempt => attempt.examId)
    );
    const publishedResults = Array.from(latestResultByExam.values()).filter(result =>
      Number.isFinite(Number(result.percentage))
    );
    const percentages = publishedResults.map(result => Number(result.percentage));
    const passedCount = publishedResults.filter(result => result.passed).length;

    const rankedExamIds = publishedResults.map(result => result.examId);
    const peerExamResults = rankedExamIds.length
      ? await Result.aggregate([
          { $match: { examId: { $in: rankedExamIds }, status: { $in: visibleResultStatuses } } },
          { $sort: { submittedAt: -1, _id: -1 } },
          {
            $group: {
              _id: { studentId: '$studentId', examId: '$examId' },
              score: { $first: '$score' }
            }
          }
        ])
      : [];
    const ranksByExam = new Map<string, { rank: number; totalRankedStudents: number }>();
    for (const result of publishedResults) {
      const ranked = peerExamResults.filter(peer =>
        peer._id.examId === result.examId && Number.isFinite(Number(peer.score))
      );
      ranksByExam.set(result.examId, {
        rank: 1 + ranked.filter(peer => Number(peer.score) > Number(result.score)).length,
        totalRankedStudents: ranked.length
      });
    }

    const ownOverall = overallRankRows.find(row => row._id === resolvedStudentId);
    const ownAverage = ownOverall && Number.isFinite(Number(ownOverall.averagePercentage))
      ? Number(ownOverall.averagePercentage)
      : null;
    const overallRank = ownAverage === null
      ? null
      : {
          rank: 1 + overallRankRows.filter(row =>
            Number(row.averagePercentage) > ownAverage
          ).length,
          totalRankedStudents: overallRankRows.length
        };

    const proctoringByExam = new Map<string, {
      totalEvents: number;
      warnings: number;
      low: number;
      medium: number;
      high: number;
      critical: number;
      eventTypes: Record<string, number>;
    }>();
    const proctoringEventTypes: Record<string, number> = {};
    const nonWarningTypes = new Set([
      'SCREENSHOT_ATTEMPT', 'WINDOW_FOCUS', 'CAMERA_CONNECTED', 'FACE_DETECTED', 'FACE_STATUS'
    ]);
    for (const group of proctoringGroups) {
      const examId = String(group._id.examId);
      const aggregate = proctoringByExam.get(examId) || {
        totalEvents: 0, warnings: 0, low: 0, medium: 0, high: 0, critical: 0, eventTypes: {}
      };
      const count = Number(group.count) || 0;
      aggregate.totalEvents += count;
      if (!nonWarningTypes.has(group._id.eventType)) aggregate.warnings += count;
      if (group._id.severity === 'LOW') aggregate.low += count;
      if (group._id.severity === 'MEDIUM') aggregate.medium += count;
      if (group._id.severity === 'HIGH') aggregate.high += count;
      if (group._id.severity === 'CRITICAL') aggregate.critical += count;
      aggregate.eventTypes[group._id.eventType] = (aggregate.eventTypes[group._id.eventType] || 0) + count;
      proctoringEventTypes[group._id.eventType] = (proctoringEventTypes[group._id.eventType] || 0) + count;
      proctoringByExam.set(examId, aggregate);
    }

    const blockHistory = unblockRequests.map(request => ({
      requestId: request.requestId,
      examId: request.examId,
      examTitle: request.examTitle,
      attemptId: request.attemptId,
      status: request.status,
      reason: request.reason,
      blockedAt: request.createdAt,
      unblockedAt: request.status === 'APPROVED' ? request.reviewedAt || null : null,
      reviewedAt: request.reviewedAt || null,
      remarks: request.remarks || ''
    }));
    const assistanceCounts = {
      total: unblockRequests.length,
      approved: unblockRequests.filter(request => request.status === 'APPROVED').length,
      rejected: unblockRequests.filter(request => request.status === 'REJECTED').length,
      pending: unblockRequests.filter(request => request.status === 'PENDING').length
    };
    const history = assignedExamsDocs.map(exam => {
      const attempt = latestAttemptByExam.get(exam.examId);
      const result = latestResultByExam.get(exam.examId);
      const rank = result ? ranksByExam.get(exam.examId) || null : null;
      return {
        examId: exam.examId,
        title: exam.title,
        subject: exam.subject,
        examDate: exam.startAt || exam.startDateTime || exam.createdAt,
        attemptStatus: attempt?.status || 'NOT_ATTEMPTED',
        submissionStatus: attempt?.status || 'NOT_ATTEMPTED',
        score: result?.score ?? null,
        totalMarks: result?.totalMarks ?? null,
        percentage: result?.percentage ?? null,
        passed: result ? Boolean(result.passed) : null,
        resultStatus: allResults.find(item => item.examId === exam.examId)?.status || null,
        resultVisibility: result ? 'PUBLISHED' : allResults.some(item => item.examId === exam.examId)
          ? 'UNPUBLISHED'
          : 'NOT_AVAILABLE',
        examRank: rank,
        proctoring: proctoringByExam.get(exam.examId) || {
          totalEvents: 0, warnings: 0, low: 0, medium: 0, high: 0, critical: 0, eventTypes: {}
        }
      };
    });

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
        completedExams: completedExamIds.size,
        pendingExams: Math.max(0, assignedCount - completedExamIds.size),
        publishedResults: publishedResults.length,
        examsAttempted: attemptedExamIds.size,
        examsNotAttempted: Math.max(0, assignedCount - attemptedExamIds.size),
        examsPassed: passedCount,
        examsFailed: Math.max(0, publishedResults.length - passedCount),
        averageScore: percentages.length
          ? percentages.reduce((sum, value) => sum + value, 0) / percentages.length
          : null,
        highestScore: percentages.length ? Math.max(...percentages) : null,
        lowestScore: percentages.length ? Math.min(...percentages) : null,
        passRate: publishedResults.length ? (passedCount / publishedResults.length) * 100 : null,
        overallRank,
        totalRankedStudents: overallRank?.totalRankedStudents || 0
      },
      recentExams: assignedExamsDocs.map(ex => {
        const latestAttempt = latestAttemptByExam.get(ex.examId);
        return {
          ...ex,
          id: ex.examId,
          attemptStatus: latestAttempt?.status || 'NOT_STARTED'
        };
      }),
      examHistory: history,
      performance: {
        subjectBreakdown: Array.from(
          publishedResults.reduce((subjects, result) => {
            const subject = result.subject || assignedExamsDocs.find(exam => exam.examId === result.examId)?.subject || 'Other';
            const scores = subjects.get(subject) || [];
            scores.push(Number(result.percentage));
            subjects.set(subject, scores);
            return subjects;
          }, new Map<string, number[]>())
        ).map(([subject, scores]) => ({
          subject,
          averagePercentage: scores.reduce((sum, score) => sum + score, 0) / scores.length,
          exams: scores.length
        })),
        overallRank
      },
      proctoringSummary: {
        totalMonitoredExams: proctoringByExam.size,
        totalEvents: Array.from(proctoringByExam.values()).reduce((sum, item) => sum + item.totalEvents, 0),
        totalWarnings: Array.from(proctoringByExam.values()).reduce((sum, item) => sum + item.warnings, 0),
        low: Array.from(proctoringByExam.values()).reduce((sum, item) => sum + item.low, 0),
        medium: Array.from(proctoringByExam.values()).reduce((sum, item) => sum + item.medium, 0),
        high: Array.from(proctoringByExam.values()).reduce((sum, item) => sum + item.high, 0),
        critical: Array.from(proctoringByExam.values()).reduce((sum, item) => sum + item.critical, 0),
        examsWithWarnings: Array.from(proctoringByExam.values()).filter(item => item.warnings > 0).length,
        eventTypes: proctoringEventTypes,
        byExam: history.filter(item => item.proctoring.totalEvents > 0).map(item => ({
          examId: item.examId,
          title: item.title,
          ...item.proctoring
        }))
      },
      assistance: {
        ...assistanceCounts,
        blockedAttempts: new Set([
          ...unblockRequests.map(request => request.attemptId),
          ...attempts.filter(attempt => attempt.suspended).map(attempt => attempt.attemptId)
        ]).size,
        blockHistory
      },
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
      examHistory: details.examHistory,
      performance: details.performance,
      proctoringSummary: details.proctoringSummary,
      assistance: details.assistance,
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
