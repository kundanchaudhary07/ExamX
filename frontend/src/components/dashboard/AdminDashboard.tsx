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
import {
  dbService,
  mapBackendQuestionToFrontend,
  mapBackendUserToSystemUser
} from '../../services/dbService';
import { realtimeService } from '../../services/realtimeService';
import { AiGenerationBatchCards } from './AiGenerationBatchCards';
import { ProctoringExamInsightsModal } from './ProctoringExamInsightsModal';
import StudentAssessmentSections from './StudentAssessmentSections';
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
  onStatusChange?: (
    examId: string,
    status: Parameters<typeof dbService.updateExamStatus>[1],
    publishResults?: boolean
  ) => Promise<void> | void;
  onResolveQuery: (queryId: string, response: string, status?: 'RESOLVED' | 'REJECTED') => Promise<void> | void;
  onRefreshGlobalData?: () => Promise<boolean | void> | void;
  onRefreshExamData?: (user: User) => Promise<boolean>;
}

export const AdminDashboard: React.FC<AdminDashboardProps> = ({
  user,
  activeTab,
  onNavigateTab,
  exams,
  onSaveExam,
  onDeleteExam,
  onPublishResult,
  onStatusChange,
  onResolveQuery,
  onRefreshGlobalData
}) => {
  const [teachers, setTeachers] = useState<SystemUser[]>([]);
  const [students, setStudents] = useState<SystemUser[]>([]);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [aiGenerationBatches, setAiGenerationBatches] = useState<AiGenerationBatch[]>([]);
  const [proctoringEvents, setProctoringEvents] = useState<ProctoringEventRecord[]>([]);
  const [attempts, setAttempts] = useState<ExamAttemptRecord[]>([]);
  const [selectedResultExamId, setSelectedResultExamId] = useState<string | null>(null);
  const [resultsExamSearch, setResultsExamSearch] = useState('');
  const [resultRecordSearch, setResultRecordSearch] = useState('');
  const [resultExamStatusFilter, setResultExamStatusFilter] = useState('ALL');
  const [examResults, setExamResults] = useState<StudentResult[]>([]);
  const [isLoadingResults, setIsLoadingResults] = useState(false);
  const [resultsPage, setResultsPage] = useState(1);
  const [selectedQueryExamId, setSelectedQueryExamId] = useState<string | null>(null);
  const [queriesExamSearch, setQueriesExamSearch] = useState('');
  const [queryRecordSearch, setQueryRecordSearch] = useState('');
  const [queryExamStatusFilter, setQueryExamStatusFilter] = useState('ALL');
  const [examQueries, setExamQueries] = useState<StudentQuery[]>([]);
  const [isLoadingQueries, setIsLoadingQueries] = useState(false);
  const [queriesPage, setQueriesPage] = useState(1);
  const [isLoadingMonitoring, setIsLoadingMonitoring] = useState(false);
  const [monitoringError, setMonitoringError] = useState<string | null>(null);
  const [monitoringResults, setMonitoringResults] = useState<StudentResult[]>([]);
  const [monitoringSearchTerm, setMonitoringSearchTerm] = useState('');
  const [showMonitoringInsights, setShowMonitoringInsights] = useState(false);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [healthStatus, setHealthStatus] = useState<{ status: string; database: string } | null>(null);
  const { confirmAction, ConfirmModal } = useConfirmAction();

  const [isLoadingData, setIsLoadingData] = useState(true);
  const refreshInProgressRef = React.useRef(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [queryStatusFilter, setQueryStatusFilter] = useState<'ALL' | 'PENDING' | 'RESOLVED'>('ALL');
  const [resultStatusFilter, setResultStatusFilter] = useState<'ALL' | 'PUBLISHED' | 'PENDING'>('ALL');

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
  const [selectedProctoringExamId, setSelectedProctoringExamId] = useState<string | null>(null);
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

  const loadDirectoryAndLogs = useCallback(async (showLoading = true): Promise<boolean> => {
    if (showLoading) setIsLoadingData(true);
    setLoadError(null);
    try {
      const [teacherList, studentList, questionList, logs, health, generationBatches] = await Promise.all([
        dbService.getTeachers(),
        dbService.getStudents(),
        dbService.getQuestions().catch(() => []),
        dbService.getAuditLogs({ limit: 100 }).catch(() => []),
        fetch('/api/health')
          .then(r => r.json())
          .catch(() => ({ status: 'healthy', database: 'connected' })),
        dbService.getAiGenerationBatches()
      ]);
      setTeachers(teacherList);
      setStudents(studentList);
      setQuestions(questionList);
      setAiGenerationBatches(generationBatches);
      setAuditLogs(logs);
      setHealthStatus({
        status: health?.status || 'healthy',
        database: health?.database || 'connected'
      });
      return true;
    } catch (err: any) {
      setLoadError(err.message || 'Unable to load dashboard data.');
      return false;
    } finally {
      if (showLoading) setIsLoadingData(false);
    }
  }, []);

  const refreshExamMonitoringData = useCallback(async (examId: string): Promise<boolean> => {
    setMonitoringError(null);
    try {
      const [attemptList, proctorList, resultList] = await Promise.all([
        dbService.getAttempts(examId),
        dbService.getProctoringEvents({ examId }),
        dbService.getResults(examId).catch(() => [])
      ]);
      setAttempts(attemptList);
      setProctoringEvents(proctorList);
      setMonitoringResults(resultList);
      return true;
    } catch (error: any) {
      setMonitoringError(error?.message || 'Unable to refresh examination monitoring data.');
      return false;
    }
  }, []);

  const handleManualRefresh = async () => {
    if (refreshInProgressRef.current) return;
    refreshInProgressRef.current = true;
    try {
      if (activeTab === 'results' && selectedResultExamId) {
        setIsLoadingResults(true);
        try {
          const resultList = await dbService.getResults(selectedResultExamId);
          setExamResults(resultList.filter(result => result.examId === selectedResultExamId));
        } catch (error: any) {
          setLoadError(error?.message || 'Unable to refresh results for this exam.');
        } finally {
          setIsLoadingResults(false);
        }
        return;
      }
      if (activeTab === 'queries' && selectedQueryExamId) {
        setIsLoadingQueries(true);
        try {
          const queryList = await dbService.getQueries({ examId: selectedQueryExamId });
          setExamQueries(queryList.filter(query => query.examId === selectedQueryExamId));
        } catch (error: any) {
          setLoadError(error?.message || 'Unable to refresh queries for this exam.');
        } finally {
          setIsLoadingQueries(false);
        }
        return;
      }
      if ((activeTab === 'proctoring' || activeTab === 'monitoring_history') && selectedProctoringExamId) {
        await refreshExamMonitoringData(selectedProctoringExamId);
        return;
      }
      const [directoryRefreshed, examsRefreshed] = await Promise.all([
        loadDirectoryAndLogs(),
        onRefreshGlobalData?.()
      ]);
      if (!directoryRefreshed || examsRefreshed === false) return;
    } finally {
      refreshInProgressRef.current = false;
    }
  };

  useEffect(() => {
    if (
      activeTab !== 'proctoring' ||
      !selectedProctoringExamId
    ) {
      return;
    }
    const interval = window.setInterval(() => {
      if (refreshInProgressRef.current || realtimeService.isConnected()) return;
      refreshInProgressRef.current = true;
      void refreshExamMonitoringData(selectedProctoringExamId)
        .finally(() => { refreshInProgressRef.current = false; });
    }, 5000);
    return () => window.clearInterval(interval);
  }, [activeTab, refreshExamMonitoringData, selectedProctoringExamId]);

  useEffect(() => {
    loadDirectoryAndLogs();
  }, [loadDirectoryAndLogs]);

  useEffect(() => {
    const unsub = realtimeService.subscribe(payload => {
      const data = payload.data as Record<string, any> | undefined;
      if (payload.event === 'teacher.updated' && data?.teacher) {
        const teacher = mapBackendUserToSystemUser(data.teacher);
        setTeachers(previous => previous.map(item =>
          (item.userId || item.id) === (teacher.userId || teacher.id) ? teacher : item
        ));
        setSelectedTeacherDetails(previous =>
          previous && (previous.teacher.userId || previous.teacher.id) === (teacher.userId || teacher.id)
            ? { ...previous, teacher }
            : previous
        );
        return;
      }
      if (payload.event === 'student.updated' && data?.student) {
        const student = mapBackendUserToSystemUser(data.student);
        setStudents(previous => previous.map(item =>
          (item.userId || item.id) === (student.userId || student.id) ? student : item
        ));
        setSelectedStudentDetails(previous =>
          previous && (previous.student.userId || previous.student.id) === (student.userId || student.id)
            ? { ...previous, student }
            : previous
        );
        return;
      }
      if (payload.event === 'monitoring.updated' && data?.attempt) {
        const attempt = data.attempt as ExamAttemptRecord;
        if (!selectedProctoringExamId || attempt.examId !== selectedProctoringExamId) return;
        setAttempts(previous => [
          attempt,
          ...previous.filter(item => item.attemptId !== attempt.attemptId)
        ]);
        return;
      }
      if (payload.event === 'attempt.suspended' && data?.attemptId) {
        setAttempts(previous => previous.map(attempt =>
          attempt.attemptId === data.attemptId
            ? {
                ...attempt,
                suspended: true,
                proctoringStatus: 'SUSPENDED',
                warningCount: data.warningCount ?? attempt.warningCount
              }
            : attempt
        ));
        return;
      }
      if (payload.event === 'attempt.resumed' && data?.attemptId) {
        setAttempts(previous => previous.map(attempt =>
          attempt.attemptId === data.attemptId
            ? { ...attempt, suspended: false, proctoringStatus: 'WARNED' }
            : attempt
        ));
        return;
      }
      if (payload.event === 'unblock.updated' && data?.attempt) {
        const attempt = data.attempt as ExamAttemptRecord;
        if (!selectedProctoringExamId || attempt.examId !== selectedProctoringExamId) return;
        setAttempts(previous => [
          attempt,
          ...previous.filter(item => item.attemptId !== attempt.attemptId)
        ]);
        return;
      }
      if (payload.event === 'proctoring.event' && data?.event) {
        const event = data.event as ProctoringEventRecord;
        if (!selectedProctoringExamId || event.examId !== selectedProctoringExamId) return;
        setProctoringEvents(previous => [
          event,
          ...previous.filter(item => item.eventId !== event.eventId)
        ]);
        return;
      }
      if (payload.event === 'audit.created' && data?.log) {
        const log = data.log as AuditLog;
        setAuditLogs(previous => [
          log,
          ...previous.filter(item => item.auditId !== log.auditId)
        ].slice(0, 100));
        return;
      }
      if (payload.event.startsWith('question.')) {
        const questionData = data?.question;
        if (payload.event === 'question.deleted' && data?.questionId) {
          setQuestions(previous => previous.filter(question =>
            question.questionId !== data.questionId && question.id !== data.questionId
          ));
        } else if (questionData) {
          const question = mapBackendQuestionToFrontend(questionData);
          setQuestions(previous => {
            const index = previous.findIndex(item =>
              (item.questionId || item.id) === (question.questionId || question.id)
            );
            if (index < 0) return [question, ...previous];
            const next = [...previous];
            next[index] = question;
            return next;
          });
        }
      }
    });
    return () => unsub();
  }, [selectedProctoringExamId]);

  useEffect(() => {
    if (!['proctoring', 'monitoring_history'].includes(activeTab) || !selectedProctoringExamId) return;
    let active = true;
    setIsLoadingMonitoring(true);
    setMonitoringError(null);
    Promise.all([
      dbService.getAttempts(selectedProctoringExamId),
      dbService.getProctoringEvents({ examId: selectedProctoringExamId }),
      dbService.getResults(selectedProctoringExamId).catch(() => [])
    ])
      .then(([attemptList, eventList, resultList]) => {
        if (!active) return;
        setAttempts(attemptList);
        setProctoringEvents(eventList);
        setMonitoringResults(resultList);
      })
      .catch((error: any) => {
        if (active) setMonitoringError(error?.message || 'Unable to load this exam’s monitoring data.');
      })
      .finally(() => {
        if (active) setIsLoadingMonitoring(false);
      });
    return () => {
      active = false;
    };
  }, [activeTab, selectedProctoringExamId]);

  useEffect(() => {
    if (activeTab !== 'results' || !selectedResultExamId) return;
    let active = true;
    setIsLoadingResults(true);
    setLoadError(null);
    setResultsPage(1);
    dbService.getResults(selectedResultExamId)
      .then(resultList => {
        if (active) setExamResults(resultList.filter(result => result.examId === selectedResultExamId));
      })
      .catch((error: any) => {
        if (active) {
          setExamResults([]);
          setLoadError(error?.message || 'Unable to load results for this exam.');
        }
      })
      .finally(() => {
        if (active) setIsLoadingResults(false);
      });
    return () => {
      active = false;
    };
  }, [activeTab, selectedResultExamId]);

  useEffect(() => {
    if (activeTab !== 'queries' || !selectedQueryExamId) return;
    let active = true;
    setIsLoadingQueries(true);
    setLoadError(null);
    setQueriesPage(1);
    dbService.getQueries({ examId: selectedQueryExamId })
      .then(queryList => {
        if (active) setExamQueries(queryList.filter(query => query.examId === selectedQueryExamId));
      })
      .catch((error: any) => {
        if (active) {
          setExamQueries([]);
          setLoadError(error?.message || 'Unable to load queries for this exam.');
        }
      })
      .finally(() => {
        if (active) setIsLoadingQueries(false);
      });
    return () => {
      active = false;
    };
  }, [activeTab, selectedQueryExamId]);

  useEffect(
    () =>
      realtimeService.subscribeStatus(status => {
        if (status.connected && status.reconnected) {
          if (selectedProctoringExamId) {
            void refreshExamMonitoringData(selectedProctoringExamId);
          }
        }
      }),
    [refreshExamMonitoringData, selectedProctoringExamId]
  );

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
      const updatedStudent = await dbService.updateStudent(studentId, { managedBy: nextManagedBy });
      setStudents(previous => previous.map(item =>
        (item.userId || item.id) === (updatedStudent.userId || updatedStudent.id)
          ? updatedStudent
          : item
      ));
      setSelectedStudentDetails(previous =>
        previous
          ? {
              ...previous,
              student: updatedStudent,
              assignedTeacher: teachers.find(teacher =>
                (teacher.userId || teacher.id) === assigningTeacherId
              ) || null
            }
          : previous
      );
      setFeedbackBanner({
        type: 'success',
        message: `Updated teacher assignment for ${updatedStudent.name}.`
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
          const updatedUser = await dbService.updateUserStatus(target.userId || target.id, nextStatus);
          if (updatedUser.role === 'TEACHER') {
            setTeachers(previous => previous.map(item =>
              (item.userId || item.id) === (updatedUser.userId || updatedUser.id) ? updatedUser : item
            ));
            setSelectedTeacherDetails(previous =>
              previous && (previous.teacher.userId || previous.teacher.id) === (updatedUser.userId || updatedUser.id)
                ? { ...previous, teacher: updatedUser }
                : previous
            );
          } else if (updatedUser.role === 'STUDENT') {
            setStudents(previous => previous.map(item =>
              (item.userId || item.id) === (updatedUser.userId || updatedUser.id) ? updatedUser : item
            ));
            setSelectedStudentDetails(previous =>
              previous && (previous.student.userId || previous.student.id) === (updatedUser.userId || updatedUser.id)
                ? { ...previous, student: updatedUser }
                : previous
            );
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
          const submitted = await dbService.submitExamAttempt(attemptId, {
            terminatedByProctor: true,
            terminationReason: 'Administrative / Proctoring violation'
          });
          setAttempts(previous => [
            submitted.attempt,
            ...previous.filter(item => item.attemptId !== submitted.attempt.attemptId)
          ]);
          setSelectedProctoringDetail(null);
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
      if (res.teacher) {
        setTeachers(previous => [res.teacher, ...previous.filter(item =>
          (item.userId || item.id) !== (res.teacher.userId || res.teacher.id)
        )]);
      }
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
      if (res.student) {
        setStudents(previous => [res.student, ...previous.filter(item =>
          (item.userId || item.id) !== (res.student.userId || res.student.id)
        )]);
      }
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
          setQuestions(previous => previous.filter(question =>
            question.questionId !== questionId && question.id !== questionId
          ));
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

  const pendingQueriesCount = examQueries.filter(
    q => q.status === 'PENDING' || q.status === 'UNDER_REVIEW' || q.status === 'OPEN'
  ).length;
  const resolvedQueriesCount = examQueries.filter(
    q =>
      q.status === 'RESOLVED' ||
      q.status === 'APPROVED' ||
      q.status === 'REJECTED' ||
      q.status === 'RESOLVED_ACCEPTED' ||
      q.status === 'RESOLVED_REJECTED'
  ).length;
  const visibleQueries = examQueries.filter(query => {
    const pending = ['OPEN', 'PENDING', 'UNDER_REVIEW'].includes(query.status);
    const resolved = ['RESOLVED', 'APPROVED', 'REJECTED', 'RESOLVED_ACCEPTED', 'RESOLVED_REJECTED'].includes(query.status);
    return queryStatusFilter === 'ALL' || (queryStatusFilter === 'PENDING' ? pending : resolved);
  });

  const publishedResultsCount = examResults.filter(
    r => r.status === 'PUBLISHED' || r.isPublished
  ).length;
  const unpublishedResultsCount = examResults.length - publishedResultsCount;
  const visibleResults = examResults.filter(result =>
    resultStatusFilter === 'ALL' ||
    (resultStatusFilter === 'PUBLISHED'
      ? result.isPublished || result.status === 'PUBLISHED'
      : !(result.isPublished || result.status === 'PUBLISHED'))
  );
  const passedResultsCount = examResults.filter(
    r => r.passed === true || (r.percentage ?? r.accuracy ?? 0) >= 40
  ).length;

  const criticalEventsCount = proctoringEvents.filter(
    e => e.severity === 'HIGH' || e.severity === 'CRITICAL'
  ).length;
  const selectedExamProctoringEvents = proctoringEvents
    .filter(event => event.examId === selectedProctoringExamId)
    .sort((first, second) =>
      new Date(second.timestamp).getTime() - new Date(first.timestamp).getTime()
    );
  const isMonitoringHistory = activeTab === 'monitoring_history';
  const monitoringExamStatuses = !isMonitoringHistory
    ? new Set(['LIVE'])
    : new Set(['ENDED', 'CLOSED', 'COMPLETED', 'RESULT_PUBLISHED']);
  const visibleMonitoringExams = exams.filter(exam => {
    const matchesStatus = monitoringExamStatuses.has(exam.status);
    const search = monitoringSearchTerm.trim().toLowerCase();
    const matchesSearch = !search ||
      `${exam.title} ${exam.examId} ${exam.subject || ''}`.toLowerCase().includes(search);
    return matchesStatus && matchesSearch;
  });
  const selectedMonitoringExam = exams.find(exam => exam.examId === selectedProctoringExamId);
  const normalizedResultsExamSearch = resultsExamSearch.trim().toLowerCase();
  const visibleResultsExams = exams.filter(exam => {
    const searchMatch = !normalizedResultsExamSearch ||
      `${exam.title} ${exam.examId} ${exam.subject || ''}`.toLowerCase().includes(normalizedResultsExamSearch);
    return searchMatch && (resultExamStatusFilter === 'ALL' || exam.status === resultExamStatusFilter);
  });
  const normalizedQueriesExamSearch = queriesExamSearch.trim().toLowerCase();
  const visibleQueriesExams = exams.filter(exam => {
    const searchMatch = !normalizedQueriesExamSearch ||
      `${exam.title} ${exam.examId} ${exam.subject || ''}`.toLowerCase().includes(normalizedQueriesExamSearch);
    return searchMatch && (queryExamStatusFilter === 'ALL' || exam.status === queryExamStatusFilter);
  });
  const normalizedResultRecordSearch = resultRecordSearch.trim().toLowerCase();
  const searchedResults = visibleResults.filter(result =>
    !normalizedResultRecordSearch ||
    `${result.studentName} ${result.studentId} ${result.resultId || result.id}`.toLowerCase().includes(normalizedResultRecordSearch)
  );
  const normalizedQueryRecordSearch = queryRecordSearch.trim().toLowerCase();
  const searchedQueries = visibleQueries.filter(query =>
    !normalizedQueryRecordSearch ||
    `${query.studentName} ${query.studentId} ${query.queryId || query.id} ${query.subject || query.topic || ''}`.toLowerCase().includes(normalizedQueryRecordSearch)
  );
  const pageSize = 10;
  const resultsPageCount = Math.max(1, Math.ceil(searchedResults.length / pageSize));
  const pagedResults = searchedResults.slice((resultsPage - 1) * pageSize, resultsPage * pageSize);
  const queriesPageCount = Math.max(1, Math.ceil(searchedQueries.length / pageSize));
  const pagedQueries = searchedQueries.slice((queriesPage - 1) * pageSize, queriesPage * pageSize);
  useEffect(() => {
    setResultsPage(page => Math.min(page, resultsPageCount));
  }, [resultsPageCount]);
  useEffect(() => {
    setQueriesPage(page => Math.min(page, queriesPageCount));
  }, [queriesPageCount]);

  const submittedAttemptsCount = attempts.filter(
    a =>
      a.status === 'SUBMITTED' ||
      a.status === 'AUTO_SUBMITTED' ||
      a.status === 'EVALUATED' ||
      a.status === 'FORCE_SUBMITTED'
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
            {activeTab === 'proctoring' && 'Live Monitoring'}
            {activeTab === 'monitoring_history' && 'Monitoring History'}
            {activeTab === 'queries' && 'Queries'}
            {activeTab === 'audit' && 'Audit Logs'}
            {activeTab === 'settings' && 'Administrator Profile'}
          </h1>
          <p className="text-[13px] text-slate-500 dark:text-slate-400 mt-1 tabular-nums">
            {user.name} · {user.role} · {user.userId || user.id}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() => void handleManualRefresh()}
            disabled={isLoadingData}
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
              label="Total Exams"
              value={exams.length}
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
              value={selectedQueryExamId ? pendingQueriesCount : '—'}
              subValue={selectedQueryExamId ? `${resolvedQueriesCount} Resolved inquiries` : 'Select an exam to review queries'}
              icon={<MessageSquare className="w-5 h-5 text-amber-600 dark:text-amber-400" />}
              isLoading={isLoadingData}
              onClick={() => {
                setQueryStatusFilter('PENDING');
                onNavigateTab('queries');
              }}
            />

            <KpiCard
              label="Published Results"
              value={selectedResultExamId ? publishedResultsCount : '—'}
              subValue={selectedResultExamId ? `${unpublishedResultsCount} Pending publication` : 'Select an exam to review results'}
              icon={<CheckCircle className="w-5 h-5 text-teal-600 dark:text-teal-400" />}
              isLoading={isLoadingData}
              onClick={() => {
                setResultStatusFilter('PUBLISHED');
                onNavigateTab('results');
              }}
            />

            <KpiCard
              label="Live Exams"
              value={liveExamsCount}
              subValue="Open live monitoring for exam details"
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
          onStatusChange={onStatusChange}
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

      {/* Results: choose an exam before loading its records. */}
      {activeTab === 'results' && (
        <div className="space-y-6">
          {!selectedResultExamId ? (
            <section className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800">
              <div className="flex flex-col gap-4 border-b border-slate-200 p-5 dark:border-slate-700 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Results by exam</h2>
                  <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Select an exam to load and manage only its results.</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <label className="relative">
                    <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                    <input aria-label="Search exams for results" value={resultsExamSearch} onChange={event => setResultsExamSearch(event.target.value)} placeholder="Search exams" className="h-9 w-56 rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-white" />
                  </label>
                  <select aria-label="Filter results exams by status" value={resultExamStatusFilter} onChange={event => setResultExamStatusFilter(event.target.value)} className="h-9 rounded-lg border border-slate-200 bg-white px-2.5 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-white">
                    <option value="ALL">All exam statuses</option><option value="DRAFT">Draft</option><option value="SCHEDULED">Scheduled</option><option value="PUBLISHED">Published</option><option value="LIVE">Live</option><option value="ENDED">Ended</option><option value="COMPLETED">Completed</option><option value="RESULT_PUBLISHED">Results published</option>
                  </select>
                </div>
              </div>
              {visibleResultsExams.length ? (
                <div className="divide-y divide-slate-200 dark:divide-slate-700">
                  {visibleResultsExams.map(exam => (
                    <button key={exam.examId} type="button" onClick={() => { setExamResults([]); setSelectedResultExamId(exam.examId); }} className="flex w-full flex-col gap-2 p-5 text-left hover:bg-slate-50 dark:hover:bg-slate-700/30 sm:flex-row sm:items-center sm:justify-between">
                      <span><span className="block font-semibold text-slate-900 dark:text-white">{exam.title}</span><span className="mt-1 block text-sm text-slate-500 dark:text-slate-400">{exam.subject || 'Unspecified subject'} · {exam.examId}</span></span>
                      <span className="flex items-center gap-3"><StatusBadge status={exam.status} /><span className="text-sm font-semibold text-blue-600 dark:text-blue-400">View results →</span></span>
                    </button>
                  ))}
                </div>
              ) : <div className="p-10 text-center text-sm text-slate-500 dark:text-slate-400">No exams match your search and status filters.</div>}
            </section>
          ) : (() => {
            const exam = exams.find(item => item.examId === selectedResultExamId);
            return <div className="space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div><button type="button" onClick={() => { setSelectedResultExamId(null); setExamResults([]); setResultsPage(1); }} className="mb-2 text-sm font-medium text-blue-600 hover:underline dark:text-blue-400">← All exams</button><h2 className="text-xl font-semibold text-slate-900 dark:text-white">{exam?.title || selectedResultExamId}</h2><p className="text-sm text-slate-500 dark:text-slate-400">Results workspace · {selectedResultExamId}</p></div>
                <div className="flex items-center gap-2"><label className="relative"><Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" /><input aria-label="Search results" value={resultRecordSearch} onChange={event => { setResultRecordSearch(event.target.value); setResultsPage(1); }} placeholder="Search students or IDs" className="h-9 w-56 rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-white" /></label><select aria-label="Filter results by publication status" value={resultStatusFilter} onChange={event => { setResultStatusFilter(event.target.value as typeof resultStatusFilter); setResultsPage(1); }} className="h-9 rounded-lg border border-slate-200 bg-white px-2.5 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-white"><option value="ALL">All results</option><option value="PUBLISHED">Published</option><option value="PENDING">Pending publication</option></select></div>
              </div>
              {loadError && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-300">{loadError}</p>}
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4"><KpiCard label="Submissions" value={examResults.length} subValue="For this exam" icon={<CheckCircle className="h-5 w-5 text-blue-600" />} isLoading={isLoadingResults} /><KpiCard label="Published" value={publishedResultsCount} subValue="Available to students" icon={<CheckCircle className="h-5 w-5 text-emerald-600" />} isLoading={isLoadingResults} /><KpiCard label="Pending publication" value={unpublishedResultsCount} subValue="Awaiting release" icon={<AlertCircle className="h-5 w-5 text-amber-600" />} isLoading={isLoadingResults} /><KpiCard label="Passed" value={passedResultsCount} subValue="40% threshold or higher" icon={<CheckCircle className="h-5 w-5 text-indigo-600" />} isLoading={isLoadingResults} /></div>
              <section className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800">
                <div className="border-b border-slate-200 p-4 text-sm text-slate-600 dark:border-slate-700 dark:text-slate-300">{searchedResults.length} result{searchedResults.length === 1 ? '' : 's'} for this exam</div>
                {isLoadingResults ? <div className="p-10 text-center text-sm text-slate-500">Loading exam results…</div> : searchedResults.length === 0 ? <div className="p-10 text-center text-sm text-slate-500 dark:text-slate-400">{examResults.length ? 'No results match the current filters.' : 'No results are available for this exam.'}</div> : <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="bg-slate-50 text-xs font-semibold text-slate-500 dark:bg-slate-900/50 dark:text-slate-400"><tr><th className="p-3">Result</th><th className="p-3">Student</th><th className="p-3">Score</th><th className="p-3">Percentage</th><th className="p-3">Status</th><th className="p-3 text-right">Actions</th></tr></thead><tbody className="divide-y divide-slate-200 dark:divide-slate-700">{pagedResults.map(result => { const resultId = result.resultId || result.id; const isPublished = result.isPublished || result.status === 'PUBLISHED'; return <tr key={resultId}><td className="p-3"><button type="button" onClick={() => setSelectedResultDetail(result)} className="font-mono text-blue-600 hover:underline dark:text-blue-400">{resultId}</button></td><td className="p-3"><div className="font-medium text-slate-900 dark:text-white">{result.studentName}</div><div className="text-xs text-slate-500">{result.studentId}</div></td><td className="p-3">{result.score} / {result.totalMarks || result.totalQuestions}</td><td className="p-3">{result.percentage ?? result.accuracy ?? 0}%</td><td className="p-3"><StatusBadge status={result.status} /></td><td className="space-x-2 p-3 text-right"><button type="button" onClick={() => setSelectedResultDetail(result)} className="rounded-md border border-slate-200 px-3 py-1.5 text-xs dark:border-slate-600">View</button>{!isPublished && <button type="button" onClick={() => confirmAction({ title: 'Publish Results', message: `Are you sure you want to publish the results for ${result.studentName}?`, confirmLabel: 'Yes, Publish', cancelLabel: 'No', variant: 'primary', action: async () => { await onPublishResult(resultId); const publishedAt = new Date().toISOString(); setExamResults(previous => previous.map(item => (item.resultId || item.id) === resultId ? { ...item, isPublished: true, status: 'PUBLISHED', publishedAt } : item)); setSelectedResultDetail(previous => previous && (previous.resultId || previous.id) === resultId ? { ...previous, isPublished: true, status: 'PUBLISHED', publishedAt } : previous); } })} className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700">Publish</button>}</td></tr>; })}</tbody></table></div>}
                {resultsPageCount > 1 && <div className="flex items-center justify-between border-t border-slate-200 p-3 text-sm dark:border-slate-700"><span>Page {resultsPage} of {resultsPageCount}</span><div className="flex gap-2"><button type="button" disabled={resultsPage <= 1} onClick={() => setResultsPage(page => Math.max(1, page - 1))} className="rounded border px-3 py-1 disabled:opacity-40 dark:border-slate-600">Previous</button><button type="button" disabled={resultsPage >= resultsPageCount} onClick={() => setResultsPage(page => Math.min(resultsPageCount, page + 1))} className="rounded border px-3 py-1 disabled:opacity-40 dark:border-slate-600">Next</button></div></div>}
              </section>
            </div>;
          })()}
        </div>
      )}

      {/* Proctoring is split into current live operations and exam-scoped history. */}
      {(activeTab === 'proctoring' || activeTab === 'monitoring_history') && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-semibold text-slate-900 dark:text-white">Exam monitoring</h2><p className="text-sm text-slate-500 dark:text-slate-400">Choose an exam to load its attempts and proctoring events.</p></div><div className="inline-flex rounded-lg border border-slate-200 bg-white p-1 dark:border-slate-700 dark:bg-slate-800"><button type="button" onClick={() => onNavigateTab(activeTab === 'monitoring_history' ? 'proctoring' : 'monitoring_history')} className="rounded-md px-3 py-1.5 text-sm font-medium bg-blue-600 text-white">{isMonitoringHistory ? 'Live monitoring' : 'Monitoring history'}</button></div></div>
          {!selectedProctoringExamId ? <section className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800"><div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-4 dark:border-slate-700"><h3 className="font-semibold text-slate-900 dark:text-white">{isMonitoringHistory ? 'Ended and completed exams' : 'Currently live exams'}</h3><label className="relative"><Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" /><input aria-label="Search monitoring exams" value={monitoringSearchTerm} onChange={event => setMonitoringSearchTerm(event.target.value)} placeholder="Search exams" className="h-9 w-56 rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-white" /></label></div>{visibleMonitoringExams.length ? <div className="divide-y divide-slate-200 dark:divide-slate-700">{visibleMonitoringExams.map(exam => <button key={exam.examId} type="button" onClick={() => { setProctoringEvents([]); setAttempts([]); setMonitoringResults([]); setSelectedProctoringExamId(exam.examId); setShowMonitoringInsights(false); setSelectedProctoringDetail(null); }} className="flex w-full flex-col gap-2 p-5 text-left hover:bg-slate-50 dark:hover:bg-slate-700/30 sm:flex-row sm:items-center sm:justify-between"><span><span className="block font-semibold text-slate-900 dark:text-white">{exam.title}</span><span className="mt-1 block text-sm text-slate-500 dark:text-slate-400">{exam.subject || 'Unspecified subject'} · {exam.examId}</span></span><span className="flex items-center gap-3"><StatusBadge status={exam.status} /><span className="text-sm font-semibold text-blue-600 dark:text-blue-400">Open {isMonitoringHistory ? 'report' : 'monitor'} →</span></span></button>)}</div> : <div className="p-10 text-center text-sm text-slate-500 dark:text-slate-400">{isMonitoringHistory ? 'No ended or completed exams are available.' : 'No exams are currently live.'}</div>}</section> : <div className="space-y-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><button type="button" onClick={() => { setSelectedProctoringExamId(null); setProctoringEvents([]); setAttempts([]); setMonitoringResults([]); setSelectedProctoringDetail(null); setShowMonitoringInsights(false); setSelectedProctoringDetail(null); }} className="mb-2 text-sm font-medium text-blue-600 hover:underline dark:text-blue-400">← {isMonitoringHistory ? 'Monitoring history' : 'Live exams'}</button><h3 className="text-xl font-semibold text-slate-900 dark:text-white">{selectedMonitoringExam?.title || selectedProctoringExamId}</h3><p className="text-sm text-slate-500 dark:text-slate-400">{selectedMonitoringExam?.subject || 'Exam'} · {selectedProctoringExamId}</p></div><div className="flex gap-2"><button type="button" onClick={() => void refreshExamMonitoringData(selectedProctoringExamId)} className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200 px-3 text-sm dark:border-slate-700"><RefreshCw className="h-4 w-4" />Refresh</button><button type="button" onClick={() => setShowMonitoringInsights(true)} className="h-9 rounded-lg bg-blue-600 px-3 text-sm font-medium text-white hover:bg-blue-700">View exam report</button></div></div>{monitoringError && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-300">{monitoringError}</p>}{isLoadingMonitoring ? <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-800">Loading exam monitoring data…</div> : <><div className="grid grid-cols-2 gap-3 md:grid-cols-4"><KpiCard label="Active attempts" value={attempts.filter(attempt => attempt.status === 'IN_PROGRESS').length} subValue="Currently in progress" icon={<ShieldAlert className="h-5 w-5 text-blue-600" />} /><KpiCard label="Proctoring events" value={selectedExamProctoringEvents.length} subValue="Only this exam" icon={<Activity className="h-5 w-5 text-amber-600" />} /><KpiCard label="High / critical" value={criticalEventsCount} subValue="Events requiring review" icon={<ShieldAlert className="h-5 w-5 text-rose-600" />} /><KpiCard label="Submitted attempts" value={submittedAttemptsCount} subValue="Completed submissions" icon={<CheckCircle className="h-5 w-5 text-emerald-600" />} /></div><section className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800"><h4 className="border-b border-slate-200 p-4 font-semibold text-slate-900 dark:border-slate-700 dark:text-white">Candidate attempts ({attempts.length})</h4>{attempts.length ? <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="bg-slate-50 text-xs text-slate-500 dark:bg-slate-900/50 dark:text-slate-400"><tr><th className="p-3">Student</th><th className="p-3">Status</th><th className="p-3">Warnings</th><th className="p-3 text-right">Action</th></tr></thead><tbody className="divide-y divide-slate-200 dark:divide-slate-700">{attempts.filter(attempt => attempt.examId === selectedProctoringExamId).map(attempt => <tr key={attempt.attemptId}><td className="p-3"><div className="font-medium text-slate-900 dark:text-white">{attempt.studentName || attempt.studentId}</div><div className="text-xs text-slate-500">{attempt.studentId}</div></td><td className="p-3"><StatusBadge status={attempt.proctoringStatus || attempt.status} /></td><td className="p-3">{attempt.warningCount ?? 0}</td><td className="p-3 text-right">{attempt.status === 'IN_PROGRESS' && <button type="button" onClick={() => handleTerminateAttempt(attempt.attemptId, attempt.studentName)} className="rounded-md border border-red-200 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-300">Terminate</button>}</td></tr>)}</tbody></table></div> : <div className="p-8 text-center text-sm text-slate-500">No candidate attempts for this exam.</div>}</section><section className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800"><h4 className="border-b border-slate-200 p-4 font-semibold text-slate-900 dark:border-slate-700 dark:text-white">Event history ({selectedExamProctoringEvents.length})</h4>{selectedExamProctoringEvents.length ? <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="bg-slate-50 text-xs text-slate-500 dark:bg-slate-900/50 dark:text-slate-400"><tr><th className="p-3">Time</th><th className="p-3">Student</th><th className="p-3">Event</th><th className="p-3">Severity</th><th className="p-3 text-right">Details</th></tr></thead><tbody className="divide-y divide-slate-200 dark:divide-slate-700">{selectedExamProctoringEvents.slice(0, 100).map(event => <tr key={event.eventId}><td className="whitespace-nowrap p-3 text-slate-500">{new Date(event.timestamp).toLocaleString()}</td><td className="p-3">{event.studentName || event.studentId}</td><td className="p-3">{event.eventType}</td><td className="p-3"><StatusBadge status={event.severity} /></td><td className="p-3 text-right"><button type="button" onClick={() => setSelectedProctoringDetail(event)} className="font-medium text-blue-600 hover:underline dark:text-blue-400">Review</button></td></tr>)}</tbody></table></div> : <div className="p-8 text-center text-sm text-slate-500">No proctoring events for this exam.</div>}</section></>}</div>}
          {showMonitoringInsights && selectedProctoringExamId && <ProctoringExamInsightsModal exam={selectedMonitoringExam} examId={selectedProctoringExamId} events={selectedExamProctoringEvents} results={monitoringResults} isStudent={false} onClose={() => setShowMonitoringInsights(false)} />}
        </div>
      )}

      {/* Queries: choose an exam before loading its records. */}
      {activeTab === 'queries' && (
        <div className="space-y-6">
          {!selectedQueryExamId ? <section className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800"><div className="flex flex-col gap-4 border-b border-slate-200 p-5 dark:border-slate-700 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="text-lg font-semibold text-slate-900 dark:text-white">Queries by exam</h2><p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Select an exam to load and resolve only its queries.</p></div><div className="flex flex-wrap gap-2"><label className="relative"><Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" /><input aria-label="Search exams for queries" value={queriesExamSearch} onChange={event => setQueriesExamSearch(event.target.value)} placeholder="Search exams" className="h-9 w-56 rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-white" /></label><select aria-label="Filter query exams by status" value={queryExamStatusFilter} onChange={event => setQueryExamStatusFilter(event.target.value)} className="h-9 rounded-lg border border-slate-200 bg-white px-2.5 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-white"><option value="ALL">All exam statuses</option><option value="DRAFT">Draft</option><option value="SCHEDULED">Scheduled</option><option value="PUBLISHED">Published</option><option value="LIVE">Live</option><option value="ENDED">Ended</option><option value="COMPLETED">Completed</option><option value="RESULT_PUBLISHED">Results published</option></select></div></div>{visibleQueriesExams.length ? <div className="divide-y divide-slate-200 dark:divide-slate-700">{visibleQueriesExams.map(exam => <button key={exam.examId} type="button" onClick={() => { setExamQueries([]); setSelectedQueryExamId(exam.examId); }} className="flex w-full flex-col gap-2 p-5 text-left hover:bg-slate-50 dark:hover:bg-slate-700/30 sm:flex-row sm:items-center sm:justify-between"><span><span className="block font-semibold text-slate-900 dark:text-white">{exam.title}</span><span className="mt-1 block text-sm text-slate-500 dark:text-slate-400">{exam.subject || 'Unspecified subject'} · {exam.examId}</span></span><span className="flex items-center gap-3"><StatusBadge status={exam.status} /><span className="text-sm font-semibold text-blue-600 dark:text-blue-400">View queries →</span></span></button>)}</div> : <div className="p-10 text-center text-sm text-slate-500 dark:text-slate-400">No exams match your search and status filters.</div>}</section> : (() => { const exam = exams.find(item => item.examId === selectedQueryExamId); return <div className="space-y-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><button type="button" onClick={() => { setSelectedQueryExamId(null); setExamQueries([]); setQueriesPage(1); }} className="mb-2 text-sm font-medium text-blue-600 hover:underline dark:text-blue-400">← All exams</button><h2 className="text-xl font-semibold text-slate-900 dark:text-white">{exam?.title || selectedQueryExamId}</h2><p className="text-sm text-slate-500 dark:text-slate-400">Queries workspace · {selectedQueryExamId}</p></div><div className="flex flex-wrap gap-2"><label className="relative"><Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" /><input aria-label="Search queries" value={queryRecordSearch} onChange={event => { setQueryRecordSearch(event.target.value); setQueriesPage(1); }} placeholder="Search students or topics" className="h-9 w-56 rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-white" /></label><select aria-label="Filter queries by status" value={queryStatusFilter} onChange={event => { setQueryStatusFilter(event.target.value as typeof queryStatusFilter); setQueriesPage(1); }} className="h-9 rounded-lg border border-slate-200 bg-white px-2.5 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-white"><option value="ALL">All statuses</option><option value="PENDING">Pending / in review</option><option value="RESOLVED">Resolved</option></select></div></div>{loadError && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-300">{loadError}</p>}<div className="grid grid-cols-2 gap-3 md:grid-cols-3"><KpiCard label="Queries" value={examQueries.length} subValue="For this exam" icon={<MessageSquare className="h-5 w-5 text-blue-600" />} isLoading={isLoadingQueries} /><KpiCard label="Pending" value={pendingQueriesCount} subValue="Requires resolution" icon={<MessageSquare className="h-5 w-5 text-amber-600" />} isLoading={isLoadingQueries} /><KpiCard label="Resolved" value={resolvedQueriesCount} subValue="Closed inquiries" icon={<CheckCircle className="h-5 w-5 text-emerald-600" />} isLoading={isLoadingQueries} /></div><section className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800"><div className="border-b border-slate-200 p-4 text-sm text-slate-600 dark:border-slate-700 dark:text-slate-300">{searchedQueries.length} quer{searchedQueries.length === 1 ? 'y' : 'ies'} for this exam</div>{isLoadingQueries ? <div className="p-10 text-center text-sm text-slate-500">Loading exam queries…</div> : searchedQueries.length === 0 ? <div className="p-10 text-center text-sm text-slate-500 dark:text-slate-400">{examQueries.length ? 'No queries match the current filters.' : 'No queries have been raised for this exam.'}</div> : <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="bg-slate-50 text-xs font-semibold text-slate-500 dark:bg-slate-900/50 dark:text-slate-400"><tr><th className="p-3">Query</th><th className="p-3">Student</th><th className="p-3">Subject / query</th><th className="p-3">Status</th><th className="p-3">Created</th><th className="p-3 text-right">Resolution</th></tr></thead><tbody className="divide-y divide-slate-200 dark:divide-slate-700">{pagedQueries.map(query => { const queryId = query.queryId || query.id; const isPending = ['OPEN', 'PENDING', 'UNDER_REVIEW'].includes(query.status); return <tr key={queryId}><td className="p-3"><button type="button" onClick={() => setSelectedQueryDetail(query)} className="font-mono text-blue-600 hover:underline dark:text-blue-400">{queryId}</button></td><td className="p-3"><div className="font-medium text-slate-900 dark:text-white">{query.studentName}</div><div className="text-xs text-slate-500">{query.studentId}</div></td><td className="max-w-sm p-3"><div className="font-medium text-slate-900 dark:text-white">{query.subject || query.topic || 'General'}</div><div className="line-clamp-2 text-xs text-slate-500">{query.description || query.message}</div></td><td className="p-3"><StatusBadge status={query.status} /></td><td className="whitespace-nowrap p-3 text-slate-500">{query.createdAt}</td><td className="p-3 text-right">{isPending ? <div className="inline-flex items-center gap-2"><input type="text" aria-label={`Response to ${queryId}`} placeholder="Write response…" value={replyText[queryId] || ''} onChange={event => setReplyText(previous => ({ ...previous, [queryId]: event.target.value }))} className="h-9 w-44 rounded-lg border border-slate-200 bg-white px-2 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-white" /><button type="button" disabled={submittingQueryId === queryId || !(replyText[queryId] || '').trim()} onClick={() => { const reply = (replyText[queryId] || '').trim(); if (!reply) return; confirmAction({ title: 'Resolve Query', subtitle: `Query ID: ${queryId}`, message: `Send this resolution to ${query.studentName || 'the student'}?`, confirmLabel: 'Yes, Resolve', cancelLabel: 'No', variant: 'primary', details: [{ label: 'Student', value: query.studentName }, { label: 'Subject', value: query.subject || query.topic || 'General' }, { label: 'Response', value: reply }], action: async () => { setSubmittingQueryId(queryId); try { await onResolveQuery(queryId, reply, 'RESOLVED'); setExamQueries(previous => previous.map(item => (item.queryId || item.id) === queryId ? { ...item, status: 'RESOLVED' } : item)); setReplyText(previous => ({ ...previous, [queryId]: '' })); } finally { setSubmittingQueryId(null); } } }); }} className="h-9 rounded-lg bg-blue-600 px-3 text-xs font-medium text-white disabled:opacity-50">{submittingQueryId === queryId ? 'Sending…' : 'Resolve'}</button></div> : <span className="text-xs text-slate-500">Resolved</span>}</td></tr>; })}</tbody></table></div>}{queriesPageCount > 1 && <div className="flex items-center justify-between border-t border-slate-200 p-3 text-sm dark:border-slate-700"><span>Page {queriesPage} of {queriesPageCount}</span><div className="flex gap-2"><button type="button" disabled={queriesPage <= 1} onClick={() => setQueriesPage(page => Math.max(1, page - 1))} className="rounded border px-3 py-1 disabled:opacity-40 dark:border-slate-600">Previous</button><button type="button" disabled={queriesPage >= queriesPageCount} onClick={() => setQueriesPage(page => Math.min(queriesPageCount, page + 1))} className="rounded border px-3 py-1 disabled:opacity-40 dark:border-slate-600">Next</button></div></div>}</section></div>; })()}
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
        <div className="space-y-5">
          <section className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-800">
            <div className="flex items-center gap-4">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-slate-200 text-lg font-bold text-slate-700 dark:bg-slate-700 dark:text-slate-100">
                {user.name.split(/\s+/).map(part => part[0]).slice(0, 2).join('').toUpperCase()}
              </div>
              <div>
                <h2 className="text-xl font-semibold text-slate-900 dark:text-white">{user.name}</h2>
                <p className="mt-1 font-mono text-xs text-slate-500">{user.userId || user.id} · Administrator</p>
                <div className="mt-2"><StatusBadge status={user.status || 'ACTIVE'} /></div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => void handleManualRefresh()}
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200 px-3 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-700"
            >
              <RefreshCw className="h-3.5 w-3.5" /> Refresh
            </button>
          </section>

          <div className="max-w-2xl">
            <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-800">
              <h3 className="mb-4 flex items-center gap-2 text-base font-semibold text-slate-900 dark:text-white"><SettingsIcon className="h-4 w-4 text-blue-600" /> Account & administration</h3>
              <dl className="divide-y divide-slate-100 text-sm dark:divide-slate-700">
                {[
                  ['Administrator ID', user.userId || user.id],
                  ['Full name', user.name],
                  ['Role', user.role],
                  ['Email', user.email || '—'],
                  ['Department', user.department || '—'],
                  ['Account status', user.status || 'ACTIVE'],
                  ['Permissions', 'Institution-wide administration']
                ].map(([label, value]) => (
                  <div key={label} className="flex justify-between gap-4 py-2.5">
                    <dt className="text-slate-500 dark:text-slate-400">{label}</dt>
                    <dd className="text-right font-medium text-slate-800 dark:text-slate-200">{value}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-4 text-xs text-slate-500 dark:text-slate-400">Passwords, tokens, and other credentials are never displayed here.</p>
            </section>
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
                                const updatedStudent = await dbService.updateStudent(studentId, { managedBy: [] });
                                setStudents(previous => previous.map(item =>
                                  (item.userId || item.id) === (updatedStudent.userId || updatedStudent.id)
                                    ? updatedStudent
                                    : item
                                ));
                                setSelectedStudentDetails(previous =>
                                  previous
                                    ? { ...previous, student: updatedStudent, assignedTeacher: null }
                                    : previous
                                );
                                setFeedbackBanner({
                                  type: 'success',
                                  message: `Removed faculty supervision for ${updatedStudent.name}.`
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
                <StudentAssessmentSections details={selectedStudentDetails} />
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
