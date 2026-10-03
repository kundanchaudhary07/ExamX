import { Exam, IExamDocument } from '../models/Exam';
import { Question } from '../models/Question';
import { User } from '../models/User';
import { ExamAssignment } from '../models/ExamAssignment';
import { ExamAttempt } from '../models/ExamAttempt';
import { Result } from '../models/Result';
import { IExamInput, SafeStudentExamDto, ExamStatus } from '../types/exam.types';
import { JwtUserPayload } from '../types/auth.types';
import { generateNextExamId } from '../utils/exam-id.generator';
import { AuditService } from './audit.service';
import { emitExamEvent, emitNotification } from '../realtime/socket';
import { logger } from '../utils/logger';

export const CANONICAL_COURSES = [
  'B.Tech CSE',
  'B.Tech CS',
  'B.Tech IT',
  'B.Tech ECE',
  'B.Tech EE',
  'B.Tech ME',
  'B.Tech CE',
  'B.Tech',
  'M.Tech CSE',
  'M.Tech',
  'BCA',
  'MCA',
  'B.Sc Computer Science',
  'B.Sc Physics',
  'B.Sc Mathematics',
  'B.Sc',
  'M.Sc Computer Science',
  'M.Sc',
  'MBA',
  'BBA',
  'CSE',
  'IT',
  'ECE',
  'EE',
  'ME',
  'CE',
  'CS',
  'Math'
] as const;

export const CANONICAL_SEMESTERS = [
  'Semester 1',
  'Semester 2',
  'Semester 3',
  'Semester 4',
  'Semester 5',
  'Semester 6',
  'Semester 7',
  'Semester 8'
] as const;

export class ExamService {
  /**
   * Normalize and validate course/program against controlled values
   */
  static normalizeCourse(rawCourse?: string): string {
    if (rawCourse === undefined || rawCourse === null || rawCourse === '') {
      return '';
    }
    if (typeof rawCourse !== 'string' || !rawCourse.trim()) {
      const err: any = new Error('Course / Program cannot be empty or whitespace-only');
      err.statusCode = 400;
      throw err;
    }
    const trimmed = rawCourse.trim().replace(/\s+/g, ' ');
    const matched = CANONICAL_COURSES.find(c => c.toLowerCase() === trimmed.toLowerCase());
    if (!matched) {
      const err: any = new Error(
        `Invalid course / program "${trimmed}". Please select a valid course from the controlled list.`
      );
      err.statusCode = 400;
      throw err;
    }
    return matched;
  }

  /**
   * Normalize and validate semester to canonical "Semester 1" .. "Semester 8"
   */
  static normalizeSemester(rawSemester?: string): string {
    if (rawSemester === undefined || rawSemester === null || rawSemester === '') {
      return '';
    }
    if (typeof rawSemester !== 'string' || !rawSemester.trim()) {
      const err: any = new Error('Semester cannot be empty or whitespace-only');
      err.statusCode = 400;
      throw err;
    }
    const trimmed = rawSemester.trim();
    const match = trimmed.match(/^(?:semester|sem)?[\s-]*([1-8])$/i);
    if (!match) {
      const err: any = new Error(
        `Invalid semester "${trimmed}". Must be a canonical semester from Semester 1 to Semester 8.`
      );
      err.statusCode = 400;
      throw err;
    }
    return `Semester ${match[1]}`;
  }

  /**
   * Parse and validate date and availability window (startAt / endAt / durationMinutes)
   */
  static resolveAndValidateSchedule(
    input: Partial<IExamInput>,
    durationMinutes: number,
    existingStart?: Date,
    existingEnd?: Date
  ): { resolvedStart?: Date; resolvedEnd?: Date } {
    const rawScheduledDate = (input as any).scheduledDate;
    if (rawScheduledDate !== undefined && rawScheduledDate !== null && rawScheduledDate !== '') {
      if (typeof rawScheduledDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(rawScheduledDate.trim())) {
        const err: any = new Error(
          'Invalid exam date format. Use unambiguous ISO date format YYYY-MM-DD.'
        );
        err.statusCode = 400;
        throw err;
      }
      const [y, m, d] = rawScheduledDate.trim().split('-').map(Number);
      const checkDate = new Date(Date.UTC(y, m - 1, d));
      if (
        isNaN(checkDate.getTime()) ||
        checkDate.getUTCFullYear() !== y ||
        checkDate.getUTCMonth() !== m - 1 ||
        checkDate.getUTCDate() !== d
      ) {
        const err: any = new Error('Invalid calendar date provided for examination.');
        err.statusCode = 400;
        throw err;
      }
    }

    const parseDateOrTime = (val: unknown, fieldName: string): Date | undefined => {
      if (val === undefined || val === null || val === '') return undefined;
      if (val instanceof Date) {
        if (isNaN(val.getTime())) {
          const err: any = new Error(`Invalid ${fieldName}`);
          err.statusCode = 400;
          throw err;
        }
        return val;
      }
      if (typeof val !== 'string') {
        const err: any = new Error(`Invalid ${fieldName} format`);
        err.statusCode = 400;
        throw err;
      }
      const trimmed = val.trim();
      // Reject ambiguous slash-separated dates such as MM/DD/YYYY or DD/MM/YYYY
      if (/^\d{1,2}\/\d{1,2}\/\d{2,4}/.test(trimmed)) {
        const err: any = new Error(
          `Ambiguous date format "${trimmed}" in ${fieldName}. Use ISO 8601 format.`
        );
        err.statusCode = 400;
        throw err;
      }
      // Support HH:mm paired with scheduledDate
      if (/^\d{2}:\d{2}(:\d{2})?$/.test(trimmed)) {
        const datePrefix =
          typeof rawScheduledDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(rawScheduledDate.trim())
            ? rawScheduledDate.trim()
            : new Date().toISOString().split('T')[0];
        const normalizedTime = trimmed.length === 5 ? `${trimmed}:00` : trimmed;
        const dt = new Date(`${datePrefix}T${normalizedTime}`);
        if (isNaN(dt.getTime())) {
          const err: any = new Error(`Invalid time value "${trimmed}" in ${fieldName}`);
          err.statusCode = 400;
          throw err;
        }
        return dt;
      }

      const parsed = new Date(trimmed);
      if (isNaN(parsed.getTime())) {
        const err: any = new Error(`Invalid date/time value in ${fieldName}`);
        err.statusCode = 400;
        throw err;
      }
      return parsed;
    };

    const startVal = input.startAt ?? input.startDateTime ?? (input as any).startTime;
    const endVal = input.endAt ?? input.endDateTime ?? (input as any).endTime;

    const resolvedStart =
      startVal !== undefined ? parseDateOrTime(startVal, 'startTime') : existingStart;
    const resolvedEnd =
      endVal !== undefined ? parseDateOrTime(endVal, 'endTime') : existingEnd;

    if (resolvedStart && resolvedEnd) {
      if (resolvedEnd.getTime() <= resolvedStart.getTime()) {
        const err: any = new Error('End time must be strictly after start time');
        err.statusCode = 400;
        throw err;
      }
      const windowMinutes = (resolvedEnd.getTime() - resolvedStart.getTime()) / 60000;
      if (windowMinutes < durationMinutes) {
        const err: any = new Error(
          `Exam availability window (${Math.floor(windowMinutes)} minutes) cannot be shorter than the attempt duration (${durationMinutes} minutes)`
        );
        err.statusCode = 400;
        throw err;
      }
    }

    return { resolvedStart, resolvedEnd };
  }

  /**
   * Validate and resolve selected question IDs and compute authoritative total marks from Question Bank
   */
  static async resolveAndValidateQuestions(
    rawQuestions: unknown,
    user: JwtUserPayload,
    context?: { subject?: string; course?: string; semester?: string }
  ): Promise<{ cleanQuestions: string[]; calculatedMarks: number }> {
    if (!Array.isArray(rawQuestions)) {
      const err: any = new Error('Questions list must be an array of question IDs');
      err.statusCode = 400;
      throw err;
    }

    const cleanQuestions: string[] = [];
    const seenIds = new Set<string>();
    let calculatedMarks = 0;

    for (const rawId of rawQuestions) {
      if (typeof rawId !== 'string' || !rawId.trim()) {
        const err: any = new Error('Each question ID must be a non-empty string');
        err.statusCode = 400;
        throw err;
      }
      const qId = rawId.trim();
      if (seenIds.has(qId)) {
        const err: any = new Error(`Duplicate question ID "${qId}" is not allowed in the same exam`);
        err.statusCode = 400;
        throw err;
      }
      seenIds.add(qId);

      const q = await Question.findOne({ questionId: qId });
      if (!q) {
        const err: any = new Error(`Question ${qId} does not exist`);
        err.statusCode = 400;
        throw err;
      }
      if (q.status && q.status !== 'ACTIVE') {
        const err: any = new Error(
          `Question ${qId} has status ${q.status} and cannot be included in an exam`
        );
        err.statusCode = 400;
        throw err;
      }
      if (user.role === 'TEACHER' && q.createdBy !== user.userId) {
        const err: any = new Error(
          `Unauthorized: Question ${qId} belongs to another faculty member`
        );
        err.statusCode = 403;
        throw err;
      }

      if (q.source === 'AI_GENERATED') {
        const matchesExamContext =
          String(q.subject || '').trim().toLowerCase() === String(context?.subject || '').trim().toLowerCase() &&
          this.normalizeCourse(q.course) === this.normalizeCourse(context?.course) &&
          this.normalizeSemester(q.semester) === this.normalizeSemester(context?.semester);
        if (!matchesExamContext) {
          const err: any = new Error(`AI question ${qId} does not match the exam subject, course, and semester.`);
          err.statusCode = 400;
          throw err;
        }
      }

      cleanQuestions.push(qId);
      calculatedMarks += Number(q.marks) > 0 ? Number(q.marks) : 1;
    }

    return { cleanQuestions, calculatedMarks };
  }

  /**
   * Recalculate total marks from stored question IDs
   */
  static async calculateMarksFromQuestionIds(questionIds: string[]): Promise<number> {
    if (!Array.isArray(questionIds) || questionIds.length === 0) {
      return 0;
    }
    const questions = await Question.find({
      questionId: { $in: questionIds },
      status: 'ACTIVE'
    }).lean();
    const map = new Map<string, number>();
    for (const q of questions) {
      map.set(q.questionId, Number(q.marks) > 0 ? Number(q.marks) : 1);
    }
    return questionIds.reduce((sum, qId) => sum + (map.get(qId) ?? 0), 0);
  }

  /**
   * Validate Exam input authoritatively
   */
  static validateExamInput(
    input: Partial<IExamInput>,
    options: { hasExplicitQuestionsArray?: boolean } = {}
  ): void {
    if (!input.title || typeof input.title !== 'string' || !input.title.trim()) {
      const err: any = new Error('Exam title is required and cannot be empty');
      err.statusCode = 400;
      throw err;
    }
    const trimmedTitle = input.title.trim();
    if (trimmedTitle.length < 2 || trimmedTitle.length > 200) {
      const err: any = new Error('Exam title must be between 2 and 200 characters');
      err.statusCode = 400;
      throw err;
    }

    if (!input.subject || typeof input.subject !== 'string' || !input.subject.trim()) {
      const err: any = new Error('Subject is required and cannot be empty');
      err.statusCode = 400;
      throw err;
    }
    const trimmedSubject = input.subject.trim();
    if (trimmedSubject.length < 2 || trimmedSubject.length > 120) {
      const err: any = new Error('Subject must be between 2 and 120 characters');
      err.statusCode = 400;
      throw err;
    }

    if (input.durationMinutes !== undefined) {
      if (
        typeof input.durationMinutes !== 'number' ||
        !Number.isFinite(input.durationMinutes) ||
        !Number.isInteger(input.durationMinutes) ||
        input.durationMinutes < 1 ||
        input.durationMinutes > 600
      ) {
        const err: any = new Error(
          'Duration must be an integer between 1 and 600 minutes'
        );
        err.statusCode = 400;
        throw err;
      }
    }

    if (input.attemptLimit !== undefined) {
      if (
        typeof input.attemptLimit !== 'number' ||
        !Number.isFinite(input.attemptLimit) ||
        !Number.isInteger(input.attemptLimit) ||
        input.attemptLimit < 1 ||
        input.attemptLimit > 10
      ) {
        const err: any = new Error(
          'Attempt limit must be an integer between 1 and 10'
        );
        err.statusCode = 400;
        throw err;
      }
    }

    if (input.totalMarks !== undefined) {
      if (
        typeof input.totalMarks !== 'number' ||
        !Number.isFinite(input.totalMarks) ||
        input.totalMarks < 0 ||
        (!options.hasExplicitQuestionsArray && input.totalMarks <= 0)
      ) {
        const err: any = new Error('Total marks must be a positive number greater than zero');
        err.statusCode = 400;
        throw err;
      }
    }

    if (input.passingMarks !== undefined) {
      if (
        typeof input.passingMarks !== 'number' ||
        !Number.isFinite(input.passingMarks) ||
        input.passingMarks < 0
      ) {
        const err: any = new Error('Passing marks cannot be negative');
        err.statusCode = 400;
        throw err;
      }
      if (
        !options.hasExplicitQuestionsArray &&
        input.totalMarks !== undefined &&
        input.passingMarks > input.totalMarks
      ) {
        const err: any = new Error('Passing marks cannot exceed total marks');
        err.statusCode = 400;
        throw err;
      }
    }
  }

  /**
   * Create new Exam (defaults to DRAFT; never allows direct creation as LIVE/ENDED/RESULT_PUBLISHED)
   */
  static async createExam(input: IExamInput, user: JwtUserPayload): Promise<IExamDocument> {
    const hasExplicitQuestionsArray =
      input.questions !== undefined || (input as any).questionIds !== undefined;

    this.validateExamInput(input, { hasExplicitQuestionsArray });

    const normalizedCourse = this.normalizeCourse(input.course);
    const normalizedSemester = this.normalizeSemester(input.semester);

    // Validate requested creation status — never allow bypassing lifecycle by creating as LIVE/ENDED/PUBLISHED
    const requestedStatus = (input as any).status as ExamStatus | undefined;
    if (
      requestedStatus !== undefined &&
      requestedStatus !== 'DRAFT' &&
      requestedStatus !== 'SCHEDULED'
    ) {
      const err: any = new Error(
        `Cannot create exam directly in ${requestedStatus} status. New exams must be created as DRAFT or SCHEDULED.`
      );
      err.statusCode = 400;
      throw err;
    }
    const initialStatus: ExamStatus = requestedStatus === 'SCHEDULED' ? 'SCHEDULED' : 'DRAFT';

    const rawQuestions = input.questions ?? (input as any).questionIds ?? [];
    const { cleanQuestions, calculatedMarks } = await this.resolveAndValidateQuestions(
      rawQuestions,
      user,
      { subject: input.subject, course: normalizedCourse, semester: normalizedSemester }
    );

    // Zero-question rule: SCHEDULED requires at least 1 valid question; DRAFT allows 0 questions
    if (initialStatus !== 'DRAFT' && cleanQuestions.length === 0) {
      const err: any = new Error(
        `Cannot create exam in ${initialStatus} status with 0 questions. At least one valid question is required.`
      );
      err.statusCode = 400;
      throw err;
    }

    const rawAssigned = input.assignedStudentIds ?? input.assignedStudents ?? [];
    if (!Array.isArray(rawAssigned)) {
      const err: any = new Error('Assigned students must be an array of student IDs');
      err.statusCode = 400;
      throw err;
    }
    const cleanAssignedStudents: string[] = [];
    for (const sId of rawAssigned) {
      if (typeof sId !== 'string' || !sId.trim()) continue;
      const trimmedSId = sId.trim();
      const student = await User.findOne({ userId: trimmedSId, role: 'STUDENT' });
      if (!student) {
        const err: any = new Error(`Student ${trimmedSId} does not exist`);
        err.statusCode = 400;
        throw err;
      }
      if (user.role === 'TEACHER' && !student.managedBy.includes(user.userId)) {
        const err: any = new Error(
          `Unauthorized: Student ${trimmedSId} is not assigned to your supervision`
        );
        err.statusCode = 403;
        throw err;
      }
      if (!cleanAssignedStudents.includes(trimmedSId)) {
        cleanAssignedStudents.push(trimmedSId);
      }
    }

    const { resolvedStart, resolvedEnd } = this.resolveAndValidateSchedule(
      input,
      input.durationMinutes
    );

    // Authoritative totalMarks calculation:
    // - If questions are selected, totalMarks is ALWAYS the sum of selected question marks
    // - If questions array was explicitly passed as empty [], totalMarks is 0
    // - Otherwise (e.g., draft created before attaching questions via /questions endpoint), use validated input.totalMarks or 0
    const authoritativeTotalMarks =
      cleanQuestions.length > 0
        ? calculatedMarks
        : hasExplicitQuestionsArray
        ? 0
        : input.totalMarks ?? 0;

    const authoritativePassingMarks =
      authoritativeTotalMarks === 0
        ? 0
        : input.passingMarks !== undefined && input.passingMarks <= authoritativeTotalMarks
        ? input.passingMarks
        : Math.max(1, Math.round(authoritativeTotalMarks * 0.4));

    const examId = await generateNextExamId();

    const exam = await Exam.create({
      examId,
      title: input.title.trim().replace(/\s+/g, ' '),
      description: (input.description || '').trim(),
      subject: input.subject.trim().replace(/\s+/g, ' '),
      course: normalizedCourse,
      department: (input.department || '').trim(),
      academicYear: (input.academicYear || '').trim(),
      semester: normalizedSemester,
      durationMinutes: input.durationMinutes,
      questionCount: cleanQuestions.length,
      totalMarks: authoritativeTotalMarks,
      passingMarks: authoritativePassingMarks,
      attemptLimit: input.attemptLimit !== undefined ? input.attemptLimit : 1,
      strictMode: input.strictMode !== undefined ? Boolean(input.strictMode) : true,
      instructions: (input.instructions || '').trim() || 'Strict proctored examination.',
      status: initialStatus,
      createdBy: user.userId, // Authoritatively derived from JWT
      questions: cleanQuestions,
      assignedStudents: cleanAssignedStudents,
      assignedStudentIds: cleanAssignedStudents,
      startAt: resolvedStart,
      endAt: resolvedEnd,
      startDateTime: resolvedStart,
      endDateTime: resolvedEnd
    });

    // Create assignment records if any students were assigned
    for (const studentId of cleanAssignedStudents) {
      await ExamAssignment.findOneAndUpdate(
        { examId, studentId },
        {
          examId,
          studentId,
          assignedBy: user.userId,
          status: 'ASSIGNED',
          assignedAt: new Date()
        },
        { upsert: true, returnDocument: 'after' }
      );
    }

    await AuditService.record({
      actorId: user.userId,
      actorName: user.name,
      actorRole: user.role,
      action: initialStatus === 'SCHEDULED' ? 'EXAM_SCHEDULED' : 'EXAM_CREATED',
      targetType: 'EXAM',
      targetId: examId,
      details: `Created exam "${exam.title}" (${examId}) in ${initialStatus} status with ${cleanQuestions.length} question(s) and ${authoritativeTotalMarks} total marks`
    });

    emitExamEvent(
      exam,
      'exam.created',
      { exam: exam.toJSON() },
      initialStatus !== 'DRAFT',
      user.userId
    );

    logger.info(
      `Exam ${examId} created by ${user.role} [${user.userId}] with status ${initialStatus}`
    );
    return exam;
  }

  /**
   * List exams with RBAC and ownership filtering
   */
  static async getExams(
    filters: { subject?: string; status?: string; search?: string },
    user: JwtUserPayload
  ): Promise<IExamDocument[]> {
    const query: any = {};

    // Teacher can ONLY view exams created by themselves
    if (user.role === 'TEACHER') {
      query.createdBy = user.userId;
    }

    if (filters.subject) {
      query.subject = filters.subject;
    }
    if (filters.status) {
      query.status = filters.status;
    }
    if (filters.search) {
      query.title = { $regex: filters.search, $options: 'i' };
    }

    return Exam.find(query).sort({ createdAt: -1 });
  }

  /**
   * Get single exam by examId with ownership verification
   */
  static async getExamById(examId: string, user: JwtUserPayload): Promise<IExamDocument> {
    const exam = await Exam.findOne({ examId });
    if (!exam) {
      const err: any = new Error(`Exam with ID ${examId} not found`);
      err.statusCode = 404;
      throw err;
    }

    if (user.role === 'TEACHER' && exam.createdBy !== user.userId) {
      const err: any = new Error('Forbidden: You are not authorized to view this exam');
      err.statusCode = 403;
      throw err;
    }

    return exam;
  }

  /**
   * Update exam with ownership, question/student sync, schedule validation, and state transition verification
   */
  static async updateExam(
    examId: string,
    updates: Partial<IExamInput & { status: ExamStatus }>,
    user: JwtUserPayload
  ): Promise<IExamDocument> {
    const exam = await Exam.findOne({ examId });
    if (!exam) {
      const err: any = new Error(`Exam with ID ${examId} not found`);
      err.statusCode = 404;
      throw err;
    }

    if (user.role === 'TEACHER' && exam.createdBy !== user.userId) {
      const err: any = new Error('Forbidden: You are not authorized to modify this exam');
      err.statusCode = 403;
      throw err;
    }

    const hasExplicitQuestionsUpdate =
      updates.questions !== undefined || (updates as any).questionIds !== undefined;

    this.validateExamInput(
      {
        title: updates.title ?? exam.title,
        subject: updates.subject ?? exam.subject,
        durationMinutes: updates.durationMinutes ?? exam.durationMinutes,
        totalMarks: hasExplicitQuestionsUpdate ? undefined : updates.totalMarks,
        passingMarks: updates.passingMarks,
        attemptLimit: updates.attemptLimit ?? exam.attemptLimit
      },
      { hasExplicitQuestionsArray: true }
    );

    if (updates.course !== undefined) {
      exam.course = this.normalizeCourse(updates.course);
    }
    if (updates.semester !== undefined) {
      exam.semester = this.normalizeSemester(updates.semester);
    }

    const nextDuration = updates.durationMinutes ?? exam.durationMinutes;
    const { resolvedStart, resolvedEnd } = this.resolveAndValidateSchedule(
      updates,
      nextDuration,
      exam.startAt || exam.startDateTime,
      exam.endAt || exam.endDateTime
    );

    if (resolvedStart !== undefined) {
      exam.startAt = resolvedStart;
      exam.startDateTime = resolvedStart;
    }
    if (resolvedEnd !== undefined) {
      exam.endAt = resolvedEnd;
      exam.endDateTime = resolvedEnd;
    }

    // Handle question list updates if provided
    if (hasExplicitQuestionsUpdate) {
      if (exam.status === 'CLOSED' || exam.status === 'ENDED' || exam.status === 'ARCHIVED') {
        const err: any = new Error(`Cannot modify questions on an exam in ${exam.status} status`);
        err.statusCode = 400;
        throw err;
      }
      const rawQuestions = updates.questions ?? (updates as any).questionIds ?? [];
      const { cleanQuestions, calculatedMarks } = await this.resolveAndValidateQuestions(
        rawQuestions,
        user,
        { subject: exam.subject, course: exam.course, semester: exam.semester }
      );
      exam.questions = cleanQuestions;
      exam.questionCount = cleanQuestions.length;
      exam.totalMarks = calculatedMarks;
      exam.passingMarks =
        calculatedMarks === 0
          ? 0
          : updates.passingMarks !== undefined && updates.passingMarks <= calculatedMarks
          ? updates.passingMarks
          : Math.min(exam.passingMarks || Math.max(1, Math.round(calculatedMarks * 0.4)), calculatedMarks);
    } else if (exam.questions && exam.questions.length > 0) {
      // Always enforce authoritative totalMarks from attached questions
      const authoritativeMarks = await this.calculateMarksFromQuestionIds(exam.questions);
      if (authoritativeMarks > 0) {
        exam.totalMarks = authoritativeMarks;
        if (updates.passingMarks !== undefined) {
          if (updates.passingMarks > authoritativeMarks) {
            const err: any = new Error('Passing marks cannot exceed total marks');
            err.statusCode = 400;
            throw err;
          }
          exam.passingMarks = updates.passingMarks;
        } else if (exam.passingMarks > authoritativeMarks) {
          exam.passingMarks = Math.max(1, Math.round(authoritativeMarks * 0.4));
        }
      }
    } else if (updates.totalMarks !== undefined) {
      exam.totalMarks = updates.totalMarks;
      if (updates.passingMarks !== undefined) {
        exam.passingMarks = updates.passingMarks;
      }
    }

    // Handle assigned students update if provided
    const rawAssigned = updates.assignedStudentIds ?? updates.assignedStudents;
    if (rawAssigned !== undefined) {
      if (!Array.isArray(rawAssigned)) {
        const err: any = new Error('Assigned students must be an array of student IDs');
        err.statusCode = 400;
        throw err;
      }
      const cleanAssignedStudents: string[] = [];
      for (const sId of rawAssigned) {
        if (typeof sId !== 'string' || !sId.trim()) continue;
        const trimmedSId = sId.trim();
        const student = await User.findOne({ userId: trimmedSId, role: 'STUDENT' });
        if (!student) {
          const err: any = new Error(`Student ${trimmedSId} does not exist`);
          err.statusCode = 400;
          throw err;
        }
        if (user.role === 'TEACHER' && !student.managedBy.includes(user.userId)) {
          const err: any = new Error(
            `Unauthorized: Student ${trimmedSId} is not assigned to your supervision`
          );
          err.statusCode = 403;
          throw err;
        }
        if (!cleanAssignedStudents.includes(trimmedSId)) {
          cleanAssignedStudents.push(trimmedSId);
        }
      }
      exam.assignedStudents = cleanAssignedStudents;
      exam.assignedStudentIds = cleanAssignedStudents;

      for (const studentId of cleanAssignedStudents) {
        await ExamAssignment.findOneAndUpdate(
          { examId, studentId },
          {
            examId,
            studentId,
            assignedBy: user.userId,
            status: 'ASSIGNED',
            assignedAt: new Date()
          },
          { upsert: true, returnDocument: 'after' }
        );
      }
    }

    const previousStatus = exam.status;
    if (updates.status && updates.status !== exam.status) {
      this.validateStatusTransition(exam.status, updates.status);

      // Enforce Zero-Question Rule on non-DRAFT / non-ARCHIVED status transitions
      if (updates.status !== 'DRAFT' && updates.status !== 'ARCHIVED') {
        if (!exam.questions || exam.questions.length === 0) {
          const err: any = new Error(
            `Cannot transition exam to ${updates.status} with 0 questions. At least one valid question is required.`
          );
          err.statusCode = 400;
          throw err;
        }
        const activeQuestionsCount = await Question.countDocuments({
          questionId: { $in: exam.questions },
          status: 'ACTIVE'
        });
        if (activeQuestionsCount === 0 || activeQuestionsCount !== exam.questions.length) {
          const err: any = new Error(
            `Cannot transition exam to ${updates.status}: One or more questions are missing or inactive.`
          );
          err.statusCode = 400;
          throw err;
        }
      }

      exam.status = updates.status;
      if (
        updates.status === 'PUBLISHED' ||
        updates.status === 'LIVE' ||
        updates.status === 'RESULT_PUBLISHED'
      ) {
        exam.publishedAt = exam.publishedAt || new Date();
      }
    } else if (exam.status !== 'DRAFT' && exam.status !== 'ARCHIVED') {
      // Prevent removing all questions from an already scheduled/live/published exam
      if (!exam.questions || exam.questions.length === 0) {
        const err: any = new Error(
          `Exam in ${exam.status} status must have at least one valid question.`
        );
        err.statusCode = 400;
        throw err;
      }
    }

    if (updates.title !== undefined) exam.title = updates.title.trim().replace(/\s+/g, ' ');
    if (updates.description !== undefined) exam.description = updates.description.trim();
    if (updates.subject !== undefined) exam.subject = updates.subject.trim().replace(/\s+/g, ' ');
    if (updates.department !== undefined) exam.department = updates.department.trim();
    if (updates.academicYear !== undefined) exam.academicYear = updates.academicYear.trim();
    if (updates.durationMinutes !== undefined) exam.durationMinutes = updates.durationMinutes;
    if (updates.attemptLimit !== undefined) exam.attemptLimit = updates.attemptLimit;
    if (updates.strictMode !== undefined) exam.strictMode = Boolean(updates.strictMode);
    if (updates.instructions !== undefined) exam.instructions = updates.instructions.trim();

    await exam.save();
    const examJson = exam.toJSON();

    if (updates.status && updates.status !== previousStatus) {
      if (updates.status === 'SCHEDULED') {
        await AuditService.record({
          actorId: user.userId,
          actorName: user.name,
          actorRole: user.role,
          action: 'EXAM_SCHEDULED',
          targetType: 'EXAM',
          targetId: examId,
          details: `Scheduled examination "${exam.title}" (${examId})`
        });
      } else if (updates.status === 'PUBLISHED' || updates.status === 'RESULT_PUBLISHED') {
        await AuditService.record({
          actorId: user.userId,
          actorName: user.name,
          actorRole: user.role,
          action: 'EXAM_PUBLISHED',
          targetType: 'EXAM',
          targetId: examId,
          details: `Published examination "${exam.title}" (${examId})`
        });
        emitExamEvent(exam, 'exam.published', { exam: examJson }, true, user.userId);
      } else if (updates.status === 'LIVE') {
        await AuditService.record({
          actorId: user.userId,
          actorName: user.name,
          actorRole: user.role,
          action: 'EXAM_STARTED',
          targetType: 'EXAM',
          targetId: examId,
          details: `Started examination "${exam.title}" (${examId})`
        });
        emitExamEvent(exam, 'exam.started', { exam: examJson }, true, user.userId);
      } else if (updates.status === 'ENDED' || updates.status === 'CLOSED') {
        await AuditService.record({
          actorId: user.userId,
          actorName: user.name,
          actorRole: user.role,
          action: 'EXAM_COMPLETED',
          targetType: 'EXAM',
          targetId: examId,
          details: `Completed examination "${exam.title}" (${examId})`
        });
        emitExamEvent(exam, 'exam.completed', { exam: examJson }, true, user.userId);
      } else if (updates.status === 'ARCHIVED') {
        emitExamEvent(exam, 'exam.cancelled', { exam: examJson }, true, user.userId);
      }
    } else {
      await AuditService.record({
        actorId: user.userId,
        actorName: user.name,
        actorRole: user.role,
        action: 'EXAM_UPDATED',
        targetType: 'EXAM',
        targetId: examId,
        details: `Updated examination "${exam.title}" (${examId})`
      });
    }

    emitExamEvent(exam, 'exam.updated', { exam: examJson }, exam.status !== 'DRAFT', user.userId);

    logger.info(`Exam ${examId} updated by ${user.role} [${user.userId}]`);
    return exam;
  }

  /**
   * Validate lifecycle transitions
   * Controlled lifecycle: DRAFT -> SCHEDULED -> LIVE -> ENDED -> RESULT_PUBLISHED / PUBLISHED
   */
  static validateStatusTransition(current: ExamStatus, next: ExamStatus): void {
    const validStatuses: ExamStatus[] = [
      'DRAFT',
      'SCHEDULED',
      'LIVE',
      'ENDED',
      'PUBLISHED',
      'RESULT_PUBLISHED',
      'CLOSED',
      'ARCHIVED'
    ];
    if (!validStatuses.includes(next)) {
      const err: any = new Error(`Invalid status: ${next}`);
      err.statusCode = 400;
      throw err;
    }

    if (current === next) {
      return;
    }

    if (current === 'ARCHIVED') {
      const err: any = new Error('Forbidden: An archived exam cannot transition to any other status');
      err.statusCode = 400;
      throw err;
    }

    const allowedTransitions: Record<ExamStatus, ExamStatus[]> = {
      DRAFT: ['SCHEDULED', 'ARCHIVED'],
      SCHEDULED: ['LIVE', 'PUBLISHED', 'ARCHIVED'],
      PUBLISHED: ['SCHEDULED', 'LIVE', 'ENDED', 'CLOSED', 'RESULT_PUBLISHED', 'ARCHIVED'],
      LIVE: ['ENDED', 'CLOSED', 'ARCHIVED'],
      ENDED: ['PUBLISHED', 'RESULT_PUBLISHED', 'CLOSED', 'ARCHIVED'],
      CLOSED: ['RESULT_PUBLISHED', 'ARCHIVED'],
      RESULT_PUBLISHED: ['ARCHIVED'],
      ARCHIVED: []
    };

    const allowedNext = allowedTransitions[current] || [];
    if (!allowedNext.includes(next)) {
      const err: any = new Error(
        `Forbidden status transition from ${current} to ${next}. Allowed transitions from ${current}: ${
          allowedNext.join(', ') || 'none'
        }`
      );
      err.statusCode = 400;
      throw err;
    }
  }

  /**
   * Delete exam and clean up assignments with ownership verification
   */
  static async deleteExam(examId: string, user: JwtUserPayload): Promise<void> {
    const exam = await Exam.findOne({ examId });
    if (!exam) {
      const err: any = new Error(`Exam with ID ${examId} not found`);
      err.statusCode = 404;
      throw err;
    }

    if (user.role === 'TEACHER' && exam.createdBy !== user.userId) {
      const err: any = new Error('Forbidden: You are not authorized to delete this exam');
      err.statusCode = 403;
      throw err;
    }

    await Exam.deleteOne({ examId });
    await ExamAssignment.deleteMany({ examId });
    emitExamEvent(exam, 'exam.cancelled', { examId }, true, user.userId);
    logger.info(`Exam ${examId} and its assignments deleted by ${user.role} [${user.userId}]`);
  }

  /**
   * Add question(s) from Question Bank to Exam and recalculate authoritative totalMarks
   */
  static async addQuestionsToExam(
    examId: string,
    questionIds: string[],
    user: JwtUserPayload
  ): Promise<IExamDocument> {
    if (!Array.isArray(questionIds) || questionIds.length === 0) {
      const err: any = new Error('At least one questionId must be provided');
      err.statusCode = 400;
      throw err;
    }

    const exam = await Exam.findOne({ examId });
    if (!exam) {
      const err: any = new Error(`Exam with ID ${examId} not found`);
      err.statusCode = 404;
      throw err;
    }

    if (user.role === 'TEACHER' && exam.createdBy !== user.userId) {
      const err: any = new Error('Forbidden: You are not authorized to modify questions on this exam');
      err.statusCode = 403;
      throw err;
    }

    if (exam.status === 'CLOSED' || exam.status === 'ENDED' || exam.status === 'ARCHIVED') {
      const err: any = new Error(`Cannot add questions to an exam in ${exam.status} status`);
      err.statusCode = 400;
      throw err;
    }

    for (const qId of questionIds) {
      if (typeof qId !== 'string' || !qId.trim()) {
        const err: any = new Error('Question ID must be a non-empty string');
        err.statusCode = 400;
        throw err;
      }
      const cleanQId = qId.trim();
      const question = await Question.findOne({ questionId: cleanQId });
      if (!question) {
        const err: any = new Error(`Question ${cleanQId} does not exist`);
        err.statusCode = 404;
        throw err;
      }

      if (question.status && question.status !== 'ACTIVE') {
        const err: any = new Error(`Question ${cleanQId} is ${question.status} and cannot be added`);
        err.statusCode = 400;
        throw err;
      }

      if (user.role === 'TEACHER' && question.createdBy !== user.userId) {
        const err: any = new Error(`Unauthorized: Question ${cleanQId} belongs to another faculty member`);
        err.statusCode = 403;
        throw err;
      }

      if (question.source === 'AI_GENERATED') {
        const matchesExamContext =
          String(question.subject || '').trim().toLowerCase() === String(exam.subject || '').trim().toLowerCase() &&
          this.normalizeCourse(question.course) === this.normalizeCourse(exam.course) &&
          this.normalizeSemester(question.semester) === this.normalizeSemester(exam.semester);
        if (!matchesExamContext) {
          const err: any = new Error(`AI question ${cleanQId} does not match the exam subject, course, and semester.`);
          err.statusCode = 400;
          throw err;
        }
      }

      if (exam.questions.includes(cleanQId)) {
        const err: any = new Error(`Question ${cleanQId} is already added to this exam`);
        err.statusCode = 400;
        throw err;
      }

      exam.questions.push(cleanQId);
    }

    exam.questionCount = exam.questions.length;
    const recalculatedMarks = await this.calculateMarksFromQuestionIds(exam.questions);
    if (recalculatedMarks > 0) {
      exam.totalMarks = recalculatedMarks;
      if (exam.passingMarks > recalculatedMarks || exam.passingMarks === 0) {
        exam.passingMarks = Math.max(1, Math.round(recalculatedMarks * 0.4));
      }
    }

    await exam.save();
    await AuditService.record({
      actorId: user.userId,
      actorName: user.name,
      actorRole: user.role,
      action: 'EXAM_QUESTIONS_UPDATED',
      targetType: 'EXAM',
      targetId: examId,
      details: `Added ${questionIds.length} question(s) to exam "${exam.title}" (${examId}); totalMarks=${exam.totalMarks}`
    });
    emitExamEvent(exam, 'exam.updated', { exam: exam.toJSON() }, exam.status !== 'DRAFT', user.userId);
    logger.info(`Added ${questionIds.length} question(s) to exam ${examId}`);
    return exam;
  }

  /**
   * Update a question attached to an exam and recalculate authoritative totalMarks
   */
  static async updateExamQuestion(
    examId: string,
    questionId: string,
    updates: { marks?: number; questionText?: string; text?: string; topic?: string; difficulty?: any },
    user: JwtUserPayload
  ): Promise<IExamDocument> {
    const exam = await Exam.findOne({ examId });
    if (!exam) {
      const err: any = new Error(`Exam with ID ${examId} not found`);
      err.statusCode = 404;
      throw err;
    }

    if (user.role === 'TEACHER' && exam.createdBy !== user.userId) {
      const err: any = new Error('Forbidden: You are not authorized to modify questions on this exam');
      err.statusCode = 403;
      throw err;
    }

    if (exam.status === 'CLOSED' || exam.status === 'ENDED' || exam.status === 'ARCHIVED') {
      const err: any = new Error(`Cannot modify questions on an exam in ${exam.status} status`);
      err.statusCode = 400;
      throw err;
    }

    const cleanQId = questionId.trim();
    if (!exam.questions.includes(cleanQId)) {
      const err: any = new Error(`Question ${cleanQId} is not attached to this exam`);
      err.statusCode = 404;
      throw err;
    }

    const question = await Question.findOne({ questionId: cleanQId });
    if (!question) {
      const err: any = new Error(`Question ${cleanQId} does not exist`);
      err.statusCode = 404;
      throw err;
    }

    if (user.role === 'TEACHER' && question.createdBy !== user.userId) {
      const err: any = new Error(`Unauthorized: Question ${cleanQId} belongs to another faculty member`);
      err.statusCode = 403;
      throw err;
    }

    if (updates.marks !== undefined) {
      const parsedMarks = Number(updates.marks);
      if (!Number.isFinite(parsedMarks) || parsedMarks <= 0) {
        const err: any = new Error('Marks must be a positive number');
        err.statusCode = 400;
        throw err;
      }
      question.marks = parsedMarks;
    }
    if (updates.questionText?.trim() || updates.text?.trim()) {
      question.questionText = (updates.questionText || updates.text || '').trim();
    }
    if (updates.topic?.trim()) {
      question.topic = updates.topic.trim();
    }
    if (updates.difficulty) {
      question.difficulty = updates.difficulty;
    }
    await question.save();

    const recalculatedMarks = await this.calculateMarksFromQuestionIds(exam.questions);
    exam.totalMarks = recalculatedMarks;
    if (exam.passingMarks > recalculatedMarks || exam.passingMarks === 0) {
      exam.passingMarks = Math.max(1, Math.round(recalculatedMarks * 0.4));
    }
    await exam.save();

    emitExamEvent(exam, 'exam.updated', { exam: exam.toJSON() }, exam.status !== 'DRAFT', user.userId);
    return exam;
  }

  /**
   * Remove a question from an exam and recalculate authoritative totalMarks
   */
  static async removeExamQuestion(
    examId: string,
    questionId: string,
    user: JwtUserPayload
  ): Promise<IExamDocument> {
    const exam = await Exam.findOne({ examId });
    if (!exam) {
      const err: any = new Error(`Exam with ID ${examId} not found`);
      err.statusCode = 404;
      throw err;
    }

    if (user.role === 'TEACHER' && exam.createdBy !== user.userId) {
      const err: any = new Error('Forbidden: You are not authorized to modify questions on this exam');
      err.statusCode = 403;
      throw err;
    }

    if (exam.status === 'CLOSED' || exam.status === 'ENDED' || exam.status === 'ARCHIVED') {
      const err: any = new Error(`Cannot remove questions from an exam in ${exam.status} status`);
      err.statusCode = 400;
      throw err;
    }

    const cleanQId = questionId.trim();
    if (!exam.questions.includes(cleanQId)) {
      const err: any = new Error(`Question ${cleanQId} is not attached to this exam`);
      err.statusCode = 404;
      throw err;
    }

    exam.questions = exam.questions.filter((id) => id !== cleanQId);
    exam.questionCount = exam.questions.length;
    const recalculatedMarks = await this.calculateMarksFromQuestionIds(exam.questions);
    exam.totalMarks = recalculatedMarks;
    exam.passingMarks =
      recalculatedMarks === 0
        ? 0
        : Math.min(exam.passingMarks || Math.max(1, Math.round(recalculatedMarks * 0.4)), recalculatedMarks);

    await exam.save();
    emitExamEvent(exam, 'exam.updated', { exam: exam.toJSON() }, exam.status !== 'DRAFT', user.userId);
    return exam;
  }

  /**
   * Assign students to an exam with authoritative teacher-student supervision verification
   */
  static async assignStudentsToExam(
    examId: string,
    studentIds: string[],
    user: JwtUserPayload
  ): Promise<{ exam: IExamDocument; assignedCount: number }> {
    if (!Array.isArray(studentIds) || studentIds.length === 0) {
      const err: any = new Error('At least one studentId must be provided for assignment');
      err.statusCode = 400;
      throw err;
    }

    const exam = await Exam.findOne({ examId });
    if (!exam) {
      const err: any = new Error(`Exam with ID ${examId} not found`);
      err.statusCode = 404;
      throw err;
    }

    if (user.role === 'TEACHER' && exam.createdBy !== user.userId) {
      const err: any = new Error('Forbidden: You are not authorized to assign students to this exam');
      err.statusCode = 403;
      throw err;
    }

    if (exam.status === 'ARCHIVED') {
      const err: any = new Error('Cannot assign students to an archived exam');
      err.statusCode = 400;
      throw err;
    }

    let newlyAssigned = 0;

    for (const sId of studentIds) {
      const cleanStudentId = sId.trim();
      const student = await User.findOne({ userId: cleanStudentId, role: 'STUDENT' });
      if (!student) {
        const err: any = new Error(`Student with ID "${cleanStudentId}" does not exist`);
        err.statusCode = 404;
        throw err;
      }

      if (student.status !== 'ACTIVE') {
        const err: any = new Error(`Student ${cleanStudentId} is ${student.status} and cannot be assigned`);
        err.statusCode = 400;
        throw err;
      }

      // Teacher ownership verification: Teacher can ONLY assign students assigned to their supervision
      if (user.role === 'TEACHER' && !student.managedBy.includes(user.userId)) {
        const err: any = new Error(`Unauthorized: Student ${cleanStudentId} is not assigned to your supervision`);
        err.statusCode = 403;
        throw err;
      }

      // Upsert ExamAssignment
      await ExamAssignment.findOneAndUpdate(
        { examId, studentId: cleanStudentId },
        {
          examId,
          studentId: cleanStudentId,
          assignedBy: user.userId,
          status: 'ASSIGNED',
          assignedAt: new Date()
        },
        { upsert: true, returnDocument: 'after' }
      );

      if (!exam.assignedStudents.includes(cleanStudentId)) {
        exam.assignedStudents.push(cleanStudentId);
        newlyAssigned++;
      }
      if (!exam.assignedStudentIds.includes(cleanStudentId)) {
        exam.assignedStudentIds.push(cleanStudentId);
      }
    }

    await exam.save();
    await AuditService.record({
      actorId: user.userId,
      actorName: user.name,
      actorRole: user.role,
      action: 'EXAM_ASSIGNMENT_UPDATED',
      targetType: 'EXAM',
      targetId: examId,
      details: `Assigned ${studentIds.length} student(s) to exam "${exam.title}" (${examId})`
    });
    emitExamEvent(exam, 'exam.updated', { exam: exam.toJSON() }, exam.status !== 'DRAFT', user.userId);
    logger.info(`Assigned students to exam ${examId} by ${user.role} [${user.userId}]`);
    return { exam, assignedCount: newlyAssigned };
  }

  /**
   * Publish an Exam from DRAFT/SCHEDULED to PUBLISHED with strict prerequisite validation
   */
  static async publishExam(examId: string, user: JwtUserPayload): Promise<IExamDocument> {
    const exam = await Exam.findOne({ examId });
    if (!exam) {
      const err: any = new Error(`Exam with ID ${examId} not found`);
      err.statusCode = 404;
      throw err;
    }

    if (user.role === 'TEACHER' && exam.createdBy !== user.userId) {
      const err: any = new Error('Forbidden: You are not authorized to publish this exam');
      err.statusCode = 403;
      throw err;
    }

    if (exam.status === 'PUBLISHED') {
      return exam; // Idempotent success
    }

    if (exam.status !== 'DRAFT' && exam.status !== 'SCHEDULED') {
      const err: any = new Error(`Cannot publish exam currently in ${exam.status} status`);
      err.statusCode = 400;
      throw err;
    }

    // Prerequisite 1: Title and Subject required
    if (!exam.title || !exam.title.trim()) {
      const err: any = new Error('Cannot publish exam: Title is missing');
      err.statusCode = 400;
      throw err;
    }

    // Prerequisite 2: Duration > 0
    if (!exam.durationMinutes || exam.durationMinutes <= 0) {
      const err: any = new Error('Cannot publish exam: Valid duration in minutes is required');
      err.statusCode = 400;
      throw err;
    }

    // Prerequisite 3: At least one question must be assigned
    if (!exam.questions || exam.questions.length === 0) {
      const err: any = new Error('Cannot publish exam: Exam must contain at least one question');
      err.statusCode = 400;
      throw err;
    }

    // Prerequisite 4: All questions must exist and be active, and recalculate authoritative marks
    const activeQuestions = await Question.find({
      questionId: { $in: exam.questions },
      status: 'ACTIVE'
    }).lean();
    if (activeQuestions.length !== exam.questions.length) {
      const err: any = new Error('Cannot publish exam: One or more questions in this exam are missing or archived');
      err.statusCode = 400;
      throw err;
    }

    const authoritativeTotalMarks = activeQuestions.reduce(
      (sum, q) => sum + (Number(q.marks) > 0 ? Number(q.marks) : 1),
      0
    );
    if (authoritativeTotalMarks <= 0) {
      const err: any = new Error('Cannot publish exam: Valid total marks are required');
      err.statusCode = 400;
      throw err;
    }

    exam.totalMarks = authoritativeTotalMarks;
    if (exam.passingMarks <= 0 || exam.passingMarks > authoritativeTotalMarks) {
      exam.passingMarks = Math.max(1, Math.round(authoritativeTotalMarks * 0.4));
    }
    exam.status = 'PUBLISHED';
    exam.questionCount = exam.questions.length;
    exam.publishedAt = new Date();
    await exam.save();

    await AuditService.record({
      actorId: user.userId,
      actorName: user.name,
      actorRole: user.role,
      action: 'EXAM_PUBLISHED',
      targetType: 'EXAM',
      targetId: examId,
      details: `Published examination "${exam.title}" (${examId})`
    });

    const examJson = exam.toJSON();
    emitExamEvent(exam, 'exam.published', { exam: examJson }, true, user.userId);
    const assignedIds = Array.from(
      new Set([...(exam.assignedStudentIds || []), ...(exam.assignedStudents || [])].filter(Boolean))
    );
    if (assignedIds.length > 0) {
      emitNotification(
        assignedIds.map(sId => `student:${sId}`),
        {
          id: `notif-${Date.now()}-${examId}`,
          title: `Exam published: ${exam.title}`
        },
        user.userId
      );
    }

    logger.info(`Exam ${examId} published by ${user.role} [${user.userId}]`);
    return exam;
  }

  /**
   * Get Student-safe list of assigned, published/live/scheduled exams
   * NEVER exposes: correctAnswer, correctOption, explanations, other students, internal metadata
   */
  static async getStudentAssignedExams(studentUserId: string): Promise<SafeStudentExamDto[]> {
    // 1. Find all assignments for this student
    const assignments = await ExamAssignment.find({ studentId: studentUserId }).lean();
    const assignedExamIds = assignments.map(a => a.examId);

    // 2. Query exams assigned to this student in PUBLISHED, LIVE, SCHEDULED, or ENDED status
    const exams = await Exam.find({
      $or: [
        { examId: { $in: assignedExamIds } },
        { assignedStudents: studentUserId },
        { assignedStudentIds: studentUserId }
      ],
      status: { $in: ['PUBLISHED', 'LIVE', 'SCHEDULED', 'ENDED'] }
    })
      .sort({ startAt: 1, startDateTime: 1, createdAt: -1 })
      .lean();

    // 3. Query all attempts for each exam by this student (sorted by most recent)
    const allAttempts = await ExamAttempt.find({
      studentId: studentUserId
    })
      .sort({ startedAt: -1 })
      .select('examId status attemptId warningCount score totalMarks percentage startedAt submittedAt')
      .lean();

    const attemptsCountMap = new Map<string, number>();
    const latestAttemptMap = new Map<string, any>();
    const activeAttemptMap = new Map<string, any>();

    for (const att of allAttempts) {
      if (!latestAttemptMap.has(att.examId)) {
        latestAttemptMap.set(att.examId, att);
      }
      if (att.status === 'IN_PROGRESS' && !activeAttemptMap.has(att.examId)) {
        activeAttemptMap.set(att.examId, att);
      }
      if (['SUBMITTED', 'EXPIRED', 'EVALUATED', 'TERMINATED'].includes(att.status)) {
        attemptsCountMap.set(att.examId, (attemptsCountMap.get(att.examId) || 0) + 1);
      }
    }

    // 4. Query published results for this student
    const publishedResults = await Result.find({
      studentId: studentUserId,
      status: { $in: ['PUBLISHED', 'QUERIED', 'REVISED'] }
    })
      .select('examId resultId score percentage')
      .lean();

    const publishedResultMap = new Map<string, any>();
    for (const res of publishedResults) {
      publishedResultMap.set(res.examId, res);
    }

    const assignmentMap = new Map<string, Date>();
    for (const a of assignments) {
      assignmentMap.set(a.examId, a.assignedAt);
    }

    // 5. Serialize to Student-safe DTO
    return exams.map(e => {
      const used = attemptsCountMap.get(e.examId) || 0;
      const limit = e.attemptLimit || 1;
      const latestAttempt = latestAttemptMap.get(e.examId);
      const activeAttempt = activeAttemptMap.get(e.examId);
      const publishedRes = publishedResultMap.get(e.examId);

      // Determine authoritative student attempt status
      const studentAttemptStatus = latestAttempt
        ? latestAttempt.status
        : used >= limit
        ? 'SUBMITTED'
        : undefined;

      const isConcluded =
        studentAttemptStatus === 'SUBMITTED' ||
        studentAttemptStatus === 'EVALUATED' ||
        studentAttemptStatus === 'TERMINATED' ||
        studentAttemptStatus === 'EXPIRED' ||
        used >= limit;

      const canAttempt =
        (e.status === 'PUBLISHED' || e.status === 'LIVE') &&
        !isConcluded &&
        (activeAttempt || used < limit);

      return {
        id: e.examId,
        examId: e.examId,
        title: e.title,
        description: e.description || '',
        subject: e.subject,
        course: e.course || '',
        department: e.department || '',
        durationMinutes: e.durationMinutes,
        totalMarks: e.totalMarks,
        passingMarks: e.passingMarks,
        attemptLimit: limit,
        strictMode: e.strictMode !== undefined ? e.strictMode : true,
        instructions: e.instructions || '',
        status: e.status,
        questionCount: e.questions?.length || 0,
        startAt: e.startAt || e.startDateTime,
        endAt: e.endAt || e.endDateTime,
        startDateTime: e.startDateTime || e.startAt,
        endDateTime: e.endDateTime || e.endAt,
        publishedAt: e.publishedAt,
        assignedAt: assignmentMap.get(e.examId) || e.createdAt,
        attemptsUsed: used,
        canAttempt,
        studentAttemptStatus,
        attemptStatus: studentAttemptStatus,
        activeAttemptId: activeAttempt ? activeAttempt.attemptId : null,
        resultPublished: Boolean(publishedRes)
      };
    });
  }

  /**
   * Get single Student-safe exam details (without correct answers or explanations)
   */
  static async getStudentExamDetails(examId: string, studentUserId: string): Promise<any> {
    const exams = await this.getStudentAssignedExams(studentUserId);
    const matched = exams.find((e) => e.examId === examId);
    if (!matched) {
      const err: any = new Error('Forbidden: You are not assigned to this examination or it is not available');
      err.statusCode = 403;
      throw err;
    }

    const examDoc = await Exam.findOne({ examId }).lean();
    const questions = await Question.find({
      questionId: { $in: examDoc?.questions || [] },
      status: 'ACTIVE'
    }).lean();

    const sanitizedQuestions = questions.map((q) => ({
      id: q.questionId,
      questionId: q.questionId,
      questionText: q.questionText,
      subject: q.subject,
      topic: q.topic || '',
      difficulty: q.difficulty,
      marks: q.marks || 1,
      negativeMarks: q.negativeMarks || 0,
      options: (q.options || []).map((o: any) => ({ id: o.id, text: o.text }))
    }));

    return {
      ...matched,
      questions: sanitizedQuestions
    };
  }
}

