import {
  User,
  UserRole,
  SystemUser,
  TeacherDetailsData,
  StudentDetailsData,
  SyllabusExtractData,
  Question,
  Difficulty,
  ScheduledExam,
  ExamAttemptRecord,
  StudentResult,
  StudentQuery,
  ProctoringEventRecord,
  AssistanceRequestRecord,
  AuditLog,
  QuestionOption,
  AiGenerationBatch
} from '../types';

const AUTH_TOKEN_KEY = 'examx_auth_token';
const LEGACY_TOKEN_KEY = 'auth_token';
const DEVICE_SESSION_KEY = 'examx_device_session_id';

function getDeviceSessionId(): string {
  const saved = localStorage.getItem(DEVICE_SESSION_KEY);
  if (saved && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(saved)) {
    return saved;
  }

  if (!globalThis.crypto?.randomUUID) {
    throw new Error('This browser cannot securely identify the examination session.');
  }

  const deviceSessionId = globalThis.crypto.randomUUID();
  localStorage.setItem(DEVICE_SESSION_KEY, deviceSessionId);
  return deviceSessionId;
}

function resolveApiBase(): string {
  const configured = ((import.meta as any).env?.VITE_API_URL || '').trim();
  if (!configured || configured === '/api') {
    return '/api';
  }
  // Never call a stale localhost port (e.g. localhost:8000) when served from the unified server or deployed domain
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/i.test(configured)) {
    return '/api';
  }
  const normalized = configured.replace(/\/+$/, '');
  return normalized.endsWith('/api') ? normalized : `${normalized}/api`;
}

const API_BASE = resolveApiBase();

export interface CreateTeacherPayload {
  name: string;
  dob?: string;
  dobYear?: number;
  email?: string;
  phone?: string;
  department: string;
  designation?: string;
  qualification?: string;
  specialization?: string;
  experience?: number;
  experienceYears?: number;
  password?: string;
}

export interface CreateStudentPayload {
  name: string;
  dob?: string;
  dobYear?: number;
  email?: string;
  phone?: string;
  enrollmentNo?: string;
  rollNumber?: string;
  course?: string;
  department: string;
  academicYear?: string;
  semester?: string;
  section?: string;
  password?: string;
  managedBy?: string[];
  assignedTeachers?: string[];
}

export interface GeneratedCredentialResponse<T> {
  teacher?: T;
  student?: T;
  credentials: {
    userId: string;
    password: string;
  };
}

function getAuthHeaders(includeJsonContentType = true): HeadersInit {
  const token = localStorage.getItem(AUTH_TOKEN_KEY) || localStorage.getItem(LEGACY_TOKEN_KEY);
  const headers: Record<string, string> = {};
  if (includeJsonContentType) {
    headers['Content-Type'] = 'application/json';
  }
  if (token) {
    headers['X-ExamX-Device-Session'] = getDeviceSessionId();
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

async function handleApiResponse<T>(res: Response): Promise<T> {
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.success === false) {
    const message = json?.error?.message || json?.message || `Request failed with status ${res.status}`;
    const err: any = new Error(message);
    err.status = res.status;
    err.code = json?.code;
    throw err;
  }
  return json.data !== undefined ? json.data : json;
}

export function mapBackendUserToFrontend(u: any): User {
  const role = (u.role as UserRole) || UserRole.STUDENT;
  return {
    id: u.userId || u.id || u._id,
    userId: u.userId || u.id,
    name: u.name || 'User',
    email: u.email || '',
    role,
    status: u.status || 'ACTIVE',
    avatar: `https://ui-avatars.com/api/?name=${encodeURIComponent(u.name || 'User')}&background=2563eb&color=fff&bold=true`,
    department: u.department || '',
    course: u.course || '',
    semester: u.semester || '',
    academicYear: u.academicYear || '',
    section: u.section || '',
    enrollmentNo: u.enrollmentNo || u.userId,
    phone: u.phone || '',
    designation: u.designation || '',
    qualification: u.qualification || '',
    specialization: u.specialization || '',
    experience: u.experienceYears ?? u.experience ?? 0,
    joinDate: u.createdAt ? new Date(u.createdAt).toLocaleDateString() : '—',
    bio: u.department ? `${role} · ${u.department}` : role
  };
}

export function mapBackendUserToSystemUser(u: any): SystemUser {
  const managedBy = Array.isArray(u.managedBy)
    ? u.managedBy
    : Array.isArray(u.teacherIds)
    ? u.teacherIds
    : [];
  const assignedTeachers = Array.isArray(u.assignedTeachers)
    ? u.assignedTeachers
    : managedBy.map((tid: string) => ({ userId: tid, name: tid }));
  const assignedTeacherNames = Array.isArray(u.assignedTeacherNames)
    ? u.assignedTeacherNames
    : assignedTeachers.map((t: any) => t.name || t.userId);

  return {
    id: u.userId || u.id || u._id,
    userId: u.userId || u.id,
    name: u.name,
    email: u.email || '',
    role: u.role as UserRole,
    status: u.status || 'ACTIVE',
    lastLogin: u.lastLoginAt
      ? new Date(u.lastLoginAt).toLocaleString()
      : u.createdAt
      ? new Date(u.createdAt).toLocaleDateString()
      : '—',
    dob: u.dob || '',
    dobYear: u.dobYear,
    department: u.department || '',
    phone: u.phone || '',
    designation: u.designation || '',
    qualification: u.qualification || '',
    specialization: u.specialization || '',
    experience: u.experienceYears ?? u.experience ?? 0,
    experienceYears: u.experienceYears ?? u.experience ?? 0,
    enrollmentNo: u.enrollmentNo || '',
    course: u.course || '',
    semester: u.semester || '',
    academicYear: u.academicYear || '',
    section: u.section || '',
    managedBy,
    teacherIds: managedBy,
    assignedTeachers,
    assignedTeacherNames,
    studentsCount: u.studentsCount ?? 0,
    examsCount: u.examsCount ?? 0,
    createdBy: u.createdBy || '',
    createdAt: u.createdAt
  };
}

export function mapBackendQuestionToFrontend(q: any): Question {
  const rawOptions: QuestionOption[] = Array.isArray(q.options)
    ? q.options.map((opt: any, idx: number) => {
        const defaultKeys: Array<'A' | 'B' | 'C' | 'D'> = ['A', 'B', 'C', 'D'];
        if (typeof opt === 'string') {
          return { key: defaultKeys[idx] || 'A', text: opt };
        }
        return {
          key: (opt.key || opt.id || defaultKeys[idx] || 'A') as 'A' | 'B' | 'C' | 'D',
          text: opt.text || ''
        };
      })
    : [];

  const optionsText = rawOptions.map((o) => o.text);
  const correctKey = (q.correctOption || q.correctAnswer) as 'A' | 'B' | 'C' | 'D' | undefined;
  const correctIndex = correctKey
    ? Math.max(0, rawOptions.findIndex((o) => o.key === correctKey))
    : typeof q.correctAnswer === 'number'
    ? q.correctAnswer
    : 0;

  return {
    id: q.questionId || q.id || q._id,
    questionId: q.questionId || q.id,
    text: q.questionText || q.text || '',
    questionText: q.questionText || q.text || '',
    options: optionsText,
    rawOptions,
    correctAnswer: correctIndex,
    correctOption: correctKey || (['A', 'B', 'C', 'D'][correctIndex] as 'A' | 'B' | 'C' | 'D') || 'A',
    difficulty: (q.difficulty as Difficulty) || Difficulty.MEDIUM,
    topic: q.topic || q.subject || 'General',
    subject: q.subject || q.topic || 'General',
    course: q.course || '',
    semester: q.semester || '',
    questionType: q.questionType || 'MCQ',
    explanation: q.explanation || '',
    marks: q.marks ?? 1,
    negativeMarks: q.negativeMarks ?? 0,
    status: q.status || 'ACTIVE',
    source: q.source || 'MANUAL',
    syllabusSource: q.syllabusSource,
    reviewStatus: q.reviewStatus,
    syllabusId: q.syllabusId,
    syllabusUnit: q.syllabusUnit,
    syllabusTopic: q.syllabusTopic,
    sourceReference: q.sourceReference,
    generationId: q.generationId,
    aiProvider: q.aiProvider,
    aiModel: q.aiModel,
    createdBy: q.createdBy,
    createdByName: q.createdByName,
    createdAt: q.createdAt
  };
}

export function mapBackendExamToFrontend(e: any): ScheduledExam {
  if (!e || typeof e !== 'object') {
    throw new Error('Exam metadata is missing from the server response.');
  }

  const rawStart = e.startTime || e.startAt || e.startDateTime || e.createdAt;
  const rawEnd = e.endTime || e.endAt || e.endDateTime;
  const startDt = rawStart ? new Date(rawStart) : null;
  const endDt = rawEnd
    ? new Date(rawEnd)
    : startDt
    ? new Date(startDt.getTime() + (e.durationMinutes || 60) * 60000)
    : null;

  const questionIds = Array.isArray(e.questionIds)
    ? e.questionIds
    : Array.isArray(e.questions)
    ? e.questions.map((q: any) => (typeof q === 'string' ? q : q.questionId || q.id))
    : [];

  const assignedStudentIds = Array.isArray(e.assignedStudentIds)
    ? e.assignedStudentIds
    : Array.isArray(e.assignedStudents)
    ? e.assignedStudents
    : [];

  const attemptStatus = e.attemptStatus || e.studentAttemptStatus;

  return {
    id: e.examId || e.id || e._id,
    examId: e.examId || e.id,
    title: e.title,
    description: e.description || '',
    subject: e.subject || '',
    course: e.course || '',
    department: e.department || '',
    semester: e.semester || '',
    scheduledDate: startDt && !isNaN(startDt.getTime()) ? startDt.toISOString().split('T')[0] : '',
    startTime: startDt && !isNaN(startDt.getTime()) ? startDt.toTimeString().slice(0, 5) : '09:00',
    endTime: endDt && !isNaN(endDt.getTime()) ? endDt.toTimeString().slice(0, 5) : '10:00',
    startAt: startDt && !isNaN(startDt.getTime()) ? startDt.toISOString() : undefined,
    endAt: endDt && !isNaN(endDt.getTime()) ? endDt.toISOString() : undefined,
    durationMinutes: e.durationMinutes || 60,
    totalMarks: Number(e.totalMarks ?? 0),
    passingMarks: Number(e.passingMarks ?? 0),
    attemptLimit: e.attemptLimit || 1,
    instructions: e.instructions || 'Read all instructions carefully before beginning.',
    questionIds,
    questionCount: e.questionCount ?? questionIds.length,
    assignedStudentIds,
    proctoringConfig: {
      enableWebcam: e.proctoringEnabled !== false && e.strictMode !== false,
      FullScreenEnforcement: true,
      tabSwitchLimit: 3,
      aiSuspicionThreshold: 70
    },
    status: e.status || 'DRAFT',
    createdBy: e.createdBy || '',
    createdByName: e.createdByName || '',
    assignedStudentsCount: e.assignedStudentsCount ?? assignedStudentIds.length,
    attemptStatus,
    studentAttemptStatus: attemptStatus,
    studentAttemptId: e.studentAttemptId,
    studentAttempts: Array.isArray(e.studentAttempts)
      ? e.studentAttempts.map((attempt: any) => ({
          attemptId: attempt.attemptId,
          status: attempt.status,
          resultPublished: Boolean(attempt.resultPublished)
        }))
      : undefined,
    canAttempt: typeof e.canAttempt === 'boolean' ? e.canAttempt : undefined,
    resultPublished:
      Boolean(e.publishedResult) || e.status === 'PUBLISHED' || e.status === 'RESULT_PUBLISHED',
    attemptCount: e.attemptCount ?? e.attemptsUsed ?? 0,
    activeAttemptId: e.activeAttemptId ?? null,
    publishedResult: e.publishedResult ?? null
  };
}

export function mapBackendResultToFrontend(r: any): StudentResult {
  const breakdown = Array.isArray(r.answerBreakdown)
    ? r.answerBreakdown
    : Array.isArray(r.answers)
    ? r.answers
    : [];

  const totalQuestions =
    (r.correctCount || 0) + (r.wrongCount || 0) + (r.unansweredCount || 0) ||
    (breakdown.length > 0 ? breakdown.length : r.totalMarks || 1);

  const totalMarks = r.totalMarks ?? totalQuestions ?? 100;
  const percentage = r.percentage ?? (totalMarks > 0 ? Math.round((r.score / totalMarks) * 100) : 0);
  const persistedDate = r.submittedAt || r.publishedAt || r.createdAt;
  const status = r.status || 'PENDING';
  const isPublished = ['PUBLISHED', 'QUERIED', 'REVISED'].includes(status) || Boolean(r.isPublished);
  const violations = r.warningCount ?? r.proctoringWarnings ?? r.violations ?? 0;
  const integrityScore =
    r.integrityScore !== undefined
      ? r.integrityScore
      : Math.max(0, 100 - violations * 10);

  return {
    id: r.resultId || r.id || r._id,
    resultId: r.resultId || r.id,
    attemptId: r.attemptId,
    studentId: r.studentId,
    studentName: r.studentName || r.studentId,
    studentEmail: r.studentEmail || '',
    examId: r.examId,
    examTitle: r.examTitle || 'Examination',
    subject: r.subject || '',
    topic: r.subject || r.examTitle || 'General',
    score: r.score ?? 0,
    totalMarks,
    percentage,
    correctCount: r.correctCount ?? breakdown.filter((b: any) => b.isCorrect).length,
    wrongCount: r.wrongCount ?? breakdown.filter((b: any) => b.selectedOption && !b.isCorrect).length,
    unansweredCount: r.unansweredCount ?? breakdown.filter((b: any) => !b.selectedOption).length,
    totalQuestions,
    accuracy: percentage,
    integrityScore,
    isPublished,
    passed: r.passed !== undefined ? r.passed : percentage >= 40,
    timeTaken: r.publishedAt ? 'Published' : 'Evaluated',
    date: persistedDate ? new Date(persistedDate).toLocaleDateString() : '—',
    status,
    publishedBy: r.publishedBy || r.verifiedBy || '',
    publishedAt: r.publishedAt || null,
    violations,
    proctoringStatus: r.proctoringStatus || 'CLEAN',
    terminationReason: r.terminationReason || '',
    answerBreakdown: breakdown
  };
}

export function mapBackendQueryToFrontend(q: any): StudentQuery {
  let normalizedStatus: StudentQuery['status'] = 'PENDING';
  if (q.status === 'RESOLVED_ACCEPTED' || q.status === 'APPROVED' || q.status === 'RESOLVED') {
    normalizedStatus = 'APPROVED';
  } else if (q.status === 'RESOLVED_REJECTED' || q.status === 'REJECTED') {
    normalizedStatus = 'REJECTED';
  } else if (q.status === 'UNDER_REVIEW') {
    normalizedStatus = 'UNDER_REVIEW';
  }

  const descriptionText = q.description || q.explanation || q.message || q.question || '';
  const responseText = q.response || q.teacherRemarks || q.facultyComment || q.reply || '';
  const createdStr = q.createdAt ? new Date(q.createdAt).toLocaleString() : '—';
  const normalizedReason = (() => {
    const rawReason = (q.reasonType || q.reason || 'EVALUATION_ERROR') as StudentQuery['reasonType'];
    return rawReason;
  })();

  return {
    id: q.queryId || q.id || q._id,
    queryId: q.queryId || q.id,
    studentId: q.studentId,
    studentName: q.studentName || q.studentId,
    examId: q.examId,
    examTitle: q.examTitle || q.examId,
    subject: q.subject || '',
    topic: q.subject || q.examTitle || 'General',
    attemptId: q.attemptId || '',
    resultId: q.resultId || '',
    questionId: q.questionId || 'GENERAL',
    questionNumber: q.questionNumber || 0,
    questionText: q.questionText || 'General Examination Query',
    options: q.options || [],
    studentAnswer: q.studentAnswer || '',
    assignedFacultyId: q.assignedFacultyId || '',
    question: descriptionText,
    currentMarks: q.currentMarks ?? 0,
    maxMarks: q.maxMarks ?? 1,
    reasonType: normalizedReason,
    message: descriptionText,
    description: descriptionText,
    status: normalizedStatus,
    response: responseText,
    reply: responseText,
    facultyComment: responseText,
    scoreAdjustment: q.scoreAdjustment ?? 0,
    resolutionType: q.resolutionType,
    resolutionNotes: q.resolutionNotes || '',
    correctedAnswer: q.correctedAnswer || '',
    resolvedBy: q.resolvedBy || '',
    resolvedByName: q.resolvedByName || '',
    resolvedAt: q.resolvedAt || null,
    createdAt: createdStr,
    timestamp: createdStr
  };
}

function mapBackendAttemptToFrontend(attempt: any): ExamAttemptRecord {
  if (!attempt || typeof attempt !== 'object') {
    throw new Error('Attempt data is missing from the server response.');
  }

  return {
    ...attempt,
    id: attempt.attemptId || attempt.id || attempt._id,
    attemptId: attempt.attemptId || attempt.id,
    startedAt: attempt.startedAt ? new Date(attempt.startedAt).toISOString() : '',
    expiresAt: attempt.expiresAt ? new Date(attempt.expiresAt).toISOString() : '',
    submittedAt: attempt.submittedAt ? new Date(attempt.submittedAt).toISOString() : null,
    lastHeartbeatAt: attempt.lastHeartbeatAt ? new Date(attempt.lastHeartbeatAt).toISOString() : undefined,
    currentQuestionIndex: attempt.currentQuestionIndex || 0,
    warningCount: attempt.warningCount || 0,
    answers: Array.isArray(attempt.answers)
      ? attempt.answers.map((answer: any) => ({
          ...answer,
          selectedOption: answer.selectedOption || null,
          markedForReview: Boolean(answer.markedForReview)
        }))
      : []
  };
}

export const dbService = {
  getAuthToken(): string | null {
    return localStorage.getItem(AUTH_TOKEN_KEY) || localStorage.getItem(LEGACY_TOKEN_KEY);
  },

  setAuthToken(token: string): void {
    localStorage.setItem(AUTH_TOKEN_KEY, token);
    localStorage.setItem(LEGACY_TOKEN_KEY, token);
  },

  clearSession(): void {
    localStorage.removeItem(AUTH_TOKEN_KEY);
    localStorage.removeItem(LEGACY_TOKEN_KEY);
  },

  // --- AUTHENTICATION ---
  async login(userId: string, password: string): Promise<{ token: string; user: User }> {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: userId.trim(), password })
    });
    const data = await handleApiResponse<{ token: string; user: any }>(res);
    this.setAuthToken(data.token);
    return {
      token: data.token,
      user: mapBackendUserToFrontend(data.user)
    };
  },

  async signUpStudent(payload: {
    name: string;
    email: string;
    phone: string;
    dob: string;
    course: string;
    department: string;
    semester: string;
    facultyId: string;
  }): Promise<{ user: User; credentials: { studentId: string; initialPassword: string } }> {
    const res = await fetch(`${API_BASE}/auth/signup/student`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await handleApiResponse<{
      user: any;
      credentials: { studentId: string; initialPassword: string };
    }>(res);
    return {
      user: mapBackendUserToFrontend(data.user),
      credentials: data.credentials
    };
  },

  async changeStudentPassword(currentPassword: string, newPassword: string): Promise<void> {
    const res = await fetch(`${API_BASE}/auth/password`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ currentPassword, newPassword })
    });
    await handleApiResponse<{ success: true }>(res);
  },

  async getCurrentUser(): Promise<User | null> {
    const token = this.getAuthToken();
    if (!token) return null;
    try {
      const res = await fetch(`${API_BASE}/users/me`, {
        method: 'GET',
        headers: getAuthHeaders()
      });
      const data = await handleApiResponse<{ user: any }>(res);
      return mapBackendUserToFrontend(data.user);
    } catch {
      this.clearSession();
      return null;
    }
  },

  // --- USER MANAGEMENT ---
  async getNextUserId(role: 'TEACHER' | 'STUDENT'): Promise<{ nextUserId: string; role: string }> {
    const res = await fetch(`${API_BASE}/users/next-id?role=${encodeURIComponent(role)}`, {
      method: 'GET',
      headers: getAuthHeaders()
    });
    return handleApiResponse<{ nextUserId: string; role: string }>(res);
  },

  async getNextTeacherId(): Promise<string> {
    const res = await fetch(`${API_BASE}/users/teachers/next-id`, {
      method: 'GET',
      headers: getAuthHeaders()
    });
    const data = await handleApiResponse<{ nextUserId: string }>(res);
    return data.nextUserId;
  },

  async getNextStudentId(): Promise<string> {
    const res = await fetch(`${API_BASE}/users/students/next-id`, {
      method: 'GET',
      headers: getAuthHeaders()
    });
    const data = await handleApiResponse<{ nextUserId: string }>(res);
    return data.nextUserId;
  },

  async getTeachers(): Promise<SystemUser[]> {
    const res = await fetch(`${API_BASE}/users/teachers`, {
      method: 'GET',
      headers: getAuthHeaders()
    });
    const data = await handleApiResponse<{ teachers: any[] }>(res);
    return (data.teachers || []).map(mapBackendUserToSystemUser);
  },

  async getTeacherDetails(userId: string): Promise<TeacherDetailsData> {
    const res = await fetch(`${API_BASE}/users/teachers/${encodeURIComponent(userId)}`, {
      method: 'GET',
      headers: getAuthHeaders()
    });
    const data = await handleApiResponse<any>(res);
    const teacherUser = mapBackendUserToSystemUser(data.teacher || data);
    const assignedStudents = (data.assignedStudents || data.recentStudents || []).map(mapBackendUserToSystemUser);
    const createdExams = (data.createdExams || data.recentExams || []).map(mapBackendExamToFrontend);
    return {
      teacher: teacherUser,
      kpis: data.kpis || {
        students: assignedStudents.length,
        exams: createdExams.length,
        questions: 0,
        queries: 0,
        assignedStudentsCount: assignedStudents.length,
        createdExamsCount: createdExams.length,
        evaluatedResultsCount: 0,
        pendingQueriesCount: 0
      },
      assignedStudents,
      recentStudents: (data.recentStudents || assignedStudents).map(mapBackendUserToSystemUser),
      createdExams,
      recentExams: (data.recentExams || createdExams).map(mapBackendExamToFrontend),
      recentActivity: data.recentActivity || []
    };
  },

  async createTeacher(payload: CreateTeacherPayload): Promise<GeneratedCredentialResponse<SystemUser>> {
    const res = await fetch(`${API_BASE}/users/teachers`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(payload)
    });
    const data = await handleApiResponse<{
      teacher: any;
      credentials?: { userId: string; password: string };
      initialCredentials?: { userId: string; temporaryPassword: string };
    }>(res);
    const creds = data.credentials || {
      userId: data.initialCredentials?.userId || data.teacher?.userId,
      password: data.initialCredentials?.temporaryPassword || ''
    };
    return {
      teacher: mapBackendUserToSystemUser(data.teacher),
      credentials: creds
    };
  },

  async updateTeacher(userId: string, payload: Partial<SystemUser>): Promise<SystemUser> {
    const res = await fetch(`${API_BASE}/users/teachers/${encodeURIComponent(userId)}`, {
      method: 'PATCH',
      headers: getAuthHeaders(),
      body: JSON.stringify(payload)
    });
    const data = await handleApiResponse<{ teacher: any }>(res);
    return mapBackendUserToSystemUser(data.teacher);
  },

  async resetTeacherPassword(userId: string, newPassword?: string): Promise<{ userId: string; temporaryPassword: string }> {
    const res = await fetch(`${API_BASE}/users/teachers/${encodeURIComponent(userId)}/reset-password`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ password: newPassword })
    });
    const data = await handleApiResponse<any>(res);
    return (
      data?.initialCredentials || {
        userId,
        temporaryPassword: newPassword || ''
      }
    );
  },

  async getStudents(): Promise<SystemUser[]> {
    const res = await fetch(`${API_BASE}/users/students`, {
      method: 'GET',
      headers: getAuthHeaders()
    });
    const data = await handleApiResponse<{ students: any[] }>(res);
    return (data.students || []).map(mapBackendUserToSystemUser);
  },

  async getStudentDetails(userId: string): Promise<StudentDetailsData> {
    const res = await fetch(`${API_BASE}/users/students/${encodeURIComponent(userId)}`, {
      method: 'GET',
      headers: getAuthHeaders()
    });
    const data = await handleApiResponse<any>(res);
    const studentUser = mapBackendUserToSystemUser(data.student || data);
    const assignedTeacher = data.assignedTeacher ? mapBackendUserToSystemUser(data.assignedTeacher) : null;
    const results = (data.results || []).map(mapBackendResultToFrontend);
    const recentExams = (data.recentExams || []).map(mapBackendExamToFrontend);
    const queries = (data.queries || []).map(mapBackendQueryToFrontend);

    const avgPct =
      results.length > 0
        ? Math.round(
            results.reduce((acc: number, r: any) => acc + (Number(r.percentage) || 0), 0) /
              results.length
          )
        : 0;

    return {
      student: studentUser,
      assignedTeacher,
      kpis: {
        assignedExams: data.kpis?.assignedExams ?? recentExams.length,
        completedExams: data.kpis?.completedExams ?? results.length,
        pendingExams: data.kpis?.pendingExams ?? Math.max(0, recentExams.length - results.length),
        publishedResults: data.kpis?.publishedResults ?? results.length,
        examsTakenCount: data.kpis?.examsTakenCount ?? results.length,
        averagePercentage: data.kpis?.averagePercentage ?? avgPct,
        publishedResultsCount: data.kpis?.publishedResultsCount ?? results.length,
        queriesCount: data.kpis?.queriesCount ?? queries.length,
        examsAttempted: data.kpis?.examsAttempted ?? data.kpis?.completedExams ?? 0,
        examsNotAttempted: data.kpis?.examsNotAttempted ?? data.kpis?.pendingExams ?? 0,
        examsPassed: data.kpis?.examsPassed ?? 0,
        examsFailed: data.kpis?.examsFailed ?? 0,
        averageScore: data.kpis?.averageScore ?? null,
        highestScore: data.kpis?.highestScore ?? null,
        lowestScore: data.kpis?.lowestScore ?? null,
        passRate: data.kpis?.passRate ?? null,
        overallRank: data.kpis?.overallRank ?? null,
        totalRankedStudents: data.kpis?.totalRankedStudents ?? 0
      },
      recentExams,
      results,
      queries,
      examHistory: data.examHistory || [],
      performance: data.performance || { subjectBreakdown: [], overallRank: null },
      proctoringSummary: data.proctoringSummary,
      assistance: data.assistance
    };
  },

  async createStudent(payload: CreateStudentPayload): Promise<GeneratedCredentialResponse<SystemUser>> {
    const res = await fetch(`${API_BASE}/users/students`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({
        ...payload,
        enrollmentNo: payload.enrollmentNo || payload.rollNumber,
        assignedTeachers: payload.assignedTeachers ?? payload.managedBy
      })
    });
    const data = await handleApiResponse<{
      student: any;
      credentials?: { userId: string; password: string };
      initialCredentials?: { userId: string; temporaryPassword: string };
    }>(res);
    const creds = data.credentials || {
      userId: data.initialCredentials?.userId || data.student?.userId,
      password: data.initialCredentials?.temporaryPassword || ''
    };
    return {
      student: mapBackendUserToSystemUser(data.student),
      credentials: creds
    };
  },

  async updateStudent(userId: string, payload: Partial<SystemUser>): Promise<SystemUser> {
    const res = await fetch(`${API_BASE}/users/students/${encodeURIComponent(userId)}`, {
      method: 'PATCH',
      headers: getAuthHeaders(),
      body: JSON.stringify(payload)
    });
    const data = await handleApiResponse<{ student: any }>(res);
    return mapBackendUserToSystemUser(data.student);
  },

  async resetStudentPassword(userId: string, newPassword?: string): Promise<{ userId: string; temporaryPassword: string }> {
    const res = await fetch(`${API_BASE}/users/students/${encodeURIComponent(userId)}/reset-password`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ password: newPassword })
    });
    const data = await handleApiResponse<any>(res);
    return (
      data?.initialCredentials || {
        userId,
        temporaryPassword: newPassword || ''
      }
    );
  },

  async updateUserStatus(
    userId: string,
    status: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED' | 'BLOCKED'
  ): Promise<SystemUser> {
    const res = await fetch(`${API_BASE}/users/${encodeURIComponent(userId)}/status`, {
      method: 'PATCH',
      headers: getAuthHeaders(),
      body: JSON.stringify({ status })
    });
    const data = await handleApiResponse<{ user: any }>(res);
    return mapBackendUserToSystemUser(data.user);
  },

  // --- QUESTION BANK & SERVER-SIDE AI WITH SYLLABUS UPLOAD ---
  async getSubjects(): Promise<string[]> {
    const res = await fetch(`${API_BASE}/subjects`, { headers: getAuthHeaders() });
    const data = await handleApiResponse<{ subjects: string[] }>(res);
    return data.subjects || [];
  },

  async createSubject(name: string): Promise<string> {
    const res = await fetch(`${API_BASE}/subjects`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ name })
    });
    const data = await handleApiResponse<{ subject: string }>(res);
    return data.subject;
  },

  async getQuestions(filters?: {
    subject?: string;
    course?: string;
    semester?: string;
    difficulty?: string;
    topic?: string;
    status?: string;
    search?: string;
    page?: number;
    pageSize?: number;
  }): Promise<Question[]> {
    const params = new URLSearchParams();
    if (filters?.subject) params.set('subject', filters.subject);
    if (filters?.course) params.set('course', filters.course);
    if (filters?.semester) params.set('semester', filters.semester);
    if (filters?.difficulty) params.set('difficulty', filters.difficulty);
    if (filters?.topic) params.set('topic', filters.topic);
    if (filters?.status) params.set('status', filters.status);
    if (filters?.search) params.set('search', filters.search);
    if (filters?.page) params.set('page', String(filters.page));
    if (filters?.pageSize) params.set('pageSize', String(filters.pageSize));

    const qs = params.toString() ? `?${params.toString()}` : '';
    const res = await fetch(`${API_BASE}/questions${qs}`, {
      method: 'GET',
      headers: getAuthHeaders()
    });
    const data = await handleApiResponse<{ questions: any[]; total?: number }>(res);
    return (data.questions || []).map(mapBackendQuestionToFrontend);
  },

  async createQuestion(payload: {
    questionText: string;
    subject: string;
    topic: string;
    course?: string;
    semester?: string;
    difficulty: Difficulty;
    options: Array<{ key: 'A' | 'B' | 'C' | 'D'; text: string; id?: string }>;
    correctOption: 'A' | 'B' | 'C' | 'D';
    explanation?: string;
    marks?: number;
    negativeMarks?: number;
    source?: 'MANUAL' | 'AI_GENERATED';
    status?: 'DRAFT' | 'ACTIVE' | 'INACTIVE' | 'ARCHIVED';
  }): Promise<Question> {
    const res = await fetch(`${API_BASE}/questions`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({
        ...payload,
        correctAnswer: payload.correctOption
      })
    });
    const data = await handleApiResponse<{ question: any }>(res);
    return mapBackendQuestionToFrontend(data.question);
  },

  async updateQuestion(
    questionId: string,
    payload: Partial<{
      questionText: string;
      subject: string;
      topic: string;
      course: string;
      semester: string;
      difficulty: Difficulty;
      options: Array<{ key: 'A' | 'B' | 'C' | 'D'; text: string }>;
      correctOption: 'A' | 'B' | 'C' | 'D';
      explanation: string;
      marks: number;
      negativeMarks: number;
      status: 'DRAFT' | 'ACTIVE' | 'INACTIVE' | 'ARCHIVED';
    }>
  ): Promise<Question> {
    const res = await fetch(`${API_BASE}/questions/${encodeURIComponent(questionId)}`, {
      method: 'PATCH',
      headers: getAuthHeaders(),
      body: JSON.stringify(payload)
    });
    const data = await handleApiResponse<{ question: any }>(res);
    return mapBackendQuestionToFrontend(data.question);
  },

  async updateQuestionStatus(
    questionId: string,
    status: 'ACTIVE' | 'INACTIVE' | 'ARCHIVED'
  ): Promise<Question> {
    const res = await fetch(`${API_BASE}/questions/${encodeURIComponent(questionId)}/status`, {
      method: 'PATCH',
      headers: getAuthHeaders(),
      body: JSON.stringify({ status })
    });
    const data = await handleApiResponse<{ question: any }>(res);
    return mapBackendQuestionToFrontend(data.question);
  },

  async deleteQuestion(questionId: string): Promise<void> {
    const res = await fetch(`${API_BASE}/questions/${encodeURIComponent(questionId)}`, {
      method: 'DELETE',
      headers: getAuthHeaders()
    });
    await handleApiResponse(res);
  },

  async extractSyllabusFile(file: File): Promise<SyllabusExtractData> {
    const formData = new FormData();
    formData.append('syllabus', file);
    const res = await fetch(`${API_BASE}/ai/syllabus/extract`, {
      method: 'POST',
      headers: getAuthHeaders(false),
      body: formData
    });
    return handleApiResponse<SyllabusExtractData>(res);
  },

  async extractSyllabusPreview(file: File): Promise<SyllabusExtractData> {
    return this.extractSyllabusFile(file);
  },

  async uploadSyllabus(
    file: File,
    context: { course: string; semester: string; subject: string }
  ): Promise<SyllabusExtractData> {
    const formData = new FormData();
    formData.append('syllabus', file);
    formData.append('course', context.course);
    formData.append('semester', context.semester);
    formData.append('subject', context.subject);
    const res = await fetch(`${API_BASE}/ai/syllabus/upload`, {
      method: 'POST',
      headers: getAuthHeaders(false),
      body: formData
    });
    return handleApiResponse<SyllabusExtractData>(res);
  },

  async getAiStatus(): Promise<{
    configured: boolean;
    status: 'READY' | 'GENERATING' | 'NOT_CONFIGURED' | 'ERROR' | 'PENDING_REVIEW';
    pendingReviewCount: number;
    maxFileSizeMb: number;
    supportedFormats: string[];
    message: string;
  }> {
    const res = await fetch(`${API_BASE}/ai/status`, { headers: getAuthHeaders() });
    return handleApiResponse(res);
  },

  async getAiDrafts(): Promise<Question[]> {
    const res = await fetch(`${API_BASE}/ai/questions/drafts`, { headers: getAuthHeaders() });
    const data = await handleApiResponse<{ drafts: any[] }>(res);
    return (data.drafts || []).map(mapBackendQuestionToFrontend);
  },

  async getAiGenerationBatches(): Promise<AiGenerationBatch[]> {
    const res = await fetch(`${API_BASE}/ai/generation-batches`, { headers: getAuthHeaders() });
    const data = await handleApiResponse<{ batches: AiGenerationBatch[] }>(res);
    return data.batches || [];
  },

  async getAiGenerationBatchQuestions(generationId: string): Promise<Question[]> {
    const res = await fetch(
      `${API_BASE}/ai/generation-batches/${encodeURIComponent(generationId)}/questions`,
      { headers: getAuthHeaders() }
    );
    const data = await handleApiResponse<{ questions: any[] }>(res);
    return (data.questions || []).map(mapBackendQuestionToFrontend);
  },

  async updateAiDraft(question: Question): Promise<Question> {
    const questionId = question.questionId || question.id;
    const res = await fetch(`${API_BASE}/ai/questions/drafts/${encodeURIComponent(questionId)}`, {
      method: 'PATCH',
      headers: getAuthHeaders(),
      body: JSON.stringify({
        questionText: question.text,
        subject: question.subject,
        topic: question.topic,
        course: question.course,
        semester: question.semester,
        difficulty: question.difficulty,
        options: question.options.map((text, index) => ({ id: ['A', 'B', 'C', 'D'][index], text })),
        correctOption: ['A', 'B', 'C', 'D'][question.correctAnswer || 0],
        explanation: question.explanation,
        marks: question.marks,
        negativeMarks: question.negativeMarks
      })
    });
    const data = await handleApiResponse<{ question: any }>(res);
    return mapBackendQuestionToFrontend(data.question);
  },

  async approveAiDraft(questionId: string): Promise<Question> {
    const res = await fetch(`${API_BASE}/ai/questions/drafts/${encodeURIComponent(questionId)}/approve`, {
      method: 'POST',
      headers: getAuthHeaders()
    });
    const data = await handleApiResponse<{ question: any }>(res);
    return mapBackendQuestionToFrontend(data.question);
  },

  async discardAiDraft(questionId: string): Promise<void> {
    const res = await fetch(`${API_BASE}/ai/questions/drafts/${encodeURIComponent(questionId)}`, {
      method: 'DELETE',
      headers: getAuthHeaders()
    });
    await handleApiResponse(res);
  },

  async generateAiQuestions(payload: {
    syllabusId: string;
    subject?: string;
    topic?: string;
    unit?: string;
    selectedUnits?: string[];
    course: string;
    semester: string;
    difficulty: Difficulty | 'MIXED';
    questionType?: 'MCQ';
    count: number;
    marks?: number;
    negativeMarks?: number;
  }): Promise<{
    generated: Question[];
    savedQuestions: Question[];
    provider: 'GROQ';
    generationBatch: AiGenerationBatch;
    syllabus?: { fileName: string; fileType: string; charCount: number };
  }> {
    const res = await fetch(`${API_BASE}/ai/questions/generate`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(payload)
    });
    const data = await handleApiResponse<{
      generated: any[];
      savedQuestions: any[];
      provider: 'GROQ';
      generationBatch: AiGenerationBatch;
    }>(res);
    return {
      generated: (data.generated || []).map(mapBackendQuestionToFrontend),
      savedQuestions: (data.savedQuestions || []).map(mapBackendQuestionToFrontend),
      provider: data.provider,
      generationBatch: data.generationBatch
    };
  },

  // --- EXAM MANAGEMENT ---
  async getExams(): Promise<ScheduledExam[]> {
    const res = await fetch(`${API_BASE}/exams`, {
      method: 'GET',
      headers: getAuthHeaders()
    });
    const data = await handleApiResponse<{ exams: any[] }>(res);
    return (data.exams || []).map(mapBackendExamToFrontend);
  },

  async getExamById(examId: string): Promise<{
    exam: ScheduledExam;
    questions: Question[];
    assignments: any[];
  }> {
    const res = await fetch(`${API_BASE}/exams/${encodeURIComponent(examId)}`, {
      method: 'GET',
      headers: getAuthHeaders()
    });
    const data = await handleApiResponse<{ exam: any }>(res);
    return {
      exam: mapBackendExamToFrontend(data.exam),
      questions: (data.exam.questions || []).map(mapBackendQuestionToFrontend),
      assignments: data.exam.assignments || []
    };
  },

  async createExam(payload: {
    title: string;
    description?: string;
    subject: string;
    course: string;
    department?: string;
    semester?: string;
    durationMinutes: number;
    totalMarks: number;
    passingMarks: number;
    attemptLimit?: number;
    startTime: string;
    endTime: string;
    instructions?: string;
    proctoringEnabled?: boolean;
    questionIds?: string[];
    assignedStudentIds?: string[];
    status?: string;
  }): Promise<ScheduledExam> {
    const res = await fetch(`${API_BASE}/exams`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(payload)
    });
    const data = await handleApiResponse<{ exam: any }>(res);
    return mapBackendExamToFrontend(data.exam);
  },

  async updateExam(examId: string, payload: Record<string, any>): Promise<ScheduledExam> {
    const res = await fetch(`${API_BASE}/exams/${encodeURIComponent(examId)}`, {
      method: 'PATCH',
      headers: getAuthHeaders(),
      body: JSON.stringify(payload)
    });
    const data = await handleApiResponse<{ exam: any }>(res);
    return mapBackendExamToFrontend(data.exam);
  },

  async deleteExam(examId: string): Promise<void> {
    const res = await fetch(`${API_BASE}/exams/${encodeURIComponent(examId)}`, {
      method: 'DELETE',
      headers: getAuthHeaders()
    });
    await handleApiResponse(res);
  },

  async updateExamStatus(
    examId: string,
    status:
      | 'DRAFT'
      | 'SCHEDULED'
      | 'LIVE'
      | 'ENDED'
      | 'PUBLISHED'
      | 'RESULT_PUBLISHED'
      | 'CLOSED'
      | 'ARCHIVED',
    publishResults?: boolean
  ): Promise<ScheduledExam> {
    const res = await fetch(`${API_BASE}/exams/${encodeURIComponent(examId)}/status`, {
      method: 'PATCH',
      headers: getAuthHeaders(),
      body: JSON.stringify({ status, publishResults })
    });
    const data = await handleApiResponse<{ exam: any }>(res);
    return mapBackendExamToFrontend(data.exam);
  },

  async attachExamQuestions(examId: string, questionIds: string[]): Promise<ScheduledExam> {
    const res = await fetch(`${API_BASE}/exams/${encodeURIComponent(examId)}/questions`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ questionIds })
    });
    const data = await handleApiResponse<{ exam: any }>(res);
    return mapBackendExamToFrontend(data.exam);
  },

  async assignExam(
    examId: string,
    payload: { studentIds?: string[]; department?: string; course?: string; semester?: string }
  ): Promise<{ assignedCount: number; totalAssignedStudents: number; studentIds: string[] }> {
    const res = await fetch(`${API_BASE}/exams/${encodeURIComponent(examId)}/assign`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(payload)
    });
    return handleApiResponse(res);
  },

  async publishExam(examId: string): Promise<ScheduledExam> {
    const res = await fetch(`${API_BASE}/exams/${encodeURIComponent(examId)}/publish`, {
      method: 'POST',
      headers: getAuthHeaders()
    });
    const data = await handleApiResponse<{ exam: any }>(res);
    return mapBackendExamToFrontend(data.exam);
  },

  async closeExam(examId: string): Promise<ScheduledExam> {
    const res = await fetch(`${API_BASE}/exams/${encodeURIComponent(examId)}/close`, {
      method: 'POST',
      headers: getAuthHeaders()
    });
    const data = await handleApiResponse<{ exam: any }>(res);
    return mapBackendExamToFrontend(data.exam);
  },

  async getExamAttempts(examId: string): Promise<ExamAttemptRecord[]> {
    const res = await fetch(`${API_BASE}/exams/${encodeURIComponent(examId)}/attempts`, {
      method: 'GET',
      headers: getAuthHeaders()
    });
    const data = await handleApiResponse<{ attempts: ExamAttemptRecord[] }>(res);
    return data.attempts || [];
  },

  async getAttempts(examId?: string): Promise<ExamAttemptRecord[]> {
    const query = examId ? `?examId=${encodeURIComponent(examId)}` : '';
    const res = await fetch(`${API_BASE}/attempts${query}`, {
      method: 'GET',
      headers: getAuthHeaders()
    });
    const data = await handleApiResponse<{ attempts: ExamAttemptRecord[] }>(res);
    return (data.attempts || []).map(mapBackendAttemptToFrontend);
  },

  // --- STUDENT EXAMS & ATTEMPTS ---
  async getStudentExams(): Promise<ScheduledExam[]> {
    const res = await fetch(`${API_BASE}/student/exams`, {
      method: 'GET',
      headers: getAuthHeaders()
    });
    const data = await handleApiResponse<{ exams: any[] }>(res);
    return (data.exams || []).map(mapBackendExamToFrontend);
  },

  async getStudentExamDetails(examId: string): Promise<{
    exam: ScheduledExam;
    questions: Question[];
  }> {
    const res = await fetch(`${API_BASE}/student/exams/${encodeURIComponent(examId)}`, {
      method: 'GET',
      headers: getAuthHeaders()
    });
    const data = await handleApiResponse<{ exam: any }>(res);
    return {
      exam: mapBackendExamToFrontend(data.exam),
      questions: (data.exam.questions || []).map(mapBackendQuestionToFrontend)
    };
  },

  async startExamAttempt(examId: string): Promise<{
    resumed: boolean;
    attempt: ExamAttemptRecord;
    exam: ScheduledExam;
    questions: Question[];
    remainingSeconds: number;
  }> {
    const res = await fetch(`${API_BASE}/attempts/start`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ examId, deviceSessionId: getDeviceSessionId() })
    });
    const data = await handleApiResponse<{
      resumed: boolean;
      attempt: ExamAttemptRecord;
      exam: any;
      questions: any[];
      remainingSeconds: number;
    }>(res);
    if (
      !data?.attempt ||
      !data.exam ||
      !Array.isArray(data.questions) ||
      typeof data.remainingSeconds !== 'number' ||
      !Number.isFinite(data.remainingSeconds) ||
      data.remainingSeconds < 0
    ) {
      throw new Error('The server returned an incomplete exam attempt response.');
    }

    return {
      resumed: data.resumed,
      attempt: mapBackendAttemptToFrontend(data.attempt),
      exam: mapBackendExamToFrontend(data.exam),
      questions: (data.questions || []).map(mapBackendQuestionToFrontend),
      remainingSeconds: data.remainingSeconds
    };
  },

  async getAttemptById(attemptId: string): Promise<{
    attempt: ExamAttemptRecord;
    exam: ScheduledExam | null;
    remainingSeconds: number;
  }> {
    const res = await fetch(`${API_BASE}/attempts/${encodeURIComponent(attemptId)}`, {
      method: 'GET',
      headers: getAuthHeaders()
    });
    const data = await handleApiResponse<{
      attempt?: ExamAttemptRecord;
      exam?: any;
      remainingSeconds: number;
    }>(res);
    if (
      !data?.attempt ||
      typeof data.remainingSeconds !== 'number' ||
      !Number.isFinite(data.remainingSeconds) ||
      data.remainingSeconds < 0
    ) {
      throw new Error('Attempt response is missing a valid server timer.');
    }
    return {
      attempt: mapBackendAttemptToFrontend(data.attempt),
      exam: data.exam ? mapBackendExamToFrontend(data.exam) : null,
      remainingSeconds: data.remainingSeconds
    };
  },

  async saveAttemptAnswers(
    attemptId: string,
    payload: {
      answers: ExamAttemptRecord['answers'];
      currentQuestionIndex?: number;
      warningCount?: number;
      cameraStatus?: ExamAttemptRecord['cameraStatus'];
      faceStatus?: ExamAttemptRecord['faceStatus'];
      fullscreenActive?: boolean;
    }
  ): Promise<ExamAttemptRecord> {
    const res = await fetch(`${API_BASE}/attempts/${encodeURIComponent(attemptId)}/answers`, {
      method: 'PATCH',
      headers: getAuthHeaders(),
      body: JSON.stringify(payload)
    });
    const data = await handleApiResponse<{ attempt: ExamAttemptRecord }>(res);
    return mapBackendAttemptToFrontend(data.attempt);
  },

  async heartbeatAttempt(
    attemptId: string,
    state: {
      cameraStatus?: ExamAttemptRecord['cameraStatus'];
      faceStatus?: ExamAttemptRecord['faceStatus'];
      fullscreenActive?: boolean;
    }
  ): Promise<{ attempt: ExamAttemptRecord; remainingSeconds: number; result?: StudentResult }> {
    const res = await fetch(`${API_BASE}/attempts/${encodeURIComponent(attemptId)}/heartbeat`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(state)
    });
    const data = await handleApiResponse<{ attempt: any; remainingSeconds: number; result?: any }>(res);
    return {
      attempt: mapBackendAttemptToFrontend(data.attempt),
      remainingSeconds: data.remainingSeconds,
      result: data.result ? mapBackendResultToFrontend(data.result) : undefined
    };
  },

  async submitExamAttempt(
    attemptId: string,
    payload: {
      answers?: ExamAttemptRecord['answers'];
      warningCount?: number;
      terminatedByProctor?: boolean;
      terminationReason?: string;
    }
  ): Promise<{
    attempt: ExamAttemptRecord;
    resultStatus: string;
    resultPublished: boolean;
    result: StudentResult | null;
    message: string;
  }> {
    const res = await fetch(`${API_BASE}/attempts/${encodeURIComponent(attemptId)}/submit`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(payload)
    });
    const data = await handleApiResponse<{
      attempt: ExamAttemptRecord;
      resultStatus: string;
      resultPublished: boolean;
      result: any;
      message: string;
    }>(res);
    return {
      attempt: data.attempt,
      resultStatus: data.resultStatus,
      resultPublished: data.resultPublished,
      result: data.result ? mapBackendResultToFrontend(data.result) : null,
      message: data.message
    };
  },

  // --- RESULTS ---
  async getResults(examId?: string): Promise<StudentResult[]> {
    const qs = examId ? `?examId=${encodeURIComponent(examId)}` : '';
    const res = await fetch(`${API_BASE}/results${qs}`, {
      method: 'GET',
      headers: getAuthHeaders()
    });
    const data = await handleApiResponse<{ results: any[] }>(res);
    return (data.results || []).map(mapBackendResultToFrontend);
  },

  async getMyPublishedResults(): Promise<StudentResult[]> {
    const res = await fetch(`${API_BASE}/results/my`, {
      method: 'GET',
      headers: getAuthHeaders()
    });
    const data = await handleApiResponse<{ results: any[] }>(res);
    return (data.results || []).map(mapBackendResultToFrontend);
  },

  async getMyRankings(examId?: string): Promise<{
    examRank: {
      rank: number;
      totalRankedStudents: number;
      percentile: number;
      score: number;
      totalMarks: number;
    } | null;
    overallRank: {
      rank: number;
      totalRankedStudents: number;
      percentile: number;
      averagePercentage: number;
      examsAttempted: number;
      passed: number;
    } | null;
  }> {
    const params = new URLSearchParams();
    if (examId) params.set('examId', examId);
    const qs = params.toString() ? `?${params.toString()}` : '';
    const res = await fetch(`${API_BASE}/results/my-rankings${qs}`, {
      method: 'GET',
      headers: getAuthHeaders()
    });
    const data = await handleApiResponse<{
      rankings: {
        examRank: {
          rank: number;
          totalRankedStudents: number;
          percentile: number;
          score: number;
          totalMarks: number;
        } | null;
        overallRank: {
          rank: number;
          totalRankedStudents: number;
          percentile: number;
          averagePercentage: number;
          examsAttempted: number;
          passed: number;
        } | null;
      };
    }>(res);
    return data.rankings;
  },

  async getResultById(resultId: string): Promise<StudentResult> {
    const res = await fetch(`${API_BASE}/results/${encodeURIComponent(resultId)}`, {
      method: 'GET',
      headers: getAuthHeaders()
    });
    const data = await handleApiResponse<{ result: any }>(res);
    return mapBackendResultToFrontend(data.result);
  },

  async publishSingleResult(
    resultId: string,
    status: 'PUBLISHED' | 'VERIFIED' | 'PENDING' = 'PUBLISHED'
  ): Promise<StudentResult> {
    const res = await fetch(`${API_BASE}/results/${encodeURIComponent(resultId)}/publish`, {
      method: 'PATCH',
      headers: getAuthHeaders(),
      body: JSON.stringify({ status })
    });
    const data = await handleApiResponse<{ result: any }>(res);
    return mapBackendResultToFrontend(data.result);
  },

  async publishExamResults(examId: string): Promise<{ publishedCount: number; examId: string }> {
    const res = await fetch(`${API_BASE}/results/exam/${encodeURIComponent(examId)}/publish`, {
      method: 'POST',
      headers: getAuthHeaders()
    });
    return handleApiResponse(res);
  },

  // --- QUERIES ---
  async createQuery(payload: {
    examId: string;
    attemptId?: string;
    resultId?: string;
    questionId?: string;
    questionText?: string;
    reasonType?: StudentQuery['reasonType'];
    message: string;
  }): Promise<StudentQuery> {
    const res = await fetch(`${API_BASE}/queries`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(payload)
    });
    const data = await handleApiResponse<{ query: any }>(res);
    return mapBackendQueryToFrontend(data.query);
  },

  async getQueries(filters?: { examId?: string; status?: string }): Promise<StudentQuery[]> {
    const params = new URLSearchParams();
    if (filters?.examId) params.set('examId', filters.examId);
    if (filters?.status) params.set('status', filters.status);
    const qs = params.toString() ? `?${params.toString()}` : '';

    const res = await fetch(`${API_BASE}/queries${qs}`, {
      method: 'GET',
      headers: getAuthHeaders()
    });
    const data = await handleApiResponse<{ queries: any[] }>(res);
    return (data.queries || []).map(mapBackendQueryToFrontend);
  },

  async resolveQuery(
    queryId: string,
    payload: {
      resolutionType: NonNullable<StudentQuery['resolutionType']>;
      resolutionNotes: string;
      scoreAdjustment?: number;
      correctedAnswer?: string;
    }
  ): Promise<StudentQuery> {
    const res = await fetch(`${API_BASE}/queries/${encodeURIComponent(queryId)}/resolve`, {
      method: 'PATCH',
      headers: getAuthHeaders(),
      body: JSON.stringify(payload)
    });
    const data = await handleApiResponse<{ query: any }>(res);
    return mapBackendQueryToFrontend(data.query);
  },

  // --- PROCTORING EVENTS ---
  async recordProctoringEvent(payload: {
    examId: string;
    attemptId?: string;
    eventType: ProctoringEventRecord['eventType'];
    severity?: ProctoringEventRecord['severity'];
    details?: string;
    metadata?: Record<string, unknown>;
  }): Promise<ProctoringEventRecord> {
    const res = await fetch(`${API_BASE}/proctoring/events`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(payload)
    });
    const data = await handleApiResponse<{ event: ProctoringEventRecord }>(res);
    return data.event;
  },

  async getProctoringEvents(filters?: {
    examId?: string;
    attemptId?: string;
    studentId?: string;
  }): Promise<ProctoringEventRecord[]> {
    const params = new URLSearchParams();
    if (filters?.examId) params.set('examId', filters.examId);
    if (filters?.attemptId) params.set('attemptId', filters.attemptId);
    if (filters?.studentId) params.set('studentId', filters.studentId);
    const qs = params.toString() ? `?${params.toString()}` : '';

    const res = await fetch(`${API_BASE}/proctoring/events${qs}`, {
      method: 'GET',
      headers: getAuthHeaders()
    });
    const data = await handleApiResponse<{ events: ProctoringEventRecord[] }>(res);
    return data.events || [];
  },

  // --- UNBLOCK REQUESTS ---
  async requestUnblock(attemptId: string, examId: string, reason: string): Promise<any> {
    const res = await fetch(`${API_BASE}/proctoring/unblock-requests`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ attemptId, examId, reason })
    });
    const data = await handleApiResponse<{ request: any }>(res);
    return data.request;
  },

  async getUnblockRequests(filters?: {
    examId?: string;
    studentId?: string;
    status?: string;
  }): Promise<AssistanceRequestRecord[]> {
    const params = new URLSearchParams();
    if (filters?.examId) params.set('examId', filters.examId);
    if (filters?.studentId) params.set('studentId', filters.studentId);
    if (filters?.status) params.set('status', filters.status);
    const qs = params.toString() ? `?${params.toString()}` : '';

    const res = await fetch(`${API_BASE}/proctoring/unblock-requests${qs}`, {
      method: 'GET',
      headers: getAuthHeaders()
    });
    const data = await handleApiResponse<{ requests: any[] }>(res);
    return data.requests || [];
  },

  async reviewUnblockRequest(
    requestId: string,
    status: 'APPROVED' | 'REJECTED',
    remarks?: string
  ): Promise<any> {
    const res = await fetch(`${API_BASE}/proctoring/unblock-requests/${encodeURIComponent(requestId)}`, {
      method: 'PATCH',
      headers: getAuthHeaders(),
      body: JSON.stringify({ status, remarks })
    });
    const data = await handleApiResponse<{ request: any }>(res);
    return data.request;
  },

  // --- COMMUNICATION ---
  async getContacts(): Promise<any[]> {
    const res = await fetch(`${API_BASE}/communication/contacts`, {
      method: 'GET',
      headers: getAuthHeaders()
    });
    const data = await handleApiResponse<{ contacts: any[] }>(res);
    return data.contacts || [];
  },

  async getConversations(type?: 'DIRECT' | 'EXAM_LIVE'): Promise<any[]> {
    const qs = type ? `?type=${encodeURIComponent(type)}` : '';
    const res = await fetch(`${API_BASE}/communication/conversations${qs}`, {
      method: 'GET',
      headers: getAuthHeaders()
    });
    const data = await handleApiResponse<{ conversations: any[] }>(res);
    return data.conversations || [];
  },

  async getMessages(conversationId: string): Promise<any[]> {
    const res = await fetch(
      `${API_BASE}/communication/conversations/${encodeURIComponent(conversationId)}/messages`,
      {
        method: 'GET',
        headers: getAuthHeaders()
      }
    );
    const data = await handleApiResponse<{ messages: any[] }>(res);
    return data.messages || [];
  },

  async sendMessage(payload: {
    recipientId: string;
    content: string;
    examId?: string;
    type?: 'DIRECT' | 'EXAM_LIVE';
  }): Promise<{ message: any; conversation: any }> {
    const res = await fetch(`${API_BASE}/communication/messages`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(payload)
    });
    return handleApiResponse(res);
  },

  // --- AUDIT LOGS (ADMIN ONLY) ---
  async getAuditLogs(filters?: {
    limit?: number;
    actorRole?: string;
    action?: string;
    targetType?: string;
  }): Promise<AuditLog[]> {
    const params = new URLSearchParams();
    if (filters?.limit) params.set('limit', String(filters.limit));
    if (filters?.actorRole) params.set('actorRole', filters.actorRole);
    if (filters?.action) params.set('action', filters.action);
    if (filters?.targetType) params.set('targetType', filters.targetType);
    const qs = params.toString() ? `?${params.toString()}` : '';

    const res = await fetch(`${API_BASE}/audit-logs${qs}`, {
      method: 'GET',
      headers: getAuthHeaders()
    });
    const data = await handleApiResponse<{ logs: AuditLog[] }>(res);
    return data.logs || [];
  },

  // --- REAL-TIME DASHBOARD STATS ---
  async getDashboardStats(): Promise<Record<string, any>> {
    const res = await fetch(`${API_BASE}/dashboard/stats`, {
      method: 'GET',
      headers: getAuthHeaders()
    });
    return handleApiResponse<Record<string, any>>(res);
  }
};
