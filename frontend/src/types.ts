export enum UserRole {
  STUDENT = 'STUDENT',
  TEACHER = 'TEACHER',
  ADMIN = 'ADMIN'
}

export enum Difficulty {
  EASY = 'EASY',
  MEDIUM = 'MEDIUM',
  HARD = 'HARD'
}

export interface User {
  id: string;
  userId?: string;
  name: string;
  email: string;
  role: UserRole;
  avatar: string;
  status?: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED' | 'BLOCKED';
  department?: string;
  course?: string;
  semester?: string;
  academicYear?: string;
  section?: string;
  enrollmentNo?: string;
  phone?: string;
  designation?: string;
  qualification?: string;
  specialization?: string;
  experience?: number;
  joinDate?: string;
  bio?: string;
}

export interface AssignedTeacherSummary {
  userId: string;
  name: string;
  department?: string;
}

export interface SystemUser {
  id: string;
  userId: string;
  name: string;
  email: string;
  role: UserRole;
  status: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED' | 'BLOCKED';
  lastLogin: string;
  dob?: string;
  dobYear?: number;
  department?: string;
  phone?: string;
  designation?: string;
  qualification?: string;
  specialization?: string;
  experience?: number;
  experienceYears?: number;
  enrollmentNo?: string;
  course?: string;
  semester?: string;
  academicYear?: string;
  section?: string;
  managedBy?: string[];
  teacherIds?: string[];
  assignedTeachers?: AssignedTeacherSummary[];
  assignedTeacherNames?: string[];
  studentsCount?: number;
  examsCount?: number;
  createdBy?: string;
  createdAt?: string;
}

export interface TeacherDetailsData {
  teacher: SystemUser;
  kpis: {
    students?: number;
    exams?: number;
    questions?: number;
    queries?: number;
    assignedStudentsCount?: number;
    createdExamsCount?: number;
    evaluatedResultsCount?: number;
    pendingQueriesCount?: number;
  };
  assignedStudents?: SystemUser[];
  recentStudents: SystemUser[];
  createdExams?: ScheduledExam[];
  recentExams: ScheduledExam[];
  recentActivity: AuditLog[];
}

export interface StudentDetailsData {
  student: SystemUser;
  assignedTeacher?: SystemUser | null;
  kpis: {
    assignedExams?: number;
    completedExams?: number;
    pendingExams?: number;
    publishedResults?: number;
    examsTakenCount?: number;
    averagePercentage?: number;
    publishedResultsCount?: number;
    queriesCount?: number;
  };
  recentExams: ScheduledExam[];
  results: StudentResult[];
  queries: StudentQuery[];
  proctoringEvents?: ProctoringEventRecord[];
}

export interface ChatMessage {
  id?: string;
  messageId: string;
  conversationId: string;
  senderId: string;
  senderRole: 'ADMIN' | 'TEACHER' | 'STUDENT';
  senderName: string;
  content: string;
  examId?: string;
  readBy?: string[];
  createdAt: string;
}

export interface Conversation {
  id?: string;
  conversationId: string;
  type: 'DIRECT' | 'EXAM_LIVE';
  examId?: string;
  examTitle?: string;
  participants: string[];
  participantRoles: Record<string, string>;
  participantNames: Record<string, string>;
  lastMessage?: {
    content: string;
    senderId: string;
    senderRole: string;
    senderName: string;
    createdAt: string;
  };
  unreadCount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface CommunicationTarget {
  userId: string;
  name: string;
  role: 'ADMIN' | 'TEACHER' | 'STUDENT';
  department?: string;
  course?: string;
  email?: string;
  isAssigned?: boolean;
}

export interface UnblockRequest {
  id?: string;
  requestId: string;
  attemptId: string;
  examId: string;
  examTitle: string;
  studentId: string;
  studentName: string;
  reason: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  warningCount: number;
  createdAt: string;
  reviewedBy?: string;
  reviewedAt?: string;
  remarks?: string;
}

export interface SyllabusExtractData {
  syllabusId?: string;
  fileName: string;
  fileType: 'PDF' | 'DOCX' | 'TXT';
  charCount: number;
  wordCount?: number;
  text?: string;
  extractedText?: string;
  course?: string;
  semester?: string;
  subject?: string;
  uploadedAt?: string;
  subjectCompatibility?: {
    compatible: boolean;
    selectedSubject: string;
    detectedTopic?: string;
  };
}

export interface AuditLog {
  id?: string;
  auditId: string;
  action: string;
  actorId: string;
  actorName: string;
  actorRole: 'ADMIN' | 'TEACHER' | 'STUDENT' | 'SYSTEM';
  targetType: string;
  targetId: string;
  timestamp: string;
  details: string;
}

export interface QuestionOption {
  key: 'A' | 'B' | 'C' | 'D';
  text: string;
}

export interface Question {
  id: string;
  questionId?: string;
  text: string;
  questionText?: string;
  options: string[];
  rawOptions?: QuestionOption[];
  correctAnswer?: number;
  correctOption?: 'A' | 'B' | 'C' | 'D';
  difficulty: Difficulty;
  topic: string;
  subject?: string;
  course?: string;
  semester?: string;
  questionType?: 'MCQ';
  explanation?: string;
  marks?: number;
  negativeMarks?: number;
  status?: 'DRAFT' | 'ACTIVE' | 'INACTIVE' | 'ARCHIVED';
  source?: 'MANUAL' | 'AI_GENERATED';
  syllabusSource?: string;
  reviewStatus?: 'PENDING_TEACHER_REVIEW' | 'APPROVED' | 'DISCARDED';
  syllabusId?: string;
  syllabusUnit?: string;
  syllabusTopic?: string;
  sourceReference?: string;
  generationId?: string;
  aiProvider?: 'GEMINI' | 'GROQ';
  aiModel?: string;
  createdBy?: string;
  createdByName?: string;
  createdAt?: string;
}

export interface AiGenerationBatch {
  generationId: string;
  generatedBy: string;
  generatedByName: string;
  subject: string;
  course: string;
  semester: string;
  topic: string;
  difficulty: Difficulty | 'MIXED';
  marksPerQuestion: number;
  requestedCount: number;
  generatedCount: number;
  syllabusId: string;
  sourceFileName: string;
  provider: 'GEMINI' | 'GROQ';
  aiModel: string;
  generatedAt: string;
  pendingCount: number;
  approvedCount: number;
  discardedCount: number;
  reviewStatus: 'PENDING_REVIEW' | 'PARTIALLY_REVIEWED' | 'APPROVED' | 'DISCARDED';
  questionIds?: string[];
  legacy?: boolean;
}

export interface ExamAnswerRecord {
  questionId: string;
  selectedOption: 'A' | 'B' | 'C' | 'D' | null;
  markedForReview?: boolean;
  answeredAt?: string;
}

export interface ExamAttemptRecord {
  attemptId: string;
  examId: string;
  examTitle: string;
  subject: string;
  studentId: string;
  studentName: string;
  attemptNumber: number;
  startedAt: string;
  expiresAt: string;
  submittedAt?: string | null;
  status: 'IN_PROGRESS' | 'SUBMITTED' | 'EXPIRED' | 'EVALUATED' | 'TERMINATED';
  answers: ExamAnswerRecord[];
  currentQuestionIndex: number;
  score: number;
  totalMarks: number;
  percentage: number;
  correctCount: number;
  wrongCount: number;
  unansweredCount: number;
  warningCount: number;
  proctoringStatus: 'CLEAN' | 'WARNED' | 'FLAGGED' | 'TERMINATED';
  terminationReason?: string;
  remainingSeconds?: number;
}

export interface ResultAnswerBreakdown {
  questionId: string;
  questionText: string;
  options: QuestionOption[];
  selectedOption: 'A' | 'B' | 'C' | 'D' | null;
  correctOption: 'A' | 'B' | 'C' | 'D';
  isCorrect: boolean;
  marksAwarded: number;
  maxMarks: number;
  negativeMarks: number;
  topic: string;
  difficulty: string;
  explanation: string;
}

export interface StudentResult {
  id: string;
  resultId: string;
  attemptId: string;
  studentId: string;
  studentName: string;
  studentEmail?: string;
  examId: string;
  examTitle: string;
  subject?: string;
  topic?: string;
  score: number;
  totalMarks?: number;
  percentage?: number;
  correctCount?: number;
  wrongCount?: number;
  unansweredCount?: number;
  totalQuestions: number;
  accuracy: number;
  integrityScore?: number;
  isPublished?: boolean;
  passed?: boolean;
  timeTaken: string;
  date: string;
  status: 'PENDING' | 'VERIFIED' | 'PUBLISHED' | 'QUERIED' | 'REVISED' | 'TERMINATED';
  publishedBy?: string;
  publishedAt?: string | null;
  violations: number;
  proctoringStatus?: 'CLEAN' | 'WARNED' | 'FLAGGED' | 'TERMINATED';
  terminationReason?: string;
  subjectTitle?: string;
  grade?: string;
  evaluatedAt?: string;
  answerBreakdown?: ResultAnswerBreakdown[];
}

export interface StudentQuery {
  id: string;
  queryId: string;
  studentId: string;
  studentName: string;
  examId: string;
  examTitle: string;
  subject: string;
  topic?: string;
  attemptId?: string;
  resultId?: string;
  questionId?: string;
  questionText?: string;
  question?: string;
  currentMarks?: number;
  maxMarks?: number;
  reasonType: 'AMBIGUOUS_QUESTION' | 'INCORRECT_KEY' | 'EVALUATION_ERROR' | 'TECHNICAL_GLITCH' | 'OTHER';
  message?: string;
  description: string;
  status: 'PENDING' | 'UNDER_REVIEW' | 'APPROVED' | 'REJECTED' | 'RESOLVED' | 'OPEN';
  response?: string;
  reply?: string;
  facultyComment?: string;
  scoreAdjustment?: number;
  resolvedBy?: string;
  resolvedByName?: string;
  resolvedAt?: string | null;
  createdAt: string;
  timestamp?: string;
}

export interface ProctoringEventRecord {
  eventId: string;
  attemptId: string;
  examId: string;
  examTitle: string;
  studentId: string;
  studentName: string;
  eventType:
    | 'TAB_SWITCH'
    | 'FULLSCREEN_EXIT'
    | 'NO_FACE'
    | 'MULTIPLE_FACES'
    | 'CAMERA_OFF'
    | 'CAMERA_BLOCKED'
    | 'LOOKING_AWAY'
    | 'COPY_PASTE_ATTEMPT'
    | 'WINDOW_BLUR'
    | 'OTHER';
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  details: string;
  message?: string;
  warningCountAfter: number;
  timestamp: string;
}

export interface ScheduledExam {
  id: string;
  examId: string;
  title: string;
  description?: string;
  subject: string;
  course: string;
  department?: string;
  semester: string;
  scheduledDate: string;
  startTime: string;
  endTime: string;
  startAt?: string;
  endAt?: string;
  durationMinutes: number;
  totalMarks: number;
  passingMarks: number;
  attemptLimit?: number;
  instructions: string;
  questionIds?: string[];
  questionCount?: number;
  assignedStudentIds?: string[];
  proctoringConfig: {
    enableWebcam: boolean;
    FullScreenEnforcement: boolean;
    tabSwitchLimit: number;
    aiSuspicionThreshold: number;
  };
  status:
    | 'DRAFT'
    | 'SCHEDULED'
    | 'LIVE'
    | 'ENDED'
    | 'PUBLISHED'
    | 'RESULT_PUBLISHED'
    | 'CLOSED'
    | 'ARCHIVED'
    | 'COMPLETED';
  createdBy: string;
  createdByName?: string;
  assignedStudentsCount?: number;
  attemptStatus?: string;
  studentAttemptStatus?: string;
  resultPublished?: boolean;
  attemptCount?: number;
  activeAttemptId?: string | null;
  publishedResult?: {
    resultId: string;
    score: number;
    totalMarks: number;
    percentage: number;
    status: string;
    publishedAt?: string | null;
  } | null;
}

export interface ProctorLog {
  id: string;
  timestamp: string;
  type: 'WARNING' | 'CRITICAL' | 'INFO';
  message: string;
  snapshot?: string;
}
