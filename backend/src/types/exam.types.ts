export type ExamStatus =
  | 'DRAFT'
  | 'SCHEDULED'
  | 'LIVE'
  | 'ENDED'
  | 'PUBLISHED'
  | 'RESULT_PUBLISHED'
  | 'CLOSED'
  | 'ARCHIVED';

export type QuestionDifficulty = 'EASY' | 'MEDIUM' | 'HARD';

export type QuestionSource = 'MANUAL' | 'AI_GENERATED';

export type QuestionStatus = 'DRAFT' | 'ACTIVE' | 'INACTIVE' | 'ARCHIVED';
export type AiReviewStatus = 'PENDING_TEACHER_REVIEW' | 'APPROVED' | 'DISCARDED';

export type AssignmentStatus = 'ASSIGNED' | 'IN_PROGRESS' | 'SUBMITTED' | 'GRADED' | 'EXPIRED';

export interface QuestionOption {
  id: string;
  text: string;
}

export interface IQuestionInput {
  questionText: string;
  subject: string;
  topic?: string;
  course?: string;
  semester?: string;
  questionType?: 'MCQ';
  difficulty?: QuestionDifficulty;
  options: QuestionOption[];
  correctAnswer?: string;
  correctOption?: string;
  marks?: number;
  negativeMarks?: number;
  explanation?: string;
  source?: QuestionSource;
  status?: QuestionStatus;
  reviewStatus?: AiReviewStatus;
  syllabusId?: string;
  syllabusUnit?: string;
  syllabusTopic?: string;
  sourceReference?: string;
  generationId?: string;
  aiProvider?: 'GROQ';
  aiModel?: string;
  approvedBy?: string;
  approvedAt?: Date;
}

export interface IExamInput {
  title: string;
  description?: string;
  subject: string;
  course?: string;
  department?: string;
  academicYear?: string;
  semester?: string;
  scheduledDate?: string;
  durationMinutes: number;
  questionCount?: number;
  totalMarks?: number;
  passingMarks?: number;
  attemptLimit?: number;
  strictMode?: boolean;
  instructions?: string;
  status?: ExamStatus;
  questions?: string[];
  questionIds?: string[];
  assignedStudents?: string[];
  assignedStudentIds?: string[];
  startAt?: string | Date;
  endAt?: string | Date;
  startDateTime?: string | Date;
  endDateTime?: string | Date;
  startTime?: string | Date;
  endTime?: string | Date;
}

export interface SafeStudentExamDto {
  id: string;
  examId: string;
  title: string;
  description: string;
  subject: string;
  course?: string;
  department?: string;
  semester?: string;
  durationMinutes: number;
  totalMarks: number;
  passingMarks: number;
  attemptLimit: number;
  strictMode: boolean;
  instructions: string;
  status: ExamStatus;
  questionCount: number;
  startAt?: Date;
  endAt?: Date;
  startDateTime?: Date;
  endDateTime?: Date;
  publishedAt?: Date;
  assignedAt?: Date;
  attemptsUsed?: number;
  canAttempt?: boolean;
}
