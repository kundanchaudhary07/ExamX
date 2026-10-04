import React, { useState, useEffect, useCallback } from 'react';
import {
  User,
  SystemUser,
  TeacherDetailsData,
  StudentDetailsData,
  AuditLog,
  UserRole,
  ScheduledExam,
  StudentResult,
  StudentQuery,
  Question,
  AiGenerationBatch,
  ProctoringEventRecord,
  ExamAttemptRecord
} from '../../types';
import { TeacherExamScheduler } from './TeacherExamScheduler';
import {
  DEPARTMENTS,
  DESIGNATIONS,
  COURSES,
  ACADEMIC_YEARS,
  SEMESTERS,
  SECTIONS
} from '../../constants';
import { dbService } from '../../services/dbService';
import { realtimeService } from '../../services/realtimeService';
import { AiGenerationBatchCards } from './AiGenerationBatchCards';
import {
  Modal,
  FormSection,
  Select,
  SearchableSelect,
  QuestionDetailModal,
  ResultDetailModal,
  QueryDetailModal,
  ProctoringDetailModal,
  AuditDetailModal,
  StatusBadge,
  KpiCard,
  getKpiPrimaryValueClass,
  useConfirmAction
} from '../common/SharedUI';
import {
  Users,
  Activity,
  FileText,
  Search,
  RefreshCw,
  Plus,
  X,
  Copy,
  AlertCircle,
  MessageSquare,
  Settings as SettingsIcon,
  Eye,
  KeyRound,
  ShieldAlert,
  BookOpen,
  CheckCircle
} from 'lucide-react';

function getStatusBadgeStyle(status?: string): string {
  switch ((status || 'ACTIVE').toUpperCase()) {
    case 'ACTIVE':
    case 'LIVE':
    case 'PUBLISHED':
    case 'APPROVED':
    case 'CLEAN':
      return 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800';
    case 'SCHEDULED':
    case 'VERIFIED':
    case 'IN_PROGRESS':
      return 'bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300 border-blue-200 dark:border-blue-800';
    case 'PENDING':
    case 'UNDER_REVIEW':
    case 'DRAFT':
    case 'WARNED':
      return 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300 border-amber-200 dark:border-amber-800';
    case 'BLOCKED':
    case 'SUSPENDED':
    case 'REJECTED':
    case 'TERMINATED':
    case 'CRITICAL':
    case 'HIGH':
      return 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300 border-red-200 dark:border-red-800';
    default:
      return 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border-slate-200 dark:border-slate-700';
  }
}

interface AdminDashboardProps {
  user: User;
  activeTab: string;
  onNavigateTab: (tab: string) => void;
  exams: ScheduledExam[];
  results: StudentResult[];
  queries: StudentQuery[];
  onSaveExam: (exam: ScheduledExam) => Promise<void> | void;
  onDeleteExam?: (examId: string) => Promise<void> | void;
  onPublishResult: (resultId: string) => Promise<void> | void;
  onPublishAllForExam?: (examId: string) => Promise<void> | void;
  onResolveQuery: (queryId: string, response: string, status?: 'RESOLVED' | 'REJECTED') => Promise<void> | void;
  onRefreshGlobalData?: () => Promise<void> | void;
}

export const AdminDashboard: React.FC<AdminDashboardProps> = ({
  user,
  activeTab,
  onNavigateTab,
  exams,
  results,
  queries,
  onSaveExam,
  onDeleteExam,
  onPublishResult,
  onPublishAllForExam,
  onResolveQuery,
  onRefreshGlobalData
}) => {
  const [teachers, setTeachers] = useState<SystemUser[]>([]);
  const [students, setStudents] = useState<SystemUser[]>([]);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [aiGenerationBatches, setAiGenerationBatches] = useState<AiGenerationBatch[]>([]);
  const [proctoringEvents, setProctoringEvents] = useState<ProctoringEventRecord[]>([]);
  const [attempts, setAttempts] = useState<ExamAttemptRecord[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [healthStatus, setHealthStatus] = useState<{ status: string; database: string } | null>(null);
  const { confirmAction, ConfirmModal } = useConfirmAction();

  const [isLoadingData, setIsLoadingData] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');

  // Teacher Creation State
  const [showCreateTeacherModal, setShowCreateTeacherModal] = useState(false);
  const [teacherForm, setTeacherForm] = useState({
    name: '',
    dob: '',
    email: '',
    phone: '',
    department: '',
    qualification: '',
    specialization: '',
    designation: '',
    experienceYears: 0
  });
  const [isSubmittingTeacher, setIsSubmittingTeacher] = useState(false);
  const [teacherFormError, setTeacherFormError] = useState<string | null>(null);
  const [createdCredentials, setCreatedCredentials] = useState<{
    roleLabel: string;
    name: string;
    userId: string;
    temporaryPassword: string;
  } | null>(null);
  const [copiedCredentialKey, setCopiedCredentialKey] = useState<'userId' | 'password' | 'all' | null>(null);

  const handleCopyCredential = async (text: string, key: 'userId' | 'password' | 'all') => {
    if (!navigator.clipboard || !navigator.clipboard.writeText) {
      setFeedbackBanner({
        type: 'error',
        message: 'Clipboard API is unavailable in this environment. Please copy manually.'
      });
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      setCopiedCredentialKey(key);
      setTimeout(() => {
        setCopiedCredentialKey(prev => (prev === key ? null : prev));
      }, 1500);
    } catch (err: any) {
      setFeedbackBanner({
        type: 'error',
        message: 'Failed to copy to clipboard. Clipboard permission denied.'
      });
    }
  };

  // Student Creation State
  const [showCreateStudentModal, setShowCreateStudentModal] = useState(false);
  const [studentForm, setStudentForm] = useState({
    name: '',
    dob: '',
    email: '',
    phone: '',
    department: '',
    course: '',
    academicYear: '',
    semester: '',
    section: '',
    assignedTeacherId: ''
  });
  const [isSubmittingStudent, setIsSubmittingStudent] = useState(false);
  const [studentFormError, setStudentFormError] = useState<string | null>(null);

  // Teacher & Student Detail Modal State
  const [selectedTeacherDetails, setSelectedTeacherDetails] = useState<TeacherDetailsData | null>(null);
  const [isLoadingTeacherDetails, setIsLoadingTeacherDetails] = useState(false);
  const [selectedStudentDetails, setSelectedStudentDetails] = useState<StudentDetailsData | null>(null);
  const [isLoadingStudentDetails, setIsLoadingStudentDetails] = useState(false);
  const [selectedQuestionDetail, setSelectedQuestionDetail] = useState<Question | null>(null);
  const [selectedResultDetail, setSelectedResultDetail] = useState<StudentResult | null>(null);
  const [selectedQueryDetail, setSelectedQueryDetail] = useState<StudentQuery | null>(null);
  const [selectedProctoringDetail, setSelectedProctoringDetail] = useState<ProctoringEventRecord | null>(null);
  const [selectedAuditDetail, setSelectedAuditDetail] = useState<AuditLog | null>(null);
  const [assigningTeacherId, setAssigningTeacherId] = useState<string>('');

  // Password Reset Modal
  const [resetTarget, setResetTarget] = useState<{ user: SystemUser; newPassword: string } | null>(null);
  const [resetMessage, setResetMessage] = useState<string | null>(null);

  // Query Adjudication State
  const [replyText, setReplyText] = useState<Record<string, string>>({});
  const [submittingQueryId, setSubmittingQueryId] = useState<string | null>(null);

  // Feedback banner
  const [feedbackBanner, setFeedbackBanner] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const loadDirectoryAndLogs = useCallback(async () => {
    setIsLoadingData(true);
    setLoadError(null);
    try {
      const [teacherList, studentList, questionList, proctorList, logs, health, attemptList, generationBatches] = await Promise.all([
        dbService.getTeachers(),
        dbService.getStudents(),
        dbService.getQuestions().catch(() => []),
        dbService.getProctoringEvents().catch(() => []),
        dbService.getAuditLogs({ limit: 100 }).catch(() => []),
        fetch('/api/health')
          .then(r => r.json())
          .catch(() => ({ status: 'healthy', database: 'connected' })),
        dbService.getAttempts().catch(() => []),
        dbService.getAiGenerationBatches()
      ]);
      setTeachers(teacherList);
      setStudents(studentList);
      setQuestions(questionList);
      setAiGenerationBatches(generationBatches);
      setProctoringEvents(proctorList);
      setAttempts(attemptList);
      setAuditLogs(logs);
      setHealthStatus({
        status: health?.status || 'healthy',
        database: health?.database || 'connected'
      });
    } catch (err: any) {
      setLoadError(err.message || 'Unable to load dashboard data.');
    } finally {
      setIsLoadingData(false);
    }
  }, []);

  useEffect(() => {
    loadDirectoryAndLogs();
  }, [loadDirectoryAndLogs]);

  useEffect(() => {
    const unsub = realtimeService.subscribe(payload => {
      if (
        payload.event.startsWith('teacher.') ||
        payload.event.startsWith('student.') ||
        payload.event.startsWith('question.') ||
        payload.event.startsWith('proctoring.') ||
        payload.event === 'audit.created' ||
        payload.event.startsWith('exam.') ||
        payload.event.startsWith('result.') ||
        payload.event.startsWith('query.')
      ) {
        loadDirectoryAndLogs();
      }
    });
    return () => unsub();
  }, [loadDirectoryAndLogs]);

  const openCreateTeacherDialog = () => {
    setTeacherFormError(null);
    setShowCreateTeacherModal(true);
  };

  const openCreateStudentDialog = () => {
    setStudentFormError(null);
    setShowCreateStudentModal(true);
  };

  const handleOpenTeacherDetails = async (teacherId: string) => {
    setIsLoadingTeacherDetails(true);
    try {
      const details = await dbService.getTeacherDetails(teacherId);
      setSelectedTeacherDetails(details);
    } catch (err: any) {
      setFeedbackBanner({
        type: 'error',
        message: err.message || 'Unable to load teacher details.'
      });
      setSelectedTeacherDetails(null);
    } finally {
      setIsLoadingTeacherDetails(false);
    }
  };

  const handleOpenStudentDetails = async (studentId: string) => {
    setIsLoadingStudentDetails(true);
    try {
      const details = await dbService.getStudentDetails(studentId);
      setSelectedStudentDetails(details);
      setAssigningTeacherId(details.student.managedBy?.[0] || '');
    } catch (err: any) {
      setFeedbackBanner({
        type: 'error',
        message: err.message || 'Unable to load student details.'
      });
      setSelectedStudentDetails(null);
    } finally {
      setIsLoadingStudentDetails(false);
    }
  };

  const handleAssignStudentTeacher = async () => {
    if (!selectedStudentDetails) return;
    const studentId = selectedStudentDetails.student.userId || selectedStudentDetails.student.id;
    try {
      const nextManagedBy = assigningTeacherId ? [assigningTeacherId] : [];
      await dbService.updateStudent(studentId, { managedBy: nextManagedBy });
      const refreshed = await dbService.getStudentDetails(studentId);
      setSelectedStudentDetails(refreshed);
      await loadDirectoryAndLogs();
      setFeedbackBanner({
        type: 'success',
        message: `Updated teacher assignment for ${refreshed.student.name}.`
      });
    } catch (err: any) {
      setFeedbackBanner({
        type: 'error',
        message: err.message || 'Failed to update teacher assignment.'
      });
    }
  };

  const handleToggleUserStatus = (target: SystemUser) => {
    const isBlocking = target.status === 'ACTIVE';
    const isUnblocking = target.status === 'BLOCKED';
    const roleLabel = target.role === 'TEACHER' ? 'Teacher' : 'Student';
    const actionLabel = isBlocking ? 'Block' : isUnblocking ? 'Unblock' : 'Activate';

    confirmAction({
      title: `${actionLabel} ${roleLabel}`,
      message: `Are you sure you want to ${actionLabel.toLowerCase()} ${target.name}?`,
      confirmLabel: `Yes, ${actionLabel}`,
      cancelLabel: 'No',
      variant: isBlocking ? 'danger' : 'primary',
      details: [
        { label: `${roleLabel} Name`, value: target.name },
        { label: 'User ID', value: target.userId || target.id },
        { label: 'Current Status', value: target.status },
        { label: 'Department', value: target.department || '—' }
      ],
      consequence: isBlocking
        ? `Blocking this ${roleLabel.toLowerCase()} will immediately revoke their access to the EXAMX portal.`
        : `This will restore full portal and examination access for this ${roleLabel.toLowerCase()}.`,
      action: async () => {
        const nextStatus = isBlocking ? 'BLOCKED' : 'ACTIVE';
        try {
          await dbService.updateUserStatus(target.userId || target.id, nextStatus);
          await loadDirectoryAndLogs();
          if (selectedTeacherDetails?.teacher.userId === target.userId) {
            handleOpenTeacherDetails(target.userId);
          }
          if (selectedStudentDetails?.student.userId === target.userId) {
            handleOpenStudentDetails(target.userId);
          }
          setFeedbackBanner({
            type: 'success',
            message: `Updated ${target.name} (${target.userId || target.id}) status to ${nextStatus}.`
          });
        } catch (err: any) {
          setFeedbackBanner({
            type: 'error',
            message: err.message || 'Failed to update account status.'
          });
        }
      }
    });
  };

  const handleTerminateAttempt = (attemptId: string, studentName?: string) => {
    confirmAction({
      title: 'Terminate Attempt',
      message: studentName
        ? `Are you sure you want to terminate ${studentName}'s examination attempt?`
        : `Are you sure you want to terminate this student's examination attempt?`,
      confirmLabel: 'Yes, Terminate',
      cancelLabel: 'No',
      variant: 'danger',
      consequence: "The student's active examination attempt will be terminated immediately due to proctoring policy violation. Recorded responses will be finalized.",
      action: async () => {
        try {
          await dbService.submitExamAttempt(attemptId, {
            terminatedByProctor: true,
            terminationReason: 'Administrative / Proctoring violation'
          });
          setSelectedProctoringDetail(null);
          await loadDirectoryAndLogs();
          setFeedbackBanner({
            type: 'success',
            message: `Attempt ${attemptId} has been terminated.`
          });
        } catch (err: any) {
          setFeedbackBanner({
            type: 'error',
            message: err.message || 'Failed to terminate attempt.'
          });
        }
      }
    });
  };

  const handleCreateTeacher = async (e: React.FormEvent) => {
    e.preventDefault();
    setTeacherFormError(null);
    if (!teacherForm.department.trim()) {
      setTeacherFormError('Please select a department.');
      return;
    }
    setIsSubmittingTeacher(true);
    try {
      const dobYear = teacherForm.dob ? Number(teacherForm.dob.split('-')[0]) : undefined;
      const res = await dbService.createTeacher({
        ...teacherForm,
        dobYear
      });
      setShowCreateTeacherModal(false);
      setTeacherForm({
        name: '',
        dob: '',
        email: '',
        phone: '',
        department: '',
        qualification: '',
        specialization: '',
        designation: '',
        experienceYears: 0
      });
      setCreatedCredentials({
        roleLabel: 'Teacher',
        name: res.teacher?.name || teacherForm.name,
        userId: res.credentials.userId,
        temporaryPassword: res.credentials.password
      });
      await loadDirectoryAndLogs();
    } catch (err: any) {
      setTeacherFormError(err.message || 'Failed to create teacher account');
    } finally {
      setIsSubmittingTeacher(false);
    }
  };

  const handleCreateStudent = async (e: React.FormEvent) => {
    e.preventDefault();
    setStudentFormError(null);
    if (!studentForm.course.trim()) {
      setStudentFormError('Please select a course / program.');
      return;
    }
    if (!studentForm.department.trim()) {
      setStudentFormError('Please select a department.');
      return;
    }
    setIsSubmittingStudent(true);
    try {
      const dobYear = studentForm.dob ? Number(studentForm.dob.split('-')[0]) : undefined;
      const res = await dbService.createStudent({
        ...studentForm,
        dobYear,
        managedBy: studentForm.assignedTeacherId ? [studentForm.assignedTeacherId] : undefined
      });
      setShowCreateStudentModal(false);
      setStudentForm({
        name: '',
        dob: '',
        email: '',
        phone: '',
        department: '',
        course: '',
        academicYear: '',
        semester: '',
        section: '',
        assignedTeacherId: ''
      });
      setCreatedCredentials({
        roleLabel: 'Student',
        name: res.student?.name || studentForm.name,
        userId: res.credentials.userId,
        temporaryPassword: res.credentials.password
      });
      await loadDirectoryAndLogs();
    } catch (err: any) {
      setStudentFormError(err.message || 'Failed to create student account');
    } finally {
      setIsSubmittingStudent(false);
    }
  };

  const departmentOptions = Array.from(
    new Set([
      ...DEPARTMENTS,
      ...teachers.map(t => t.department?.trim()).filter((d): d is string => Boolean(d)),
      ...students.map(s => s.department?.trim()).filter((d): d is string => Boolean(d))
    ])
  ).map(d => ({ value: d, label: d }));

  const designationOptions = Array.from(
    new Set([
      ...DESIGNATIONS,
      ...teachers.map(t => t.designation?.trim()).filter((d): d is string => Boolean(d))
    ])
  ).map(d => ({ value: d, label: d }));

  const courseOptions = Array.from(
    new Set([
      ...COURSES,
      ...students.map(s => s.course?.trim()).filter((c): c is string => Boolean(c)),
      ...exams.map(e => e.course?.trim()).filter((c): c is string => Boolean(c))
    ])
  ).map(c => ({ value: c, label: c }));

  const academicYearOptions = Array.from(
    new Set([
      ...ACADEMIC_YEARS,
      ...students.map(s => s.academicYear?.trim()).filter((y): y is string => Boolean(y))
    ])
  ).map(y => ({ value: y, label: y }));

  const semesterOptions = Array.from(
    new Set([
      ...SEMESTERS,
      ...students.map(s => s.semester?.trim()).filter((s): s is string => Boolean(s)),
      ...exams.map(e => e.semester?.trim()).filter((s): s is string => Boolean(s))
    ])
  ).map(s => ({ value: s, label: s }));

  const sectionOptions = Array.from(
    new Set([
      ...SECTIONS,
      ...students.map(s => s.section?.trim()).filter((sec): sec is string => Boolean(sec))
    ])
  ).map(sec => ({ value: sec, label: sec }));

  const teacherOptions = teachers.map(t => ({
    value: t.userId || t.id,
    label: `${t.name} (${t.userId || t.id})`,
    subtitle: t.department || undefined
  }));

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetTarget) return;

    confirmAction({
      title: 'Reset Password',
      message: `Are you sure you want to reset password for ${resetTarget.user.name}?`,
      confirmLabel: 'Yes, Reset Password',
      cancelLabel: 'No',
      variant: 'primary',
      action: async () => {
        try {
          const targetId = resetTarget.user.userId || resetTarget.user.id;
          const trimmedPass = resetTarget.newPassword.trim() || undefined;
          let creds: { userId: string; temporaryPassword: string };
          if (resetTarget.user.role === UserRole.TEACHER) {
            creds = await dbService.resetTeacherPassword(targetId, trimmedPass);
          } else {
            creds = await dbService.resetStudentPassword(targetId, trimmedPass);
          }
          setResetMessage(`Password updated for ${resetTarget.user.name} (${targetId}): ${creds.temporaryPassword}`);
          await loadDirectoryAndLogs();
        } catch (err: any) {
          setResetMessage(err.message || 'Password reset failed');
        }
      }
    });
  };

  const handleDeleteQuestion = (questionId: string) => {
    confirmAction({
      title: 'Delete Question',
      message: 'Are you sure you want to delete this question?',
      confirmLabel: 'Yes, Delete',
      cancelLabel: 'No',
      variant: 'danger',
      action: async () => {
        try {
          await dbService.deleteQuestion(questionId);
          await loadDirectoryAndLogs();
          setFeedbackBanner({ type: 'success', message: `Question ${questionId} removed.` });
        } catch (err: any) {
          setFeedbackBanner({ type: 'error', message: err.message || 'Unable to delete question.' });
        }
      }
    });
  };

  const filteredTeachers = teachers.filter(
    t =>
      t.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (t.userId || t.id).toLowerCase().includes(searchTerm.toLowerCase()) ||
      (t.department || '').toLowerCase().includes(searchTerm.toLowerCase())
  );

  const filteredStudents = students.filter(
    s =>
      s.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (s.userId || s.id).toLowerCase().includes(searchTerm.toLowerCase()) ||
      (s.department || '').toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Authoritative Real Metrics Derived Directly from Database State
  const activeTeachersCount = teachers.filter(t => t.status === 'ACTIVE').length;
  const inactiveTeachersCount = teachers.filter(t => t.status !== 'ACTIVE').length;
  const totalSupervisedCount = teachers.reduce((sum, t) => sum + (t.studentsCount ?? 0), 0);
  const teacherDeptsCount = Array.from(
    new Set(teachers.map(t => t.department?.trim()).filter(Boolean))
  ).length;
  const supervisorsCount = teachers.filter(t => (t.studentsCount ?? 0) > 0).length;

  const activeStudentsCount = students.filter(s => s.status === 'ACTIVE').length;
  const inactiveStudentsCount = students.filter(s => s.status !== 'ACTIVE').length;
  const assignedStudentsCount = students.filter(
    s =>
      (s.assignedTeacherNames && s.assignedTeacherNames.length > 0) ||
      (s.managedBy && s.managedBy.length > 0)
  ).length;
  const unassignedStudentsCount = Math.max(0, students.length - assignedStudentsCount);
  const studentCoursesCount = Array.from(
    new Set(students.map(s => s.course?.trim()).filter(Boolean))
  ).length;
  const studentDeptsCount = Array.from(
    new Set(students.map(s => s.department?.trim()).filter(Boolean))
  ).length;

  const liveExamsCount = exams.filter(e => e.status === 'LIVE').length;
  const scheduledExamsCount = exams.filter(
    e => e.status === 'SCHEDULED' || e.status === 'PUBLISHED'
  ).length;
  const draftExamsCount = exams.filter(e => e.status === 'DRAFT').length;
  const completedExamsCount = exams.filter(
    e =>
      e.status === 'ENDED' ||
      e.status === 'CLOSED' ||
      e.status === 'COMPLETED' ||
      e.status === 'RESULT_PUBLISHED'
  ).length;
  const activeExamsCount = liveExamsCount + scheduledExamsCount;

  const activeQuestionsCount = questions.filter(q => q.status === 'ACTIVE' || !q.status).length;
  const draftQuestionsCount = questions.filter(q => q.status === 'DRAFT').length;
  const aiQuestionsCount = questions.filter(
    q => q.source === 'AI_GENERATED' || q.createdBy === 'AI'
  ).length;
  const manualQuestionsCount = questions.length - aiQuestionsCount;
  const isAiQuestion = (question: Question) =>
    question.source === 'AI_GENERATED' || question.createdBy === 'AI';
  const batchQuestionIds = new Set(aiGenerationBatches.flatMap((batch) => batch.questionIds || []));
  const manualQuestions = questions.filter((question) => !isAiQuestion(question));
  const unbatchedAiQuestions = questions.filter(
    (question) => isAiQuestion(question) && !batchQuestionIds.has(question.questionId || question.id)
  );
  const questionSearchTextByBatch = Object.fromEntries(
    aiGenerationBatches.map((batch) => [
      batch.generationId,
      (batch.questionIds || [])
        .map((questionId) => questions.find((question) => (question.questionId || question.id) === questionId)?.text || '')
        .join(' ')
    ])
  );
  const uniqueSubjectsCount = Array.from(
    new Set(questions.map(q => q.subject?.trim() || q.topic?.trim()).filter(Boolean))
  ).length;

  const pendingQueriesCount = queries.filter(
    q => q.status === 'PENDING' || q.status === 'UNDER_REVIEW' || q.status === 'OPEN'
  ).length;
  const resolvedQueriesCount = queries.filter(
    q =>
      q.status === 'RESOLVED' ||
      q.status === 'APPROVED' ||
      q.status === 'REJECTED' ||
      q.status === 'RESOLVED_ACCEPTED' ||
      q.status === 'RESOLVED_REJECTED'
  ).length;
  const examsWithQueriesCount = Array.from(
    new Set(queries.map(q => q.examId).filter(Boolean))
  ).length;

  const publishedResultsCount = results.filter(
    r => r.status === 'PUBLISHED' || r.isPublished
  ).length;
  const unpublishedResultsCount = results.length - publishedResultsCount;
  const passedResultsCount = results.filter(
    r => r.passed === true || (r.percentage ?? r.accuracy ?? 0) >= 40
  ).length;

  const criticalEventsCount = proctoringEvents.filter(
    e => e.severity === 'HIGH' || e.severity === 'CRITICAL'
  ).length;

  const activeAttemptsCount = attempts.filter(a => a.status === 'IN_PROGRESS').length;
  const blockedAttemptsCount = attempts.filter(
    a => a.status === 'TERMINATED' || a.proctoringStatus === 'TERMINATED'
  ).length;
  const submittedAttemptsCount = attempts.filter(
    a => a.status === 'SUBMITTED' || a.status === 'EVALUATED'
  ).length;

  return (
    <div className="w-full max-w-[1440px] mx-auto px-4 md:px-6 lg:px-8 py-7 space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-slate-200 dark:border-slate-800 pb-4">
        <div>
          <h1 className="text-[22px] font-semibold text-slate-900 dark:text-white tracking-tight leading-tight">
            {activeTab === 'overview' && 'Dashboard'}
            {activeTab === 'teachers' && 'Teachers'}
            {activeTab === 'students' && 'Students'}
            {activeTab === 'exams' && 'Exams'}
            {activeTab === 'questions' && 'Question Bank'}
            {activeTab === 'results' && 'Results'}
            {activeTab === 'proctoring' && 'Proctoring'}
            {activeTab === 'queries' && 'Queries'}
            {activeTab === 'audit' && 'Audit Logs'}
            {activeTab === 'settings' && 'Settings'}
          </h1>
          <p className="text-[13px] text-slate-500 dark:text-slate-400 mt-1 tabular-nums">
            {user.name} · {user.role} · {user.userId || user.id}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() => {
              loadDirectoryAndLogs();
              if (onRefreshGlobalData) onRefreshGlobalData();
            }}
            className="h-9 px-3.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-[13px] font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 inline-flex items-center justify-center gap-1.5 transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoadingData ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          <button
            type="button"
            onClick={() => setShowCreateTeacherModal(true)}
            className="h-9 px-3.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-[13px] font-medium inline-flex items-center justify-center gap-1.5 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" /> Add Teacher
          </button>
          <button
            type="button"
            onClick={() => setShowCreateStudentModal(true)}
            className="h-9 px-3.5 rounded-lg bg-slate-900 dark:bg-slate-700 hover:bg-slate-800 text-white text-[13px] font-medium inline-flex items-center justify-center gap-1.5 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" /> Add Student
          </button>
        </div>
      </div>

      {/* Feedback Banner */}
      {feedbackBanner && (
        <div
          className={`p-4 rounded-lg border flex items-center justify-between text-[15px] ${
            feedbackBanner.type === 'success'
              ? 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300'
              : 'bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800 text-red-800 dark:text-red-300'
          }`}
        >
          <span>{feedbackBanner.message}</span>
          <button
            type="button"
            onClick={() => setFeedbackBanner(null)}
            className="text-[13.5px] font-medium underline ml-4"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Error State */}
      {loadError && (
        <div className="p-5 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 flex items-center justify-between">
          <div className="flex items-center gap-3 text-[15px] text-red-700 dark:text-red-300">
            <AlertCircle className="w-5 h-5 shrink-0" />
            <span>{loadError}</span>
          </div>
          <button
            type="button"
            onClick={loadDirectoryAndLogs}
            className="h-10 px-4 rounded-lg bg-red-600 text-white text-[14px] font-medium inline-flex items-center justify-center"
          >
            Retry
          </button>
        </div>
      )}

      {/* 1. OVERVIEW TAB */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          {/* Real Backend Modern KSI Summary Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            <KpiCard
              label="Total Teachers"
              value={teachers.length}
              subValue={`${activeTeachersCount} Active · ${inactiveTeachersCount} Inactive`}
              icon={<Users className="w-5 h-5 text-blue-600 dark:text-blue-400" />}
              isLoading={isLoadingData}
              onClick={() => onNavigateTab('teachers')}
            />

            <KpiCard
              label="Total Students"
              value={students.length}
              subValue={`${activeStudentsCount} Active · ${inactiveStudentsCount} Inactive`}
              icon={<Users className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />}
              isLoading={isLoadingData}
              onClick={() => onNavigateTab('students')}
            />

            <KpiCard
              label="Active Exams"
              value={activeExamsCount}
              subValue={`${liveExamsCount} Live · ${scheduledExamsCount} Scheduled · ${completedExamsCount} Completed`}
              icon={<FileText className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />}
              isLoading={isLoadingData}
              onClick={() => onNavigateTab('exams')}
            />

            <KpiCard
              label="Question Bank"
              value={questions.length}
              subValue={`${aiQuestionsCount} AI Generated · ${manualQuestionsCount} Manual`}
              icon={<BookOpen className="w-5 h-5 text-purple-600 dark:text-purple-400" />}
              isLoading={isLoadingData}
              onClick={() => onNavigateTab('questions')}
            />

            <KpiCard
              label="Pending Queries"
              value={pendingQueriesCount}
              subValue={`${resolvedQueriesCount} Resolved inquiries`}
              icon={<MessageSquare className="w-5 h-5 text-amber-600 dark:text-amber-400" />}
              isLoading={isLoadingData}
              onClick={() => onNavigateTab('queries')}
            />

            <KpiCard
              label="Published Results"
              value={publishedResultsCount}
              subValue={`${unpublishedResultsCount} Pending publication`}
              icon={<CheckCircle className="w-5 h-5 text-teal-600 dark:text-teal-400" />}
              isLoading={isLoadingData}
              onClick={() => onNavigateTab('results')}
            />

            <KpiCard
              label="Proctoring Events"
              value={proctoringEvents.length}
              subValue={`${criticalEventsCount} Critical / High`}
              icon={<ShieldAlert className="w-5 h-5 text-rose-600 dark:text-rose-400" />}
              isLoading={isLoadingData}
              onClick={() => onNavigateTab('proctoring')}
            />

            <KpiCard
              label="System Audit Logs"
              value={auditLogs.length}
              subValue={`DB: ${healthStatus?.database || 'Connected'}`}
              icon={<Activity className="w-5 h-5 text-cyan-600 dark:text-cyan-400" />}
              isLoading={isLoadingData}
              onClick={() => onNavigateTab('audit')}
            />
          </div>

          {/* Operational Panels: Recent Exams & Recent Audit Logs */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Recent Exams */}
            <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-[20px] font-semibold text-slate-900 dark:text-white leading-snug">
                  Recent Exams
                </h2>
                <button
                  type="button"
                  onClick={() => onNavigateTab('exams')}
                  className="text-[14px] font-medium text-blue-600 dark:text-blue-400 hover:underline"
                >
                  View all
                </button>
              </div>
              {exams.length === 0 ? (
                <p className="text-[15px] text-slate-500 dark:text-slate-400 py-8 text-center">
                  No examinations yet.
                </p>
              ) : (
                <div className="divide-y divide-slate-100 dark:divide-slate-700/60">
                  {exams.slice(0, 5).map(ex => (
                    <div key={ex.examId || ex.id} className="py-3.5 flex items-center justify-between text-[15px]">
                      <div>
                        <p className="font-medium text-slate-900 dark:text-white">{ex.title}</p>
                        <p className="text-[13px] text-slate-500 dark:text-slate-400 tabular-nums mt-0.5">
                          {ex.examId || ex.id} · {ex.subject} · {ex.durationMinutes} mins
                        </p>
                      </div>
                      <span className="text-[13px] font-medium text-slate-600 dark:text-slate-300">
                        {ex.status}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Recent Audit Logs */}
            <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-[20px] font-semibold text-slate-900 dark:text-white leading-snug">
                  Recent Audit Logs
                </h2>
                <button
                  type="button"
                  onClick={() => onNavigateTab('audit')}
                  className="text-[14px] font-medium text-blue-600 dark:text-blue-400 hover:underline"
                >
                  View all
                </button>
              </div>
              {auditLogs.length === 0 ? (
                <p className="text-[15px] text-slate-500 dark:text-slate-400 py-8 text-center">
                  No audit logs available.
                </p>
              ) : (
                <div className="divide-y divide-slate-100 dark:divide-slate-700/60">
                  {auditLogs.slice(0, 5).map(log => (
                    <div key={log.auditId || log.id} className="py-3.5 flex items-center justify-between text-[15px]">
                      <div className="min-w-0 pr-3">
                        <p className="font-medium text-slate-900 dark:text-white">{log.action}</p>
                        <p className="text-[13px] text-slate-500 dark:text-slate-400 truncate mt-0.5">{log.details}</p>
                      </div>
                      <span className="text-[13px] text-slate-400 shrink-0 tabular-nums">{log.timestamp}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 2. TEACHERS TAB */}
      {activeTab === 'teachers' && (
        <div className="space-y-6">
          {/* Teacher KSI Summary */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiCard
              label="Total Teachers"
              value={teachers.length}
              subValue={`${activeTeachersCount} Active · ${inactiveTeachersCount} Inactive`}
              icon={<Users className="w-5 h-5 text-blue-600 dark:text-blue-400" />}
              isLoading={isLoadingData}
            />
            <KpiCard
              label="Active Faculty"
              value={activeTeachersCount}
              subValue={`${teacherDeptsCount} Departments`}
              icon={<Users className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />}
              isLoading={isLoadingData}
            />
            <KpiCard
              label="Students Supervised"
              value={totalSupervisedCount}
              subValue={`${supervisorsCount} Active supervisors`}
              icon={<FileText className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />}
              isLoading={isLoadingData}
            />
            <KpiCard
              label="Academic Departments"
              value={teacherDeptsCount}
              subValue="Faculty distribution"
              icon={<BookOpen className="w-5 h-5 text-purple-600 dark:text-purple-400" />}
              isLoading={isLoadingData}
            />
          </div>

          <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
            <div className="p-6 border-b border-slate-200 dark:border-slate-700 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
              <h2 className="text-[20px] font-semibold text-slate-900 dark:text-white leading-snug">
                Teachers ({filteredTeachers.length})
              </h2>
            <div className="flex items-center gap-3 w-full sm:w-auto">
              <div className="relative flex-1 sm:w-72">
                <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Search teachers..."
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                  className="w-full h-12 pl-10 pr-3.5 text-[15px] bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white outline-none focus:border-blue-500"
                />
              </div>
              <button
                type="button"
                onClick={openCreateTeacherDialog}
                className="h-11 px-4 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-[14.5px] font-medium shrink-0 inline-flex items-center justify-center gap-2"
              >
                <Plus className="w-4 h-4" /> Add Teacher
              </button>
            </div>
          </div>

          {filteredTeachers.length === 0 ? (
            <div className="p-12 text-center">
              <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
                No teachers yet.
              </p>
              <button
                type="button"
                onClick={openCreateTeacherDialog}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium"
              >
                <Plus className="w-4 h-4" /> Add Teacher
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-900/50 text-slate-500 dark:text-slate-400 text-xs font-medium border-b border-slate-200 dark:border-slate-700">
                    <th className="p-3.5 whitespace-nowrap">Teacher ID</th>
                    <th className="p-3.5">Name</th>
                    <th className="p-3.5">Department</th>
                    <th className="p-3.5">Designation</th>
                    <th className="p-3.5">Email</th>
                    <th className="p-3.5 whitespace-nowrap">Students</th>
                    <th className="p-3.5">Status</th>
                    <th className="p-3.5 whitespace-nowrap">Created</th>
                    <th className="p-3.5 text-right whitespace-nowrap">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-700 text-sm">
                  {filteredTeachers.map(t => (
                    <tr key={t.userId || t.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/30">
                      <td className="p-3.5 whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => handleOpenTeacherDetails(t.userId || t.id)}
                          className="font-mono text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline tabular-nums"
                        >
                          {t.userId || t.id}
                        </button>
                      </td>
                      <td className="p-3.5">
                        <button
                          type="button"
                          onClick={() => handleOpenTeacherDetails(t.userId || t.id)}
                          className="font-medium text-slate-900 dark:text-white hover:text-blue-600 dark:hover:text-blue-400 text-left"
                        >
                          {t.name}
                        </button>
                      </td>
                      <td className="p-3.5 text-slate-600 dark:text-slate-300">
                        {t.department || '—'}
                      </td>
                      <td className="p-3.5 text-xs text-slate-600 dark:text-slate-300">
                        {t.designation || 'Faculty'}
                      </td>
                      <td className="p-3.5 text-xs text-slate-600 dark:text-slate-300">
                        <div>{t.email || '—'}</div>
                        <div className="text-slate-400">{t.phone || ''}</div>
                      </td>
                      <td className="p-3.5 font-medium text-slate-800 dark:text-slate-200 tabular-nums">
                        {t.studentsCount ?? 0}
                      </td>
                      <td className="p-3.5">
                        <span
                          className={`inline-flex items-center px-2.5 py-0.5 rounded-md text-xs font-medium border ${getStatusBadgeStyle(
                            t.status
                          )}`}
                        >
                          {t.status}
                        </span>
                      </td>
                      <td className="p-3.5 text-xs text-slate-500 whitespace-nowrap tabular-nums">
                        {t.createdAt ? new Date(t.createdAt).toLocaleDateString() : '—'}
                      </td>
                      <td className="p-3.5 text-right whitespace-nowrap space-x-2">
                        <button
                          type="button"
                          onClick={() => handleOpenTeacherDetails(t.userId || t.id)}
                          className="px-2.5 py-1 rounded border border-slate-200 dark:border-slate-700 text-xs font-medium text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-slate-700 inline-flex items-center gap-1"
                        >
                          <Eye className="w-3 h-3" /> View
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setResetMessage(null);
                            setResetTarget({ user: t, newPassword: '' });
                          }}
                          className="px-2.5 py-1 rounded border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
                        >
                          Reset Password
                        </button>
                        <button
                          type="button"
                          onClick={() => handleToggleUserStatus(t)}
                          className="px-2.5 py-1 rounded border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
                        >
                          {t.status === 'ACTIVE' ? 'Block' : t.status === 'BLOCKED' ? 'Unblock' : 'Activate'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        </div>
      )}

      {/* 3. STUDENTS TAB */}
      {activeTab === 'students' && (
        <div className="space-y-6">
          {/* Student KSI Summary */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiCard
              label="Total Students"
              value={students.length}
              subValue={`${activeStudentsCount} Active · ${inactiveStudentsCount} Inactive`}
              icon={<Users className="w-5 h-5 text-blue-600 dark:text-blue-400" />}
              isLoading={isLoadingData}
            />
            <KpiCard
              label="Active Students"
              value={activeStudentsCount}
              subValue={`${inactiveStudentsCount} Inactive / Blocked`}
              icon={<Users className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />}
              isLoading={isLoadingData}
            />
            <KpiCard
              label="Assigned to Faculty"
              value={assignedStudentsCount}
              subValue={`${unassignedStudentsCount} Unassigned`}
              icon={<Users className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />}
              isLoading={isLoadingData}
            />
            <KpiCard
              label="Academic Cohorts"
              value={`${studentCoursesCount} Courses`}
              subValue={`${studentDeptsCount} Departments`}
              icon={<BookOpen className="w-5 h-5 text-purple-600 dark:text-purple-400" />}
              isLoading={isLoadingData}
            />
          </div>

          <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
            <div className="p-6 border-b border-slate-200 dark:border-slate-700 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
              <h2 className="text-[20px] font-semibold text-slate-900 dark:text-white leading-snug">
                Students ({filteredStudents.length})
              </h2>
            <div className="flex items-center gap-3 w-full sm:w-auto">
              <div className="relative flex-1 sm:w-72">
                <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Search students..."
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                  className="w-full h-12 pl-10 pr-3.5 text-[15px] bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white outline-none focus:border-blue-500"
                />
              </div>
              <button
                type="button"
                onClick={openCreateStudentDialog}
                className="h-11 px-4 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-[14.5px] font-medium shrink-0 inline-flex items-center justify-center gap-2"
              >
                <Plus className="w-4 h-4" /> Add Student
              </button>
            </div>
          </div>

          {filteredStudents.length === 0 ? (
            <div className="p-12 text-center">
              <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
                No students yet.
              </p>
              <button
                type="button"
                onClick={openCreateStudentDialog}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium"
              >
                <Plus className="w-4 h-4" /> Add Student
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-900/50 text-slate-500 dark:text-slate-400 text-xs font-medium border-b border-slate-200 dark:border-slate-700">
                    <th className="p-3.5 whitespace-nowrap">Student ID</th>
                    <th className="p-3.5">Name</th>
                    <th className="p-3.5">Course</th>
                    <th className="p-3.5">Department</th>
                    <th className="p-3.5">Assigned Teacher</th>
                    <th className="p-3.5">Status</th>
                    <th className="p-3.5 whitespace-nowrap">Created</th>
                    <th className="p-3.5 text-right whitespace-nowrap">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-700 text-sm">
                  {filteredStudents.map(s => (
                    <tr key={s.userId || s.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/30">
                      <td className="p-3.5 whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => handleOpenStudentDetails(s.userId || s.id)}
                          className="font-mono text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline tabular-nums"
                        >
                          {s.userId || s.id}
                        </button>
                      </td>
                      <td className="p-3.5">
                        <button
                          type="button"
                          onClick={() => handleOpenStudentDetails(s.userId || s.id)}
                          className="font-medium text-slate-900 dark:text-white hover:text-blue-600 dark:hover:text-blue-400 text-left"
                        >
                          {s.name}
                        </button>
                        <div className="text-xs text-slate-500">{s.email || '—'}</div>
                      </td>
                      <td className="p-3.5 text-slate-600 dark:text-slate-300">
                        <div>{s.course || '—'}</div>
                        <div className="text-xs text-slate-400">
                          {s.academicYear || s.semester || ''}
                        </div>
                      </td>
                      <td className="p-3.5 text-slate-600 dark:text-slate-300">
                        {s.department || '—'}
                      </td>
                      <td className="p-3.5 text-xs text-slate-600 dark:text-slate-300">
                        {s.assignedTeacherNames && s.assignedTeacherNames.length > 0
                          ? s.assignedTeacherNames.join(', ')
                          : 'Unassigned'}
                      </td>
                      <td className="p-3.5">
                        <span
                          className={`inline-flex items-center px-2.5 py-0.5 rounded-md text-xs font-medium border ${getStatusBadgeStyle(
                            s.status
                          )}`}
                        >
                          {s.status}
                        </span>
                      </td>
                      <td className="p-3.5 text-xs text-slate-500 whitespace-nowrap tabular-nums">
                        {s.createdAt ? new Date(s.createdAt).toLocaleDateString() : '—'}
                      </td>
                      <td className="p-3.5 text-right whitespace-nowrap space-x-2">
                        <button
                          type="button"
                          onClick={() => handleOpenStudentDetails(s.userId || s.id)}
                          className="px-2.5 py-1 rounded border border-slate-200 dark:border-slate-700 text-xs font-medium text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-slate-700 inline-flex items-center gap-1"
                        >
                          <Eye className="w-3 h-3" /> View
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setResetMessage(null);
                            setResetTarget({ user: s, newPassword: '' });
                          }}
                          className="px-2.5 py-1 rounded border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
                        >
                          Reset Password
                        </button>
                        <button
                          type="button"
                          onClick={() => handleToggleUserStatus(s)}
                          className="px-2.5 py-1 rounded border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
                        >
                          {s.status === 'ACTIVE' ? 'Block' : s.status === 'BLOCKED' ? 'Unblock' : 'Activate'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        </div>
      )}

      {/* 4. EXAMS TAB */}
      {activeTab === 'exams' && (
        <TeacherExamScheduler
          exams={exams}
          questions={questions}
          students={students}
          onSaveExam={onSaveExam}
          onDeleteExam={onDeleteExam}
          onRefresh={onRefreshGlobalData}
          onPublishExamResults={onPublishAllForExam}
        />
      )}

      {/* 5. QUESTION BANK TAB */}
      {activeTab === 'questions' && (
        <div className="space-y-6">
          {/* Question Bank KSI Summary */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiCard
              label="Total Questions"
              value={questions.length}
              subValue={`${uniqueSubjectsCount} Subjects covered`}
              icon={<BookOpen className="w-5 h-5 text-blue-600 dark:text-blue-400" />}
              isLoading={isLoadingData}
            />
            <KpiCard
              label="Active Questions"
              value={activeQuestionsCount}
              subValue={`${draftQuestionsCount} Drafts`}
              icon={<BookOpen className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />}
              isLoading={isLoadingData}
            />
            <KpiCard
              label="AI Generated"
              value={aiQuestionsCount}
              subValue="Generated from syllabus/AI"
              icon={<BookOpen className="w-5 h-5 text-purple-600 dark:text-purple-400" />}
              isLoading={isLoadingData}
            />
            <KpiCard
              label="Manual Questions"
              value={manualQuestionsCount}
              subValue="Authored by faculty"
              icon={<FileText className="w-5 h-5 text-amber-600 dark:text-amber-400" />}
              isLoading={isLoadingData}
            />
          </div>

          <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
            <div className="p-6 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
              <h2 className="text-[20px] font-semibold text-slate-900 dark:text-white leading-snug">
                Question Bank ({questions.length})
              </h2>
            </div>
          <div className="p-5">
            <AiGenerationBatchCards
              batches={aiGenerationBatches}
              questionSearchTextByBatch={questionSearchTextByBatch}
              unbatchedQuestions={unbatchedAiQuestions}
              onViewQuestion={setSelectedQuestionDetail}
              onDeleteQuestion={(question) => handleDeleteQuestion(question.questionId || question.id)}
            />
          </div>
          {manualQuestions.length === 0 ? (
            <div className="p-12 text-center text-[15px] text-slate-500 dark:text-slate-400">
              {questions.length > 0 || aiGenerationBatches.length > 0
                ? 'No manual questions match this search.'
                : 'No questions yet.'}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-900/50 text-slate-500 dark:text-slate-400 text-[13.5px] font-semibold border-b border-slate-200 dark:border-slate-700">
                    <th className="p-3.5 whitespace-nowrap">Question ID</th>
                    <th className="p-3.5">Question</th>
                    <th className="p-3.5">Type</th>
                    <th className="p-3.5">Difficulty</th>
                    <th className="p-3.5">Marks</th>
                    <th className="p-3.5">Created By</th>
                    <th className="p-3.5">Created</th>
                    <th className="p-3.5">Status</th>
                    <th className="p-3.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-700 text-[14.5px]">
                  {manualQuestions.map(q => (
                    <tr key={q.questionId || q.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/30">
                      <td className="p-3.5 whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => setSelectedQuestionDetail(q)}
                          className="font-mono text-[14px] font-medium text-blue-600 dark:text-blue-400 hover:underline tabular-nums"
                        >
                          {q.questionId || q.id}
                        </button>
                      </td>
                      <td className="p-3.5">
                        <div className="font-medium text-slate-900 dark:text-white">{q.text}</div>
                        <div className="text-[13px] text-slate-500 mt-0.5">{q.subject || q.topic}</div>
                      </td>
                      <td className="p-3.5 text-[14px] text-slate-600 dark:text-slate-300">MCQ</td>
                      <td className="p-3.5 text-[14px] font-medium text-slate-700 dark:text-slate-300">
                        {q.difficulty}
                      </td>
                      <td className="p-3.5 text-slate-600 dark:text-slate-300 tabular-nums">
                        {q.marks ?? 1}
                      </td>
                      <td className="p-3.5 text-slate-600 dark:text-slate-400 text-[14px]">
                        {q.createdByName || q.createdBy || '—'}
                      </td>
                      <td className="p-3.5 text-[14px] text-slate-500 tabular-nums">
                        {q.createdAt ? new Date(q.createdAt).toLocaleDateString() : '—'}
                      </td>
                      <td className="p-3.5 text-[13px] font-medium text-slate-700 dark:text-slate-300">
                        {q.status || 'ACTIVE'}
                      </td>
                      <td className="p-3.5 text-right whitespace-nowrap space-x-2">
                        <button
                          type="button"
                          onClick={() => setSelectedQuestionDetail(q)}
                          className="h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-700 text-[14px] font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
                        >
                          View
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteQuestion(q.questionId || q.id)}
                          className="h-9 px-3 rounded-lg border border-red-200 dark:border-red-900/50 text-[14px] font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30"
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        </div>
      )}

      {/* 6. RESULTS TAB */}
      {activeTab === 'results' && (
        <div className="space-y-6">
          {/* Results KSI Summary */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiCard
              label="Total Submissions"
              value={results.length}
              subValue="Evaluated attempts"
              icon={<CheckCircle className="w-5 h-5 text-blue-600 dark:text-blue-400" />}
              isLoading={isLoadingData}
            />
            <KpiCard
              label="Published Results"
              value={publishedResultsCount}
              subValue="Available on student portal"
              icon={<CheckCircle className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />}
              isLoading={isLoadingData}
            />
            <KpiCard
              label="Pending Publication"
              value={unpublishedResultsCount}
              subValue="Awaiting release"
              icon={<AlertCircle className="w-5 h-5 text-amber-600 dark:text-amber-400" />}
              isLoading={isLoadingData}
            />
            <KpiCard
              label="Passing Grade"
              value={passedResultsCount}
              subValue={`${results.length - passedResultsCount} Below threshold`}
              icon={<CheckCircle className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />}
              isLoading={isLoadingData}
            />
          </div>

          <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
            <div className="p-6 border-b border-slate-200 dark:border-slate-700 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
              <h2 className="text-[20px] font-semibold text-slate-900 dark:text-white leading-snug">
                Results ({results.length})
              </h2>
            {unpublishedResultsCount > 0 && (
              <span className="text-[13.5px] font-medium text-amber-600 dark:text-amber-400">
                {unpublishedResultsCount} pending publication
              </span>
            )}
          </div>

          {results.length === 0 ? (
            <div className="p-12 text-center text-[15px] text-slate-500 dark:text-slate-400">
              No results available.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-900/50 text-slate-500 dark:text-slate-400 text-[13.5px] font-semibold border-b border-slate-200 dark:border-slate-700">
                    <th className="p-3.5 whitespace-nowrap">Result ID</th>
                    <th className="p-3.5">Exam</th>
                    <th className="p-3.5">Student</th>
                    <th className="p-3.5">Score</th>
                    <th className="p-3.5">Percentage</th>
                    <th className="p-3.5">Status</th>
                    <th className="p-3.5">Published At</th>
                    <th className="p-3.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-700 text-[14.5px]">
                  {results.map(r => {
                    const isPublished = r.status === 'PUBLISHED';
                    const rId = r.resultId || r.id;
                    return (
                      <tr key={rId} className="hover:bg-slate-50 dark:hover:bg-slate-700/30">
                        <td className="p-3.5 whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => setSelectedResultDetail(r)}
                            className="font-mono text-[14px] font-medium text-blue-600 dark:text-blue-400 hover:underline tabular-nums"
                          >
                            {rId}
                          </button>
                        </td>
                        <td className="p-3.5">
                          <div className="font-medium text-slate-800 dark:text-slate-200">
                            {r.examTitle || r.subject}
                          </div>
                        </td>
                        <td className="p-3.5">
                          <div className="font-medium text-slate-900 dark:text-white">
                            {r.studentName}
                          </div>
                          <div className="text-[13px] font-mono text-slate-500 tabular-nums">{r.studentId}</div>
                        </td>
                        <td className="p-3.5 font-medium text-slate-900 dark:text-white tabular-nums">
                          {r.score} / {r.totalMarks || r.totalQuestions}
                        </td>
                        <td className="p-3.5 font-medium text-slate-700 dark:text-slate-300 tabular-nums">
                          {r.percentage ?? r.accuracy ?? 0}%
                        </td>
                        <td className="p-3.5 text-[13px] font-medium text-slate-700 dark:text-slate-300">
                          {r.status}
                        </td>
                        <td className="p-3.5 text-[14px] text-slate-500 tabular-nums">
                          {r.publishedAt
                            ? new Date(r.publishedAt).toLocaleDateString()
                            : isPublished
                            ? r.date
                            : '—'}
                        </td>
                        <td className="p-3.5 text-right whitespace-nowrap space-x-2">
                          <button
                            type="button"
                            onClick={() => setSelectedResultDetail(r)}
                            className="h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-700 text-[14px] font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
                          >
                            View
                          </button>
                          {!isPublished && (
                            <button
                              type="button"
                              onClick={() => {
                                confirmAction({
                                  title: 'Publish Results',
                                  message: `Are you sure you want to publish the results for ${r.studentName}?`,
                                  confirmLabel: 'Yes, Publish',
                                  cancelLabel: 'No',
                                  variant: 'primary',
                                  action: async () => {
                                    await onPublishResult(rId);
                                  }
                                });
                              }}
                              className="h-9 px-3.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-[14px] font-medium"
                            >
                              Publish
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
        </div>
      )}

      {/* 7. PROCTORING TAB */}
      {activeTab === 'proctoring' && (
        <div className="space-y-6">
          {/* Proctoring KSI Summary */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiCard
              label="Active Attempts"
              value={activeAttemptsCount}
              subValue="Live candidate examinations"
              icon={<ShieldAlert className="w-5 h-5 text-blue-600 dark:text-blue-400" />}
              isLoading={isLoadingData}
            />
            <KpiCard
              label="Warning Events"
              value={proctoringEvents.length}
              subValue={`${criticalEventsCount} Threshold flagged`}
              icon={<ShieldAlert className="w-5 h-5 text-amber-600 dark:text-amber-400" />}
              isLoading={isLoadingData}
            />
            <KpiCard
              label="Blocked Attempts"
              value={blockedAttemptsCount}
              subValue="Terminated policy violations"
              icon={<ShieldAlert className="w-5 h-5 text-rose-600 dark:text-rose-400" />}
              isLoading={isLoadingData}
            />
            <KpiCard
              label="Submitted Attempts"
              value={submittedAttemptsCount}
              subValue="Evaluated & completed"
              icon={<CheckCircle className="w-5 h-5 text-purple-600 dark:text-purple-400" />}
              isLoading={isLoadingData}
            />
          </div>

          <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
            <div className="p-6 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
              <h2 className="text-[20px] font-semibold text-slate-900 dark:text-white leading-snug">
                Proctoring ({proctoringEvents.length})
              </h2>
            </div>

          {proctoringEvents.length === 0 ? (
            <div className="p-12 text-center text-[15px] text-slate-500 dark:text-slate-400">
              No proctoring events.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-900/50 text-slate-500 dark:text-slate-400 text-[13.5px] font-semibold border-b border-slate-200 dark:border-slate-700">
                    <th className="p-3.5">Event ID</th>
                    <th className="p-3.5">Student</th>
                    <th className="p-3.5">Exam</th>
                    <th className="p-3.5">Type</th>
                    <th className="p-3.5">Severity</th>
                    <th className="p-3.5">Details</th>
                    <th className="p-3.5">Timestamp</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-700 text-[14.5px]">
                  {proctoringEvents.map(ev => (
                    <tr
                      key={ev.eventId}
                      onClick={() => setSelectedProctoringDetail(ev)}
                      className="hover:bg-slate-50 dark:hover:bg-slate-700/30 cursor-pointer transition-colors"
                    >
                      <td className="p-3.5 font-mono text-[14px] text-blue-600 dark:text-blue-400 font-medium tabular-nums hover:underline">
                        {ev.eventId}
                      </td>
                      <td className="p-3.5">
                        <div className="font-medium text-slate-900 dark:text-white">{ev.studentName || ev.studentId}</div>
                        <div className="font-mono text-[13px] text-slate-500 tabular-nums">{ev.studentId}</div>
                      </td>
                      <td className="p-3.5 text-slate-600 dark:text-slate-300">
                        {ev.examTitle || ev.examId}
                      </td>
                      <td className="p-3.5 font-medium text-slate-800 dark:text-slate-200">
                        {ev.eventType}
                      </td>
                      <td className="p-3.5">
                        <StatusBadge status={ev.severity} />
                      </td>
                      <td className="p-3.5 text-slate-600 dark:text-slate-300 max-w-xs truncate">{ev.details}</td>
                      <td className="p-3.5 text-[14px] text-slate-500 tabular-nums whitespace-nowrap">
                        {new Date(ev.timestamp).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        </div>
      )}

      {/* 8. QUERIES TAB */}
      {activeTab === 'queries' && (
        <div className="space-y-6">
          {/* Queries KSI Summary */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiCard
              label="Total Queries"
              value={queries.length}
              subValue="All inquiries logged"
              icon={<MessageSquare className="w-5 h-5 text-blue-600 dark:text-blue-400" />}
              isLoading={isLoadingData}
            />
            <KpiCard
              label="Pending Adjudication"
              value={pendingQueriesCount}
              subValue="Requires resolution"
              icon={<MessageSquare className="w-5 h-5 text-amber-600 dark:text-amber-400" />}
              isLoading={isLoadingData}
            />
            <KpiCard
              label="Resolved Queries"
              value={resolvedQueriesCount}
              subValue="Successfully closed"
              icon={<CheckCircle className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />}
              isLoading={isLoadingData}
            />
            <KpiCard
              label="Exams with Inquiries"
              value={examsWithQueriesCount}
              subValue="Distinct exams queried"
              icon={<FileText className="w-5 h-5 text-purple-600 dark:text-purple-400" />}
              isLoading={isLoadingData}
            />
          </div>

          <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
            <div className="p-6 border-b border-slate-200 dark:border-slate-700">
              <h2 className="text-[20px] font-semibold text-slate-900 dark:text-white leading-snug">
                Queries ({queries.length})
              </h2>
            </div>
          {queries.length === 0 ? (
            <div className="p-12 text-center text-[15px] text-slate-500 dark:text-slate-400">
              No queries yet.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-900/50 text-slate-500 dark:text-slate-400 text-[13.5px] font-semibold border-b border-slate-200 dark:border-slate-700">
                    <th className="p-3.5 whitespace-nowrap">Query ID</th>
                    <th className="p-3.5">Student</th>
                    <th className="p-3.5">Exam</th>
                    <th className="p-3.5">Subject</th>
                    <th className="p-3.5">Status</th>
                    <th className="p-3.5">Created</th>
                    <th className="p-3.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-700 text-[14.5px]">
                  {queries.map(q => {
                    const qKey = q.queryId || q.id;
                    const isPending = q.status === 'PENDING' || q.status === 'UNDER_REVIEW';
                    return (
                      <tr key={qKey} className="hover:bg-slate-50 dark:hover:bg-slate-700/30">
                        <td className="p-3.5 whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => setSelectedQueryDetail(q)}
                            className="font-mono text-[14px] font-medium text-blue-600 dark:text-blue-400 hover:underline tabular-nums"
                          >
                            {qKey}
                          </button>
                        </td>
                        <td className="p-3.5">
                          <div className="font-medium text-slate-900 dark:text-white">{q.studentName}</div>
                          <div className="text-[13px] font-mono text-slate-500 tabular-nums">{q.studentId}</div>
                        </td>
                        <td className="p-3.5 text-slate-600 dark:text-slate-300">
                          {q.examTitle || q.examId || '—'}
                        </td>
                        <td className="p-3.5">
                          <div className="font-medium text-slate-900 dark:text-white">{q.subject || q.topic}</div>
                          <div className="text-[13px] text-slate-500 line-clamp-1">{q.description || q.message}</div>
                        </td>
                        <td className="p-3.5 text-[13px] font-medium text-slate-700 dark:text-slate-300">
                          {q.status}
                        </td>
                        <td className="p-3.5 text-[14px] text-slate-500 tabular-nums">{q.createdAt}</td>
                        <td className="p-3.5 text-right whitespace-nowrap">
                          {isPending ? (
                            <div className="inline-flex items-center gap-2">
                              <input
                                type="text"
                                placeholder="Write response..."
                                value={replyText[qKey] || ''}
                                onChange={e =>
                                  setReplyText(prev => ({ ...prev, [qKey]: e.target.value }))
                                }
                                className="w-52 h-10 px-3 text-[14px] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white outline-none"
                              />
                              <button
                                type="button"
                                disabled={submittingQueryId === qKey || !(replyText[qKey] || '').trim()}
                                onClick={() => {
                                  const reply = (replyText[qKey] || '').trim();
                                  if (!reply) return;
                                  confirmAction({
                                    title: 'Resolve Query',
                                    subtitle: `Query ID: ${qKey}`,
                                    message: `Are you sure you want to send this resolution to ${q.studentName || 'the student'}?`,
                                    confirmLabel: 'Yes, Resolve',
                                    cancelLabel: 'No',
                                    variant: 'primary',
                                    details: [
                                      { label: 'Student', value: q.studentName },
                                      { label: 'Subject', value: q.subject || q.topic || 'General' },
                                      { label: 'Response', value: reply }
                                    ],
                                    action: async () => {
                                      setSubmittingQueryId(qKey);
                                      try {
                                        await onResolveQuery(qKey, reply, 'RESOLVED');
                                      } finally {
                                        setSubmittingQueryId(null);
                                      }
                                    }
                                  });
                                }}
                                className="h-10 px-3.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg text-[14px] font-medium"
                              >
                                Resolve
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setSelectedQueryDetail(q)}
                              className="h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-700 text-[14px] font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
                            >
                              View
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
        </div>
      )}

      {/* 9. AUDIT LOGS TAB */}
      {activeTab === 'audit' && (
        <div className="space-y-6">
          {/* Audit Logs KSI Summary */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <KpiCard
              label="Total Audit Logs"
              value={auditLogs.length}
              subValue="Immutable operations logged"
              icon={<Activity className="w-5 h-5 text-blue-600 dark:text-blue-400" />}
              isLoading={isLoadingData}
            />
            <KpiCard
              label="Distinct Actors"
              value={Array.from(new Set(auditLogs.map(l => l.actorId).filter(Boolean))).length}
              subValue="Active staff & admin actors"
              icon={<Users className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />}
              isLoading={isLoadingData}
            />
            <KpiCard
              label="Audited Operations"
              value={Array.from(new Set(auditLogs.map(l => l.action).filter(Boolean))).length}
              subValue="Action categories"
              icon={<FileText className="w-5 h-5 text-purple-600 dark:text-purple-400" />}
              isLoading={isLoadingData}
            />
          </div>

          <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
            <div className="p-6 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
              <h2 className="text-[20px] font-semibold text-slate-900 dark:text-white leading-snug">
                Audit Logs ({auditLogs.length})
              </h2>
            </div>

            {auditLogs.length === 0 ? (
              <div className="p-12 text-center text-[15px] text-slate-500 dark:text-slate-400">
                No recent activity.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-50 dark:bg-slate-900/50 text-slate-500 dark:text-slate-400 text-[13.5px] font-semibold border-b border-slate-200 dark:border-slate-700">
                      <th className="p-3.5 whitespace-nowrap">Timestamp</th>
                      <th className="p-3.5">Actor</th>
                      <th className="p-3.5">Role</th>
                      <th className="p-3.5">Action</th>
                      <th className="p-3.5">Resource</th>
                      <th className="p-3.5">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-700 text-[14.5px]">
                    {auditLogs.map((log, idx) => (
                      <tr
                        key={log.auditId || log.id || idx}
                        onClick={() => setSelectedAuditDetail(log)}
                        className="hover:bg-slate-50 dark:hover:bg-slate-700/30 cursor-pointer transition-colors"
                      >
                        <td className="p-3.5 text-[14px] text-slate-500 whitespace-nowrap tabular-nums">
                          {log.timestamp}
                        </td>
                        <td className="p-3.5 font-mono text-[14px] text-slate-700 dark:text-slate-300 tabular-nums">
                          {log.actorName || log.actorId}
                        </td>
                        <td className="p-3.5 text-[13px] font-medium text-slate-600 dark:text-slate-400">
                          {log.actorRole || 'SYSTEM'}
                        </td>
                        <td className="p-3.5 font-mono text-[14px] font-medium text-blue-600 dark:text-blue-400 hover:underline">
                          {log.action}
                        </td>
                        <td className="p-3.5 text-slate-700 dark:text-slate-300 max-w-xs truncate">
                          {log.details}
                        </td>
                        <td className="p-3.5 text-[13px] font-medium text-emerald-600 dark:text-emerald-400">
                          {log.status || 'SUCCESS'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 10. SETTINGS TAB */}
      {activeTab === 'settings' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-6 space-y-4">
            <h2 className="text-[20px] font-semibold text-slate-900 dark:text-white flex items-center gap-2.5 leading-snug">
              <SettingsIcon className="w-5 h-5 text-blue-600" />
              Administrator Profile
            </h2>
            <div className="space-y-2.5 text-[15px]">
              <div className="flex justify-between py-2.5 border-b border-slate-100 dark:border-slate-700">
                <span className="text-slate-500">User ID</span>
                <span className="font-mono font-medium text-slate-900 dark:text-white tabular-nums">
                  {user.userId || user.id}
                </span>
              </div>
              <div className="flex justify-between py-2.5 border-b border-slate-100 dark:border-slate-700">
                <span className="text-slate-500">Name</span>
                <span className="font-medium text-slate-900 dark:text-white">{user.name}</span>
              </div>
              <div className="flex justify-between py-2.5 border-b border-slate-100 dark:border-slate-700">
                <span className="text-slate-500">Role</span>
                <span className="font-medium text-slate-900 dark:text-white">{user.role}</span>
              </div>
              <div className="flex justify-between py-2.5">
                <span className="text-slate-500">Department</span>
                <span className="font-medium text-slate-900 dark:text-white">
                  {user.department || 'Controller of Examinations'}
                </span>
              </div>
            </div>
          </div>

          <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-6 space-y-4">
            <h2 className="text-[20px] font-semibold text-slate-900 dark:text-white flex items-center gap-2.5 leading-snug">
              <Activity className="w-5 h-5 text-emerald-600" />
              System Status
            </h2>
            <div className="space-y-2.5 text-[15px]">
              <div className="flex justify-between py-2.5 border-b border-slate-100 dark:border-slate-700">
                <span className="text-slate-500">API Status</span>
                <span className="font-medium text-emerald-600 dark:text-emerald-400">
                  {healthStatus?.status || 'healthy'}
                </span>
              </div>
              <div className="flex justify-between py-2.5 border-b border-slate-100 dark:border-slate-700">
                <span className="text-slate-500">Database</span>
                <span className="font-medium text-emerald-600 dark:text-emerald-400">
                  {healthStatus?.database || 'connected'}
                </span>
              </div>
              <div className="flex justify-between py-2.5 border-b border-slate-100 dark:border-slate-700">
                <span className="text-slate-500">Teacher ID Format</span>
                <span className="font-mono text-[14px] text-slate-700 dark:text-slate-300 tabular-nums">
                  1251XXXX
                </span>
              </div>
              <div className="flex justify-between py-2.5">
                <span className="text-slate-500">Student ID Format</span>
                <span className="font-mono text-[14px] text-slate-700 dark:text-slate-300 tabular-nums">
                  1261XXXX
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* CREATE TEACHER MODAL */}
      <Modal
        isOpen={showCreateTeacherModal}
        onClose={() => setShowCreateTeacherModal(false)}
        size="large"
        title="Add Teacher"
        footer={
          <div className="flex items-center justify-end gap-3 w-full">
            <button
              type="button"
              onClick={() => setShowCreateTeacherModal(false)}
              className="h-11 px-4 rounded-lg text-[14.5px] font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 inline-flex items-center justify-center transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              form="create-teacher-form"
              disabled={isSubmittingTeacher}
              className="h-11 px-5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-[14.5px] font-medium disabled:opacity-50 inline-flex items-center justify-center shadow-sm transition-colors"
            >
              {isSubmittingTeacher ? 'Creating...' : 'Create Teacher'}
            </button>
          </div>
        }
      >
        {teacherFormError && (
          <div className="p-3.5 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-[14px] font-medium text-red-600 dark:text-red-400 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{teacherFormError}</span>
          </div>
        )}

        <form id="create-teacher-form" onSubmit={handleCreateTeacher} className="space-y-6">
          <FormSection title="Personal Information">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-[14px] font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                  Full Name *
                </label>
                <input
                  type="text"
                  required
                  value={teacherForm.name}
                  onChange={e => setTeacherForm({ ...teacherForm, name: e.target.value })}
                  placeholder="Enter full name"
                  className="w-full h-12 px-3.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-[15px] text-slate-900 dark:text-white outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-[14px] font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                  Date of Birth *
                </label>
                <input
                  type="date"
                  required
                  value={teacherForm.dob}
                  onChange={e => setTeacherForm({ ...teacherForm, dob: e.target.value })}
                  className="w-full h-12 px-3.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-[15px] text-slate-900 dark:text-white outline-none focus:border-blue-500"
                />
              </div>
            </div>
          </FormSection>

          <FormSection title="Department & Designation">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-[14px] font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                  Department *
                </label>
                <SearchableSelect
                  required
                  value={teacherForm.department}
                  onChange={val => setTeacherForm({ ...teacherForm, department: val })}
                  options={departmentOptions}
                  placeholder="Select department"
                  emptyMessage="No departments available."
                  isLoading={isLoadingData}
                  error={loadError}
                />
              </div>
              <div>
                <label className="block text-[14px] font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                  Designation
                </label>
                <Select
                  value={teacherForm.designation}
                  onChange={val => setTeacherForm({ ...teacherForm, designation: val })}
                  options={designationOptions}
                  placeholder="Select designation"
                  emptyMessage="No designations available."
                  isLoading={isLoadingData}
                  error={loadError}
                />
              </div>
            </div>
          </FormSection>

          <FormSection title="Contact Information">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-[14px] font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                  Email
                </label>
                <input
                  type="email"
                  value={teacherForm.email}
                  onChange={e => setTeacherForm({ ...teacherForm, email: e.target.value })}
                  placeholder="Enter email address"
                  className="w-full h-12 px-3.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-[15px] text-slate-900 dark:text-white outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-[14px] font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                  Phone
                </label>
                <input
                  type="text"
                  value={teacherForm.phone}
                  onChange={e => setTeacherForm({ ...teacherForm, phone: e.target.value })}
                  placeholder="Enter phone number"
                  className="w-full h-12 px-3.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-[15px] text-slate-900 dark:text-white outline-none focus:border-blue-500"
                />
              </div>
            </div>
          </FormSection>
        </form>
      </Modal>

      {/* CREATE STUDENT MODAL */}
      <Modal
        isOpen={showCreateStudentModal}
        onClose={() => setShowCreateStudentModal(false)}
        size="large"
        title="Add Student"
        footer={
          <div className="flex items-center justify-end gap-3 w-full">
            <button
              type="button"
              onClick={() => setShowCreateStudentModal(false)}
              className="h-11 px-4 rounded-lg text-[14.5px] font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 inline-flex items-center justify-center transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              form="create-student-form"
              disabled={isSubmittingStudent}
              className="h-11 px-5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-[14.5px] font-medium disabled:opacity-50 inline-flex items-center justify-center shadow-sm transition-colors"
            >
              {isSubmittingStudent ? 'Creating...' : 'Create Student'}
            </button>
          </div>
        }
      >
        {studentFormError && (
          <div className="p-3.5 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-[14px] font-medium text-red-600 dark:text-red-400 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{studentFormError}</span>
          </div>
        )}

        <form id="create-student-form" onSubmit={handleCreateStudent} className="space-y-6">
          <FormSection title="Personal Details">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-[14px] font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                  Full Name *
                </label>
                <input
                  type="text"
                  required
                  value={studentForm.name}
                  onChange={e => setStudentForm({ ...studentForm, name: e.target.value })}
                  placeholder="Enter full name"
                  className="w-full h-12 px-3.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-[15px] text-slate-900 dark:text-white outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-[14px] font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                  Date of Birth *
                </label>
                <input
                  type="date"
                  required
                  value={studentForm.dob}
                  onChange={e => setStudentForm({ ...studentForm, dob: e.target.value })}
                  className="w-full h-12 px-3.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-[15px] text-slate-900 dark:text-white outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-[14px] font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                  Email
                </label>
                <input
                  type="email"
                  value={studentForm.email}
                  onChange={e => setStudentForm({ ...studentForm, email: e.target.value })}
                  placeholder="Enter email address"
                  className="w-full h-12 px-3.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-[15px] text-slate-900 dark:text-white outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-[14px] font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                  Phone
                </label>
                <input
                  type="text"
                  value={studentForm.phone}
                  onChange={e => setStudentForm({ ...studentForm, phone: e.target.value })}
                  placeholder="Enter phone number"
                  className="w-full h-12 px-3.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-[15px] text-slate-900 dark:text-white outline-none focus:border-blue-500"
                />
              </div>
            </div>
          </FormSection>

          <FormSection title="Academic Program & Enrollment">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <div>
                <label className="block text-[14px] font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                  Course / Program *
                </label>
                <SearchableSelect
                  required
                  value={studentForm.course}
                  onChange={val => setStudentForm({ ...studentForm, course: val })}
                  options={courseOptions}
                  placeholder="Select course / program"
                  emptyMessage="No courses available."
                  isLoading={isLoadingData}
                  error={loadError}
                />
              </div>
              <div>
                <label className="block text-[14px] font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                  Department *
                </label>
                <SearchableSelect
                  required
                  value={studentForm.department}
                  onChange={val => setStudentForm({ ...studentForm, department: val })}
                  options={departmentOptions}
                  placeholder="Select department"
                  emptyMessage="No departments available."
                  isLoading={isLoadingData}
                  error={loadError}
                />
              </div>
              <div>
                <label className="block text-[14px] font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                  Academic Year
                </label>
                <Select
                  value={studentForm.academicYear}
                  onChange={val => setStudentForm({ ...studentForm, academicYear: val })}
                  options={academicYearOptions}
                  placeholder="Select academic year"
                  emptyMessage="No academic years available."
                  isLoading={isLoadingData}
                  error={loadError}
                />
              </div>
              <div>
                <label className="block text-[14px] font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                  Semester
                </label>
                <Select
                  value={studentForm.semester}
                  onChange={val => setStudentForm({ ...studentForm, semester: val })}
                  options={semesterOptions}
                  placeholder="Select semester"
                  emptyMessage="No semesters available."
                  isLoading={isLoadingData}
                  error={loadError}
                />
              </div>
              <div>
                <label className="block text-[14px] font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                  Section / Batch
                </label>
                <Select
                  value={studentForm.section}
                  onChange={val => setStudentForm({ ...studentForm, section: val })}
                  options={sectionOptions}
                  placeholder="Select section / batch"
                  emptyMessage="No sections available."
                  isLoading={isLoadingData}
                  error={loadError}
                />
              </div>
            </div>
          </FormSection>

          <FormSection title="Faculty Mentor Assignment">
            <div>
              <label className="block text-[14px] font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                Assigned Teacher
              </label>
              <SearchableSelect
                value={studentForm.assignedTeacherId}
                onChange={val =>
                  setStudentForm({ ...studentForm, assignedTeacherId: val })
                }
                options={teacherOptions}
                placeholder="Search and select faculty advisor"
                emptyMessage="No teachers available."
                isLoading={isLoadingData}
                error={loadError}
              />
            </div>
          </FormSection>
        </form>
      </Modal>

      {/* TEACHER DETAIL MODAL */}
      {(selectedTeacherDetails || isLoadingTeacherDetails) && (
        <Modal
          isOpen={!!(selectedTeacherDetails || isLoadingTeacherDetails)}
          onClose={() => setSelectedTeacherDetails(null)}
          size="large"
          title={
            <div className="flex items-center gap-2.5">
              <span>Teacher Profile & Activity Details</span>
              {selectedTeacherDetails && (
                <span className="font-mono text-[13px] font-medium px-2.5 py-0.5 rounded-md bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 tabular-nums">
                  {selectedTeacherDetails.teacher.userId}
                </span>
              )}
            </div>
          }
          footer={
            <div className="flex justify-end w-full">
              <button
                type="button"
                onClick={() => setSelectedTeacherDetails(null)}
                className="h-10 px-5 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 text-[14px] font-medium text-slate-700 dark:text-slate-200 transition-colors"
              >
                Close
              </button>
            </div>
          }
        >
          {isLoadingTeacherDetails || !selectedTeacherDetails ? (
            <div className="py-12 text-center text-[15px] text-slate-500">
              Loading teacher details...
            </div>
          ) : (
            <div className="space-y-6">
                {/* 1. Summary / KSI Cards */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5">
                  <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/60">
                    <span className="text-[12px] font-medium text-slate-500 block">Teacher ID</span>
                    <span className="font-mono text-[16px] font-semibold text-blue-600 dark:text-blue-400 tabular-nums">
                      {selectedTeacherDetails.teacher.userId || selectedTeacherDetails.teacher.id}
                    </span>
                  </div>
                  <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/60">
                    <span className="text-[12px] font-medium text-slate-500 block">Account Status</span>
                    <span
                      className={`inline-block mt-0.5 px-2 py-0.5 rounded text-[12px] font-semibold ${
                        selectedTeacherDetails.teacher.status === 'ACTIVE'
                          ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                          : 'bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-300'
                      }`}
                    >
                      {selectedTeacherDetails.teacher.status}
                    </span>
                  </div>
                  <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/60">
                    <span className="text-[12px] font-medium text-slate-500 block">Students Supervised</span>
                    <span className="text-[20px] font-semibold text-slate-900 dark:text-white tabular-nums">
                      {(selectedTeacherDetails.assignedStudents || []).length}
                    </span>
                  </div>
                  <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/60">
                    <span className="text-[12px] font-medium text-slate-500 block">Department</span>
                    <span className="text-[14px] font-semibold text-slate-900 dark:text-white truncate block">
                      {selectedTeacherDetails.teacher.department || 'General'}
                    </span>
                  </div>
                </div>

                {/* 2. Personal Details */}
                <div className="border border-slate-200 dark:border-slate-700 rounded-xl p-4 bg-white dark:bg-slate-800">
                  <h4 className="text-[14px] font-semibold text-slate-900 dark:text-white mb-3 flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-blue-600" /> Personal Details
                  </h4>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-[13.5px]">
                    <div>
                      <span className="text-[12px] text-slate-400 block">Full Name</span>
                      <span className="font-medium text-slate-900 dark:text-white">
                        {selectedTeacherDetails.teacher.name}
                      </span>
                    </div>
                    <div>
                      <span className="text-[12px] text-slate-400 block">Email</span>
                      <span className="font-medium text-slate-700 dark:text-slate-300">
                        {selectedTeacherDetails.teacher.email || '—'}
                      </span>
                    </div>
                    <div>
                      <span className="text-[12px] text-slate-400 block">Phone</span>
                      <span className="font-medium text-slate-700 dark:text-slate-300 tabular-nums">
                        {selectedTeacherDetails.teacher.phone || '—'}
                      </span>
                    </div>
                    <div>
                      <span className="text-[12px] text-slate-400 block">Date of Birth</span>
                      <span className="font-medium text-slate-700 dark:text-slate-300 tabular-nums">
                        {selectedTeacherDetails.teacher.dob || '—'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* 3. Professional Details */}
                <div className="border border-slate-200 dark:border-slate-700 rounded-xl p-4 bg-white dark:bg-slate-800">
                  <h4 className="text-[14px] font-semibold text-slate-900 dark:text-white mb-3 flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-indigo-600" /> Professional Details
                  </h4>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-[13.5px]">
                    <div>
                      <span className="text-[12px] text-slate-400 block">Department</span>
                      <span className="font-medium text-slate-800 dark:text-slate-200">
                        {selectedTeacherDetails.teacher.department || '—'}
                      </span>
                    </div>
                    <div>
                      <span className="text-[12px] text-slate-400 block">Designation</span>
                      <span className="font-medium text-slate-800 dark:text-slate-200">
                        {selectedTeacherDetails.teacher.designation || 'Faculty'}
                      </span>
                    </div>
                    <div>
                      <span className="text-[12px] text-slate-400 block">Qualification</span>
                      <span className="font-medium text-slate-800 dark:text-slate-200">
                        {selectedTeacherDetails.teacher.qualification || '—'}
                      </span>
                    </div>
                    <div>
                      <span className="text-[12px] text-slate-400 block">Experience</span>
                      <span className="font-medium text-slate-800 dark:text-slate-200 tabular-nums">
                        {selectedTeacherDetails.teacher.experienceYears || selectedTeacherDetails.teacher.experience || 0} years
                      </span>
                    </div>
                  </div>
                </div>

                {/* 4. Account Details */}
                <div className="border border-slate-200 dark:border-slate-700 rounded-xl p-4 bg-white dark:bg-slate-800">
                  <h4 className="text-[14px] font-semibold text-slate-900 dark:text-white mb-3 flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-600" /> Account Details
                  </h4>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-[13.5px]">
                    <div>
                      <span className="text-[12px] text-slate-400 block">User Role</span>
                      <span className="font-medium text-slate-800 dark:text-slate-200">
                        {selectedTeacherDetails.teacher.role || 'TEACHER'}
                      </span>
                    </div>
                    <div>
                      <span className="text-[12px] text-slate-400 block">Account Status</span>
                      <span className="font-medium text-slate-800 dark:text-slate-200">
                        {selectedTeacherDetails.teacher.status}
                      </span>
                    </div>
                    <div>
                      <span className="text-[12px] text-slate-400 block">Created On</span>
                      <span className="font-medium text-slate-700 dark:text-slate-300 tabular-nums">
                        {selectedTeacherDetails.teacher.createdAt
                          ? new Date(selectedTeacherDetails.teacher.createdAt).toLocaleDateString()
                          : '—'}
                      </span>
                    </div>
                    <div>
                      <span className="text-[12px] text-slate-400 block">Provisioned By</span>
                      <span className="font-mono text-slate-700 dark:text-slate-300 tabular-nums">
                        {selectedTeacherDetails.teacher.createdBy || 'ADMIN'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* 5. Academic & Assignment Summary */}
                {/* Assigned Students Table */}
                <div>
                  <h4 className="text-[14px] font-semibold text-slate-900 dark:text-white mb-2">
                    Assigned Students ({(selectedTeacherDetails.assignedStudents || []).length})
                  </h4>
                  <div className="border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden">
                    <table className="w-full text-left border-collapse text-[13px]">
                      <thead>
                        <tr className="bg-slate-50 dark:bg-slate-900/50 text-slate-500 text-[12px] font-semibold">
                          <th className="py-2 px-3">Student ID</th>
                          <th className="py-2 px-3">Name</th>
                          <th className="py-2 px-3">Course / Dept</th>
                          <th className="py-2 px-3">Year</th>
                          <th className="py-2 px-3">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
                        {(selectedTeacherDetails.assignedStudents || []).map(s => (
                          <tr key={s.userId || s.id}>
                            <td className="py-2 px-3 font-mono font-medium text-blue-600 dark:text-blue-400 tabular-nums">
                              {s.userId || s.id}
                            </td>
                            <td className="py-2 px-3 font-medium text-slate-900 dark:text-white">
                              {s.name}
                            </td>
                            <td className="py-2 px-3 text-slate-600 dark:text-slate-300">
                              {s.course || '—'} ({s.department || '—'})
                            </td>
                            <td className="py-2 px-3 text-slate-500">{s.academicYear || s.semester || '—'}</td>
                            <td className="py-2 px-3">
                              <span
                                className={`px-2 py-0.5 rounded text-[11px] font-medium ${
                                  s.status === 'ACTIVE'
                                    ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
                                    : 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300'
                                }`}
                              >
                                {s.status}
                              </span>
                            </td>
                          </tr>
                        ))}
                        {(!selectedTeacherDetails.assignedStudents || selectedTeacherDetails.assignedStudents.length === 0) && (
                          <tr>
                            <td colSpan={5} className="py-4 text-center text-slate-400 text-[13px]">
                              No students currently assigned to this teacher.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Created Exams Table */}
                <div>
                  <h4 className="text-[14px] font-semibold text-slate-900 dark:text-white mb-2">
                    Created Examinations ({(selectedTeacherDetails.createdExams || []).length})
                  </h4>
                  <div className="border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden">
                    <table className="w-full text-left border-collapse text-[13px]">
                      <thead>
                        <tr className="bg-slate-50 dark:bg-slate-900/50 text-slate-500 text-[12px] font-semibold">
                          <th className="py-2 px-3">Title</th>
                          <th className="py-2 px-3">Subject</th>
                          <th className="py-2 px-3">Date & Time</th>
                          <th className="py-2 px-3">Marks</th>
                          <th className="py-2 px-3">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
                        {(selectedTeacherDetails.createdExams || []).map(ex => (
                          <tr key={ex.examId || ex.id}>
                            <td className="py-2 px-3 font-medium text-slate-900 dark:text-white">
                              {ex.title}
                            </td>
                            <td className="py-2 px-3 text-slate-600 dark:text-slate-300">
                              {ex.subjectTitle || ex.subject}
                            </td>
                            <td className="py-2 px-3 text-slate-500 tabular-nums">
                              {ex.scheduledDate || 'Flexible'} {ex.startTime || ''}
                            </td>
                            <td className="py-2 px-3 text-slate-600 dark:text-slate-300 tabular-nums">
                              {ex.totalMarks}
                            </td>
                            <td className="py-2 px-3">
                              <span className="px-2 py-0.5 rounded text-[11.5px] font-medium bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
                                {ex.status}
                              </span>
                            </td>
                          </tr>
                        ))}
                        {(!selectedTeacherDetails.createdExams || selectedTeacherDetails.createdExams.length === 0) && (
                          <tr>
                            <td colSpan={5} className="py-4 text-center text-slate-400 text-[13px]">
                              No examinations created by this teacher yet.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}
        </Modal>
      )}

      {/* STUDENT DETAIL MODAL */}
      {(selectedStudentDetails || isLoadingStudentDetails) && (
        <Modal
          isOpen={!!(selectedStudentDetails || isLoadingStudentDetails)}
          onClose={() => setSelectedStudentDetails(null)}
          size="large"
          title={
            <div className="flex items-center gap-2.5">
              <span>Student Academic & Assessment Profile</span>
              {selectedStudentDetails && (
                <span className="font-mono text-[13px] font-medium px-2.5 py-0.5 rounded-md bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 tabular-nums">
                  {selectedStudentDetails.student.userId}
                </span>
              )}
            </div>
          }
          footer={
            <div className="flex justify-end w-full">
              <button
                type="button"
                onClick={() => setSelectedStudentDetails(null)}
                className="h-10 px-5 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 text-[14px] font-medium text-slate-700 dark:text-slate-200 transition-colors"
              >
                Close
              </button>
            </div>
          }
        >
          {isLoadingStudentDetails || !selectedStudentDetails ? (
            <div className="py-12 text-center text-[15px] text-slate-500">
              Loading student details...
            </div>
          ) : (
            <div className="space-y-6">
                {/* Profile Summary Grid */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 bg-slate-50 dark:bg-slate-900/60 p-4 rounded-xl border border-slate-200 dark:border-slate-700 text-[14px]">
                  <div>
                    <span className="text-[13px] text-slate-400 block">Full Name</span>
                    <span className="font-semibold text-slate-900 dark:text-white text-[15px]">
                      {selectedStudentDetails.student.name}
                    </span>
                  </div>
                  <div>
                    <span className="text-[13px] text-slate-400 block">Course / Program</span>
                    <span className="font-medium text-slate-800 dark:text-slate-200">
                      {selectedStudentDetails.student.course || '—'}
                    </span>
                  </div>
                  <div>
                    <span className="text-[13px] text-slate-400 block">Department</span>
                    <span className="font-medium text-slate-800 dark:text-slate-200">
                      {selectedStudentDetails.student.department || '—'}
                    </span>
                  </div>
                  <div>
                    <span className="text-[13px] text-slate-400 block">Academic Year</span>
                    <span className="font-medium text-slate-800 dark:text-slate-200">
                      {selectedStudentDetails.student.academicYear || '—'}
                    </span>
                  </div>
                  <div>
                    <span className="text-[13px] text-slate-400 block">Email</span>
                    <span className="font-medium text-slate-700 dark:text-slate-300">
                      {selectedStudentDetails.student.email || '—'}
                    </span>
                  </div>
                  <div>
                    <span className="text-[13px] text-slate-400 block">Phone</span>
                    <span className="font-medium text-slate-700 dark:text-slate-300 tabular-nums">
                      {selectedStudentDetails.student.phone || '—'}
                    </span>
                  </div>
                  <div>
                    <span className="text-[13px] text-slate-400 block">Date of Birth</span>
                    <span className="font-medium text-slate-700 dark:text-slate-300 tabular-nums">
                      {selectedStudentDetails.student.dob || '—'}
                    </span>
                  </div>
                  <div>
                    <span className="text-[13px] text-slate-400 block">Assigned Teacher</span>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="font-medium text-blue-600 dark:text-blue-400">
                        {selectedStudentDetails.assignedTeacher
                          ? `${selectedStudentDetails.assignedTeacher.name} (${selectedStudentDetails.assignedTeacher.userId})`
                          : selectedStudentDetails.student.assignedTeacherId || 'Unassigned'}
                      </span>
                      {selectedStudentDetails.assignedTeacher && (
                        <button
                          type="button"
                          onClick={() => {
                            confirmAction({
                              title: 'Remove Assignment',
                              message: `Are you sure you want to remove ${selectedStudentDetails.student.name} from teacher supervision?`,
                              confirmLabel: 'Yes, Remove',
                              cancelLabel: 'No',
                              variant: 'danger',
                              details: [
                                { label: 'Student', value: selectedStudentDetails.student.name },
                                { label: 'Current Supervisor', value: selectedStudentDetails.assignedTeacher.name }
                              ],
                              consequence: 'This student will no longer be under faculty supervision for this teacher.',
                              action: async () => {
                                const studentId = selectedStudentDetails.student.userId || selectedStudentDetails.student.id;
                                await dbService.updateStudent(studentId, { managedBy: [] });
                                const refreshed = await dbService.getStudentDetails(studentId);
                                setSelectedStudentDetails(refreshed);
                                await loadDirectoryAndLogs();
                                setFeedbackBanner({
                                  type: 'success',
                                  message: `Removed faculty supervision for ${refreshed.student.name}.`
                                });
                              }
                            });
                          }}
                          className="text-[12px] text-red-600 dark:text-red-400 hover:underline font-medium ml-1"
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  </div>
                  <div>
                    <span className="text-[13px] text-slate-400 block">Status</span>
                    <span
                      className={`inline-block mt-0.5 px-2.5 py-0.5 rounded-md text-[12.5px] font-medium ${
                        selectedStudentDetails.student.status === 'ACTIVE'
                          ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
                          : 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300'
                      }`}
                    >
                      {selectedStudentDetails.student.status}
                    </span>
                  </div>
                  <div>
                    <span className="text-[13px] text-slate-400 block">Semester</span>
                    <span className="font-medium text-slate-800 dark:text-slate-200">
                      {selectedStudentDetails.student.semester || '—'}
                    </span>
                  </div>
                  <div>
                    <span className="text-[13px] text-slate-400 block">Section / Batch</span>
                    <span className="font-medium text-slate-800 dark:text-slate-200">
                      {selectedStudentDetails.student.section || '—'}
                    </span>
                  </div>
                  <div>
                    <span className="text-[13px] text-slate-400 block">Enrollment No</span>
                    <span className="font-mono text-slate-700 dark:text-slate-300 tabular-nums">
                      {selectedStudentDetails.student.enrollmentNo || '—'}
                    </span>
                  </div>
                  <div>
                    <span className="text-[13px] text-slate-400 block">Created On</span>
                    <span className="font-medium text-slate-700 dark:text-slate-300 tabular-nums">
                      {selectedStudentDetails.student.createdAt
                        ? new Date(selectedStudentDetails.student.createdAt).toLocaleDateString()
                        : '—'}
                    </span>
                  </div>
                </div>

                {/* KPI Metrics */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5">
                  <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
                    <div className="text-[13.5px] font-medium text-slate-500">Exams Taken</div>
                    <div className={`${getKpiPrimaryValueClass(selectedStudentDetails.kpis.examsTakenCount)} text-blue-600 dark:text-blue-400 mt-1 tabular-nums`}>
                      {selectedStudentDetails.kpis.examsTakenCount}
                    </div>
                  </div>
                  <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
                    <div className="text-[13.5px] font-medium text-slate-500">Average Percentage</div>
                    <div className={`${getKpiPrimaryValueClass(`${selectedStudentDetails.kpis.averagePercentage}%`)} text-emerald-600 dark:text-emerald-400 mt-1 tabular-nums`}>
                      {selectedStudentDetails.kpis.averagePercentage}%
                    </div>
                  </div>
                  <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
                    <div className="text-[13.5px] font-medium text-slate-500">Published Results</div>
                    <div className={`${getKpiPrimaryValueClass(selectedStudentDetails.kpis.publishedResultsCount)} text-indigo-600 dark:text-indigo-400 mt-1 tabular-nums`}>
                      {selectedStudentDetails.kpis.publishedResultsCount}
                    </div>
                  </div>
                  <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
                    <div className="text-[13.5px] font-medium text-slate-500">Queries Raised</div>
                    <div className={`${getKpiPrimaryValueClass(selectedStudentDetails.kpis.queriesCount)} text-amber-600 dark:text-amber-400 mt-1 tabular-nums`}>
                      {selectedStudentDetails.kpis.queriesCount}
                    </div>
                  </div>
                </div>

                {/* Results Table */}
                <div>
                  <h4 className="text-[15px] font-semibold text-slate-900 dark:text-white mb-2.5">
                    Examination Results ({selectedStudentDetails.results.length})
                  </h4>
                  <div className="border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden">
                    <table className="w-full text-left border-collapse text-[14px]">
                      <thead>
                        <tr className="bg-slate-50 dark:bg-slate-900/50 text-slate-500 text-[13px] font-semibold">
                          <th className="py-2.5 px-3.5">Subject</th>
                          <th className="py-2.5 px-3.5">Score</th>
                          <th className="py-2.5 px-3.5">Grade</th>
                          <th className="py-2.5 px-3.5">Status</th>
                          <th className="py-2.5 px-3.5">Date</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
                        {selectedStudentDetails.results.map(r => (
                          <tr key={r.id}>
                            <td className="py-2.5 px-3.5 font-medium text-slate-900 dark:text-white">
                              {r.subjectTitle}
                            </td>
                            <td className="py-2.5 px-3.5 font-semibold text-slate-800 dark:text-slate-200 tabular-nums">
                              {r.score} / {r.totalMarks} ({r.percentage}%)
                            </td>
                            <td className="py-2.5 px-3.5 font-semibold text-blue-600 dark:text-blue-400">
                              {r.grade}
                            </td>
                            <td className="py-2.5 px-3.5">
                              <span
                                className={`px-2 py-0.5 rounded-md text-[12.5px] font-medium ${
                                  r.status === 'PUBLISHED'
                                    ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
                                    : 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
                                }`}
                              >
                                {r.status}
                              </span>
                            </td>
                            <td className="py-2.5 px-3.5 text-slate-500 tabular-nums">
                              {r.evaluatedAt ? new Date(r.evaluatedAt).toLocaleDateString() : '—'}
                            </td>
                          </tr>
                        ))}
                        {selectedStudentDetails.results.length === 0 && (
                          <tr>
                            <td colSpan={5} className="py-5 text-center text-slate-400 text-[14px]">
                              No examination results recorded for this student yet.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Exam Summary / Assigned Exams */}
                <div>
                  <h4 className="text-[15px] font-semibold text-slate-900 dark:text-white mb-2.5">
                    Assigned Examinations ({selectedStudentDetails.recentExams?.length || 0})
                  </h4>
                  <div className="border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden">
                    <table className="w-full text-left border-collapse text-[14px]">
                      <thead>
                        <tr className="bg-slate-50 dark:bg-slate-900/50 text-slate-500 text-[13px] font-semibold">
                          <th className="py-2.5 px-3.5">Exam Title</th>
                          <th className="py-2.5 px-3.5">Subject</th>
                          <th className="py-2.5 px-3.5">Duration</th>
                          <th className="py-2.5 px-3.5">Total Marks</th>
                          <th className="py-2.5 px-3.5">Exam Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
                        {(selectedStudentDetails.recentExams || []).map(ex => (
                          <tr key={ex.id}>
                            <td className="py-2.5 px-3.5 font-medium text-slate-900 dark:text-white">
                              {ex.title}
                            </td>
                            <td className="py-2.5 px-3.5 text-slate-600 dark:text-slate-300">
                              {ex.subject}
                            </td>
                            <td className="py-2.5 px-3.5 text-slate-500 tabular-nums">
                              {ex.durationMinutes} mins
                            </td>
                            <td className="py-2.5 px-3.5 text-slate-600 dark:text-slate-300 tabular-nums">
                              {ex.totalMarks}
                            </td>
                            <td className="py-2.5 px-3.5">
                              <span className="px-2 py-0.5 rounded-md text-[12.5px] font-medium bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
                                {ex.status}
                              </span>
                            </td>
                          </tr>
                        ))}
                        {(!selectedStudentDetails.recentExams || selectedStudentDetails.recentExams.length === 0) && (
                          <tr>
                            <td colSpan={5} className="py-5 text-center text-slate-400 text-[14px]">
                              No assigned examinations found for this student.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}
        </Modal>
      )}

      {/* GENERATED CREDENTIALS MODAL */}
      {createdCredentials && (
        <Modal
          isOpen={!!createdCredentials}
          onClose={() => {
            setCreatedCredentials(null);
            setCopiedCredentialKey(null);
          }}
          size="compact"
          title={`${createdCredentials.roleLabel} Credentials Generated`}
          subtitle={createdCredentials.name}
          footer={
            <div className="flex items-center gap-3 w-full">
              <button
                type="button"
                onClick={() =>
                  handleCopyCredential(
                    `${createdCredentials.roleLabel} ID: ${createdCredentials.userId}\nInitial Password: ${createdCredentials.temporaryPassword}`,
                    'all'
                  )
                }
                className="flex-1 h-11 rounded-lg border border-slate-200 dark:border-slate-700 text-[14.5px] font-medium text-slate-700 dark:text-slate-300 flex items-center justify-center gap-2 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
              >
                {copiedCredentialKey === 'all' ? (
                  <>
                    <CheckCircle className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                    Copied
                  </>
                ) : (
                  <>
                    <Copy className="w-4 h-4" />
                    Copy
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={() => {
                  setCreatedCredentials(null);
                  setCopiedCredentialKey(null);
                }}
                className="flex-1 h-11 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-[14.5px] font-medium inline-flex items-center justify-center shadow-sm transition-colors"
              >
                Done
              </button>
            </div>
          }
        >
          <div className="bg-slate-50 dark:bg-slate-900 rounded-xl p-4 space-y-3.5 border border-slate-200 dark:border-slate-700">
            <div className="flex justify-between items-center">
              <div>
                <span className="text-[13.5px] text-slate-500 block">
                  {createdCredentials.roleLabel} ID
                </span>
                <span className="font-mono text-[15px] font-semibold text-blue-600 dark:text-blue-400 tabular-nums">
                  {createdCredentials.userId}
                </span>
              </div>
              <button
                type="button"
                onClick={() => handleCopyCredential(createdCredentials.userId, 'userId')}
                className={`h-9 px-3 rounded-lg border text-[13px] font-medium inline-flex items-center gap-1.5 transition-colors ${
                  copiedCredentialKey === 'userId'
                    ? 'border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300'
                    : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
                title={`Copy ${createdCredentials.roleLabel} ID`}
              >
                {copiedCredentialKey === 'userId' ? (
                  <>
                    <CheckCircle className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                    Copied
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    Copy
                  </>
                )}
              </button>
            </div>
            <div className="flex justify-between items-center pt-3 border-t border-slate-200/70 dark:border-slate-800">
              <div>
                <span className="text-[13.5px] text-slate-500 block">Initial Password</span>
                <span className="font-mono text-[15px] font-semibold text-emerald-600 dark:text-emerald-400">
                  {createdCredentials.temporaryPassword}
                </span>
              </div>
              <button
                type="button"
                onClick={() =>
                  handleCopyCredential(createdCredentials.temporaryPassword, 'password')
                }
                className={`h-9 px-3 rounded-lg border text-[13px] font-medium inline-flex items-center gap-1.5 transition-colors ${
                  copiedCredentialKey === 'password'
                    ? 'border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300'
                    : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
                title="Copy Initial Password"
              >
                {copiedCredentialKey === 'password' ? (
                  <>
                    <CheckCircle className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                    Copied
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    Copy
                  </>
                )}
              </button>
            </div>
          </div>
          <p className="text-[13px] text-slate-500 dark:text-slate-400 mt-3 text-center">
            Save these credentials securely. The user must change their password upon initial sign in.
          </p>
        </Modal>
      )}

      {/* PASSWORD RESET MODAL */}
      {resetTarget && (
        <Modal
          isOpen={!!resetTarget}
          onClose={() => setResetTarget(null)}
          size="compact"
          title="Reset Password"
          subtitle={`${resetTarget.user.name} (${resetTarget.user.userId || resetTarget.user.id})`}
          footer={
            <div className="flex items-center justify-end gap-3 w-full">
              <button
                type="button"
                onClick={() => setResetTarget(null)}
                className="h-11 px-4 rounded-lg text-[14.5px] font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 inline-flex items-center justify-center transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                form="reset-password-form"
                className="h-11 px-5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-[14.5px] font-medium inline-flex items-center justify-center shadow-sm transition-colors"
              >
                Save Password
              </button>
            </div>
          }
        >
          {resetMessage && (
            <div className="mb-4 p-3 rounded-lg bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 text-[14px] font-medium">
              {resetMessage}
            </div>
          )}
          <form id="reset-password-form" onSubmit={handleResetPassword} className="space-y-4">
            <div>
              <label className="block text-[14px] font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                New Temporary Password *
              </label>
              <input
                type="text"
                required
                minLength={6}
                placeholder="Enter new password (min 6 characters)"
                value={resetTarget.newPassword}
                onChange={e => setResetTarget({ ...resetTarget, newPassword: e.target.value })}
                className="w-full h-12 px-3.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-[15px] text-slate-900 dark:text-white outline-none focus:border-blue-500"
              />
            </div>
          </form>
        </Modal>
      )}

      <QuestionDetailModal
        question={selectedQuestionDetail}
        onClose={() => setSelectedQuestionDetail(null)}
      />
      <ResultDetailModal
        result={selectedResultDetail}
        onClose={() => setSelectedResultDetail(null)}
      />
      <QueryDetailModal
        query={selectedQueryDetail}
        onClose={() => setSelectedQueryDetail(null)}
      />
      <ProctoringDetailModal
        event={selectedProctoringDetail}
        onClose={() => setSelectedProctoringDetail(null)}
        onTerminateAttempt={handleTerminateAttempt}
      />
      <AuditDetailModal
        log={selectedAuditDetail}
        onClose={() => setSelectedAuditDetail(null)}
      />
      <ConfirmModal />
    </div>
  );
};
