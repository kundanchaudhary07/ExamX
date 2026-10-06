import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  User,
  StudentResult,
  Question,
  AiGenerationBatch,
  Difficulty,
  StudentQuery,
  ScheduledExam,
  SystemUser,
  StudentDetailsData,
  SyllabusExtractData,
  ProctoringEventRecord,
  ExamAttemptRecord,
  AssistanceRequestRecord
} from '../../types';
import { ProctoringExamInsightsModal } from './ProctoringExamInsightsModal';
import StudentAssessmentSections from './StudentAssessmentSections';
import { TeacherExamScheduler } from './TeacherExamScheduler';
import {
  SUBJECTS,
  DEPARTMENTS,
  COURSES,
  ACADEMIC_YEARS,
  SEMESTERS,
  SECTIONS
} from '../../constants';
import { generateQuestionsWithAI } from '../../services/questionGenerationService';
import {
  dbService,
  mapBackendQueryToFrontend,
  mapBackendResultToFrontend,
  mapBackendUserToSystemUser
} from '../../services/dbService';
import { CreatableSubjectCombobox } from '../common/CreatableSubjectCombobox';
import { AiGenerationBatchCards } from './AiGenerationBatchCards';
import { realtimeService } from '../../services/realtimeService';
import {
  Modal,
  FormSection,
  StatusBadge,
  Select,
  SearchableSelect,
  QuestionDetailModal,
  ResultDetailModal,
  QueryDetailModal,
  KpiCard,
  getKpiPrimaryValueClass,
  PageMotionShell,
  ScrollReveal,
  ProctoringDetailModal,
  useConfirmAction
} from '../common/SharedUI';
import {
  Users,
  FileText,
  Plus,
  Trash2,
  Edit2,
  Check,
  CheckCircle,
  X,
  RefreshCw,
  Search,
  Copy,
  AlertCircle,
  MessageSquare,
  Shield,
  BookOpen,
  Sparkles,
  Upload,
  Eye,
  User as UserIcon,
  ChevronLeft,
  ChevronRight,
  Download,
  Wifi,
  WifiOff
} from 'lucide-react';

const AI_GENERATION_COURSES = [
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
];

interface TeacherDashboardProps {
  user?: User;
  activeTab: string;
  onNavigateTab: (tab: string) => void;
  questions: Question[];
  exams: ScheduledExam[];
  onAddQuestion: (q: Question) => Promise<void> | void;
  onUpdateQuestion: (q: Question) => Promise<void> | void;
  onDeleteQuestion: (id: string) => Promise<void> | void;
  onPublishResult: (id: string) => Promise<void> | void;
  onStatusChange?: (
    examId: string,
    status: Parameters<typeof dbService.updateExamStatus>[1],
    publishResults?: boolean
  ) => Promise<void> | void;
  onResolveQueryDetailed?: (
    id: string,
    payload: {
      resolutionType: NonNullable<StudentQuery['resolutionType']>;
      resolutionNotes: string;
      scoreAdjustment?: number;
      correctedAnswer?: string;
    }
  ) => Promise<void> | void;
  onSaveExam: (exam: ScheduledExam) => Promise<void> | void;
  onDeleteExam?: (examId: string) => Promise<void> | void;
  onRefreshData?: () => Promise<boolean | void> | void;
  onRefreshExamData?: (user: User) => Promise<boolean>;
}

export const TeacherDashboard: React.FC<TeacherDashboardProps> = ({
  user,
  activeTab,
  onNavigateTab,
  questions,
  exams,
  onAddQuestion,
  onUpdateQuestion,
  onDeleteQuestion,
  onPublishResult,
  onStatusChange,
  onResolveQueryDetailed,
  onSaveExam,
  onDeleteExam,
  onRefreshData,
  onRefreshExamData
}) => {
  // Supervised Students & Proctoring Events
  const [students, setStudents] = useState<SystemUser[]>([]);
  const [examPollingEnabled, setExamPollingEnabled] = useState(false);
  const refreshInProgressRef = useRef(false);
  const [proctoringEvents, setProctoringEvents] = useState<ProctoringEventRecord[]>([]);
  const [selectedProctoringExamId, setSelectedProctoringExamId] = useState<string | null>(null);
  const [proctoringExamResults, setProctoringExamResults] = useState<StudentResult[]>([]);
  const [attempts, setAttempts] = useState<ExamAttemptRecord[]>([]);
  const [assistanceRequests, setAssistanceRequests] = useState<AssistanceRequestRecord[]>([]);
  const [monitoringExamId, setMonitoringExamId] = useState('');
  const [monitoringExamSearch, setMonitoringExamSearch] = useState('');
  const [monitoringExamPage, setMonitoringExamPage] = useState(1);
  const [historyExamId, setHistoryExamId] = useState('');
  const [historyEvents, setHistoryEvents] = useState<ProctoringEventRecord[]>([]);
  const [historyAttempts, setHistoryAttempts] = useState<ExamAttemptRecord[]>([]);
  const [examResults, setExamResults] = useState<StudentResult[]>([]);
  const [examQueries, setExamQueries] = useState<StudentQuery[]>([]);
  const [selectedResultExamId, setSelectedResultExamId] = useState<string | null>(null);
  const [selectedQueryExamId, setSelectedQueryExamId] = useState<string | null>(null);
  const [isLoadingExamRecords, setIsLoadingExamRecords] = useState(false);
  const [examRecordError, setExamRecordError] = useState<string | null>(null);
  const [recordSearch, setRecordSearch] = useState('');
  const [recordPage, setRecordPage] = useState(1);
  const [monitoringSearch, setMonitoringSearch] = useState('');
  const [monitoringStatusFilter, setMonitoringStatusFilter] = useState('ALL');
  const [monitoringRiskFilter, setMonitoringRiskFilter] = useState('ALL');
  const [monitoringWarningsFilter, setMonitoringWarningsFilter] = useState('ALL');
  const [monitoringConnectionFilter, setMonitoringConnectionFilter] = useState('ALL');
  const [monitoringProgressFilter, setMonitoringProgressFilter] = useState('ALL');
  const [monitoringAssistanceFilter, setMonitoringAssistanceFilter] = useState('ALL');
  const [monitoringSort, setMonitoringSort] = useState('RISK');
  const [monitoringPage, setMonitoringPage] = useState(1);
  const [monitoringPageSize, setMonitoringPageSize] = useState(25);
  const [selectedMonitoringStudentIds, setSelectedMonitoringStudentIds] = useState<Set<string>>(
    () => new Set()
  );
  const [queryStatusFilter, setQueryStatusFilter] = useState<'ALL' | 'PENDING' | 'RESOLVED'>('ALL');
  const [monitoringNow, setMonitoringNow] = useState(Date.now());
  const [monitoringLastUpdated, setMonitoringLastUpdated] = useState<Date | null>(null);
  const [monitoringDataExamId, setMonitoringDataExamId] = useState('');
  const [monitoringRealtimeConnected, setMonitoringRealtimeConnected] = useState(() =>
    realtimeService.isConnected()
  );
  const [aiStatus, setAiStatus] = useState<{
    configured: boolean;
    status: 'READY' | 'GENERATING' | 'NOT_CONFIGURED' | 'ERROR' | 'PENDING_REVIEW';
    pendingReviewCount: number;
    maxFileSizeMb: number;
    supportedFormats: string[];
    message: string;
  } | null>(null);
  const [isLoadingAiData, setIsLoadingAiData] = useState(true);
  const [isLoadingDirectory, setIsLoadingDirectory] = useState(true);
  const [directoryError, setDirectoryError] = useState<string | null>(null);
  const { confirmAction, ConfirmModal } = useConfirmAction();

  // Student Creation & Detail Modal
  const [showCreateStudentModal, setShowCreateStudentModal] = useState(false);
  const [selectedStudentDetails, setSelectedStudentDetails] = useState<StudentDetailsData | null>(null);
  const [isLoadingStudentDetails, setIsLoadingStudentDetails] = useState(false);
  const [selectedQuestionDetail, setSelectedQuestionDetail] = useState<Question | null>(null);
  const [selectedResultDetail, setSelectedResultDetail] = useState<StudentResult | null>(null);
  const [selectedQueryDetail, setSelectedQueryDetail] = useState<StudentQuery | null>(null);
  const [selectedProctoringDetail, setSelectedProctoringDetail] = useState<ProctoringEventRecord | null>(null);
  const [selectedMonitoringAttempt, setSelectedMonitoringAttempt] = useState<ExamAttemptRecord | null>(null);

  const [studentForm, setStudentForm] = useState({
    name: '',
    dob: '',
    email: '',
    phone: '',
    department: user?.department || '',
    course: '',
    academicYear: '',
    semester: '',
    section: '',
    assignedTeacherId: user?.userId || user?.id || '',
    rollNumber: ''
  });
  const [isCreatingStudent, setIsCreatingStudent] = useState(false);
  const [studentCreateError, setStudentCreateError] = useState<string | null>(null);
  const [generatedStudentCreds, setGeneratedStudentCreds] = useState<{
    name: string;
    userId: string;
    temporaryPassword: string;
  } | null>(null);
  const [copiedStudentCredKey, setCopiedStudentCredKey] = useState<'userId' | 'password' | 'all' | null>(null);

  const handleCopyStudentCred = async (text: string, key: 'userId' | 'password' | 'all') => {
    if (!navigator.clipboard || !navigator.clipboard.writeText) {
      setFeedbackBanner({
        type: 'error',
        message: 'Clipboard API is unavailable in this environment. Please copy manually.'
      });
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      setCopiedStudentCredKey(key);
      setTimeout(() => {
        setCopiedStudentCredKey(prev => (prev === key ? null : prev));
      }, 1500);
    } catch (err: any) {
      setFeedbackBanner({
        type: 'error',
        message: 'Failed to copy to clipboard. Clipboard permission denied.'
      });
    }
  };

  // Question Bank Filter & Modal State
  const [selectedSubject, setSelectedSubject] = useState<string>('ALL');
  const [questionSearch, setQuestionSearch] = useState('');
  const [editingQuestion, setEditingQuestion] = useState<Question | null>(null);
  const [showQuestionModal, setShowQuestionModal] = useState(false);
  const [questionForm, setQuestionForm] = useState<{
    subject: string;
    topic: string;
    difficulty: Difficulty;
    text: string;
    options: string[];
    correctAnswerIndex: number;
    marks: number;
    negativeMarks: number;
    explanation: string;
  }>({
    subject: SUBJECTS[0],
    topic: '',
    difficulty: Difficulty.MEDIUM,
    text: '',
    options: ['', '', '', ''],
    correctAnswerIndex: 0,
    marks: 2,
    negativeMarks: 0,
    explanation: ''
  });
  const [questionError, setQuestionError] = useState<string | null>(null);
  const [isSavingQuestion, setIsSavingQuestion] = useState(false);

  // AI Question Generation & Syllabus Upload State
  const [aiTopic, setAiTopic] = useState(SUBJECTS[0]);
  const [aiCourse, setAiCourse] = useState('');
  const [aiSemester, setAiSemester] = useState('');
  const [aiSubtopic, setAiSubtopic] = useState('');
  const [aiQuestionType, setAiQuestionType] = useState<'MCQ'>('MCQ');
  const [aiDifficulty, setAiDifficulty] = useState<Difficulty>(Difficulty.MEDIUM);
  const [aiCount, setAiCount] = useState(3);
  const [aiMarks, setAiMarks] = useState(2);
  const [syllabusFile, setSyllabusFile] = useState<File | null>(null);
  const [extractedSyllabus, setExtractedSyllabus] = useState<SyllabusExtractData | null>(null);
  const [selectedSyllabusUnits, setSelectedSyllabusUnits] = useState<string[]>([]);
  const [isExtractingSyllabus, setIsExtractingSyllabus] = useState(false);
  const [isGeneratingAI, setIsGeneratingAI] = useState(false);
  const [aiDrafts, setAiDrafts] = useState<Question[]>([]);
  const [aiGenerationBatches, setAiGenerationBatches] = useState<AiGenerationBatch[]>([]);
  const [editingDraftId, setEditingDraftId] = useState<string | null>(null);
  const [editingDraftForm, setEditingDraftForm] = useState<Question | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [savingDraftIds, setSavingDraftIds] = useState<Record<string, boolean>>({});

  const refreshAiReviewData = useCallback(async () => {
    setIsLoadingAiData(true);
    try {
      const [status, drafts, batches] = await Promise.all([
        dbService.getAiStatus(),
        dbService.getAiDrafts(),
        dbService.getAiGenerationBatches()
      ]);
      setAiStatus(status);
      setAiDrafts(drafts);
      setAiGenerationBatches(batches);
    } catch (err: any) {
      setAiStatus((current) => current ? { ...current, status: 'ERROR', message: err.message || 'Unable to load AI review data.' } : null);
    } finally {
      setIsLoadingAiData(false);
    }
  }, []);

  // Query Adjudication State

  // Exam draft preservation when jumping between Create Exam and AI Generator
  const [savedExamDraft, setSavedExamDraft] = useState<{
    formData: Partial<ScheduledExam>;
    editingExam: ScheduledExam | null;
    autoOpen?: boolean;
  } | null>(null);

  // Feedback banner
  const [feedbackBanner, setFeedbackBanner] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const loadTeacherData = useCallback(async (showLoading = true): Promise<boolean> => {
    if (showLoading) setIsLoadingDirectory(true);
    setDirectoryError(null);
    try {
      const studentList = await dbService.getStudents();
      setStudents(studentList);
      setMonitoringLastUpdated(new Date());
      return true;
    } catch (err: any) {
      setDirectoryError(err.message || 'Unable to load dashboard data. Try again.');
      return false;
    } finally {
      if (showLoading) setIsLoadingDirectory(false);
    }
  }, []);

  const refreshMonitoringData = useCallback(async (): Promise<boolean> => {
    try {
      if (activeTab !== 'monitoring') return true;
      const examId = monitoringExamId;
      if (!examId) return true;
      const [proctorList, attemptList, assistanceList] = await Promise.all([
        dbService.getProctoringEvents({ examId }),
        dbService.getAttempts(examId),
        dbService.getUnblockRequests({ examId })
      ]);
      setProctoringEvents(proctorList.filter(event => event.examId === examId));
      setAttempts(attemptList.filter(attempt => attempt.examId === examId));
      setAssistanceRequests(previous => [
        ...previous.filter(request => request.examId !== examId),
        ...assistanceList
      ]);
      setMonitoringDataExamId(examId);
      setMonitoringLastUpdated(new Date());
      return true;
    } catch (error: any) {
      setDirectoryError(error?.message || 'Unable to refresh examination monitoring data.');
      return false;
    }
  }, [activeTab, monitoringExamId]);

  const loadExamResults = useCallback(async (examId: string) => {
    setSelectedResultExamId(examId);
    setRecordSearch('');
    setRecordPage(1);
    setExamRecordError(null);
    setIsLoadingExamRecords(true);
    try {
      setExamResults((await dbService.getResults(examId)).filter(result => result.examId === examId));
    } catch (error: any) {
      setExamRecordError(error?.message || 'Unable to load results for this exam.');
      setExamResults([]);
    } finally {
      setIsLoadingExamRecords(false);
    }
  }, []);

  const loadExamQueries = useCallback(async (examId: string) => {
    setSelectedQueryExamId(examId);
    setRecordSearch('');
    setRecordPage(1);
    setExamRecordError(null);
    setIsLoadingExamRecords(true);
    try {
      setExamQueries((await dbService.getQueries({ examId })).filter(query => query.examId === examId));
    } catch (error: any) {
      setExamRecordError(error?.message || 'Unable to load queries for this exam.');
      setExamQueries([]);
    } finally {
      setIsLoadingExamRecords(false);
    }
  }, []);

  const loadReportedQuery = useCallback(async (attempt: ExamAttemptRecord) => {
    try {
      const examQueries = await dbService.getQueries({ examId: attempt.examId });
      const related = examQueries.find(query => query.attemptId === attempt.attemptId);
      if (related) {
        setSelectedQueryDetail(related);
      } else {
        setFeedbackBanner({ type: 'error', message: 'No query record was found for this attempt.' });
      }
    } catch (error: any) {
      setFeedbackBanner({ type: 'error', message: error?.message || 'Unable to load the reported query.' });
    }
  }, []);

  const resolveWorkspaceQuery = useCallback(async (
    queryId: string,
    payload: {
      resolutionType: NonNullable<StudentQuery['resolutionType']>;
      resolutionNotes: string;
      scoreAdjustment?: number;
      correctedAnswer?: string;
    }
  ) => {
    if (!onResolveQueryDetailed) return;
    await onResolveQueryDetailed(queryId, payload);
    if (selectedQueryExamId) {
      const updated = await dbService.getQueries({ examId: selectedQueryExamId });
      setExamQueries(updated.filter(query => query.examId === selectedQueryExamId));
    }
    setSelectedQueryDetail(null);
  }, [onResolveQueryDetailed, selectedQueryExamId]);

  const refreshSelectedExamWorkspace = useCallback(async (): Promise<boolean> => {
    try {
      if (activeTab === 'results' && selectedResultExamId) {
        setExamResults((await dbService.getResults(selectedResultExamId))
          .filter(result => result.examId === selectedResultExamId));
      } else if (activeTab === 'queries' && selectedQueryExamId) {
        setExamQueries((await dbService.getQueries({ examId: selectedQueryExamId }))
          .filter(query => query.examId === selectedQueryExamId));
      } else if (activeTab === 'monitoring_history' && historyExamId) {
        const [events, history] = await Promise.all([
          dbService.getProctoringEvents({ examId: historyExamId }),
          dbService.getAttempts(historyExamId)
        ]);
        setHistoryEvents(events.filter(event => event.examId === historyExamId));
        setHistoryAttempts(history.filter(attempt => attempt.examId === historyExamId));
      }
      return true;
    } catch (error: any) {
      setExamRecordError(error?.message || 'Unable to refresh the selected exam workspace.');
      return false;
    }
  }, [activeTab, historyExamId, selectedQueryExamId, selectedResultExamId]);

  useEffect(() => {
    if (activeTab === 'monitoring' && monitoringExamId) {
      void refreshMonitoringData();
    }
  }, [activeTab, monitoringExamId, refreshMonitoringData]);

  useEffect(() => {
    if (activeTab !== 'monitoring_history' || !historyExamId) return;
    let cancelled = false;
    setExamRecordError(null);
    setIsLoadingExamRecords(true);
    void Promise.all([
      dbService.getProctoringEvents({ examId: historyExamId }),
      dbService.getAttempts(historyExamId)
    ])
      .then(([events, examAttempts]) => {
        if (cancelled) return;
        setHistoryEvents(events.filter(event => event.examId === historyExamId));
        setHistoryAttempts(examAttempts.filter(attempt => attempt.examId === historyExamId));
      })
      .catch((error: any) => {
        if (!cancelled) {
          setExamRecordError(error?.message || 'Unable to load examination history.');
          setHistoryEvents([]);
          setHistoryAttempts([]);
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoadingExamRecords(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeTab, historyExamId]);

  useEffect(() => {
    if (!selectedProctoringExamId) {
      setProctoringExamResults([]);
      return;
    }
    let cancelled = false;
    const eventRequest = selectedProctoringExamId === monitoringDataExamId
      ? Promise.resolve(null)
      : dbService.getProctoringEvents({ examId: selectedProctoringExamId });
    void Promise.all([eventRequest, dbService.getResults(selectedProctoringExamId)]).then(([events, examResults]) => {
      if (cancelled) return;
      if (events) setProctoringEvents(events.filter(event => event.examId === selectedProctoringExamId));
      setProctoringExamResults(examResults.filter(result => result.examId === selectedProctoringExamId));
    }).catch((error: any) => {
      if (!cancelled) {
        setDirectoryError(error?.message || 'Unable to load proctoring details for this exam.');
        setProctoringEvents([]);
        setProctoringExamResults([]);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [monitoringDataExamId, selectedProctoringExamId]);

  const handleManualRefresh = async () => {
    if (refreshInProgressRef.current) return;
    refreshInProgressRef.current = true;
    try {
    const [localRefresh, monitoringRefresh, workspaceRefresh, globalRefresh] = await Promise.all([
      loadTeacherData(),
      activeTab === 'monitoring' ? refreshMonitoringData() : Promise.resolve(true),
      refreshSelectedExamWorkspace(),
      onRefreshData?.()
    ]);
    if (localRefresh && monitoringRefresh && workspaceRefresh && globalRefresh !== false) setExamPollingEnabled(true);
    } finally {
      refreshInProgressRef.current = false;
    }
  };

  useEffect(() => {
    if (!examPollingEnabled || !['overview', 'exams', 'monitoring', 'monitoring_history', 'results', 'queries'].includes(activeTab)) {
      return;
    }
    const interval = window.setInterval(() => {
      if (refreshInProgressRef.current || realtimeService.isConnected()) return;
      refreshInProgressRef.current = true;
      void Promise.all([
        refreshMonitoringData(),
        refreshSelectedExamWorkspace(),
        onRefreshExamData?.(user)
      ])
        .finally(() => {
          refreshInProgressRef.current = false;
        });
    }, 5000);
    return () => window.clearInterval(interval);
  }, [activeTab, examPollingEnabled, onRefreshExamData, refreshMonitoringData, refreshSelectedExamWorkspace, user]);

  useEffect(
    () =>
      realtimeService.subscribeStatus(status => {
        if (status.connected && status.reconnected) {
          void refreshMonitoringData();
          void refreshSelectedExamWorkspace();
        }
      }),
      [onRefreshExamData, refreshMonitoringData, refreshSelectedExamWorkspace, user]
  );

  const handleAssistanceReview = (
    requestId: string,
    status: 'APPROVED' | 'REJECTED'
  ) => {
    const approved = status === 'APPROVED';
    confirmAction({
      title: approved ? 'Approve examination resume' : 'Reject assistance and submit exam',
      message: approved
        ? 'Allow this student to resume the same preserved examination attempt?'
        : 'Rejecting this request will submit the student\'s current attempt and close the examination.',
      confirmLabel: approved ? 'Approve resume' : 'Reject and submit',
      cancelLabel: 'Cancel',
      variant: approved ? 'primary' : 'danger',
      consequence: approved
        ? 'The existing attempt resumes with its saved answers, warning history, question position, and server timer.'
        : 'The existing answers and proctoring history are preserved, but the submitted attempt cannot be resumed.',
      action: async () => {
        try {
          const request = await dbService.reviewUnblockRequest(
            requestId,
            status,
            approved
              ? 'Faculty approved resumption of the suspended attempt.'
              : 'Attempt remains suspended pending further review.'
          );
          setAssistanceRequests(previous => [
            request,
            ...previous.filter(item => item.requestId !== request.requestId)
          ]);
          const { attempt } = await dbService.getAttemptById(request.attemptId);
          setAttempts(previous => [
            attempt,
            ...previous.filter(item => item.attemptId !== attempt.attemptId)
          ]);
          setMonitoringLastUpdated(new Date());
          setFeedbackBanner({
            type: 'success',
            message: approved
              ? 'Student may resume the preserved attempt.'
              : 'The assistance request was rejected and the attempt was submitted.'
          });
        } catch (error: any) {
          setFeedbackBanner({
            type: 'error',
            message: error?.message || 'Unable to review this assistance request.'
          });
        }
      }
    });
  };

  useEffect(() => {
    loadTeacherData();
  }, [loadTeacherData]);

  useEffect(() => {
    const timer = window.setInterval(() => setMonitoringNow(Date.now()), 15000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    refreshAiReviewData();
  }, [refreshAiReviewData]);

  useEffect(() => {
    const unsub = realtimeService.subscribe(payload => {
      const data = payload.data as Record<string, any> | undefined;
      if (payload.event === 'exam.deleted' && typeof data?.examId === 'string') {
        setAttempts(previous => previous.filter(attempt => attempt.examId !== data.examId));
        setProctoringEvents(previous => previous.filter(event => event.examId !== data.examId));
        setAssistanceRequests(previous => previous.filter(request => request.examId !== data.examId));
        setExamResults(previous => previous.filter(result => result.examId !== data.examId));
        setExamQueries(previous => previous.filter(query => query.examId !== data.examId));
        if (monitoringExamId === data.examId) setMonitoringExamId('');
        if (historyExamId === data.examId) setHistoryExamId('');
        if (selectedResultExamId === data.examId) setSelectedResultExamId(null);
        if (selectedQueryExamId === data.examId) setSelectedQueryExamId(null);
        return;
      }
      if (payload.event === 'monitoring.updated' && data?.attempt) {
        const incoming = data.attempt as ExamAttemptRecord;
        if (incoming.examId !== monitoringExamId) return;
        setAttempts(previous => [
          incoming,
          ...previous.filter(attempt => attempt.attemptId !== incoming.attemptId)
        ]);
        setMonitoringLastUpdated(new Date());
        return;
      }
      if (payload.event === 'proctoring.event' && data?.event) {
        const incoming = data.event as ProctoringEventRecord;
        if (
          incoming.examId !== monitoringExamId &&
          incoming.examId !== historyExamId &&
          incoming.examId !== selectedProctoringExamId
        ) return;
        setProctoringEvents(previous => [
          incoming,
          ...previous.filter(event => event.eventId !== incoming.eventId)
        ]);
        if (incoming.examId === historyExamId) {
          setHistoryEvents(previous => [incoming, ...previous.filter(event => event.eventId !== incoming.eventId)]);
        }
        setMonitoringLastUpdated(new Date());
        return;
      }
      if ((payload.event === 'unblock.created' || payload.event === 'unblock.updated') && data?.request) {
        const incoming = data.request as AssistanceRequestRecord;
        if (incoming.examId !== monitoringExamId) return;
        setAssistanceRequests(previous => [
          incoming,
          ...previous.filter(request => request.requestId !== incoming.requestId)
        ]);
        if (data.attempt) {
          const attempt = data.attempt as ExamAttemptRecord;
          if (attempt.examId !== monitoringExamId) return;
          setAttempts(previous => [
            attempt,
            ...previous.filter(item => item.attemptId !== attempt.attemptId)
          ]);
        }
        setMonitoringLastUpdated(new Date());
        return;
      }
      if (payload.event === 'attempt.suspended' && data?.attemptId) {
        setAttempts(previous => previous.map(attempt => attempt.attemptId === data.attemptId
          ? {
              ...attempt,
              suspended: true,
              proctoringStatus: 'SUSPENDED',
              warningCount: data.warningCount ?? attempt.warningCount
            }
          : attempt));
        setMonitoringLastUpdated(new Date());
        return;
      }
      if (payload.event.startsWith('query.') && data?.query) {
        const incoming = mapBackendQueryToFrontend(data.query);
        if (incoming.examId === selectedQueryExamId) {
          setExamQueries(previous => [incoming, ...previous.filter(query => query.queryId !== incoming.queryId)]);
        }
        return;
      }
      if (
        (payload.event === 'result.created' || payload.event === 'result.updated' ||
          payload.event === 'result.published') &&
        data?.result
      ) {
        const incoming = mapBackendResultToFrontend(data.result);
        if (incoming.examId === selectedResultExamId) {
          setExamResults(previous => [incoming, ...previous.filter(result => result.resultId !== incoming.resultId)]);
        }
        if (incoming.examId === selectedProctoringExamId) {
          setProctoringExamResults(previous => [incoming, ...previous.filter(result => result.resultId !== incoming.resultId)]);
        }
        return;
      }
      if (payload.event === 'attempt.resumed' && data?.attemptId) {
        setAttempts(previous => previous.map(attempt => attempt.attemptId === data.attemptId
          ? { ...attempt, suspended: false, proctoringStatus: 'WARNED' }
          : attempt));
        setMonitoringLastUpdated(new Date());
        return;
      }
      if (
        payload.event === 'student.updated' &&
        data?.student
      ) {
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
    });
    const unsubStatus = realtimeService.subscribeStatus(status => {
      setMonitoringRealtimeConnected(status.connected);
      if (status.connected && status.reconnected) void loadTeacherData(false);
    });
    return () => {
      unsub();
      unsubStatus();
    };
  }, [historyExamId, loadTeacherData, monitoringExamId, selectedProctoringExamId, selectedQueryExamId, selectedResultExamId]);

  const handleOpenStudentDetails = async (studentId: string) => {
    setIsLoadingStudentDetails(true);
    setSelectedStudentDetails(null);
    try {
      const details = await dbService.getStudentDetails(studentId);
      setSelectedStudentDetails(details);
    } catch (err: any) {
      setFeedbackBanner({
        type: 'error',
        message: err.message || 'Failed to load student details.'
      });
    } finally {
      setIsLoadingStudentDetails(false);
    }
  };

  // Open Modal for New / Edit Question
  const openCreateQuestionModal = () => {
    setEditingQuestion(null);
    setQuestionError(null);
    setQuestionForm({
      subject: SUBJECTS[0],
      topic: '',
      difficulty: Difficulty.MEDIUM,
      text: '',
      options: ['', '', '', ''],
      correctAnswerIndex: 0,
      marks: 2,
      negativeMarks: 0,
      explanation: ''
    });
    setShowQuestionModal(true);
  };

  const openEditQuestionModal = (q: Question) => {
    setEditingQuestion(q);
    setQuestionError(null);
    setQuestionForm({
      subject: q.subject || q.topic || SUBJECTS[0],
      topic: q.topic || q.subject || '',
      difficulty: q.difficulty || Difficulty.MEDIUM,
      text: q.text,
      options: q.options.length >= 2 ? [...q.options] : ['', '', '', ''],
      correctAnswerIndex: q.correctAnswer ?? 0,
      marks: q.marks || 2,
      negativeMarks: q.negativeMarks || 0,
      explanation: q.explanation || ''
    });
    setShowQuestionModal(true);
  };

  const handleSaveQuestionSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setQuestionError(null);
    if (!questionForm.text.trim()) {
      setQuestionError('Question text is required.');
      return;
    }
    if (questionForm.options.some(o => !o.trim())) {
      setQuestionError('All options must have non-empty text.');
      return;
    }

    setIsSavingQuestion(true);
    try {
      const payload: Question = {
        id: editingQuestion ? editingQuestion.questionId || editingQuestion.id : '',
        questionId: editingQuestion?.questionId,
        subject: questionForm.subject,
        topic: questionForm.topic.trim() || questionForm.subject,
        difficulty: questionForm.difficulty,
        text: questionForm.text.trim(),
        options: questionForm.options.map(o => o.trim()),
        correctAnswer: questionForm.correctAnswerIndex,
        marks: Number(questionForm.marks) || 2,
        negativeMarks: Number(questionForm.negativeMarks) || 0,
        explanation: questionForm.explanation.trim()
      };

      if (editingQuestion) {
        await onUpdateQuestion(payload);
        setFeedbackBanner({ type: 'success', message: 'Question updated in Question Bank.' });
      } else {
        await onAddQuestion(payload);
        setFeedbackBanner({ type: 'success', message: 'Question saved to Question Bank.' });
      }
      setShowQuestionModal(false);
    } catch (err: any) {
      setQuestionError(err.message || 'Failed to save question.');
    } finally {
      setIsSavingQuestion(false);
    }
  };

  const handleSyllabusFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null;
    setAiError(null);
    setSyllabusFile(file);
    setExtractedSyllabus(null);
    setSelectedSyllabusUnits([]);
    if (!file) return;

    if (file.size > 10 * 1024 * 1024) {
      setAiError('Syllabus file size exceeds maximum limit of 10 MB.');
      setSyllabusFile(null);
      return;
    }
    if (!/\.(pdf|docx|txt)$/i.test(file.name)) {
      setAiError('Choose a PDF, DOCX, or TXT syllabus file.');
      setSyllabusFile(null);
    }
  };

  const handleUploadSyllabus = async () => {
    if (!syllabusFile || isExtractingSyllabus) return;
    if (!aiCourse || !aiSemester || !aiTopic) {
      setAiError('Select the course, semester, and subject before uploading the syllabus.');
      return;
    }
    setAiError(null);
    setIsExtractingSyllabus(true);
    try {
      const uploaded = await dbService.uploadSyllabus(syllabusFile, {
        course: aiCourse,
        semester: aiSemester,
        subject: aiTopic
      });
      setExtractedSyllabus(uploaded);
      setSelectedSyllabusUnits([]);
      setFeedbackBanner({
        type: 'success',
        message: `Uploaded ${uploaded.fileName} (${uploaded.wordCount || 0} extracted words).`
      });
    } catch (err: any) {
      setExtractedSyllabus(null);
      setAiError(err.message || 'Failed to upload or extract the syllabus.');
    } finally {
      setIsExtractingSyllabus(false);
    }
  };

  const handleGenerateAIDrafts = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isGeneratingAI) return;
    if (!Number.isInteger(aiCount) || aiCount < 1 || aiCount > 200) {
      setAiError('Question count must be a whole number between 1 and 200.');
      return;
    }
    if (!extractedSyllabus?.syllabusId) {
      setAiError('Upload and extract a syllabus before generating questions.');
      return;
    }
    setAiError(null);
    setIsGeneratingAI(true);
    setAiStatus((current) => current ? { ...current, status: 'GENERATING', message: 'Generating syllabus-grounded questions.' } : current);
    try {
      const generated = await generateQuestionsWithAI(
        aiSubtopic.trim() ? `${aiTopic} - ${aiSubtopic.trim()}` : aiTopic,
        aiDifficulty,
        aiCount,
        aiMarks,
        {
          syllabusId: extractedSyllabus.syllabusId,
          subject: aiTopic,
          course: aiCourse,
          semester: aiSemester,
          topic: aiSubtopic.trim() || undefined,
          selectedUnits: selectedSyllabusUnits,
          questionType: aiQuestionType
        }
      );
      await refreshAiReviewData();
      setFeedbackBanner({
        type: 'success',
        message: `Generated ${generated.length} draft question(s) for teacher review.`
      });
    } catch (err: any) {
      setAiError(err.message || 'AI Question Generation is unavailable.');
      if (err.code === 'SYLLABUS_SUBJECT_MISMATCH') {
        setAiStatus((current) => current ? {
          ...current,
          status: !current.configured
            ? 'NOT_CONFIGURED'
            : current.pendingReviewCount ? 'PENDING_REVIEW' : 'READY',
          message: current.configured
            ? 'AI Question Generation with Syllabus Upload is active.'
            : current.message
        } : current);
      } else {
        setAiStatus((current) => current ? { ...current, status: 'ERROR', message: err.message || 'AI question generation failed.' } : current);
      }
    } finally {
      setIsGeneratingAI(false);
    }
  };

  const handleApproveAndSaveDraft = async (draft: Question) => {
    const draftId = draft.questionId || draft.id;
    if (savingDraftIds[draftId]) return;
    setSavingDraftIds(prev => ({ ...prev, [draftId]: true }));
    try {
      await dbService.approveAiDraft(draftId);
      await refreshAiReviewData();
      setFeedbackBanner({
        type: 'success',
        message: 'Approved question saved to Question Bank.'
      });
    } catch (err: any) {
      setAiError(err.message || 'Failed to approve AI draft.');
      setFeedbackBanner({
        type: 'error',
        message: err.message || 'Failed to save AI draft to Question Bank.'
      });
    } finally {
      setSavingDraftIds(prev => ({ ...prev, [draftId]: false }));
    }
  };

  const handleSaveEditedDraft = async () => {
    if (!editingDraftId || !editingDraftForm || savingDraftIds[editingDraftId]) return;
    setSavingDraftIds(prev => ({ ...prev, [editingDraftId]: true }));
    try {
      const updated = await dbService.updateAiDraft(editingDraftForm);
      setAiDrafts(prev => prev.map(draft => (draft.questionId === editingDraftId ? updated : draft)));
      setEditingDraftId(null);
      setEditingDraftForm(null);
    } catch (err: any) {
      setAiError(err.message || 'Failed to update AI draft.');
    } finally {
      setSavingDraftIds(prev => ({ ...prev, [editingDraftId]: false }));
    }
  };

  const handleDiscardDraft = async (draft: Question) => {
    const draftId = draft.questionId || draft.id;
    if (savingDraftIds[draftId]) return;
    setSavingDraftIds(prev => ({ ...prev, [draftId]: true }));
    try {
      await dbService.discardAiDraft(draftId);
      await refreshAiReviewData();
    } catch (err: any) {
      setAiError(err.message || 'Failed to discard AI draft.');
    } finally {
      setSavingDraftIds(prev => ({ ...prev, [draftId]: false }));
    }
  };

  const handleApproveAllDrafts = async () => {
    for (const draft of [...aiDrafts]) {
      await handleApproveAndSaveDraft(draft);
    }
  };

  const handleCreateStudent = async (e: React.FormEvent) => {
    e.preventDefault();
    setStudentCreateError(null);
    if (!studentForm.course.trim()) {
      setStudentCreateError('Please select a course / program.');
      return;
    }
    if (!studentForm.department.trim()) {
      setStudentCreateError('Please select a department.');
      return;
    }
    setIsCreatingStudent(true);
    try {
      const dobYear = studentForm.dob ? new Date(studentForm.dob).getFullYear() : undefined;
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
        department: user?.department || '',
        course: '',
        academicYear: '',
        semester: '',
        section: '',
        assignedTeacherId: user?.userId || user?.id || '',
        rollNumber: ''
      });
      setGeneratedStudentCreds({
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
      setStudentCreateError(err.message || 'Failed to create student account.');
    } finally {
      setIsCreatingStudent(false);
    }
  };

  const departmentOptions = Array.from(
    new Set([
      ...DEPARTMENTS,
      ...(user?.department ? [user.department.trim()] : []),
      ...students.map(s => s.department?.trim()).filter((d): d is string => Boolean(d))
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

  const teacherOptions = (() => {
    const map = new Map<string, { value: string; label: string; subtitle?: string }>();
    if (user && (user.userId || user.id)) {
      const uid = user.userId || user.id;
      map.set(uid, {
        value: uid,
        label: `${user.name} (${uid})`,
        subtitle: user.department || undefined
      });
    }
    students.forEach(s => {
      (s.assignedTeachers || []).forEach(t => {
        if (t.userId && !map.has(t.userId)) {
          map.set(t.userId, {
            value: t.userId,
            label: `${t.name || t.userId} (${t.userId})`,
            subtitle: t.department || undefined
          });
        }
      });
    });
    return Array.from(map.values());
  })();

  const handleToggleStudentStatus = (student: SystemUser) => {
    const isBlocking = student.status === 'ACTIVE';
    const isUnblocking = student.status === 'BLOCKED';
    const actionLabel = isBlocking ? 'Block' : isUnblocking ? 'Unblock' : 'Activate';

    confirmAction({
      title: `${actionLabel} Student`,
      message: `Are you sure you want to ${actionLabel.toLowerCase()} ${student.name}?`,
      confirmLabel: `Yes, ${actionLabel}`,
      cancelLabel: 'No',
      variant: isBlocking ? 'danger' : 'primary',
      details: [
        { label: 'Student Name', value: student.name },
        { label: 'Student ID', value: student.userId || student.id },
        { label: 'Current Status', value: student.status },
        { label: 'Program / Cohort', value: student.course || student.department || '—' }
      ],
      consequence: isBlocking
        ? 'Blocking this student will immediately revoke their ability to start or continue examinations and submit coursework.'
        : 'Activating this student will restore their examination scheduling and testing privileges.',
      action: async () => {
        const nextStatus = isBlocking ? 'BLOCKED' : 'ACTIVE';
        try {
          const updatedStudent = await dbService.updateUserStatus(student.userId || student.id, nextStatus);
          setStudents(previous => previous.map(item =>
            (item.userId || item.id) === (updatedStudent.userId || updatedStudent.id)
              ? updatedStudent
              : item
          ));
          setSelectedStudentDetails(previous =>
            previous && (previous.student.userId || previous.student.id) === (updatedStudent.userId || updatedStudent.id)
              ? { ...previous, student: updatedStudent }
              : previous
          );
          setFeedbackBanner({
            type: 'success',
            message: `Student ${student.name} status updated to ${nextStatus}.`
          });
        } catch (err: any) {
          setFeedbackBanner({
            type: 'error',
            message: err.message || 'Failed to update student status.'
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
            terminationReason: 'Faculty / Proctoring policy violation'
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

  const filteredQuestions = questions.filter(q => {
    const matchesSubject =
      selectedSubject === 'ALL' || q.subject === selectedSubject || q.topic === selectedSubject;
    const matchesSearch =
      !questionSearch.trim() ||
      q.text.toLowerCase().includes(questionSearch.toLowerCase()) ||
      (q.topic || '').toLowerCase().includes(questionSearch.toLowerCase());
    return matchesSubject && matchesSearch;
  });
  const isAiQuestion = (question: Question) =>
    question.source === 'AI_GENERATED' || question.createdBy === 'AI';
  const batchQuestionIds = new Set(aiGenerationBatches.flatMap((batch) => batch.questionIds || []));
  const filteredManualQuestions = filteredQuestions.filter((question) => !isAiQuestion(question));
  const filteredUnbatchedAiQuestions = filteredQuestions.filter(
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
  const questionBankSubjects = Array.from(new Set([
    ...questions.map((question) => question.subject || question.topic),
    ...aiGenerationBatches.map((batch) => batch.subject)
  ].filter(Boolean))).sort((left, right) => left.localeCompare(right));
  const matchingAiBatchQuestionCount = aiGenerationBatches
    .filter((batch) => {
      if (selectedSubject !== 'ALL' && batch.subject.toLocaleLowerCase() !== selectedSubject.toLocaleLowerCase()) return false;
      const term = questionSearch.trim().toLocaleLowerCase();
      const metadataMatches = !term || [
        batch.generationId,
        batch.subject,
        batch.course,
        batch.semester,
        batch.topic,
        batch.sourceFileName,
        batch.generatedByName,
        batch.generatedBy,
        batch.reviewStatus
      ].some((value) => value.toLocaleLowerCase().includes(term));
      const questionMatches = !term || (batch.questionIds || []).some((questionId) => {
        const question = questions.find((item) => (item.questionId || item.id) === questionId);
        return question?.text.toLocaleLowerCase().includes(term);
      });
      return metadataMatches || questionMatches;
    })
    .reduce((total, batch) => {
      if (!questionSearch.trim() || [
        batch.generationId,
        batch.subject,
        batch.course,
        batch.semester,
        batch.topic,
        batch.sourceFileName,
        batch.generatedByName,
        batch.generatedBy,
        batch.reviewStatus
      ].some((value) => value.toLocaleLowerCase().includes(questionSearch.trim().toLocaleLowerCase()))) {
        return total + (batch.questionIds?.length || batch.generatedCount);
      }
      return total + (batch.questionIds || []).filter((questionId) => {
        const question = questions.find((item) => (item.questionId || item.id) === questionId);
        return question?.text.toLocaleLowerCase().includes(questionSearch.trim().toLocaleLowerCase());
      }).length;
    }, 0);
  const aiDraftGroupMap = aiDrafts.reduce<Record<string, { generationId: string; questions: Question[] }>>((groups, draft) => {
      const generationId = draft.generationId || 'LEGACY';
      groups[generationId] ||= { generationId, questions: [] };
      groups[generationId].questions.push(draft);
      return groups;
    }, {});
  const aiDraftGroups = Object.keys(aiDraftGroupMap).map((generationId) => aiDraftGroupMap[generationId]);

  // Authoritative Real Metrics Derived Directly from Database State
  const activeStudentsCount = students.filter(s => s.status === 'ACTIVE').length;
  const inactiveStudentsCount = students.filter(s => s.status !== 'ACTIVE').length;
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
  const uniqueSubjectsCount = Array.from(
    new Set(questions.map(q => q.subject?.trim() || q.topic?.trim()).filter(Boolean))
  ).length;

  const publishedResultsCount = examResults.filter(
    r => r.isPublished || r.status === 'PUBLISHED'
  ).length;
  const unpublishedResultsCount = examResults.length - publishedResultsCount;
  const passedResultsCount = examResults.filter(
    r => r.passed === true || (r.percentage ?? r.accuracy ?? 0) >= 40
  ).length;

  const openQueriesCount = examQueries.filter(
    q => q.status === 'OPEN' || q.status === 'PENDING' || q.status === 'UNDER_REVIEW'
  ).length;
  const visibleQueries = examQueries.filter(query => {
    const pending = ['OPEN', 'PENDING', 'UNDER_REVIEW'].includes(query.status);
    const resolved = ['RESOLVED', 'APPROVED', 'REJECTED', 'RESOLVED_ACCEPTED', 'RESOLVED_REJECTED'].includes(query.status);
    return queryStatusFilter === 'ALL' || (queryStatusFilter === 'PENDING' ? pending : resolved);
  });
  const resolvedQueriesCount = examQueries.filter(
    q =>
      q.status === 'RESOLVED' ||
      q.status === 'APPROVED' ||
      q.status === 'REJECTED' ||
      q.status === 'RESOLVED_ACCEPTED' ||
      q.status === 'RESOLVED_REJECTED'
  ).length;

  const monitoringExams = exams.filter(exam => exam.status === 'LIVE');
  const matchingMonitoringExams = monitoringExams.filter(exam =>
    !monitoringExamSearch.trim() ||
    [exam.examId, exam.title, exam.subject]
      .some(value => value?.toLocaleLowerCase().includes(monitoringExamSearch.trim().toLocaleLowerCase()))
  );
  const monitoringExamPageCount = Math.max(1, Math.ceil(matchingMonitoringExams.length / 25));
  const pageMonitoringExams = matchingMonitoringExams.slice((monitoringExamPage - 1) * 25, monitoringExamPage * 25);
  const selectedMonitoringExam = monitoringExams.find(
    exam => (exam.examId || exam.id) === monitoringExamId
  );
  const selectedMonitoringExamId = selectedMonitoringExam?.examId || selectedMonitoringExam?.id || '';
  const selectedFacultyProctoringEvents = proctoringEvents
    .filter(event => event.examId === selectedProctoringExamId)
    .sort((first, second) => new Date(second.timestamp).getTime() - new Date(first.timestamp).getTime());
  const selectedResultExam = exams.find(exam => (exam.examId || exam.id) === selectedResultExamId);
  const selectedQueryExam = exams.find(exam => (exam.examId || exam.id) === selectedQueryExamId);
  const historyExams = exams.filter(exam =>
    ['ENDED', 'CLOSED', 'COMPLETED', 'RESULT_PUBLISHED', 'ARCHIVED'].includes(exam.status)
  );
  const matchingHistoryExams = historyExams.filter(exam =>
    !recordSearch.trim() ||
    [exam.examId, exam.title, exam.subject]
      .some(value => value?.toLocaleLowerCase().includes(recordSearch.trim().toLocaleLowerCase()))
  );
  const selectedHistoryExam = historyExams.find(exam => (exam.examId || exam.id) === historyExamId);
  const normalizedRecordSearch = recordSearch.trim().toLocaleLowerCase();
  const matchingExams = exams.filter(exam =>
    !normalizedRecordSearch ||
    [exam.examId, exam.title, exam.subject]
      .some(value => value?.toLocaleLowerCase().includes(normalizedRecordSearch))
  );
  const matchingExamResults = examResults.filter(result =>
    !normalizedRecordSearch ||
    [result.resultId, result.studentName, result.studentId]
      .some(value => value?.toLocaleLowerCase().includes(normalizedRecordSearch))
  );
  const matchingExamQueries = visibleQueries.filter(query =>
    !normalizedRecordSearch ||
    [query.queryId, query.studentName, query.studentId, query.questionText, query.message]
      .some(value => value?.toLocaleLowerCase().includes(normalizedRecordSearch))
  );
  const recordPageSize = 25;
  const examPageCount = Math.max(1, Math.ceil(matchingExams.length / recordPageSize));
  const resultPageCount = Math.max(1, Math.ceil(matchingExamResults.length / recordPageSize));
  const queryPageCount = Math.max(1, Math.ceil(matchingExamQueries.length / recordPageSize));
  const pageExams = matchingExams.slice((recordPage - 1) * recordPageSize, recordPage * recordPageSize);
  const historyExamPageCount = Math.max(1, Math.ceil(matchingHistoryExams.length / recordPageSize));
  const pageHistoryExams = matchingHistoryExams.slice((recordPage - 1) * recordPageSize, recordPage * recordPageSize);
  const pageResults = matchingExamResults.slice((recordPage - 1) * recordPageSize, recordPage * recordPageSize);
  const pageQueries = matchingExamQueries.slice((recordPage - 1) * recordPageSize, recordPage * recordPageSize);
  const historyPageCount = Math.max(1, Math.ceil(historyEvents.length / recordPageSize));
  const pageHistoryEvents = historyEvents.slice((recordPage - 1) * recordPageSize, recordPage * recordPageSize);

  useEffect(() => {
    if (monitoringExamId && !monitoringExams.some(exam => (exam.examId || exam.id) === monitoringExamId)) {
      setMonitoringExamId('');
      setAttempts([]);
      setProctoringEvents([]);
      setAssistanceRequests([]);
      setMonitoringDataExamId('');
    }
  }, [monitoringExamId, monitoringExams]);
  const monitoringExamAttempts = attempts
    .filter(attempt => attempt.examId === selectedMonitoringExamId)
    .slice()
    .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
  const monitoringAttemptByStudent = new Map<string, ExamAttemptRecord>();
  monitoringExamAttempts.forEach(attempt => {
    if (!monitoringAttemptByStudent.has(attempt.studentId)) {
      monitoringAttemptByStudent.set(attempt.studentId, attempt);
    }
  });
  const monitoringEventByStudent = new Map<string, ProctoringEventRecord>();
  proctoringEvents
    .filter(event => event.examId === selectedMonitoringExamId)
    .slice()
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .forEach(event => {
      if (!monitoringEventByStudent.has(event.studentId)) {
        monitoringEventByStudent.set(event.studentId, event);
      }
    });
  const monitoringAssistanceByStudent = new Map<string, AssistanceRequestRecord>();
  const monitoringAssistanceByAttempt = new Map<string, AssistanceRequestRecord>();
  assistanceRequests
    .filter(request => request.examId === selectedMonitoringExamId)
    .slice()
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .forEach(request => {
      if (!monitoringAssistanceByStudent.has(request.studentId)) {
        monitoringAssistanceByStudent.set(request.studentId, request);
      }
      if (!monitoringAssistanceByAttempt.has(request.attemptId)) {
        monitoringAssistanceByAttempt.set(request.attemptId, request);
      }
    });
  const assignedMonitoringStudentIds = new Set([
    ...(selectedMonitoringExam?.assignedStudentIds || []),
    ...monitoringExamAttempts.map(attempt => attempt.studentId)
  ]);
  const monitoringStudents = Array.from(assignedMonitoringStudentIds).map(studentId => {
    const student = students.find(item => item.userId === studentId);
    const attempt = monitoringAttemptByStudent.get(studentId);
    const lastEvent = monitoringEventByStudent.get(studentId);
    const assistance = attempt
      ? monitoringAssistanceByAttempt.get(attempt.attemptId)
      : monitoringAssistanceByStudent.get(studentId);
    const warningCount = attempt?.warningCount || lastEvent?.warningCountAfter || 0;
    const risk: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' | 'N/A' =
      !attempt
        ? 'N/A'
        : attempt.suspended || attempt.status === 'TERMINATED' || warningCount >= 5
        ? 'CRITICAL'
        : attempt?.proctoringStatus === 'FLAGGED' || warningCount >= 3
        ? 'HIGH'
        : attempt?.proctoringStatus === 'WARNED' || warningCount > 0
        ? 'MEDIUM'
        : attempt?.proctoringStatus === 'CLEAN'
        ? 'LOW'
        : 'N/A';
    const lastHeartbeatTime = attempt?.lastHeartbeatAt
      ? new Date(attempt.lastHeartbeatAt).getTime()
      : 0;
    const connection: 'ONLINE' | 'OFFLINE' | 'N/A' =
      !attempt || attempt.status !== 'IN_PROGRESS'
        ? 'N/A'
        : lastHeartbeatTime > 0 && monitoringNow - lastHeartbeatTime < 45000
        ? 'ONLINE'
        : 'OFFLINE';
    const totalQuestions =
      selectedMonitoringExam?.questionCount ||
      selectedMonitoringExam?.questionIds?.length ||
      attempt?.answers.length ||
      0;
    const answered = attempt?.answers.filter(answer => Boolean(answer.selectedOption)).length || 0;
    const isSubmitted = Boolean(attempt && ['SUBMITTED', 'EVALUATED', 'EXPIRED'].includes(attempt.status));
    const status =
      !attempt ? 'NOT_STARTED'
      : attempt.suspended ? 'SUSPENDED'
      : isSubmitted ? 'SUBMITTED'
      : connection === 'OFFLINE' ? 'OFFLINE'
      : risk !== 'LOW' || assistance?.status === 'PENDING' ? 'NEEDS_ATTENTION'
      : attempt.status === 'IN_PROGRESS' ? 'ACTIVE'
      : attempt.status;
    const lastActivityAt = [
      attempt?.lastHeartbeatAt,
      lastEvent?.timestamp,
      attempt?.submittedAt,
      attempt?.startedAt
    ]
      .filter((value): value is string => Boolean(value))
      .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0];
    return {
      studentId,
      studentName: student?.name || attempt?.studentName || studentId,
      attempt,
      totalQuestions,
      answered,
      progress: totalQuestions ? Math.round((answered / totalQuestions) * 100) : 0,
      currentQuestion: attempt ? Math.min((attempt.currentQuestionIndex || 0) + 1, totalQuestions || 1) : 0,
      risk,
      warningCount,
      connection,
      status,
      assistance,
      lastEvent,
      lastActivityAt,
      remainingSeconds: attempt?.expiresAt && attempt.status === 'IN_PROGRESS'
        ? Math.max(0, Math.floor((new Date(attempt.expiresAt).getTime() - monitoringNow) / 1000))
        : 0
    };
  });
  const riskOrder: Record<string, number> = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1, 'N/A': 0 };
  const getWarningMatch = (warningCount: number) => {
    if (monitoringWarningsFilter === '0') return warningCount === 0;
    if (monitoringWarningsFilter === '1-2') return warningCount >= 1 && warningCount <= 2;
    if (monitoringWarningsFilter === '3-4') return warningCount >= 3 && warningCount <= 4;
    if (monitoringWarningsFilter === '5') return warningCount >= 5;
    return true;
  };
  const filteredMonitoringStudents = monitoringStudents
    .filter(row => {
      const query = monitoringSearch.trim().toLowerCase();
      return (!query || `${row.studentName} ${row.studentId}`.toLowerCase().includes(query)) &&
        (monitoringStatusFilter === 'ALL' || row.status === monitoringStatusFilter) &&
        (monitoringRiskFilter === 'ALL' ||
          (monitoringRiskFilter === 'HIGH_RISK' && (row.risk === 'HIGH' || row.risk === 'CRITICAL')) ||
          row.risk === monitoringRiskFilter) &&
        getWarningMatch(row.warningCount) &&
        (monitoringConnectionFilter === 'ALL' || row.connection === monitoringConnectionFilter) &&
        (monitoringProgressFilter === 'ALL' ||
          (monitoringProgressFilter === 'NOT_STARTED' && row.status === 'NOT_STARTED') ||
          (monitoringProgressFilter === 'IN_PROGRESS' && ['ACTIVE', 'NEEDS_ATTENTION', 'OFFLINE', 'SUSPENDED'].includes(row.status)) ||
          (monitoringProgressFilter === 'ALMOST_FINISHED' && row.progress >= 80 && ['ACTIVE', 'NEEDS_ATTENTION', 'OFFLINE', 'SUSPENDED'].includes(row.status)) ||
          (monitoringProgressFilter === 'SUBMITTED' && row.status === 'SUBMITTED')) &&
        (monitoringAssistanceFilter === 'ALL' ||
          (monitoringAssistanceFilter === 'NONE' && !row.assistance) ||
          row.assistance?.status === monitoringAssistanceFilter);
    })
    .sort((a, b) => {
      switch (monitoringSort) {
        case 'WARNINGS': return b.warningCount - a.warningCount || riskOrder[b.risk] - riskOrder[a.risk];
        case 'LAST_ACTIVITY': return new Date(b.lastActivityAt || 0).getTime() - new Date(a.lastActivityAt || 0).getTime();
        case 'PROGRESS': return b.progress - a.progress;
        case 'TIME':
          if (Boolean(a.attempt && a.attempt.status === 'IN_PROGRESS') !== Boolean(b.attempt && b.attempt.status === 'IN_PROGRESS')) {
            return a.attempt?.status === 'IN_PROGRESS' ? -1 : 1;
          }
          return a.remainingSeconds - b.remainingSeconds;
        case 'NAME': return a.studentName.localeCompare(b.studentName);
        default: return riskOrder[b.risk] - riskOrder[a.risk] ||
          new Date(b.lastActivityAt || 0).getTime() - new Date(a.lastActivityAt || 0).getTime();
      }
    });
  const monitoringPageCount = Math.max(1, Math.ceil(filteredMonitoringStudents.length / monitoringPageSize));
  const currentMonitoringPage = Math.min(monitoringPage, monitoringPageCount);
  const pagedMonitoringStudents = filteredMonitoringStudents.slice(
    (currentMonitoringPage - 1) * monitoringPageSize,
    currentMonitoringPage * monitoringPageSize
  );
  const visibleMonitoringPages = Array.from(
    { length: Math.min(5, monitoringPageCount) },
    (_, index) => Math.max(1, Math.min(monitoringPageCount - 4, currentMonitoringPage - 2)) + index
  );
  const attentionRows = monitoringStudents
    .filter(row => ['NEEDS_ATTENTION', 'SUSPENDED', 'OFFLINE'].includes(row.status))
    .sort((a, b) => riskOrder[b.risk] - riskOrder[a.risk] ||
      new Date(b.lastEvent?.timestamp || b.lastActivityAt || 0).getTime() -
      new Date(a.lastEvent?.timestamp || a.lastActivityAt || 0).getTime());
  const riskCounts = {
    LOW: monitoringStudents.filter(row => row.risk === 'LOW').length,
    MEDIUM: monitoringStudents.filter(row => row.risk === 'MEDIUM').length,
    HIGH: monitoringStudents.filter(row => row.risk === 'HIGH').length,
    CRITICAL: monitoringStudents.filter(row => row.risk === 'CRITICAL').length
  };
  const studentsWithRiskData = Object.values(riskCounts).reduce((sum, count) => sum + count, 0);
  const monitoringCounts = {
    TOTAL: monitoringStudents.length,
    ACTIVE: monitoringStudents.filter(row => row.status === 'ACTIVE').length,
    NEEDS_ATTENTION: monitoringStudents.filter(row => row.status === 'NEEDS_ATTENTION').length,
    SUSPENDED: monitoringStudents.filter(row => row.status === 'SUSPENDED').length,
    SUBMITTED: monitoringStudents.filter(row => row.status === 'SUBMITTED').length,
    OFFLINE: monitoringStudents.filter(row => row.status === 'OFFLINE').length,
    HIGH_RISK: monitoringStudents.filter(row => row.risk === 'HIGH' || row.risk === 'CRITICAL').length,
    FACULTY_REQUESTS: monitoringStudents.filter(row => row.assistance?.status === 'PENDING').length
  };
  const statusDistribution = [
    ['NOT_STARTED', 'Not Started'],
    ['ACTIVE', 'Active'],
    ['NEEDS_ATTENTION', 'Needs Attention'],
    ['SUSPENDED', 'Suspended'],
    ['SUBMITTED', 'Submitted'],
    ['OFFLINE', 'Offline']
  ] as const;
  const trendBuckets = Array.from({ length: 6 }, (_, index) => {
    const end = monitoringNow - (5 - index) * 10 * 60 * 1000;
    const start = end - 10 * 60 * 1000;
    const count = proctoringEvents.filter(event => {
      const timestamp = new Date(event.timestamp).getTime();
      return event.examId === selectedMonitoringExamId && timestamp >= start && timestamp < end &&
        event.eventType !== 'WINDOW_FOCUS' && event.eventType !== 'CAMERA_CONNECTED' &&
        event.eventType !== 'FACE_DETECTED' && event.eventType !== 'FACE_STATUS';
    }).length;
    return { label: new Date(start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), count };
  });
  const maxTrendEvents = Math.max(1, ...trendBuckets.map(bucket => bucket.count));
  const monitoringAlerts = attentionRows.map(row => {
    const message = row.status === 'SUSPENDED'
      ? `${row.studentName} reached ${row.warningCount}/5 warnings`
      : row.status === 'OFFLINE'
      ? `${row.studentName} is offline`
      : row.lastEvent
      ? `${row.studentName}: ${row.lastEvent.message || row.lastEvent.eventType}`
      : `${row.studentName} needs attention`;
    return {
      ...row,
      alertSeverity: row.status === 'OFFLINE' && row.risk === 'LOW' ? 'MEDIUM' : row.risk,
      message
    };
  });
  const monitoringExamStart = selectedMonitoringExam?.startAt
    ? new Date(selectedMonitoringExam.startAt).getTime()
    : NaN;
  const monitoringExamEnd = selectedMonitoringExam?.endAt
    ? new Date(selectedMonitoringExam.endAt).getTime()
    : NaN;
  const monitoringExamElapsedMinutes = Number.isFinite(monitoringExamStart)
    ? Math.max(0, Math.floor((monitoringNow - monitoringExamStart) / 60000))
    : null;
  const monitoringExamRemainingMinutes = Number.isFinite(monitoringExamEnd)
    ? Math.max(0, Math.ceil((monitoringExamEnd - monitoringNow) / 60000))
    : null;
  const applyMonitoringKpiFilter = (filter: string) => {
    setMonitoringSearch('');
    setMonitoringWarningsFilter('ALL');
    setMonitoringConnectionFilter('ALL');
    setMonitoringProgressFilter('ALL');
    setMonitoringStatusFilter(filter === 'HIGH_RISK' || filter === 'FACULTY_REQUESTS' ? 'ALL' : filter);
    setMonitoringRiskFilter(filter === 'HIGH_RISK' ? 'HIGH_RISK' : 'ALL');
    setMonitoringAssistanceFilter(filter === 'FACULTY_REQUESTS' ? 'PENDING' : 'ALL');
    setMonitoringPage(1);
  };
  const pendingAssistanceRequests = assistanceRequests
    .filter(request => request.examId === selectedMonitoringExamId && request.status === 'PENDING')
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  const openMonitoringStudent = (studentId: string) => {
    const attempt = monitoringExamAttempts.find(item => item.studentId === studentId);
    if (attempt) setSelectedMonitoringAttempt(attempt);
  };
  const exportSelectedMonitoringStudents = () => {
    const selectedRows = monitoringStudents.filter(row => selectedMonitoringStudentIds.has(row.studentId));
    const csv = [
      ['Student', 'Student ID', 'Exam', 'Status', 'Progress', 'Current Question', 'Risk', 'Warnings', 'Connection', 'Assistance'],
      ...selectedRows.map(row => [
        row.studentName,
        row.studentId,
        selectedMonitoringExam?.title || '',
        row.status,
        `${row.progress}%`,
        row.currentQuestion ? `Q${row.currentQuestion}/${row.totalQuestions}` : '',
        row.risk,
        `${row.warningCount}/5`,
        row.connection,
        row.assistance?.status || 'NONE'
      ])
    ].map(line => line.map(value => `"${String(value).replace(/"/g, '""')}"`).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${selectedMonitoringExamId || 'exam'}-monitoring-selection.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <PageMotionShell>
      <div className="w-full max-w-[1440px] mx-auto px-4 md:px-6 lg:px-8 py-7 space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-slate-200 dark:border-slate-800 pb-4">
        <div>
          <h1 className="text-[22px] font-semibold text-slate-900 dark:text-white leading-tight tracking-[-0.015em]">
            {activeTab === 'overview' && 'Dashboard'}
            {activeTab === 'students' && 'Students'}
            {activeTab === 'exams' && 'Exams'}
            {activeTab === 'questions' && 'Question Bank'}
            {activeTab === 'ai_generator' && 'AI Question Generation'}
            {activeTab === 'monitoring' && 'Exam Monitoring'}
            {activeTab === 'monitoring_history' && 'Monitoring History'}
            {activeTab === 'results' && 'Results'}
            {activeTab === 'queries' && 'Queries'}
            {activeTab === 'profile' && 'Profile'}
          </h1>
          <p className="text-[13px] font-normal text-slate-500 dark:text-slate-400 mt-1">
            {user?.name} · ID: {user?.userId || user?.id} · {user?.department || 'Faculty'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() => void handleManualRefresh()}
            className="h-9 px-3.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-[13px] font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 inline-flex items-center gap-1.5 transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoadingDirectory ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          <button
            type="button"
            onClick={() => setShowCreateStudentModal(true)}
            className="h-9 px-3.5 rounded-lg bg-slate-900 dark:bg-slate-700 hover:bg-slate-800 text-white text-[13px] font-medium inline-flex items-center gap-1.5 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" /> Add Student
          </button>
          <button
            type="button"
            onClick={openCreateQuestionModal}
            className="h-11 px-4 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-[14.5px] font-medium inline-flex items-center gap-2 transition-colors"
          >
            <Plus className="w-4 h-4" /> Add Question
          </button>
        </div>
      </div>

      {/* Feedback Banner */}
      {feedbackBanner && (
        <div
          className={`p-4 rounded-xl border flex items-center justify-between text-[15px] ${
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
      {directoryError && (
        <div className="p-4 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5 text-[15px] text-red-700 dark:text-red-300">
            <AlertCircle className="w-5 h-5 shrink-0" />
            <span>{directoryError}</span>
          </div>
          <button
            type="button"
            onClick={loadTeacherData}
            className="h-10 px-4 rounded-lg bg-red-600 text-white text-[14px] font-medium"
          >
            Try again
          </button>
        </div>
      )}

      {/* 1. OVERVIEW TAB */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          {/* Real Backend Modern KSI Summary Grid */}
          <ScrollReveal className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
            <KpiCard
              label="Supervised Students"
              value={students.length}
              subValue={`${activeStudentsCount} Active · ${inactiveStudentsCount} Inactive`}
              icon={<Users className="w-5 h-5 text-blue-600 dark:text-blue-400" />}
              isLoading={isLoadingDirectory}
              onClick={() => onNavigateTab('students')}
            />

            <KpiCard
              label="Exams"
              value={exams.length}
              subValue={`${activeExamsCount} Active · ${draftExamsCount} Draft`}
              icon={<FileText className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />}
              onClick={() => onNavigateTab('exams')}
            />

            <KpiCard
              label="Question Bank"
              value={questions.length}
              subValue={`${aiQuestionsCount} AI · ${manualQuestionsCount} Manual`}
              icon={<BookOpen className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />}
              onClick={() => onNavigateTab('questions')}
            />

            <KpiCard
              label="Exam Queries"
              value="By exam"
              subValue="Open a selected exam to review"
              icon={<MessageSquare className="w-5 h-5 text-amber-600 dark:text-amber-400" />}
              onClick={() => onNavigateTab('queries')}
            />
            <KpiCard
              label="Exam Results"
              value="By exam"
              subValue="Open a selected exam to review"
              icon={<CheckCircle className="w-5 h-5 text-teal-600 dark:text-teal-400" />}
              onClick={() => onNavigateTab('results')}
            />
            <KpiCard
              label="High-Risk Students"
              value={monitoringCounts.HIGH_RISK}
              subValue="Open monitoring at high-risk filter"
              icon={<Shield className="w-5 h-5 text-rose-600 dark:text-rose-400" />}
              isLoading={isLoadingDirectory}
              onClick={() => {
                setMonitoringRiskFilter('HIGH_RISK');
                onNavigateTab('monitoring');
              }}
            />

            {aiDrafts.length > 0 && (
              <KpiCard
                label="Pending AI Review"
                value={aiDrafts.length}
                subValue="Awaiting teacher approval"
                icon={<Sparkles className="w-5 h-5 text-purple-600 dark:text-purple-400" />}
                onClick={() => onNavigateTab('ai_generator')}
              />
            )}
          </ScrollReveal>

          <ScrollReveal className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Recent Exams */}
            <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-[20px] font-semibold text-slate-900 dark:text-white leading-snug">
                  Exams
                </h2>
                <button
                  type="button"
                  onClick={() => onNavigateTab('exams')}
                  className="text-[14px] font-medium text-blue-600 dark:text-blue-400 hover:underline"
                >
                  Manage exams
                </button>
              </div>
              {exams.length === 0 ? (
                <p className="text-[15px] text-slate-500 dark:text-slate-400 py-8 text-center">
                  No examinations yet.
                </p>
              ) : (
                <div className="divide-y divide-slate-100 dark:divide-slate-700/60">
                  {exams.slice(0, 5).map(ex => (
                    <div key={ex.id} className="py-3 flex items-center justify-between text-[14.5px]">
                      <div>
                        <p className="font-medium text-slate-900 dark:text-white">{ex.title}</p>
                        <p className="text-[13px] text-slate-500 dark:text-slate-400 mt-0.5 tabular-nums">
                          {ex.subject} · {ex.durationMinutes} mins · {ex.totalMarks} marks
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

            {/* Exam results workspace shortcut */}
            <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-[20px] font-semibold text-slate-900 dark:text-white leading-snug">
                  Results by exam
                </h2>
                <button
                  type="button"
                  onClick={() => onNavigateTab('results')}
                  className="text-[14px] font-medium text-blue-600 dark:text-blue-400 hover:underline"
                >
                  Select exam
                </button>
              </div>
              <p className="py-8 text-center text-sm text-slate-500 dark:text-slate-400">
                Results are loaded only after selecting an authorized exam.
              </p>
            </div>
          </ScrollReveal>
        </div>
      )}

      {/* 2. STUDENTS TAB */}
      {activeTab === 'students' && (
        <div className="space-y-6">
          {/* Supervised Students KSI Summary */}
          <ScrollReveal className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiCard
              label="Supervised Students"
              value={students.length}
              subValue={`${activeStudentsCount} Active · ${inactiveStudentsCount} Inactive`}
              icon={<Users className="w-5 h-5 text-blue-600 dark:text-blue-400" />}
              isLoading={isLoadingDirectory}
            />
            <KpiCard
              label="Active Students"
              value={activeStudentsCount}
              subValue={`${inactiveStudentsCount} Inactive / Blocked`}
              icon={<Users className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />}
              isLoading={isLoadingDirectory}
            />
            <KpiCard
              label="Academic Cohorts"
              value={`${studentCoursesCount} Courses`}
              subValue={`${studentDeptsCount} Departments`}
              icon={<BookOpen className="w-5 h-5 text-purple-600 dark:text-purple-400" />}
              isLoading={isLoadingDirectory}
            />
            <KpiCard
              label="Exam Queries"
              value="Scoped"
              subValue="Review queries in the exam workspace"
              icon={<MessageSquare className="w-5 h-5 text-amber-600 dark:text-amber-400" />}
              onClick={() => onNavigateTab('queries')}
              isLoading={isLoadingDirectory}
            />
          </ScrollReveal>

          <ScrollReveal className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
            <div className="p-6 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
              <h2 className="text-[20px] font-semibold text-slate-900 dark:text-white leading-snug">
                Students ({students.length})
              </h2>
            <button
              type="button"
              onClick={() => setShowCreateStudentModal(true)}
              className="h-11 px-4 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-[14.5px] font-medium inline-flex items-center justify-center"
            >
              Add Student
            </button>
            </div>

          {students.length === 0 ? (
            <div className="p-12 text-center text-[15px] text-slate-500 dark:text-slate-400">
              No students yet.
            </div>
          ) : (
            <ScrollReveal className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-900/50 text-slate-500 dark:text-slate-400 text-[13.5px] font-semibold border-b border-slate-200 dark:border-slate-700">
                    <th className="p-3.5">Student ID</th>
                    <th className="p-3.5">Name</th>
                    <th className="p-3.5">Course</th>
                    <th className="p-3.5">Department</th>
                    <th className="p-3.5">Semester</th>
                    <th className="p-3.5">Assigned Teacher</th>
                    <th className="p-3.5">Status</th>
                    <th className="p-3.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-700 text-[14.5px]">
                  {students.map(s => (
                    <tr key={s.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/30">
                      <td className="p-3.5 font-mono text-[14px] font-medium tabular-nums">
                        <button
                          type="button"
                          onClick={() => handleOpenStudentDetails(s.userId || s.id)}
                          className="text-blue-600 dark:text-blue-400 hover:underline"
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
                        <div className="text-[13px] text-slate-500">{s.email || s.phone || ''}</div>
                      </td>
                      <td className="p-3.5 text-slate-600 dark:text-slate-300">
                        {s.course || '—'}
                      </td>
                      <td className="p-3.5 text-slate-600 dark:text-slate-300">
                        {s.department || '—'}
                      </td>
                      <td className="p-3.5 text-slate-600 dark:text-slate-300">
                        {s.semester || s.academicYear || '—'}
                      </td>
                      <td className="p-3.5 text-slate-600 dark:text-slate-300">
                        {s.assignedTeacherName || user?.name || s.assignedTeacherId || '—'}
                      </td>
                      <td className="p-3.5">
                        <span
                          className={`inline-block px-2.5 py-0.5 rounded-md text-[12.5px] font-medium ${
                            s.status === 'ACTIVE'
                              ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
                              : 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300'
                          }`}
                        >
                          {s.status}
                        </span>
                      </td>
                      <td className="p-3.5 text-right whitespace-nowrap space-x-2">
                        <button
                          type="button"
                          onClick={() => handleOpenStudentDetails(s.userId || s.id)}
                          className="h-9 px-3 rounded-lg border border-blue-200 dark:border-blue-800 text-[14px] font-medium text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20"
                        >
                          View Details
                        </button>
                        <button
                          type="button"
                          onClick={() => handleToggleStudentStatus(s)}
                          className="h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-700 text-[14px] font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
                        >
                          {s.status === 'ACTIVE' ? 'Block' : s.status === 'BLOCKED' ? 'Unblock' : 'Activate'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollReveal>
          )}
        </ScrollReveal>
        </div>
      )}

      {/* 3. EXAMS TAB */}
      {activeTab === 'exams' && (
        <ScrollReveal>
        <TeacherExamScheduler
          exams={exams}
          questions={questions}
          generationBatches={aiGenerationBatches}
          students={students}
          onSaveExam={onSaveExam}
          onDeleteExam={undefined}
          onStatusChange={onStatusChange}
          onRequestGenerateQuestions={(ctx) => {
            setSavedExamDraft({
              formData: ctx.currentFormData,
              editingExam: ctx.editingExam,
              autoOpen: true
            });
            if (ctx.subject) {
              setAiTopic(ctx.subject);
            }
            if (ctx.course) setAiCourse(ctx.course);
            if (ctx.semester) setAiSemester(ctx.semester);
            if (ctx.examTitle) {
              setAiSubtopic(ctx.examTitle);
            }
            onNavigateTab('ai_generator');
          }}
          savedDraft={savedExamDraft}
        />
        </ScrollReveal>
      )}

      {/* 4. QUESTION BANK TAB */}
      {activeTab === 'questions' && (
        <div className="space-y-6">
          {/* Question Bank KSI Summary */}
          <ScrollReveal className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiCard
              label="Total Questions"
              value={questions.length}
              subValue={`${uniqueSubjectsCount} Subjects`}
              icon={<BookOpen className="w-5 h-5 text-blue-600 dark:text-blue-400" />}
            />
            <KpiCard
              label="Active Questions"
              value={activeQuestionsCount}
              subValue={`${draftQuestionsCount} Drafts`}
              icon={<BookOpen className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />}
            />
            <KpiCard
              label="AI Generated"
              value={aiQuestionsCount}
              subValue="Generated from syllabus/AI"
              icon={<Sparkles className="w-5 h-5 text-purple-600 dark:text-purple-400" />}
            />
            <KpiCard
              label="Faculty Authored"
              value={manualQuestionsCount}
              subValue="Authored questions"
              icon={<FileText className="w-5 h-5 text-amber-600 dark:text-amber-400" />}
            />
          </ScrollReveal>

          <ScrollReveal className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
            <div className="p-6 border-b border-slate-200 dark:border-slate-700 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
              <h2 className="text-[20px] font-semibold text-slate-900 dark:text-white leading-snug">
                Question Bank ({filteredManualQuestions.length + filteredUnbatchedAiQuestions.length + matchingAiBatchQuestionCount})
              </h2>
            <div className="flex flex-wrap items-center gap-3 w-full sm:w-auto">
              <select
                value={selectedSubject}
                onChange={e => setSelectedSubject(e.target.value)}
                className="h-12 px-3.5 text-[15px] bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-800 dark:text-slate-200"
              >
                <option value="ALL">All Subjects</option>
                {questionBankSubjects.map(sub => (
                  <option key={sub} value={sub}>
                    {sub}
                  </option>
                ))}
              </select>
              <div className="relative flex-1 sm:w-64">
                <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Search questions..."
                  value={questionSearch}
                  onChange={e => setQuestionSearch(e.target.value)}
                  className="w-full h-12 pl-10 pr-3.5 text-[15px] bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white outline-none"
                />
              </div>
              <button
                type="button"
                onClick={openCreateQuestionModal}
                className="h-11 px-4 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-[14.5px] font-medium inline-flex items-center justify-center"
              >
                Add Question
              </button>
            </div>
          </div>

          <ScrollReveal className="p-5">
            <AiGenerationBatchCards
              batches={aiGenerationBatches}
              search={questionSearch}
              subject={selectedSubject}
              questionSearchTextByBatch={questionSearchTextByBatch}
              unbatchedQuestions={filteredUnbatchedAiQuestions}
              onViewQuestion={setSelectedQuestionDetail}
              onEditQuestion={openEditQuestionModal}
              onDeleteQuestion={(question) => {
                confirmAction({
                  title: 'Delete Question',
                  message: 'Are you sure you want to delete this question?',
                  confirmLabel: 'Yes, Delete',
                  cancelLabel: 'No',
                  variant: 'danger',
                  action: async () => {
                    await onDeleteQuestion(question.questionId || question.id);
                  }
                });
              }}
              onReviewBatch={() => onNavigateTab('ai_generator')}
              emptyMessage="No AI generation batches match these filters."
            />
          </ScrollReveal>

          {filteredManualQuestions.length === 0 ? (
            <div className="p-12 text-center text-[15px] text-slate-500 dark:text-slate-400">
              {filteredQuestions.length > 0 || aiGenerationBatches.length > 0
                ? 'No manual questions match these filters.'
                : 'No questions in the question bank.'}
            </div>
          ) : (
            <ScrollReveal className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-900/50 text-slate-500 dark:text-slate-400 text-[13.5px] font-semibold border-b border-slate-200 dark:border-slate-700">
                    <th className="p-3.5">Question ID</th>
                    <th className="p-3.5">Subject</th>
                    <th className="p-3.5">Topic</th>
                    <th className="p-3.5">Type</th>
                    <th className="p-3.5">Difficulty</th>
                    <th className="p-3.5">Marks</th>
                    <th className="p-3.5">Source</th>
                    <th className="p-3.5">Status</th>
                    <th className="p-3.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-700 text-[14.5px]">
                  {filteredManualQuestions.map(q => (
                    <tr key={q.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/30">
                      <td className="p-3.5 font-mono text-[14px] font-medium tabular-nums">
                        <button
                          type="button"
                          onClick={() => setSelectedQuestionDetail(q)}
                          className="text-blue-600 dark:text-blue-400 hover:underline"
                        >
                          {q.questionId || q.id}
                        </button>
                      </td>
                      <td className="p-3.5 text-slate-700 dark:text-slate-300">
                        {q.subject || q.topic}
                      </td>
                      <td className="p-3.5">
                        <button
                          type="button"
                          onClick={() => setSelectedQuestionDetail(q)}
                          className="font-medium text-slate-900 dark:text-white hover:text-blue-600 dark:hover:text-blue-400 text-left line-clamp-1 max-w-xs"
                        >
                          {q.topic || q.text}
                        </button>
                      </td>
                      <td className="p-3.5 text-[14px] text-slate-600 dark:text-slate-300">
                        {q.questionType || 'MCQ'}
                      </td>
                      <td className="p-3.5 text-[14px] font-medium text-slate-700 dark:text-slate-300">
                        {q.difficulty}
                      </td>
                      <td className="p-3.5 text-[14px] font-medium text-slate-700 dark:text-slate-300 tabular-nums">
                        {q.marks || 1}
                      </td>
                      <td className="p-3.5 text-[13.5px] text-slate-600 dark:text-slate-300">
                        {q.source || (q.createdBy === 'AI' ? 'AI' : 'MANUAL')}
                      </td>
                      <td className="p-3.5">
                        <span className="inline-block px-2.5 py-0.5 rounded-md text-[12.5px] font-medium bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
                          {q.status || 'APPROVED'}
                        </span>
                      </td>
                      <td className="p-3.5 text-right whitespace-nowrap space-x-2">
                        <button
                          type="button"
                          onClick={() => setSelectedQuestionDetail(q)}
                          className="h-9 px-3 rounded-lg border border-blue-200 dark:border-blue-800 text-[14px] font-medium text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20"
                        >
                          View
                        </button>
                        <button
                          type="button"
                          onClick={() => openEditQuestionModal(q)}
                          className="h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-700 text-[14px] font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            confirmAction({
                              title: 'Delete Question',
                              message: 'Are you sure you want to delete this question?',
                              confirmLabel: 'Yes, Delete',
                              cancelLabel: 'No',
                              variant: 'danger',
                              action: async () => {
                                await onDeleteQuestion(q.questionId || q.id);
                              }
                            });
                          }}
                          className="h-9 px-3 rounded-lg border border-red-200 dark:border-red-900/50 text-[14px] font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30"
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollReveal>
          )}
        </ScrollReveal>
        </div>
      )}

      {/* 5. AI QUESTION GENERATION TAB */}
      {activeTab === 'ai_generator' && (
        <div className="space-y-6">
          {/* AI Generation KSI Summary */}
          <ScrollReveal className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiCard
              label="AI Engine Status"
              value={
                isGeneratingAI
                  ? 'GENERATING'
                  : aiStatus?.status || (isLoadingAiData ? 'LOADING' : 'ERROR')
              }
              subValue={aiStatus?.message || (isLoadingAiData ? 'Checking backend provider status' : 'AI status unavailable')}
              isLoading={isLoadingAiData && !aiStatus}
              icon={<Sparkles className="w-5 h-5 text-purple-600 dark:text-purple-400" />}
            />
            <KpiCard
              label="Drafts in Review"
              value={aiStatus?.pendingReviewCount ?? 0}
              subValue={isLoadingAiData ? 'Loading from MongoDB' : aiDrafts.length > 0 ? 'Pending teacher review' : 'No pending drafts'}
              isLoading={isLoadingAiData && !aiStatus}
              icon={<BookOpen className="w-5 h-5 text-blue-600 dark:text-blue-400" />}
            />
            <KpiCard
              label="Target Subject"
              value={aiTopic}
              subValue={`${aiDifficulty} · ${aiMarks} marks/Q`}
              icon={<FileText className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />}
            />
            <KpiCard
              label="Syllabus Source"
              value={extractedSyllabus ? `${extractedSyllabus.wordCount || 0} words` : 'No upload'}
              subValue={extractedSyllabus?.fileName || 'A faculty syllabus is required'}
              icon={<Upload className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />}
            />
          </ScrollReveal>

          <ScrollReveal className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-6 space-y-5">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-[20px] font-semibold text-slate-900 dark:text-white flex items-center gap-2.5 leading-snug">
                  <Sparkles className="w-5 h-5 text-blue-600" />
                  AI Question Generation & Syllabus Upload
                </h2>
                <p className="text-[14px] text-slate-500 mt-1">
                  Upload a syllabus document (PDF, DOCX, TXT up to 10 MB) to generate questions for teacher review
                </p>
              </div>
              {aiStatus && (
                <span className="text-[13px] font-medium px-3 py-1 rounded-md bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300">
                  Provider: {aiStatus.status === 'NOT_CONFIGURED' ? 'NOT CONFIGURED' : aiStatus.status}
                </span>
              )}
            </div>

            {aiError && (
              <div className="p-4 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-[14px] text-amber-800 dark:text-amber-300">
                {aiError}
              </div>
            )}

            {savedExamDraft && (
              <div className="p-4 rounded-xl bg-purple-50 dark:bg-purple-950/40 border border-purple-200 dark:border-purple-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="text-[14px] text-purple-900 dark:text-purple-200">
                  <span className="font-semibold">Context Linked:</span> Generating questions for{' '}
                  <span className="font-semibold">
                    {savedExamDraft.formData.title || 'Draft Exam'}
                  </span>{' '}
                  ({savedExamDraft.formData.subject || 'All Subjects'} · {savedExamDraft.formData.course} ·{' '}
                  {savedExamDraft.formData.semester})
                </div>
                <button
                  type="button"
                  onClick={() => onNavigateTab('exams')}
                  className="h-9 px-3.5 rounded-lg bg-purple-600 hover:bg-purple-700 text-white text-[13.5px] font-medium shrink-0 inline-flex items-center gap-1.5 shadow-sm"
                >
                  Return to Create Exam
                </button>
              </div>
            )}

            {/* Syllabus File Upload Zone */}
            <div className="p-5 rounded-xl border border-dashed border-slate-300 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-900/40 space-y-3.5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-3.5">
                  <div className="p-3 rounded-lg bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400">
                    <Upload className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="text-[15px] font-medium text-slate-800 dark:text-slate-200">
                      Upload Course Syllabus
                    </div>
                    <div className="text-[13px] text-slate-500 mt-0.5">
                      Supported formats: PDF, DOCX, TXT · Maximum file size: 10 MB
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2.5">
                  <label className="cursor-pointer h-11 px-4 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-[14.5px] font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 inline-flex items-center justify-center">
                    Choose Syllabus File
                    <input
                      type="file"
                      accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
                      onChange={handleSyllabusFileChange}
                      className="hidden"
                    />
                  </label>
                  {syllabusFile && (
                    <>
                      <button
                        type="button"
                        disabled={isExtractingSyllabus}
                        onClick={handleUploadSyllabus}
                        className="h-11 px-3.5 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-[14px] font-medium text-white inline-flex items-center justify-center"
                      >
                        {isExtractingSyllabus ? 'Uploading...' : 'Upload Syllabus'}
                      </button>
                      <button
                        type="button"
                        disabled={isExtractingSyllabus}
                        onClick={() => {
                          setSyllabusFile(null);
                          setExtractedSyllabus(null);
                        }}
                        className="h-11 px-3.5 rounded-lg text-[14px] font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 inline-flex items-center justify-center"
                      >
                        Clear
                      </button>
                    </>
                  )}
                </div>
              </div>

              {isExtractingSyllabus && (
                <div className="text-[14px] text-blue-600 dark:text-blue-400">
                  Uploading and extracting {syllabusFile?.name}...
                </div>
              )}

              {extractedSyllabus && (
                <div className="p-4 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 space-y-2">
                  <div className="flex items-center justify-between text-[13.5px]">
                    <span className="font-semibold text-emerald-700 dark:text-emerald-400">
                      Extracted: {extractedSyllabus.fileName}
                    </span>
                    <span className="text-slate-500 tabular-nums">
                      {extractedSyllabus.wordCount} words ({extractedSyllabus.charCount} chars)
                    </span>
                  </div>
                  <p className="text-[13.5px] text-slate-600 dark:text-slate-300">
                    {extractedSyllabus.course} · {extractedSyllabus.semester} · {extractedSyllabus.subject}
                  </p>
                  {extractedSyllabus.subjectCompatibility?.compatible === false && (
                    <div
                      role="alert"
                      className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-[13.5px] text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200"
                    >
                      <p className="font-semibold">Syllabus may not match the selected subject.</p>
                      <p className="mt-1">Selected subject: {extractedSyllabus.subjectCompatibility.selectedSubject}</p>
                      <p>Detected syllabus topic: {extractedSyllabus.subjectCompatibility.detectedTopic}</p>
                      <p className="mt-1">Please select the matching subject or upload the correct syllabus.</p>
                    </div>
                  )}
                  {extractedSyllabus.availableUnits?.length ? (
                    <div className="border-t border-slate-100 pt-3 dark:border-slate-700">
                      <div className="mb-2 flex flex-wrap items-center gap-2">
                        <span className="text-[13px] font-medium text-slate-700 dark:text-slate-200">
                          Generate from
                        </span>
                        <button
                          type="button"
                          aria-pressed={selectedSyllabusUnits.length === 0}
                          onClick={() => setSelectedSyllabusUnits([])}
                          className={`rounded-md border px-2.5 py-1 text-[12.5px] ${selectedSyllabusUnits.length === 0 ? 'border-blue-600 bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300' : 'border-slate-200 text-slate-600 dark:border-slate-600 dark:text-slate-300'}`}
                        >
                          All Units
                        </button>
                      </div>
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                        {extractedSyllabus.availableUnits.map((unit) => (
                          <label key={unit} className="flex items-start gap-2 text-[12.5px] text-slate-600 dark:text-slate-300">
                            <input
                              type="checkbox"
                              checked={selectedSyllabusUnits.length === 0 || selectedSyllabusUnits.includes(unit)}
                              onChange={(event) => {
                                if (selectedSyllabusUnits.length === 0) {
                                  if (!event.target.checked) {
                                    setSelectedSyllabusUnits(extractedSyllabus.availableUnits!.filter((item) => item !== unit));
                                  }
                                  return;
                                }
                                const next = event.target.checked
                                  ? [...selectedSyllabusUnits, unit]
                                  : selectedSyllabusUnits.filter((item) => item !== unit);
                                setSelectedSyllabusUnits(
                                  next.length === extractedSyllabus.availableUnits!.length ? [] : next
                                );
                              }}
                              className="mt-0.5"
                            />
                            <span>{unit}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <p className="border-t border-slate-100 pt-3 text-[12.5px] text-slate-500 dark:border-slate-700 dark:text-slate-400">
                      No explicit unit headings were detected. All extracted syllabus content will be used.
                    </p>
                  )}
                </div>
              )}
            </div>

            <form
              onSubmit={handleGenerateAIDrafts}
              className="grid grid-cols-1 sm:grid-cols-6 gap-4 items-end"
            >
              <div className="sm:col-span-3">
                <label className="block text-[14px] font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                  Subject
                </label>
                <CreatableSubjectCombobox
                  value={aiTopic}
                  onChange={value => {
                    setAiTopic(value);
                    setExtractedSyllabus(null);
                    setSelectedSyllabusUnits([]);
                  }}
                  onError={setAiError}
                  required
                />
              </div>
              <div>
                <label className="block text-[14px] font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                  Course
                </label>
                <select
                  value={aiCourse}
                  onChange={e => {
                    setAiCourse(e.target.value);
                    setExtractedSyllabus(null);
                    setSelectedSyllabusUnits([]);
                  }}
                  className="w-full h-12 px-3.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-[15px] text-slate-900 dark:text-white"
                >
                  <option value="">Select course</option>
                  {AI_GENERATION_COURSES.map(course => <option key={course} value={course}>{course}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[14px] font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                  Semester
                </label>
                <select
                  value={aiSemester}
                  onChange={e => {
                    setAiSemester(e.target.value);
                    setExtractedSyllabus(null);
                    setSelectedSyllabusUnits([]);
                  }}
                  className="w-full h-12 px-3.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-[15px] text-slate-900 dark:text-white"
                >
                  <option value="">Select semester</option>
                  {SEMESTERS.map(semester => <option key={semester} value={semester}>{semester}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[14px] font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                  Topic / Subtopic
                </label>
                <input
                  type="text"
                  value={aiSubtopic}
                  onChange={e => setAiSubtopic(e.target.value)}
                  placeholder="e.g., B-Trees & Indexing"
                  className="w-full h-12 px-3.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-[15px] text-slate-900 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-[14px] font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                  Difficulty
                </label>
                <select
                  value={aiDifficulty}
                  onChange={e => setAiDifficulty(e.target.value as Difficulty)}
                  className="w-full h-12 px-3.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-[15px] text-slate-900 dark:text-white"
                >
                  <option value={Difficulty.EASY}>EASY</option>
                  <option value={Difficulty.MEDIUM}>MEDIUM</option>
                  <option value={Difficulty.HARD}>HARD</option>
                </select>
              </div>
              <div>
                <label className="block text-[14px] font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                  Marks / Question
                </label>
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={aiMarks}
                  onChange={e => setAiMarks(Number(e.target.value))}
                  className="w-full h-12 px-3.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-[15px] text-slate-900 dark:text-white tabular-nums"
                />
              </div>
              <div>
                <label className="block text-[14px] font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                  Count (1–200)
                </label>
                <input
                  type="number"
                  min={1}
                  max={200}
                  value={aiCount}
                  onChange={e => setAiCount(Number(e.target.value))}
                  required
                  className="w-full h-12 px-3.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-[15px] text-slate-900 dark:text-white tabular-nums"
                />
              </div>
              <button
                type="submit"
                disabled={isGeneratingAI || isExtractingSyllabus || !extractedSyllabus?.syllabusId || extractedSyllabus.subjectCompatibility?.compatible === false || !Number.isInteger(aiCount) || aiCount < 1 || aiCount > 200}
                className="h-12 px-4 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-[14.5px] font-medium inline-flex items-center justify-center"
              >
                {isGeneratingAI ? 'Generating...' : 'Generate Drafts'}
              </button>
            </form>
          </ScrollReveal>

          {/* Teacher Review Queue */}
          <ScrollReveal className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-[20px] font-semibold text-slate-900 dark:text-white leading-snug">
                  Teacher Review Queue ({aiDrafts.length})
                </h3>
                <p className="text-[14px] text-slate-500 mt-0.5">
                  Review, edit, approve, or discard AI-generated questions before adding to the Question Bank
                </p>
              </div>
              {aiDrafts.length > 1 && (
                <button
                  type="button"
                  disabled={Object.values(savingDraftIds).some(Boolean)}
                  onClick={handleApproveAllDrafts}
                  className="h-11 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-[14px] font-medium inline-flex items-center justify-center"
                >
                  Approve & Save All ({aiDrafts.length})
                </button>
              )}
            </div>
            {aiDrafts.length === 0 ? (
              <p className="text-[15px] text-slate-500 dark:text-slate-400 py-8 text-center">
                {isLoadingAiData ? 'Loading drafts from MongoDB...' : 'No generated drafts pending review.'}
              </p>
            ) : (
              <div className="space-y-4">
                {aiDraftGroups.map(group => {
                  const batch = aiGenerationBatches.find(item => item.generationId === group.generationId);
                  return (
                  <section key={group.generationId} className="space-y-3 rounded-xl border border-purple-200 p-4 dark:border-purple-900/60">
                    <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <h4 className="text-[14px] font-semibold text-purple-800 dark:text-purple-300">
                          {batch ? `Generation ${batch.generationId}` : 'Earlier AI generation'}
                        </h4>
                        {batch && (
                          <p className="text-[12.5px] text-slate-500 dark:text-slate-400">
                            {batch.subject} · {batch.course} · {batch.semester} · {batch.topic} · {batch.generatedCount} questions
                          </p>
                        )}
                      </div>
                      <span className="text-[12.5px] text-slate-500 dark:text-slate-400">
                        {group.questions.length} pending review
                      </span>
                    </div>
                    <div className="space-y-3.5">
                    {group.questions.map(draft => (
                  <div
                    key={draft.questionId || draft.id}
                    className="rounded-xl border border-slate-200 p-5 space-y-3.5 dark:border-slate-700"
                  >
                    {editingDraftId === draft.id && editingDraftForm ? (
                      <div className="space-y-3.5">
                        <textarea
                          rows={2}
                          value={editingDraftForm.text}
                          onChange={e => setEditingDraftForm({ ...editingDraftForm, text: e.target.value })}
                          className="w-full px-3.5 py-2.5 text-[15px] bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white"
                        />
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                          {editingDraftForm.options.map((option, index) => (
                            <div key={index} className="flex items-center gap-2.5">
                              <input
                                type="radio"
                                checked={editingDraftForm.correctAnswer === index}
                                onChange={() => setEditingDraftForm({ ...editingDraftForm, correctAnswer: index })}
                              />
                              <input
                                type="text"
                                value={option}
                                onChange={event => {
                                  const options = [...editingDraftForm.options];
                                  options[index] = event.target.value;
                                  setEditingDraftForm({ ...editingDraftForm, options });
                                }}
                                className="flex-1 h-11 px-3 text-[14.5px] bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white"
                              />
                            </div>
                          ))}
                        </div>
                        <div className="flex justify-end gap-2.5">
                          <button
                            type="button"
                            onClick={() => { setEditingDraftId(null); setEditingDraftForm(null); }}
                            className="h-10 px-3.5 rounded-lg border border-slate-200 dark:border-slate-700 text-[14px] font-medium text-slate-600 dark:text-slate-400"
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            disabled={savingDraftIds[draft.questionId || draft.id]}
                            onClick={handleSaveEditedDraft}
                            className="h-10 px-4 rounded-lg bg-blue-600 disabled:opacity-50 text-white text-[14px] font-medium"
                          >
                            {savingDraftIds[draft.questionId || draft.id] ? 'Saving...' : 'Save Changes'}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-3.5">
                        <div className="flex flex-col sm:flex-row sm:justify-between items-start gap-4">
                          <div className="min-w-0">
                            <div className="text-[13px] text-slate-500 mb-1">
                              {draft.subject || aiTopic} · {draft.difficulty} · {draft.marks || aiMarks} marks
                            </div>
                            <p className="text-[15px] font-medium text-slate-900 dark:text-white break-words">
                              {draft.text}
                            </p>
                            {draft.syllabusUnit && (
                              <p className="text-[13px] text-slate-500 mt-2 break-words">
                                {draft.syllabusUnit} · {draft.syllabusTopic} · Source: {draft.sourceReference}
                              </p>
                            )}
                          </div>
                          <div className="flex flex-wrap items-center justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => { setEditingDraftId(draft.id); setEditingDraftForm({ ...draft }); }}
                              className="h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-700 text-[14px] font-medium text-slate-700 dark:text-slate-300"
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              disabled={savingDraftIds[draft.questionId || draft.id]}
                              onClick={() => handleApproveAndSaveDraft(draft)}
                              className="h-9 px-3.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-[14px] font-medium"
                            >
                              {savingDraftIds[draft.questionId || draft.id] ? 'Saving...' : 'Approve'}
                            </button>
                            <button
                              type="button"
                              disabled={savingDraftIds[draft.questionId || draft.id]}
                              onClick={() => handleDiscardDraft(draft)}
                              className="h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-700 disabled:opacity-50 text-[14px] font-medium text-slate-600 dark:text-slate-400"
                            >
                              Discard
                            </button>
                          </div>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {draft.options.map((option, index) => (
                            <div
                              key={index}
                              className={`text-[14px] px-3 py-2 rounded-lg border ${
                                index === draft.correctAnswer
                                  ? 'border-emerald-300 dark:border-emerald-700 bg-emerald-50/40 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-300 font-medium'
                                  : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400'
                              }`}
                            >
                              {String.fromCharCode(65 + index)}. {option}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                    ))}
                    </div>
                  </section>
                  );
                })}
              </div>
            )}
          </ScrollReveal>
          </div>
      )}

      {/* 6. EXAM MONITORING (PROCTORING) TAB */}
      {activeTab === 'monitoring' && (
        <ScrollReveal className="space-y-5">
          {!selectedMonitoringExamId && (
          <section className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-4 dark:border-slate-700">
              <h2 className="text-base font-semibold text-slate-900 dark:text-white">
                Live exams ({monitoringExams.length})
              </h2>
              <input aria-label="Search live exams" value={monitoringExamSearch} onChange={event => { setMonitoringExamSearch(event.target.value); setMonitoringExamPage(1); }} placeholder="Search live exams..." className="h-9 w-full max-w-xs rounded-lg border border-slate-200 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200" />
            </div>
            {monitoringExams.length === 0 ? (
                <p className="p-10 text-center text-sm text-slate-500 dark:text-slate-400">
                  No exams are currently live.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-500 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-400">
                        <th className="p-3">Exam ID</th>
                        <th className="p-3">Exam Title</th>
                        <th className="p-3">Subject</th>
                        <th className="p-3">Scheduled</th>
                        <th className="p-3"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-sm dark:divide-slate-700">
                      {pageMonitoringExams.map(exam => (
                        <tr key={exam.examId || exam.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/30">
                          <td className="p-3 font-mono text-blue-600 dark:text-blue-400">{exam.examId || exam.id}</td>
                          <td className="p-3 font-medium text-slate-900 dark:text-white">{exam.title}</td>
                          <td className="p-3 text-slate-600 dark:text-slate-300">{exam.subject || exam.course}</td>
                          <td className="p-3 text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">
                            {exam.scheduledDate} · {exam.startTime}
                          </td>
                          <td className="p-3 text-right">
                            <button
                              type="button"
                              onClick={() => {
                                setMonitoringExamId(exam.examId || exam.id);
                                setMonitoringPage(1);
                              }}
                              className="text-sm font-semibold text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
                            >
                              Open monitor
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3 text-xs dark:border-slate-700"><span>Page {monitoringExamPage} of {monitoringExamPageCount} · {matchingMonitoringExams.length} exams</span><div className="flex gap-2"><button type="button" disabled={monitoringExamPage <= 1} onClick={() => setMonitoringExamPage(page => Math.max(1, page - 1))} className="rounded border border-slate-200 px-3 py-1 disabled:opacity-40 dark:border-slate-700">Previous</button><button type="button" disabled={monitoringExamPage >= monitoringExamPageCount} onClick={() => setMonitoringExamPage(page => Math.min(monitoringExamPageCount, page + 1))} className="rounded border border-slate-200 px-3 py-1 disabled:opacity-40 dark:border-slate-700">Next</button></div></div>
                </div>
              )}
          </section>
          )}
          {selectedMonitoringExamId && (
          <>
          <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setMonitoringExamId('')}
                    className="mr-2 inline-flex items-center rounded-md border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-700"
                  >
                    ← Back to live exams
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedProctoringExamId(selectedMonitoringExamId)}
                    className="rounded-md border border-blue-200 px-2.5 py-1 text-xs font-medium text-blue-700 hover:bg-blue-50 dark:border-blue-800 dark:text-blue-300 dark:hover:bg-blue-950/30"
                  >
                    Proctoring insights
                  </button>
                  {selectedMonitoringExam?.status === 'LIVE' && (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-50 px-2.5 py-1 text-[11px] font-bold tracking-wide text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
                      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-rose-500" /> LIVE
                    </span>
                  )}
                  <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
                    {selectedMonitoringExam?.title || 'Live Exam Command Center'}
                  </h2>
                  {selectedMonitoringExam && (
                    <span className="rounded-md bg-slate-100 px-2 py-1 font-mono text-xs text-slate-600 dark:bg-slate-700 dark:text-slate-300">
                      {selectedMonitoringExam.subject || selectedMonitoringExam.course}
                    </span>
                  )}
                </div>
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
                  <span className="font-mono">{selectedMonitoringExamId || 'No active exam selected'}</span>
                  <span>{monitoringCounts.TOTAL} assigned students</span>
                  {selectedMonitoringExam?.durationMinutes ? <span>{selectedMonitoringExam.durationMinutes} min exam</span> : null}
                  {selectedMonitoringExam?.status === 'LIVE' && monitoringExamElapsedMinutes !== null
                    ? <span>Elapsed {monitoringExamElapsedMinutes} min</span>
                    : null}
                  {selectedMonitoringExam?.status === 'LIVE' && monitoringExamRemainingMinutes !== null
                    ? <span>{monitoringExamRemainingMinutes} min remaining</span>
                    : null}
                  {monitoringLastUpdated && <span>Updated {monitoringLastUpdated.toLocaleTimeString()}</span>}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className={`inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold ${monitoringRealtimeConnected ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300' : 'bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300'}`}>
                  {monitoringRealtimeConnected ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
                  {monitoringRealtimeConnected ? 'Live connection' : 'Reconnecting'}
                </span>
                <button
                  type="button"
                  onClick={() => void refreshMonitoringData()}
                  className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200 px-3 text-[13px] text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-700"
                >
                  <RefreshCw className="h-3.5 w-3.5" /> Refresh
                </button>
              </div>
            </div>
          </section>

          {!selectedMonitoringExam ? (
            <div className="rounded-xl border border-slate-200 bg-white py-14 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
              No active students
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-8">
                {([
                  ['TOTAL', 'Total students', 'text-slate-900 dark:text-white', 'ALL'],
                  ['ACTIVE', 'Active', 'text-blue-700 dark:text-blue-300', 'ACTIVE'],
                  ['NEEDS_ATTENTION', 'Needs attention', 'text-amber-700 dark:text-amber-300', 'NEEDS_ATTENTION'],
                  ['SUSPENDED', 'Suspended', 'text-rose-700 dark:text-rose-300', 'SUSPENDED'],
                  ['SUBMITTED', 'Submitted', 'text-emerald-700 dark:text-emerald-300', 'SUBMITTED'],
                  ['OFFLINE', 'Offline', 'text-orange-700 dark:text-orange-300', 'OFFLINE'],
                  ['HIGH_RISK', 'High risk', 'text-red-700 dark:text-red-300', 'HIGH_RISK'],
                  ['FACULTY_REQUESTS', 'Faculty requests', 'text-indigo-700 dark:text-indigo-300', 'FACULTY_REQUESTS']
                ] as const).map(([key, label, color, filter]) => (
                  <button
                    type="button"
                    key={key}
                    onClick={() => applyMonitoringKpiFilter(filter)}
                    className="rounded-lg border border-slate-200 bg-white p-3 text-left transition-colors hover:border-blue-300 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:hover:border-blue-700 dark:hover:bg-slate-800/80"
                  >
                    <span className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</span>
                    <span className={`mt-1 block text-xl font-semibold tabular-nums ${color}`}>
                      {monitoringCounts[key]}
                    </span>
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.3fr_1fr_1fr]">
                <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
                  <h3 className="mb-3 text-sm font-semibold text-slate-900 dark:text-white">Exam status distribution</h3>
                  <div className="flex h-3 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700" role="group" aria-label="Filter students by status">
                    {statusDistribution.map(([status, label]) => {
                      const count = monitoringStudents.filter(row => row.status === status).length;
                      const width = monitoringCounts.TOTAL ? (count / monitoringCounts.TOTAL) * 100 : 0;
                      const colors: Record<string, string> = {
                        NOT_STARTED: 'bg-slate-300', ACTIVE: 'bg-blue-500', NEEDS_ATTENTION: 'bg-amber-500',
                        SUSPENDED: 'bg-rose-600', SUBMITTED: 'bg-emerald-500', OFFLINE: 'bg-orange-500'
                      };
                      return width > 0 ? (
                        <button
                          type="button"
                          key={status}
                          title={`${label}: ${count}`}
                          aria-label={`Filter ${label}: ${count} students`}
                          onClick={() => { setMonitoringStatusFilter(status); setMonitoringPage(1); }}
                          className={`${colors[status]} h-full hover:brightness-90`}
                          style={{ width: `${width}%` }}
                        />
                      ) : null;
                    })}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2">
                    {statusDistribution.map(([status, label]) => {
                      const count = monitoringStudents.filter(row => row.status === status).length;
                      return (
                        <button
                          type="button"
                          key={status}
                          onClick={() => { setMonitoringStatusFilter(status); setMonitoringPage(1); }}
                          className="inline-flex items-center gap-1.5 text-xs text-slate-600 hover:text-blue-700 dark:text-slate-300 dark:hover:text-blue-300"
                        >
                          <span className={`h-2 w-2 rounded-full ${status === 'ACTIVE' ? 'bg-blue-500' : status === 'NEEDS_ATTENTION' ? 'bg-amber-500' : status === 'SUSPENDED' ? 'bg-rose-600' : status === 'SUBMITTED' ? 'bg-emerald-500' : status === 'OFFLINE' ? 'bg-orange-500' : 'bg-slate-400'}`} />
                          {label} <span className="font-semibold tabular-nums">{count}</span>
                        </button>
                      );
                    })}
                  </div>
                </section>

                <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
                  <h3 className="mb-3 text-sm font-semibold text-slate-900 dark:text-white">Risk overview</h3>
                  <div className="space-y-2.5">
                    {(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const).map(level => {
                      const count = riskCounts[level];
                      const percent = studentsWithRiskData ? Math.round((count / studentsWithRiskData) * 100) : 0;
                      return (
                        <button
                          type="button"
                          key={level}
                          onClick={() => { setMonitoringRiskFilter(level); setMonitoringPage(1); }}
                          className="grid w-full grid-cols-[70px_1fr_32px_38px] items-center gap-2 text-left text-xs"
                        >
                          <span className={`font-semibold ${level === 'CRITICAL' || level === 'HIGH' ? 'text-rose-700 dark:text-rose-300' : level === 'MEDIUM' ? 'text-amber-700 dark:text-amber-300' : 'text-emerald-700 dark:text-emerald-300'}`}>{level}</span>
                          <span className="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700">
                            <span className={`block h-full rounded-full ${level === 'CRITICAL' || level === 'HIGH' ? 'bg-rose-500' : level === 'MEDIUM' ? 'bg-amber-500' : 'bg-emerald-500'}`} style={{ width: `${percent}%` }} />
                          </span>
                          <span className="text-right font-semibold tabular-nums text-slate-700 dark:text-slate-200">{count}</span>
                          <span className="text-right tabular-nums text-slate-500">{percent}%</span>
                        </button>
                      );
                    })}
                  </div>
                  <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
                    {monitoringCounts.HIGH_RISK} {monitoringCounts.HIGH_RISK === 1 ? 'student requires' : 'students require'} immediate attention.
                  </p>
                </section>

                <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
                  <h3 className="mb-3 text-sm font-semibold text-slate-900 dark:text-white">Proctoring activity · last hour</h3>
                  {trendBuckets.every(bucket => bucket.count === 0) ? (
                    <p className="py-5 text-center text-xs text-slate-500 dark:text-slate-400">No recent proctoring events.</p>
                  ) : (
                    <div className="flex h-20 items-end gap-2">
                      {trendBuckets.map(bucket => (
                        <div key={bucket.label} className="flex min-w-0 flex-1 flex-col items-center gap-1" title={`${bucket.label}: ${bucket.count} events`}>
                          <span className="text-[10px] tabular-nums text-slate-500">{bucket.count || ''}</span>
                          <div className="flex h-12 w-full items-end rounded-sm bg-slate-50 dark:bg-slate-900/60">
                            <div className="w-full rounded-sm bg-blue-500" style={{ height: `${bucket.count ? Math.max(8, (bucket.count / maxTrendEvents) * 100) : 0}%` }} />
                          </div>
                          <span className="truncate text-[9px] text-slate-400">{bucket.label}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              </div>

              <section className="rounded-xl border border-amber-200 bg-amber-50/60 p-4 dark:border-amber-900/60 dark:bg-amber-950/20">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Faculty assistance queue</h3>
                  <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-bold text-amber-800 dark:bg-amber-900/60 dark:text-amber-200">{pendingAssistanceRequests.length} pending</span>
                </div>
                {pendingAssistanceRequests.length === 0 ? (
                  <p className="text-sm text-slate-600 dark:text-slate-300">No pending assistance requests</p>
                ) : (
                  <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                    {pendingAssistanceRequests.slice(0, 6).map(request => {
                      const attempt = attempts.find(item => item.attemptId === request.attemptId);
                      return (
                        <div key={request.requestId} className="flex items-center justify-between gap-3 rounded-lg border border-amber-200 bg-white p-3 dark:border-amber-900 dark:bg-slate-900">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-slate-900 dark:text-white">{request.studentName}</p>
                            <p className="truncate font-mono text-[11px] text-slate-500">{request.studentId} · {request.warningCount}/5 warnings</p>
                            <p className="mt-0.5 truncate text-xs text-slate-500">{request.reason}</p>
                          </div>
                          <div className="flex shrink-0 gap-1.5">
                            {attempt && <button type="button" onClick={() => setSelectedMonitoringAttempt(attempt)} className="rounded-md border border-slate-200 px-2 py-1.5 text-xs hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800">Review</button>}
                            <button type="button" onClick={() => void handleAssistanceReview(request.requestId, 'APPROVED')} className="rounded-md bg-emerald-600 px-2 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700">Approve</button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
              <details className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
                <summary className="cursor-pointer text-sm font-semibold text-slate-800 dark:text-slate-200">
                  Assistance history ({assistanceRequests.filter(request => request.examId === selectedMonitoringExamId && request.status !== 'PENDING').length})
                </summary>
                <div className="mt-3 divide-y divide-slate-100 dark:divide-slate-700">
                  {assistanceRequests
                    .filter(request => request.examId === selectedMonitoringExamId && request.status !== 'PENDING')
                    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
                    .slice(0, 10)
                    .map(request => (
                      <div key={request.requestId} className="flex flex-wrap items-start justify-between gap-3 py-3 text-xs">
                        <div><p className="font-medium text-slate-800 dark:text-slate-200">{request.studentName} · {request.studentId}</p><p className="mt-1 text-slate-500">{request.reason}</p>{request.remarks && <p className="mt-1 text-slate-500">Review note: {request.remarks}</p>}</div>
                        <span className="font-semibold text-slate-600 dark:text-slate-300">{request.status} · {new Date(request.createdAt).toLocaleString()}</span>
                      </div>
                    ))}
                </div>
              </details>

              <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
                <h3 className="mb-2 text-sm font-semibold text-slate-900 dark:text-white">Alert center</h3>
                {monitoringAlerts.length === 0 ? (
                  <p className="text-sm text-slate-500 dark:text-slate-400">All students are currently within normal monitoring limits.</p>
                ) : (
                  <div className="flex gap-2 overflow-x-auto pb-1">
                    {monitoringAlerts.slice(0, 8).map(row => (
                      <button
                        type="button"
                        key={row.studentId}
                        onClick={() => openMonitoringStudent(row.studentId)}
                        className={`min-w-[210px] rounded-lg border px-3 py-2 text-left text-xs ${row.alertSeverity === 'CRITICAL' ? 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-200' : row.alertSeverity === 'HIGH' ? 'border-orange-200 bg-orange-50 text-orange-800 dark:border-orange-900 dark:bg-orange-950/30 dark:text-orange-200' : 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200'}`}
                      >
                        <span className="font-bold">{row.alertSeverity}</span>
                        <span className="mt-1 block truncate">{row.message}</span>
                      </button>
                    ))}
                  </div>
                )}
              </section>

              <section className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800">
                <div className="border-b border-slate-200 p-4 dark:border-slate-700">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h3 className="text-base font-semibold text-slate-900 dark:text-white">Needs Attention</h3>
                      <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{attentionRows.length} students need review</p>
                    </div>
                  </div>
                </div>
                {attentionRows.length === 0 ? (
                  <p className="p-5 text-sm text-slate-500 dark:text-slate-400">All students are currently within normal monitoring limits.</p>
                ) : (
                  <div className="divide-y divide-slate-100 dark:divide-slate-700">
                    {attentionRows.slice(0, 6).map(row => (
                      <div key={row.studentId} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-slate-900 dark:text-white">{row.studentName} <span className="ml-1 font-mono text-xs font-normal text-slate-500">{row.studentId}</span></p>
                          <p className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">
                            {row.currentQuestion ? `Question ${row.currentQuestion}/${row.totalQuestions} · ${row.progress}% complete` : row.status}
                            {row.lastEvent && ` · ${row.lastEvent.message || row.lastEvent.eventType} · ${Math.max(0, Math.floor((monitoringNow - new Date(row.lastEvent.timestamp).getTime()) / 1000))}s ago`}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-bold text-slate-700 dark:bg-slate-700 dark:text-slate-200">{row.risk}</span>
                          <span className="text-xs tabular-nums text-slate-600 dark:text-slate-300">{row.warningCount}/5</span>
                          <button type="button" onClick={() => openMonitoringStudent(row.studentId)} className="rounded-md border border-blue-200 px-2.5 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-50 dark:border-blue-800 dark:text-blue-300 dark:hover:bg-blue-950/40">Open student</button>
                          {row.assistance?.status === 'PENDING' && <button type="button" onClick={() => void handleAssistanceReview(row.assistance!.requestId, 'APPROVED')} className="rounded-md bg-blue-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-blue-700">Assist</button>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <section className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800">
                <div className="space-y-3 border-b border-slate-200 p-4 dark:border-slate-700">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h3 className="text-base font-semibold text-slate-900 dark:text-white">Students</h3>
                      <p className="text-xs text-slate-500 dark:text-slate-400">One live row per assigned student</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <label className="relative">
                        <span className="sr-only">Search student by name or ID</span>
                        <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
                        <input value={monitoringSearch} onChange={event => { setMonitoringSearch(event.target.value); setMonitoringPage(1); }} placeholder="Search student / ID" className="h-9 w-48 rounded-lg border border-slate-200 bg-white pl-8 pr-3 text-xs text-slate-800 placeholder:text-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200" />
                      </label>
                      <button
                        type="button"
                        disabled={selectedMonitoringStudentIds.size === 0}
                        onClick={exportSelectedMonitoringStudents}
                        className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-700"
                      >
                        <Download className="h-3.5 w-3.5" /> Export selected
                      </button>
                      <button
                        type="button"
                        disabled={!monitoringStudents.some(row => selectedMonitoringStudentIds.has(row.studentId) && row.attempt)}
                        onClick={() => {
                          const selectedRow = monitoringStudents.find(row => selectedMonitoringStudentIds.has(row.studentId) && row.attempt);
                          if (selectedRow?.attempt) setSelectedMonitoringAttempt(selectedRow.attempt);
                        }}
                        className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-700"
                      >
                        View selected
                      </button>
                      {selectedMonitoringStudentIds.size > 0 && (
                        <button type="button" onClick={() => setSelectedMonitoringStudentIds(new Set())} className="inline-flex h-9 items-center gap-1 rounded-lg px-2 text-xs text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700">
                          <X className="h-3.5 w-3.5" /> Clear ({selectedMonitoringStudentIds.size})
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-8">
                    {[
                      ['Status', monitoringStatusFilter, setMonitoringStatusFilter, ['ALL', 'ACTIVE', 'NEEDS_ATTENTION', 'SUSPENDED', 'SUBMITTED', 'OFFLINE', 'NOT_STARTED']],
                      ['Risk', monitoringRiskFilter, setMonitoringRiskFilter, ['ALL', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL', 'HIGH_RISK']],
                      ['Warnings', monitoringWarningsFilter, setMonitoringWarningsFilter, ['ALL', '0', '1-2', '3-4', '5']],
                      ['Connection', monitoringConnectionFilter, setMonitoringConnectionFilter, ['ALL', 'ONLINE', 'OFFLINE']],
                      ['Progress', monitoringProgressFilter, setMonitoringProgressFilter, ['ALL', 'NOT_STARTED', 'IN_PROGRESS', 'ALMOST_FINISHED', 'SUBMITTED']],
                      ['Assistance', monitoringAssistanceFilter, setMonitoringAssistanceFilter, ['ALL', 'NONE', 'PENDING', 'APPROVED', 'REJECTED']]
                    ].map(([label, value, setter, options]) => (
                      <label key={String(label)} className="min-w-0">
                        <span className="sr-only">{String(label)} filter</span>
                        <select
                          value={String(value)}
                          onChange={event => {
                            (setter as (value: string) => void)(event.target.value);
                            setMonitoringPage(1);
                          }}
                          className="h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                        >
                          {(options as string[]).map(option => <option key={option} value={option}>{option === 'ALL' ? `${label}: All` : option.replaceAll('_', ' ')}</option>)}
                        </select>
                      </label>
                    ))}
                    <label className="min-w-0">
                      <span className="sr-only">Sort students</span>
                      <select value={monitoringSort} onChange={event => setMonitoringSort(event.target.value)} className="h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
                        <option value="RISK">Sort: Risk</option>
                        <option value="WARNINGS">Sort: Warnings</option>
                        <option value="LAST_ACTIVITY">Sort: Last activity</option>
                        <option value="PROGRESS">Sort: Progress</option>
                        <option value="TIME">Sort: Time remaining</option>
                        <option value="NAME">Sort: Student name</option>
                      </select>
                    </label>
                  </div>
                </div>
                {monitoringStudents.length === 0 ? (
                  <div className="p-10 text-center text-sm text-slate-500 dark:text-slate-400">No active students</div>
                ) : filteredMonitoringStudents.length === 0 ? (
                  <div className="p-10 text-center text-sm text-slate-500 dark:text-slate-400">No students match the selected filters.</div>
                ) : (
                  <>
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[1120px] border-collapse text-left">
                        <thead>
                          <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-400">
                            <th className="p-3"><input type="checkbox" aria-label="Select page students" checked={pagedMonitoringStudents.length > 0 && pagedMonitoringStudents.every(row => selectedMonitoringStudentIds.has(row.studentId))} onChange={event => setSelectedMonitoringStudentIds(previous => { const next = new Set(previous); pagedMonitoringStudents.forEach(row => event.target.checked ? next.add(row.studentId) : next.delete(row.studentId)); return next; })} /></th>
                            <th className="p-3">Student</th><th className="p-3">Status</th><th className="p-3">Progress</th><th className="p-3">Current question</th><th className="p-3">Time left</th><th className="p-3">Risk</th><th className="p-3">Warnings</th><th className="p-3">Connection</th><th className="p-3">Last activity</th><th className="p-3 text-right">Action</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 text-xs text-slate-700 dark:divide-slate-700 dark:text-slate-300">
                          {pagedMonitoringStudents.map(row => (
                            <tr key={row.studentId} className="hover:bg-slate-50 dark:hover:bg-slate-900/40">
                              <td className="p-3"><input type="checkbox" aria-label={`Select ${row.studentName}`} checked={selectedMonitoringStudentIds.has(row.studentId)} onChange={event => setSelectedMonitoringStudentIds(previous => { const next = new Set(previous); event.target.checked ? next.add(row.studentId) : next.delete(row.studentId); return next; })} /></td>
                              <td className="p-3"><div className="max-w-[170px] truncate font-semibold text-slate-900 dark:text-white">{row.studentName}</div><div className="font-mono text-[10px] text-slate-500">{row.studentId}</div></td>
                              <td className="p-3"><span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-semibold dark:bg-slate-700">{row.status.replaceAll('_', ' ')}</span></td>
                              <td className="p-3 tabular-nums">{row.answered}/{row.totalQuestions} · {row.progress}%</td>
                              <td className="p-3 tabular-nums">{row.currentQuestion ? `Q${row.currentQuestion}/${row.totalQuestions}` : '—'}</td>
                              <td className="p-3 font-mono tabular-nums">{row.attempt && row.attempt.status === 'IN_PROGRESS' ? `${Math.floor(row.remainingSeconds / 60)}:${String(row.remainingSeconds % 60).padStart(2, '0')}` : '—'}</td>
                              <td className={`p-3 font-semibold ${row.risk === 'CRITICAL' || row.risk === 'HIGH' ? 'text-rose-600 dark:text-rose-300' : row.risk === 'MEDIUM' ? 'text-amber-600 dark:text-amber-300' : row.risk === 'LOW' ? 'text-emerald-600 dark:text-emerald-300' : 'text-slate-400'}`}>{row.risk}</td>
                              <td className="p-3 tabular-nums">{row.warningCount}/5</td>
                              <td className={`p-3 ${row.connection === 'ONLINE' ? 'text-emerald-600 dark:text-emerald-300' : row.connection === 'OFFLINE' ? 'text-rose-600 dark:text-rose-300' : 'text-slate-400'}`}>{row.connection}</td>
                              <td className="p-3">{row.lastActivityAt ? `${Math.floor(Math.max(0, monitoringNow - new Date(row.lastActivityAt).getTime()) / 1000)}s ago` : '—'}</td>
                              <td className="p-3 text-right"><button type="button" disabled={!row.attempt} onClick={() => openMonitoringStudent(row.studentId)} className="rounded-md border border-blue-200 px-2.5 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-50 disabled:opacity-40 dark:border-blue-800 dark:text-blue-300 dark:hover:bg-blue-950/40">View</button></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-4 py-3 text-xs dark:border-slate-700">
                      <span className="text-slate-500">Showing {(currentMonitoringPage - 1) * monitoringPageSize + 1}–{Math.min(currentMonitoringPage * monitoringPageSize, filteredMonitoringStudents.length)} of {filteredMonitoringStudents.length} students</span>
                      <div className="flex items-center gap-2">
                        <label className="text-slate-500">Rows
                          <select value={monitoringPageSize} onChange={event => { setMonitoringPageSize(Number(event.target.value)); setMonitoringPage(1); }} className="ml-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
                            {[25, 50, 100].map(size => <option key={size}>{size}</option>)}
                          </select>
                        </label>
                        <button type="button" aria-label="Previous page" disabled={currentMonitoringPage <= 1} onClick={() => setMonitoringPage(page => Math.max(1, page - 1))} className="rounded-md border border-slate-200 p-1.5 disabled:opacity-40 dark:border-slate-700"><ChevronLeft className="h-4 w-4" /></button>
                        {visibleMonitoringPages.map(page => (
                          <button key={page} type="button" aria-current={currentMonitoringPage === page ? 'page' : undefined} onClick={() => setMonitoringPage(page)} className={`min-w-7 rounded-md px-2 py-1.5 tabular-nums ${currentMonitoringPage === page ? 'bg-blue-600 font-semibold text-white' : 'border border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-700'}`}>
                            {page}
                          </button>
                        ))}
                        <button type="button" aria-label="Next page" disabled={currentMonitoringPage >= monitoringPageCount} onClick={() => setMonitoringPage(page => Math.min(monitoringPageCount, page + 1))} className="rounded-md border border-slate-200 p-1.5 disabled:opacity-40 dark:border-slate-700"><ChevronRight className="h-4 w-4" /></button>
                      </div>
                    </div>
                  </>
                )}
          </section>
          </>
          )}
          </>
          )}
        </ScrollReveal>
      )}

      {activeTab === 'monitoring_history' && (
        <ScrollReveal className="space-y-5">
          {historyExamId ? (
            <section className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800">
              <div className="border-b border-slate-200 p-4 dark:border-slate-700">
                <button type="button" onClick={() => setHistoryExamId('')} className="mb-2 text-sm font-medium text-blue-600 hover:underline dark:text-blue-400">← Back to Exams</button>
                <h2 className="text-lg font-semibold text-slate-900 dark:text-white">{selectedHistoryExam?.title || historyExamId} · Monitoring report</h2>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{historyExamId} · {historyAttempts.length} attempts · {historyEvents.length} proctoring events</p>
              </div>
              {examRecordError && <p role="alert" className="m-4 rounded-lg bg-rose-50 p-3 text-sm text-rose-700 dark:bg-rose-950/30 dark:text-rose-300">{examRecordError}</p>}
              {isLoadingExamRecords ? <p className="p-10 text-center text-sm text-slate-500">Loading report…</p> : (
                <div className="space-y-6 p-4">
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <KpiCard label="Attempts" value={historyAttempts.length} icon={<FileText className="h-5 w-5 text-blue-600" />} />
                    <KpiCard label="Finalized" value={historyAttempts.filter(attempt => attempt.status !== 'IN_PROGRESS').length} icon={<CheckCircle className="h-5 w-5 text-emerald-600" />} />
                    <KpiCard label="Proctoring events" value={historyEvents.length} icon={<Shield className="h-5 w-5 text-amber-600" />} />
                    <KpiCard label="High / Critical" value={historyEvents.filter(event => event.severity === 'HIGH' || event.severity === 'CRITICAL').length} icon={<AlertCircle className="h-5 w-5 text-rose-600" />} />
                  </div>
                  <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
                    <table className="w-full min-w-[850px] text-left text-sm">
                      <thead><tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-500 dark:border-slate-700 dark:bg-slate-900/50"><th className="p-3">Timestamp</th><th className="p-3">Student</th><th className="p-3">Event</th><th className="p-3">Severity</th><th className="p-3">Details</th></tr></thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-700">{pageHistoryEvents.map(event => <tr key={event.eventId}><td className="whitespace-nowrap p-3 text-xs text-slate-500">{new Date(event.timestamp).toLocaleString()}</td><td className="p-3"><div className="font-medium text-slate-900 dark:text-white">{event.studentName}</div><div className="font-mono text-xs text-slate-500">{event.studentId}</div></td><td className="p-3">{event.eventType}</td><td className="p-3">{event.severity}</td><td className="max-w-lg p-3 text-slate-600 dark:text-slate-300">{event.details}</td></tr>)}</tbody>
                    </table>
                    {historyEvents.length === 0 && <p className="p-8 text-center text-sm text-slate-500">No proctoring events recorded</p>}
                    {historyEvents.length > recordPageSize && <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3 text-xs dark:border-slate-700"><span>Page {recordPage} of {historyPageCount}</span><div className="flex gap-2"><button type="button" disabled={recordPage <= 1} onClick={() => setRecordPage(page => Math.max(1, page - 1))} className="rounded border border-slate-200 px-3 py-1 disabled:opacity-40 dark:border-slate-700">Previous</button><button type="button" disabled={recordPage >= historyPageCount} onClick={() => setRecordPage(page => Math.min(historyPageCount, page + 1))} className="rounded border border-slate-200 px-3 py-1 disabled:opacity-40 dark:border-slate-700">Next</button></div></div>}
                  </div>
                </div>
              )}
            </section>
          ) : (
            <section className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800">
              <div className="border-b border-slate-200 p-4 dark:border-slate-700"><h2 className="text-lg font-semibold text-slate-900 dark:text-white">Monitoring history</h2><p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Select an ended exam to view its monitoring report.</p></div>
              <div className="border-b border-slate-200 p-4 dark:border-slate-700"><input aria-label="Search history exams" value={recordSearch} onChange={event => { setRecordSearch(event.target.value); setRecordPage(1); }} placeholder="Search completed exams..." className="h-9 w-full max-w-xs rounded-lg border border-slate-200 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200" /></div>
              {historyExams.length === 0 ? <p className="p-10 text-center text-sm text-slate-500">No completed exams available.</p> : <><div className="divide-y divide-slate-100 dark:divide-slate-700">{pageHistoryExams.map(exam => <div key={exam.examId || exam.id} className="flex items-center justify-between gap-4 p-4"><div><p className="font-medium text-slate-900 dark:text-white">{exam.title}</p><p className="mt-1 font-mono text-xs text-slate-500">{exam.examId || exam.id} · {exam.subject} · {exam.status}</p></div><button type="button" onClick={() => { setRecordPage(1); setHistoryExamId(exam.examId || exam.id); }} className="rounded-md border border-blue-200 px-3 py-1.5 text-sm font-medium text-blue-700 hover:bg-blue-50 dark:border-blue-800 dark:text-blue-300 dark:hover:bg-blue-950/30">View report</button></div>)}</div><div className="flex items-center justify-between border-t border-slate-200 px-4 py-3 text-xs dark:border-slate-700"><span>Page {recordPage} of {historyExamPageCount} · {matchingHistoryExams.length} exams</span><div className="flex gap-2"><button type="button" disabled={recordPage <= 1} onClick={() => setRecordPage(page => Math.max(1, page - 1))} className="rounded border border-slate-200 px-3 py-1 disabled:opacity-40 dark:border-slate-700">Previous</button><button type="button" disabled={recordPage >= historyExamPageCount} onClick={() => setRecordPage(page => Math.min(historyExamPageCount, page + 1))} className="rounded border border-slate-200 px-3 py-1 disabled:opacity-40 dark:border-slate-700">Next</button></div></div></>}
            </section>
          )}
        </ScrollReveal>
      )}

      {/* 7. RESULTS TAB */}
      {activeTab === 'results' && (
        <ScrollReveal className="space-y-5">
          {selectedResultExamId ? (
            <section className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-4 dark:border-slate-700">
                <div>
                  <button type="button" onClick={() => setSelectedResultExamId(null)} className="mb-2 text-sm font-medium text-blue-600 hover:underline dark:text-blue-400">← Back to Exams</button>
                  <h2 className="text-lg font-semibold text-slate-900 dark:text-white">{selectedResultExam?.title || selectedResultExamId} · Results</h2>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{examResults.length} results · {publishedResultsCount} published · {unpublishedResultsCount} pending publication</p>
                </div>
                <input aria-label="Search results" value={recordSearch} onChange={event => { setRecordSearch(event.target.value); setRecordPage(1); }} placeholder="Search student or result..." className="h-9 w-full max-w-xs rounded-lg border border-slate-200 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200" />
              </div>
              {examRecordError && <p role="alert" className="m-4 rounded-lg bg-rose-50 p-3 text-sm text-rose-700 dark:bg-rose-950/30 dark:text-rose-300">{examRecordError}</p>}
              {isLoadingExamRecords ? <p className="p-10 text-center text-sm text-slate-500">Loading results…</p> : pageResults.length === 0 ? <p className="p-10 text-center text-sm text-slate-500">No results for this exam.</p> : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[850px] text-left">
                    <thead><tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-500 dark:border-slate-700 dark:bg-slate-900/50"><th className="p-3">Student</th><th className="p-3">Score</th><th className="p-3">Percentage</th><th className="p-3">Grade</th><th className="p-3">Status</th><th className="p-3 text-right">Actions</th></tr></thead>
                    <tbody className="divide-y divide-slate-100 text-sm dark:divide-slate-700">
                      {pageResults.map(result => {
                        const percentage = result.percentage ?? result.accuracy ?? (result.totalMarks ? Math.round(result.score / result.totalMarks * 100) : 0);
                        const published = result.isPublished || result.status === 'PUBLISHED';
                        return <tr key={result.resultId || result.id}>
                          <td className="p-3"><div className="font-medium text-slate-900 dark:text-white">{result.studentName}</div><div className="font-mono text-xs text-slate-500">{result.studentId}</div></td>
                          <td className="p-3 tabular-nums">{result.score} / {result.totalMarks || result.totalQuestions}</td>
                          <td className="p-3 tabular-nums">{percentage}%</td>
                          <td className="p-3">{result.grade || '—'}</td>
                          <td className="p-3">{published ? 'PUBLISHED' : 'PENDING'}</td>
                          <td className="p-3 text-right">
                            <button type="button" onClick={() => setSelectedResultDetail(result)} className="mr-2 rounded-md border border-slate-200 px-2.5 py-1.5 text-xs font-medium dark:border-slate-700">View</button>
                            {!published && <button type="button" onClick={() => confirmAction({ title: 'Publish Results', message: `Publish results for ${result.studentName}?`, confirmLabel: 'Publish', cancelLabel: 'Cancel', variant: 'primary', action: async () => { await onPublishResult(result.resultId || result.id); setExamResults(previous => previous.map(item => item.resultId === result.resultId ? { ...item, status: 'PUBLISHED', isPublished: true } : item)); } })} className="rounded-md bg-blue-600 px-2.5 py-1.5 text-xs font-medium text-white">Publish</button>}
                          </td>
                        </tr>;
                      })}
                    </tbody>
                  </table>
                  <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3 text-xs dark:border-slate-700"><span>Page {recordPage} of {resultPageCount} · {matchingExamResults.length} results</span><div className="flex gap-2"><button type="button" disabled={recordPage <= 1} onClick={() => setRecordPage(page => Math.max(1, page - 1))} className="rounded border border-slate-200 px-3 py-1 disabled:opacity-40 dark:border-slate-700">Previous</button><button type="button" disabled={recordPage >= resultPageCount} onClick={() => setRecordPage(page => Math.min(resultPageCount, page + 1))} className="rounded border border-slate-200 px-3 py-1 disabled:opacity-40 dark:border-slate-700">Next</button></div></div>
                </div>
              )}
            </section>
          ) : (
            <section className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-4 dark:border-slate-700"><div><h2 className="text-lg font-semibold text-slate-900 dark:text-white">Results by exam</h2><p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Select an exam to load its results.</p></div><input aria-label="Search exams" value={recordSearch} onChange={event => setRecordSearch(event.target.value)} placeholder="Search exams..." className="h-9 w-full max-w-xs rounded-lg border border-slate-200 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200" /></div>
              <div className="divide-y divide-slate-100 dark:divide-slate-700">{pageExams.map(exam => <div key={exam.examId || exam.id} className="flex items-center justify-between gap-4 p-4"><div><p className="font-medium text-slate-900 dark:text-white">{exam.title}</p><p className="mt-1 font-mono text-xs text-slate-500">{exam.examId || exam.id} · {exam.subject} · {exam.status}</p></div><button type="button" onClick={() => void loadExamResults(exam.examId || exam.id)} className="rounded-md border border-blue-200 px-3 py-1.5 text-sm font-medium text-blue-700 hover:bg-blue-50 dark:border-blue-800 dark:text-blue-300 dark:hover:bg-blue-950/30">View</button></div>)}</div>
              <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3 text-xs dark:border-slate-700"><span>Page {recordPage} of {examPageCount} · {matchingExams.length} exams</span><div className="flex gap-2"><button type="button" disabled={recordPage <= 1} onClick={() => setRecordPage(page => Math.max(1, page - 1))} className="rounded border border-slate-200 px-3 py-1 disabled:opacity-40 dark:border-slate-700">Previous</button><button type="button" disabled={recordPage >= examPageCount} onClick={() => setRecordPage(page => Math.min(examPageCount, page + 1))} className="rounded border border-slate-200 px-3 py-1 disabled:opacity-40 dark:border-slate-700">Next</button></div></div>
            </section>
          )}
        </ScrollReveal>
      )}

      {/* 8. QUERIES TAB */}
      {activeTab === 'queries' && (
        <ScrollReveal className="space-y-5">
          {selectedQueryExamId ? (
            <section className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-4 dark:border-slate-700">
                <div><button type="button" onClick={() => setSelectedQueryExamId(null)} className="mb-2 text-sm font-medium text-blue-600 hover:underline dark:text-blue-400">← Back to Exams</button><h2 className="text-lg font-semibold text-slate-900 dark:text-white">{selectedQueryExam?.title || selectedQueryExamId} · Queries</h2><p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{examQueries.length} queries · {openQueriesCount} open · {resolvedQueriesCount} resolved</p></div>
                <div className="flex flex-wrap gap-2"><input aria-label="Search queries" value={recordSearch} onChange={event => { setRecordSearch(event.target.value); setRecordPage(1); }} placeholder="Search student or query..." className="h-9 w-full max-w-xs rounded-lg border border-slate-200 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200" /><select aria-label="Filter queries by status" value={queryStatusFilter} onChange={event => { setQueryStatusFilter(event.target.value as typeof queryStatusFilter); setRecordPage(1); }} className="h-9 rounded-lg border border-slate-200 bg-white px-2.5 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"><option value="ALL">All statuses</option><option value="PENDING">Pending / in review</option><option value="RESOLVED">Resolved</option></select></div>
              </div>
              {examRecordError && <p role="alert" className="m-4 rounded-lg bg-rose-50 p-3 text-sm text-rose-700 dark:bg-rose-950/30 dark:text-rose-300">{examRecordError}</p>}
              {isLoadingExamRecords ? <p className="p-10 text-center text-sm text-slate-500">Loading queries…</p> : pageQueries.length === 0 ? <p className="p-10 text-center text-sm text-slate-500">{examQueries.length ? 'No queries match the selected filter.' : 'No queries for this exam.'}</p> : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[820px] text-left"><thead><tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-500 dark:border-slate-700 dark:bg-slate-900/50"><th className="p-3">Query</th><th className="p-3">Student</th><th className="p-3">Issue</th><th className="p-3">Status</th><th className="p-3">Created</th><th className="p-3 text-right">Review</th></tr></thead>
                    <tbody className="divide-y divide-slate-100 text-sm dark:divide-slate-700">{pageQueries.map(query => <tr key={query.queryId || query.id}><td className="p-3"><button type="button" onClick={() => setSelectedQueryDetail(query)} className="font-mono text-blue-600 hover:underline dark:text-blue-400">{query.queryId || query.id}</button><p className="mt-1 max-w-sm truncate text-xs text-slate-500">{query.questionText || query.message || query.description}</p></td><td className="p-3"><div className="font-medium text-slate-900 dark:text-white">{query.studentName}</div><div className="font-mono text-xs text-slate-500">{query.studentId}</div></td><td className="p-3">{query.reasonType.replaceAll('_', ' ')}</td><td className="p-3">{query.status}</td><td className="p-3 text-xs text-slate-500">{query.createdAt}</td><td className="p-3 text-right"><button type="button" onClick={() => setSelectedQueryDetail(query)} className="rounded-md border border-slate-200 px-2.5 py-1.5 text-xs font-medium dark:border-slate-700">Review</button></td></tr>)}</tbody>
                  </table>
                  <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3 text-xs dark:border-slate-700"><span>Page {recordPage} of {queryPageCount} · {matchingExamQueries.length} queries</span><div className="flex gap-2"><button type="button" disabled={recordPage <= 1} onClick={() => setRecordPage(page => Math.max(1, page - 1))} className="rounded border border-slate-200 px-3 py-1 disabled:opacity-40 dark:border-slate-700">Previous</button><button type="button" disabled={recordPage >= queryPageCount} onClick={() => setRecordPage(page => Math.min(queryPageCount, page + 1))} className="rounded border border-slate-200 px-3 py-1 disabled:opacity-40 dark:border-slate-700">Next</button></div></div>
                </div>
              )}
            </section>
          ) : (
            <section className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-4 dark:border-slate-700"><div><h2 className="text-lg font-semibold text-slate-900 dark:text-white">Queries by exam</h2><p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Select an exam to load and review its queries.</p></div><input aria-label="Search exams" value={recordSearch} onChange={event => setRecordSearch(event.target.value)} placeholder="Search exams..." className="h-9 w-full max-w-xs rounded-lg border border-slate-200 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200" /></div>
              <div className="divide-y divide-slate-100 dark:divide-slate-700">{pageExams.map(exam => <div key={exam.examId || exam.id} className="flex items-center justify-between gap-4 p-4"><div><p className="font-medium text-slate-900 dark:text-white">{exam.title}</p><p className="mt-1 font-mono text-xs text-slate-500">{exam.examId || exam.id} · {exam.subject} · {exam.status}</p></div><button type="button" onClick={() => void loadExamQueries(exam.examId || exam.id)} className="rounded-md border border-blue-200 px-3 py-1.5 text-sm font-medium text-blue-700 hover:bg-blue-50 dark:border-blue-800 dark:text-blue-300 dark:hover:bg-blue-950/30">View</button></div>)}</div>
              <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3 text-xs dark:border-slate-700"><span>Page {recordPage} of {examPageCount} · {matchingExams.length} exams</span><div className="flex gap-2"><button type="button" disabled={recordPage <= 1} onClick={() => setRecordPage(page => Math.max(1, page - 1))} className="rounded border border-slate-200 px-3 py-1 disabled:opacity-40 dark:border-slate-700">Previous</button><button type="button" disabled={recordPage >= examPageCount} onClick={() => setRecordPage(page => Math.min(examPageCount, page + 1))} className="rounded border border-slate-200 px-3 py-1 disabled:opacity-40 dark:border-slate-700">Next</button></div></div>
            </section>
          )}
        </ScrollReveal>
      )}

      {/* 10. PROFILE TAB */}
      {activeTab === 'profile' && (
        <div className="space-y-5">
          <section className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-800">
            <div className="flex items-center gap-4">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-indigo-100 text-lg font-bold text-indigo-700 dark:bg-indigo-900/50 dark:text-indigo-200">
                {(user?.name || 'Faculty').split(/\s+/).map(part => part[0]).slice(0, 2).join('').toUpperCase()}
              </div>
              <div>
                <h2 className="text-xl font-semibold text-slate-900 dark:text-white">{user?.name || 'Faculty'}</h2>
                <p className="mt-1 font-mono text-xs text-slate-500">{user?.userId || user?.id} · {user?.department || 'Faculty'}</p>
                <div className="mt-2"><StatusBadge status={user?.status || 'ACTIVE'} /></div>
              </div>
            </div>
            <button type="button" onClick={() => void loadTeacherData()} className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200 px-3 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-700">
              <RefreshCw className="h-3.5 w-3.5" /> Refresh
            </button>
          </section>

          <section className="max-w-2xl rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-800">
              <h3 className="mb-4 text-base font-semibold text-slate-900 dark:text-white">Faculty information</h3>
              <dl className="divide-y divide-slate-100 text-sm dark:divide-slate-700">
                {[
                  ['Faculty ID', user?.userId || user?.id || '—'],
                  ['Name', user?.name || '—'],
                  ['Email', user?.email || '—'],
                  ['Phone', user?.phone || '—'],
                  ['Department', user?.department || '—'],
                  ['Designation', user?.designation || '—'],
                  ['Qualification', user?.qualification || '—']
                ].map(([label, value]) => (
                  <div key={label} className="flex justify-between gap-4 py-2.5">
                    <dt className="text-slate-500 dark:text-slate-400">{label}</dt>
                    <dd className="text-right font-medium text-slate-800 dark:text-slate-200">{value}</dd>
                  </div>
                ))}
              </dl>
          </section>
        </div>
      )}

      {/* QUESTION CREATE / EDIT MODAL */}
      <Modal
        isOpen={showQuestionModal}
        onClose={() => setShowQuestionModal(false)}
        size="large"
        title={editingQuestion ? 'Edit Question' : 'Add Question'}
        footer={
          <div className="flex items-center justify-end gap-3 w-full">
            <button
              type="button"
              onClick={() => setShowQuestionModal(false)}
              className="h-11 px-4 rounded-lg text-[14.5px] font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 inline-flex items-center justify-center transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              form="teacher-question-form"
              disabled={isSavingQuestion}
              className="h-11 px-6 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-[14.5px] font-medium disabled:opacity-50 inline-flex items-center justify-center shadow-sm transition-colors"
            >
              {isSavingQuestion ? 'Saving...' : 'Save Question'}
            </button>
          </div>
        }
      >
        {questionError && (
          <div className="p-3.5 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-[14px] font-medium text-red-600 dark:text-red-400 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{questionError}</span>
          </div>
        )}

        <form id="teacher-question-form" onSubmit={handleSaveQuestionSubmit} className="space-y-6">
          <FormSection title="Classification & Marks">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-[14px] font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                  Subject *
                </label>
                <SearchableSelect
                  value={questionForm.subject}
                  onChange={val => setQuestionForm({ ...questionForm, subject: val })}
                  options={SUBJECTS.map(s => ({ value: s, label: s }))}
                  placeholder="Select subject"
                  searchable={true}
                  required
                />
              </div>
              <div>
                <label className="block text-[14px] font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                  Difficulty *
                </label>
                <Select
                  value={questionForm.difficulty}
                  onChange={val =>
                    setQuestionForm({
                      ...questionForm,
                      difficulty: val as Difficulty
                    })
                  }
                  options={[
                    { value: Difficulty.EASY, label: 'EASY' },
                    { value: Difficulty.MEDIUM, label: 'MEDIUM' },
                    { value: Difficulty.HARD, label: 'HARD' }
                  ]}
                  placeholder="Select difficulty"
                />
              </div>
              <div>
                <label className="block text-[14px] font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                  Marks *
                </label>
                <input
                  type="number"
                  min={1}
                  required
                  value={questionForm.marks}
                  onChange={e =>
                    setQuestionForm({ ...questionForm, marks: Number(e.target.value) })
                  }
                  className="w-full h-12 px-3.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-[15px] text-slate-900 dark:text-white tabular-nums outline-none focus:border-blue-500"
                />
              </div>
            </div>
          </FormSection>

          <FormSection title="Question Prompt">
            <div>
              <label className="block text-[14px] font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                Question Text *
              </label>
              <textarea
                rows={3}
                required
                value={questionForm.text}
                onChange={e => setQuestionForm({ ...questionForm, text: e.target.value })}
                placeholder="Enter question text here..."
                className="w-full px-3.5 py-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-[15px] text-slate-900 dark:text-white outline-none focus:border-blue-500"
              />
            </div>
          </FormSection>

          <FormSection title="Options & Correct Answer">
            <div className="space-y-3">
              {questionForm.options.map((opt, idx) => (
                <div
                  key={idx}
                  className={`flex items-center gap-3 p-2.5 rounded-lg border transition-colors ${
                    questionForm.correctAnswerIndex === idx
                      ? 'border-emerald-500 bg-emerald-50/40 dark:bg-emerald-950/20'
                      : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900'
                  }`}
                >
                  <input
                    type="radio"
                    id={`opt-radio-${idx}`}
                    name="correctAnswerIndex"
                    checked={questionForm.correctAnswerIndex === idx}
                    onChange={() =>
                      setQuestionForm({ ...questionForm, correctAnswerIndex: idx })
                    }
                    className="w-4 h-4 text-emerald-600 focus:ring-emerald-500 cursor-pointer"
                  />
                  <label
                    htmlFor={`opt-radio-${idx}`}
                    className="text-[14px] font-mono font-bold text-slate-600 dark:text-slate-300 w-6 cursor-pointer"
                  >
                    {String.fromCharCode(65 + idx)}.
                  </label>
                  <input
                    type="text"
                    required
                    value={opt}
                    onChange={e => {
                      const updated = [...questionForm.options];
                      updated[idx] = e.target.value;
                      setQuestionForm({ ...questionForm, options: updated });
                    }}
                    placeholder={`Option ${String.fromCharCode(65 + idx)}`}
                    className="flex-1 h-11 px-3.5 bg-transparent border-0 text-[15px] text-slate-900 dark:text-white outline-none focus:ring-0"
                  />
                  {questionForm.correctAnswerIndex === idx && (
                    <span className="text-[12.5px] font-semibold text-emerald-600 dark:text-emerald-400 px-2 py-0.5 rounded bg-emerald-100 dark:bg-emerald-900/40 shrink-0">
                      Correct
                    </span>
                  )}
                </div>
              ))}
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
              form="teacher-create-student-form"
              disabled={isCreatingStudent}
              className="h-11 px-6 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-[14.5px] font-medium disabled:opacity-50 inline-flex items-center justify-center shadow-sm transition-colors"
            >
              {isCreatingStudent ? 'Creating...' : 'Create Student'}
            </button>
          </div>
        }
      >
        {studentCreateError && (
          <div className="p-3.5 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-[14px] font-medium text-red-600 dark:text-red-400 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{studentCreateError}</span>
          </div>
        )}

        <form id="teacher-create-student-form" onSubmit={handleCreateStudent} className="space-y-6">
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
                  isLoading={isLoadingDirectory}
                  error={directoryError}
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
                  isLoading={isLoadingDirectory}
                  error={directoryError}
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
                  isLoading={isLoadingDirectory}
                  error={directoryError}
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
                  isLoading={isLoadingDirectory}
                  error={directoryError}
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
                  isLoading={isLoadingDirectory}
                  error={directoryError}
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
                onChange={val => setStudentForm({ ...studentForm, assignedTeacherId: val })}
                options={teacherOptions}
                placeholder="Search and select teacher"
                emptyMessage="No teachers available."
                isLoading={isLoadingDirectory}
                error={directoryError}
              />
            </div>
          </FormSection>
        </form>
      </Modal>

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
                <ScrollReveal className="grid grid-cols-2 sm:grid-cols-4 gap-4 bg-slate-50 dark:bg-slate-900/60 p-4 rounded-xl border border-slate-200 dark:border-slate-700 text-[14px]">
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
                </ScrollReveal>
                <StudentAssessmentSections details={selectedStudentDetails} />
              </div>
            )}
        </Modal>
      )}

      {/* GENERATED STUDENT CREDENTIALS MODAL */}
      {generatedStudentCreds && (
        <Modal
          isOpen={!!generatedStudentCreds}
          onClose={() => {
            setGeneratedStudentCreds(null);
            setCopiedStudentCredKey(null);
          }}
          size="compact"
          title="Student Credentials Generated"
          subtitle={generatedStudentCreds.name}
          footer={
            <div className="flex items-center gap-3 w-full">
              <button
                type="button"
                onClick={() =>
                  handleCopyStudentCred(
                    `Student ID: ${generatedStudentCreds.userId}\nInitial Password: ${generatedStudentCreds.temporaryPassword}`,
                    'all'
                  )
                }
                className="flex-1 h-11 rounded-lg border border-slate-200 dark:border-slate-700 text-[14.5px] font-medium text-slate-700 dark:text-slate-300 flex items-center justify-center gap-2 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
              >
                {copiedStudentCredKey === 'all' ? (
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
                  setGeneratedStudentCreds(null);
                  setCopiedStudentCredKey(null);
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
                <span className="text-[13.5px] text-slate-500 block">Student ID</span>
                <span className="font-mono text-[15px] font-semibold text-blue-600 dark:text-blue-400 tabular-nums">
                  {generatedStudentCreds.userId}
                </span>
              </div>
              <button
                type="button"
                onClick={() => handleCopyStudentCred(generatedStudentCreds.userId, 'userId')}
                className={`h-9 px-3 rounded-lg border text-[13px] font-medium inline-flex items-center gap-1.5 transition-colors ${
                  copiedStudentCredKey === 'userId'
                    ? 'border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300'
                    : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
                title="Copy Student ID"
              >
                {copiedStudentCredKey === 'userId' ? (
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
                  {generatedStudentCreds.temporaryPassword}
                </span>
              </div>
              <button
                type="button"
                onClick={() =>
                  handleCopyStudentCred(generatedStudentCreds.temporaryPassword, 'password')
                }
                className={`h-9 px-3 rounded-lg border text-[13px] font-medium inline-flex items-center gap-1.5 transition-colors ${
                  copiedStudentCredKey === 'password'
                    ? 'border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300'
                    : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
                title="Copy Initial Password"
              >
                {copiedStudentCredKey === 'password' ? (
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
            Provide these credentials to the student. They will be prompted to change their password upon first login.
          </p>
        </Modal>
      )}

      <QuestionDetailModal
        question={selectedQuestionDetail}
        onClose={() => setSelectedQuestionDetail(null)}
      />

      <ResultDetailModal
        result={selectedResultDetail}
        onClose={() => setSelectedResultDetail(null)}
        onPublish={(id) => {
          confirmAction({
            title: 'Publish Results',
            message: 'Are you sure you want to publish these results? Students will be able to view the published results.',
            confirmLabel: 'Yes, Publish',
            cancelLabel: 'No',
            variant: 'primary',
            action: async () => {
              await onPublishResult(id);
              setExamResults(previous => previous.map(result =>
                (result.resultId || result.id) === id
                  ? { ...result, status: 'PUBLISHED', isPublished: true }
                  : result
              ));
            }
          });
        }}
        canPublish={true}
      />

      {selectedProctoringExamId && (
        <ProctoringExamInsightsModal
          exam={exams.find(exam => (exam.examId || exam.id) === selectedProctoringExamId)}
          examId={selectedProctoringExamId}
          events={selectedFacultyProctoringEvents}
          results={proctoringExamResults}
          isStudent={false}
          onClose={() => setSelectedProctoringExamId(null)}
        />
      )}

      <QueryDetailModal
        query={selectedQueryDetail}
        onClose={() => setSelectedQueryDetail(null)}
        onResolve={resolveWorkspaceQuery}
      />

      {selectedMonitoringAttempt && (
        <div className="fixed inset-0 z-[80]">
          <button type="button" aria-label="Close student monitoring details" onClick={() => setSelectedMonitoringAttempt(null)} className="absolute inset-0 bg-slate-950/50" />
          {(() => {
            const attempt =
              attempts.find(item => item.attemptId === selectedMonitoringAttempt.attemptId) ||
              selectedMonitoringAttempt;
            const exam = exams.find(item => item.examId === attempt.examId);
            const student = students.find(item => item.userId === attempt.studentId || item.id === attempt.studentId);
            const events = proctoringEvents
              .filter(event => event.attemptId === attempt.attemptId)
              .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
            const assistance = assistanceRequests
              .filter(request => request.attemptId === attempt.attemptId)
              .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
            const totalQuestions = exam?.questionCount || exam?.questionIds?.length || attempt.answers.length;
            const answeredCount = attempt.answers.filter(answer => answer.selectedOption).length;
            const lastViolation = events.find(event =>
              !['WINDOW_FOCUS', 'CAMERA_CONNECTED', 'FACE_DETECTED', 'FACE_STATUS'].includes(event.eventType)
            );
            const remainingSeconds = attempt.status === 'IN_PROGRESS'
              ? Math.max(0, Math.floor((new Date(attempt.expiresAt).getTime() - Date.now()) / 1000))
              : 0;
            return (
              <aside role="dialog" aria-modal="true" aria-label="Individual student monitoring" className="absolute inset-y-0 right-0 flex w-full max-w-2xl flex-col border-l border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900">
                <header className="flex items-start justify-between gap-4 border-b border-slate-200 p-5 dark:border-slate-700">
                  <div>
                    <h2 className="text-lg font-semibold text-slate-900 dark:text-white">{student?.name || attempt.studentName}</h2>
                    <p className="mt-1 font-mono text-xs text-slate-500">{attempt.studentId} · {exam?.title || attempt.examId}</p>
                    <div className="mt-2 flex flex-wrap gap-2 text-xs">
                      <span className="rounded-full bg-slate-100 px-2 py-1 font-semibold dark:bg-slate-700">{attempt.suspended ? 'SUSPENDED' : attempt.status}</span>
                      <span className={`rounded-full px-2 py-1 font-semibold ${attempt.suspended || attempt.warningCount >= 5 ? 'bg-rose-100 text-rose-800 dark:bg-rose-950/50 dark:text-rose-200' : attempt.warningCount >= 3 ? 'bg-orange-100 text-orange-800 dark:bg-orange-950/50 dark:text-orange-200' : attempt.warningCount ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-200' : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200'}`}>
                        {attempt.suspended || attempt.warningCount >= 5 ? 'CRITICAL' : attempt.warningCount >= 3 ? 'HIGH' : attempt.warningCount ? 'MEDIUM' : 'LOW'} risk
                      </span>
                    </div>
                  </div>
                  <button type="button" aria-label="Close student monitoring details" onClick={() => setSelectedMonitoringAttempt(null)} className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 dark:hover:bg-slate-800"><X className="h-4 w-4" /></button>
                </header>
                <div className="flex-1 space-y-5 overflow-y-auto p-5">
                <div>
                  <h3 className="mb-2 text-sm font-semibold text-slate-900 dark:text-white">Exam progress</h3>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {[
                    ['Answered', `${answeredCount} / ${totalQuestions} · ${totalQuestions ? Math.round(answeredCount / totalQuestions * 100) : 0}%`],
                    ['Current question', `${Math.min((attempt.currentQuestionIndex || 0) + 1, totalQuestions || 1)} / ${totalQuestions}`],
                    ['Remaining time', `${Math.floor(remainingSeconds / 60)}m ${remainingSeconds % 60}s`],
                    ['Warnings', `${attempt.warningCount} / 5`]
                  ].map(([label, value]) => (
                    <div key={label} className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                      <div className="text-[11px] text-slate-500">{label}</div>
                      <div className="mt-1 break-words text-[13px] font-medium text-slate-800 dark:text-slate-200">{value}</div>
                    </div>
                  ))}
                </div>
                </div>
                <div>
                  <h3 className="mb-2 text-sm font-semibold text-slate-900 dark:text-white">Proctoring status</h3>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {[
                    ['Camera', attempt.cameraStatus || 'UNKNOWN'],
                    ['Face', attempt.faceStatus || 'UNKNOWN'],
                    ['Multiple faces', attempt.faceStatus === 'MULTIPLE' ? 'Detected' : 'No current detection'],
                    ['Fullscreen', attempt.fullscreenActive ? 'Active' : 'Exited'],
                    ['Connection', attempt.lastHeartbeatAt && Date.now() - new Date(attempt.lastHeartbeatAt).getTime() < 45000 ? 'Online' : 'Offline'],
                    ['Last violation', lastViolation?.message || lastViolation?.eventType || 'None recorded']
                  ].map(([label, value]) => (
                    <div key={label} className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                      <div className="text-[11px] text-slate-500">{label}</div>
                      <div className="mt-1 break-words text-[13px] font-medium text-slate-800 dark:text-slate-200">{value}</div>
                    </div>
                  ))}
                </div>
                </div>
                <div className="grid gap-4 md:grid-cols-3">
                  <div className="rounded-lg bg-slate-50 p-3 text-[13px] dark:bg-slate-900">
                    Answered: {answeredCount}
                  </div>
                  <div className="rounded-lg bg-slate-50 p-3 text-[13px] dark:bg-slate-900">
                    Flagged: {attempt.answers.filter(answer => answer.markedForReview).length}
                  </div>
                  <div className="rounded-lg bg-slate-50 p-3 text-[13px] dark:bg-slate-900">
                    Reported: {attempt.reportedQuestionIds?.length || 0}
                  </div>
                </div>
                <section className="rounded-lg border border-slate-200 p-4 dark:border-slate-700">
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Faculty assistance</h3>
                  {assistance ? (
                    <div className="mt-2 text-sm">
                      <p className="font-medium text-slate-800 dark:text-slate-200">{assistance.status} · {assistance.warningCount}/5 warnings</p>
                      <p className="mt-1 text-slate-600 dark:text-slate-400">{assistance.reason}</p>
                      {assistance.remarks && <p className="mt-1 text-xs text-slate-500">Review note: {assistance.remarks}</p>}
                      {assistance.status === 'PENDING' && (
                        <div className="mt-3 flex gap-2">
                          <button type="button" onClick={() => void handleAssistanceReview(assistance.requestId, 'REJECTED')} className="rounded-md border border-rose-200 px-3 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-50 dark:border-rose-800 dark:text-rose-300">Reject and submit</button>
                          <button type="button" onClick={() => void handleAssistanceReview(assistance.requestId, 'APPROVED')} className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700">Approve resume</button>
                        </div>
                      )}
                    </div>
                  ) : <p className="mt-2 text-sm text-slate-500">No assistance request for this attempt.</p>}
                  {(attempt.reportedQuestionIds?.length || 0) > 0 && <button type="button" onClick={() => { setSelectedMonitoringAttempt(null); void loadReportedQuery(attempt); }} className="mt-3 rounded-md border border-blue-200 px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-50 dark:border-blue-800 dark:text-blue-300">View reported question</button>}
                </section>
                <div>
                  <h3 className="mb-2 text-[15px] font-semibold text-slate-900 dark:text-white">Event Timeline</h3>
                  {events.length === 0 ? (
                    <p className="rounded-lg bg-slate-50 p-4 text-[13px] text-slate-500 dark:bg-slate-900">No persisted events recorded for this attempt.</p>
                  ) : (
                    <ol className="max-h-72 space-y-2 overflow-y-auto">
                      {events.map(event => (
                        <li key={event.eventId} className="flex gap-3 rounded-lg border border-slate-200 p-3 text-[13px] dark:border-slate-700">
                          <time className="shrink-0 text-slate-500">{new Date(event.timestamp).toLocaleString()}</time>
                          <span className="font-semibold text-slate-800 dark:text-slate-200">{event.eventType}</span>
                          <span className="text-slate-600 dark:text-slate-400">{event.details}</span>
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
                </div>
              </aside>
            );
          })()}
        </div>
      )}

      <ProctoringDetailModal
        event={selectedProctoringDetail}
        onClose={() => setSelectedProctoringDetail(null)}
        onTerminateAttempt={handleTerminateAttempt}
      />

      <ConfirmModal />
    </div>
    </PageMotionShell>
  );
};
