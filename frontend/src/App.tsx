import React, { useState, useEffect, useCallback } from 'react';
import {
  User,
  UserRole,
  Question,
  Difficulty,
  ProctorLog,
  StudentResult,
  StudentQuery,
  ScheduledExam,
  ExamAttemptRecord,
  ProctoringEventRecord
} from './types';
import { dbService } from './services/dbService';
import { realtimeService } from './services/realtimeService';
import { ProctoringModule } from './components/ProctoringModule';
import { StudentDashboard } from './components/dashboard/StudentDashboard';
import { TeacherDashboard } from './components/dashboard/TeacherDashboard';
import { AdminDashboard } from './components/dashboard/AdminDashboard';
import LandingPage from './components/landing/LandingPage';
import Header from './components/common/Header';
import { Modal, useConfirmAction } from './components/common/SharedUI';
import {
  Lock,
  CheckCircle,
  Clock,
  ChevronRight,
  ChevronLeft,
  Flag,
  HelpCircle,
  FileText,
  Sparkles,
  ArrowRight,
  Shield,
  X,
  UserCheck,
  Loader2,
  Bookmark,
  Eye,
  EyeOff,
  AlertCircle
} from 'lucide-react';

enum ViewState {
  LANDING = 'LANDING',
  LOGIN = 'LOGIN',
  DASHBOARD = 'DASHBOARD',
  EXAM_INTRO = 'EXAM_INTRO',
  EXAM_ACTIVE = 'EXAM_ACTIVE',
  EXAM_RESULT = 'EXAM_RESULT'
}

const SIDEBAR_STORAGE_KEY = 'examx_sidebar_collapsed';

export default function App() {
  const [view, setView] = useState<ViewState>(ViewState.LANDING);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [darkMode, setDarkMode] = useState(false);
  const [activeTab, setActiveTab] = useState<string>('overview');
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem(SIDEBAR_STORAGE_KEY);
      return saved !== null ? saved === 'true' : true;
    } catch {
      return true;
    }
  });
  const [notifications, setNotifications] = useState<
    Array<{ id: string; title: string; timestamp: string }>
  >([]);

  // Real Backend State
  const [questionBank, setQuestionBank] = useState<Question[]>([]);
  const [allResults, setAllResults] = useState<StudentResult[]>([]);
  const [allQueries, setAllQueries] = useState<StudentQuery[]>([]);
  const [scheduledExams, setScheduledExams] = useState<ScheduledExam[]>([]);

  // Login Form State
  const [loginId, setLoginId] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [isAuthenticating, setIsAuthenticating] = useState(false);

  // Active Exam Engine State
  const [activeScheduledExam, setActiveScheduledExam] = useState<ScheduledExam | null>(null);
  const [activeAttempt, setActiveAttempt] = useState<ExamAttemptRecord | null>(null);
  const [examQuestions, setExamQuestions] = useState<Question[]>([]);
  const [currentQIndex, setCurrentQIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [markedForReview, setMarkedForReview] = useState<Record<string, boolean>>({});
  const [proctorLogs, setProctorLogs] = useState<ProctorLog[]>([]);
  const [timeLeft, setTimeLeft] = useState(1800);
  const [isLoadingExam, setIsLoadingExam] = useState(false);
  const [examEngineError, setExamEngineError] = useState<string | null>(null);
  const [isTerminated, setIsTerminated] = useState(false);
  const [terminationReason, setTerminationReason] = useState('');
  const [lastSubmissionSummary, setLastSubmissionSummary] = useState<{
    attempt: ExamAttemptRecord;
    resultPublished: boolean;
    result: StudentResult | null;
    message: string;
  } | null>(null);

  // Logout confirmation state
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  // Proctoring Warning Modal & Live Question Query State
  const [activeWarningPopup, setActiveWarningPopup] = useState<{ log: ProctorLog; count: number } | null>(null);
  const [showScreenshotWarning, setShowScreenshotWarning] = useState(false);
  const [screenshotWarningMessage, setScreenshotWarningMessage] = useState('');
  const [showLiveQueryModal, setShowLiveQueryModal] = useState(false);
  const [liveQueryMessage, setLiveQueryMessage] = useState('');
  const [liveQueryReasonType, setLiveQueryReasonType] = useState<StudentQuery['reasonType']>('INCORRECT_QUESTION');
  const [isSubmittingLiveQuery, setIsSubmittingLiveQuery] = useState(false);
  const [liveQuerySuccess, setLiveQuerySuccess] = useState<string | null>(null);

  // Unblock review request state for terminated student
  const [showUnblockRequestModal, setShowUnblockRequestModal] = useState(false);
  const [unblockReason, setUnblockReason] = useState('');
  const [isSubmittingUnblock, setIsSubmittingUnblock] = useState(false);
  const [unblockSubmitted, setUnblockSubmitted] = useState(false);

  const { confirmAction, ConfirmModal } = useConfirmAction();

  const handleRequestFinishExam = () => {
    const answeredCount = Object.keys(answers).length;
    const unansweredCount = examQuestions.length - answeredCount;

    confirmAction({
      title: 'Submit Examination',
      subtitle: activeScheduledExam?.title || 'Active Session',
      message:
        unansweredCount > 0
          ? `Are you sure you want to finish and submit your exam? You have ${unansweredCount} unanswered question${unansweredCount > 1 ? 's' : ''}.`
          : 'Are you sure you want to finish and submit your examination?',
      consequence:
        'Once submitted, your responses will be permanently finalized and evaluated. You cannot re-enter this exam.',
      confirmLabel: 'Yes, Submit',
      cancelLabel: 'No',
      variant: unansweredCount > 0 ? 'warning' : 'primary',
      details: [
        { label: 'Total Questions', value: examQuestions.length },
        { label: 'Answered', value: `${answeredCount} questions` },
        { label: 'Unanswered', value: `${unansweredCount} questions` },
        {
          label: 'Marked for Review',
          value: `${Object.values(markedForReview).filter(Boolean).length} questions`
        }
      ],
      action: async () => {
        await finishExam(false);
      }
    });
  };

  const handleConfirmLogout = () => {
    if (isLoggingOut) return;
    setIsLoggingOut(true);
    try {
      setShowLogoutConfirm(false);
      handleLogout();
    } finally {
      setIsLoggingOut(false);
    }
  };

  const toggleSidebarCollapse = useCallback(() => {
    setSidebarCollapsed(prev => {
      const next = !prev;
      try {
        localStorage.setItem(SIDEBAR_STORAGE_KEY, String(next));
      } catch {
        // Ignore storage errors
      }
      return next;
    });
  }, []);

  const loadRoleData = useCallback(async (user: User) => {
    try {
      if (user.role === UserRole.STUDENT) {
        const [studentExams, publishedResults, studentQueries] = await Promise.all([
          dbService.getStudentExams(),
          dbService.getMyPublishedResults(),
          dbService.getQueries()
        ]);
        setScheduledExams(studentExams);
        setAllResults(publishedResults);
        setAllQueries(studentQueries);
        setQuestionBank([]);
      } else {
        const [examsData, questionsData, resultsData, queriesData] = await Promise.all([
          dbService.getExams(),
          dbService.getQuestions(),
          dbService.getResults(),
          dbService.getQueries()
        ]);
        setScheduledExams(examsData);
        setQuestionBank(questionsData);
        setAllResults(resultsData);
        setAllQueries(queriesData);
      }
    } catch {
      // Non-blocking initial load
    }
  }, []);

  // Restore session on mount
  useEffect(() => {
    const restoreSession = async () => {
      const token = dbService.getAuthToken();
      if (!token) return;
      const user = await dbService.getCurrentUser();
      if (user) {
        setCurrentUser(user);
        setActiveTab('overview');
        setView(ViewState.DASHBOARD);
        await loadRoleData(user);
      }
    };
    restoreSession();
  }, [loadRoleData]);

  // Connect & subscribe to authenticated Socket.IO real-time events
  useEffect(() => {
    if (!currentUser) {
      realtimeService.disconnect();
      return;
    }

    realtimeService.connect();

    const unsubEvents = realtimeService.subscribe(payload => {
      if (payload.event === 'notification.created' && payload.data) {
        const notif = payload.data as { id?: string; title?: string; timestamp?: string };
        if (notif.title) {
          setNotifications(prev => {
            const id = notif.id || `notif-${Date.now()}`;
            if (prev.some(n => n.id === id)) return prev;
            return [
              {
                id,
                title: notif.title!,
                timestamp: notif.timestamp
                  ? new Date(notif.timestamp).toLocaleTimeString()
                  : new Date().toLocaleTimeString()
              },
              ...prev
            ].slice(0, 30);
          });
        }
        return;
      }

      if (
        payload.event.startsWith('exam.') ||
        payload.event.startsWith('question.') ||
        payload.event.startsWith('result.') ||
        payload.event.startsWith('query.') ||
        payload.event.startsWith('student.') ||
        payload.event.startsWith('teacher.')
      ) {
        loadRoleData(currentUser);
      }
    });

    const unsubStatus = realtimeService.subscribeStatus(status => {
      if (status.connected && status.reconnected) {
        loadRoleData(currentUser);
      }
    });

    return () => {
      unsubEvents();
      unsubStatus();
    };
  }, [currentUser, loadRoleData]);

  // Toggle Dark Mode
  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [darkMode]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);

    if (!loginId.trim() || !password) {
      setAuthError('Invalid User ID or password.');
      return;
    }

    setIsAuthenticating(true);
    try {
      const { user } = await dbService.login(loginId.trim(), password);
      const verifiedUser = (await dbService.getCurrentUser()) || user;
      setCurrentUser(verifiedUser);
      setPassword('');
      setActiveTab('overview');
      setSidebarCollapsed(true);
      try {
        localStorage.setItem(SIDEBAR_STORAGE_KEY, 'true');
      } catch {
        // Ignore storage errors
      }
      setView(ViewState.DASHBOARD);
      await loadRoleData(verifiedUser);
    } catch (err: any) {
      setAuthError(err?.message || 'Invalid User ID or password.');
    } finally {
      setIsAuthenticating(false);
    }
  };

  const handleLogout = () => {
    realtimeService.disconnect();
    dbService.clearSession();
    setCurrentUser(null);
    setNotifications([]);
    setLoginId('');
    setPassword('');
    setAuthError(null);
    setActiveTab('overview');
    setSidebarCollapsed(true);
    try {
      localStorage.setItem(SIDEBAR_STORAGE_KEY, 'true');
    } catch {
      // Ignore storage errors
    }
    setView(ViewState.LANDING);
  };

  // --- TEACHER / ADMIN HANDLERS ---
  const handleAddQuestion = async (newQ: Question) => {
    const optionKeys: Array<'A' | 'B' | 'C' | 'D'> = ['A', 'B', 'C', 'D'];
    const formattedOptions = newQ.options.slice(0, 4).map((text, idx) => ({
      id: optionKeys[idx],
      key: optionKeys[idx],
      text
    }));
    const correctOption = optionKeys[newQ.correctAnswer ?? 0] || 'A';

    const saved = await dbService.createQuestion({
      questionText: newQ.text || newQ.questionText || '',
      subject: newQ.subject || newQ.topic || 'General',
      topic: newQ.topic || 'General',
      course: newQ.course,
      semester: newQ.semester,
      difficulty: newQ.difficulty || Difficulty.MEDIUM,
      options: formattedOptions,
      correctOption,
      explanation: newQ.explanation || '',
      marks: newQ.marks || 1,
      negativeMarks: newQ.negativeMarks || 0,
      source: newQ.source || 'MANUAL',
      status: newQ.status || 'ACTIVE'
    });

    setQuestionBank((prev) => [saved, ...prev]);
  };

  const handleUpdateQuestion = async (updatedQ: Question) => {
    const qId = updatedQ.questionId || updatedQ.id;
    const optionKeys: Array<'A' | 'B' | 'C' | 'D'> = ['A', 'B', 'C', 'D'];
    const formattedOptions = updatedQ.options.slice(0, 4).map((text, idx) => ({
      id: optionKeys[idx],
      key: optionKeys[idx],
      text
    }));
    const correctOption = optionKeys[updatedQ.correctAnswer ?? 0] || 'A';

    const saved = await dbService.updateQuestion(qId, {
      questionText: updatedQ.text || updatedQ.questionText || '',
      subject: updatedQ.subject || updatedQ.topic || 'General',
      topic: updatedQ.topic || 'General',
      course: updatedQ.course,
      semester: updatedQ.semester,
      difficulty: updatedQ.difficulty || Difficulty.MEDIUM,
      options: formattedOptions,
      correctOption,
      explanation: updatedQ.explanation || '',
      marks: updatedQ.marks || 1,
      negativeMarks: updatedQ.negativeMarks || 0,
      status: updatedQ.status
    });

    setQuestionBank((prev) =>
      prev.map((q) => (q.id === qId || q.questionId === qId ? saved : q))
    );
  };

  const handleDeleteQuestion = async (id: string) => {
    await dbService.deleteQuestion(id);
    setQuestionBank((prev) => prev.filter((q) => q.id !== id && q.questionId !== id));
  };

  const handlePublishResult = async (resultId: string) => {
    await dbService.publishSingleResult(resultId, 'PUBLISHED');
    if (currentUser) await loadRoleData(currentUser);
  };

  const handlePublishExamResults = async (examId: string) => {
    await dbService.publishExamResults(examId);
    if (currentUser) await loadRoleData(currentUser);
  };

  const handleRaiseQuery = async (
    topic: string,
    question: string,
    examId?: string,
    resultId?: string
  ) => {
    await dbService.createQuery({
      examId: examId || '',
      resultId,
      questionText: topic,
      message: question
    });
    if (currentUser) await loadRoleData(currentUser);
  };

  const handleResolveQuery = async (
    queryId: string,
    response: string,
    status: 'RESOLVED' | 'REJECTED' = 'RESOLVED'
  ) => {
    await dbService.resolveQuery(queryId, {
      status,
      response
    });
    if (currentUser) await loadRoleData(currentUser);
  };

  const handleSaveExam = async (exam: ScheduledExam) => {
    const startIso = `${exam.scheduledDate}T${exam.startTime || '09:00'}:00`;
    const endIso = `${exam.scheduledDate}T${exam.endTime || '23:00'}:00`;

    if (exam.examId) {
      await dbService.updateExam(exam.examId, {
        title: exam.title,
        description: exam.description,
        subject: exam.subject,
        course: exam.course,
        department: exam.department,
        semester: exam.semester,
        durationMinutes: exam.durationMinutes,
        totalMarks: exam.totalMarks,
        passingMarks: exam.passingMarks,
        attemptLimit: exam.attemptLimit || 1,
        startTime: new Date(startIso).toISOString(),
        endTime: new Date(endIso).toISOString(),
        instructions: exam.instructions,
        proctoringEnabled: exam.proctoringConfig?.enableWebcam ?? true,
        questionIds: exam.questionIds || [],
        assignedStudentIds: exam.assignedStudentIds || [],
        status: exam.status
      });
    } else {
      await dbService.createExam({
        title: exam.title,
        description: exam.description,
        subject: exam.subject,
        course: exam.course,
        department: exam.department || currentUser?.department || '',
        semester: exam.semester,
        durationMinutes: exam.durationMinutes,
        totalMarks: exam.totalMarks,
        passingMarks: exam.passingMarks,
        attemptLimit: exam.attemptLimit || 1,
        startTime: new Date(startIso).toISOString(),
        endTime: new Date(endIso).toISOString(),
        instructions: exam.instructions,
        proctoringEnabled: exam.proctoringConfig?.enableWebcam ?? true,
        questionIds: exam.questionIds || [],
        assignedStudentIds: exam.assignedStudentIds || [],
        status: exam.status || 'DRAFT'
      });
    }

    if (currentUser) await loadRoleData(currentUser);
  };

  const handleDeleteExam = async (id: string) => {
    await dbService.updateExamStatus(id, 'ARCHIVED');
    if (currentUser) await loadRoleData(currentUser);
  };

  // --- STUDENT EXAM FLOW ---
  const handleStartExam = (_subject: string, examId?: string) => {
    setExamEngineError(null);
    const found = examId
      ? scheduledExams.find((e) => e.examId === examId || e.id === examId)
      : scheduledExams[0];
    setActiveScheduledExam(found || scheduledExams[0] || null);
    setView(ViewState.EXAM_INTRO);
  };

  const buildBackendAnswersPayload = useCallback(
    (ansMap: Record<string, number>, reviewMap: Record<string, boolean>) => {
      const optionKeys: Array<'A' | 'B' | 'C' | 'D'> = ['A', 'B', 'C', 'D'];
      return Object.entries(ansMap).map(([questionId, optIndex]) => ({
        questionId,
        selectedOption: optionKeys[optIndex] || null,
        markedForReview: Boolean(reviewMap[questionId])
      }));
    },
    []
  );

  const handleConfirmStartExam = async () => {
    if (!activeScheduledExam) return;
    setIsLoadingExam(true);
    setExamEngineError(null);

    try {
      const startData = await dbService.startExamAttempt(
        activeScheduledExam.examId || activeScheduledExam.id
      );

      setActiveAttempt(startData.attempt);
      setActiveScheduledExam(startData.exam);
      setExamQuestions(startData.questions);
      setTimeLeft(startData.remainingSeconds || startData.exam.durationMinutes * 60);

      // Restore any saved answers if resumed
      const restoredAnswers: Record<string, number> = {};
      const restoredReview: Record<string, boolean> = {};
      const optionKeys: Array<'A' | 'B' | 'C' | 'D'> = ['A', 'B', 'C', 'D'];

      for (const ans of startData.attempt.answers || []) {
        if (ans.selectedOption) {
          const idx = optionKeys.indexOf(ans.selectedOption);
          if (idx >= 0) restoredAnswers[ans.questionId] = idx;
        }
        if (ans.markedForReview) {
          restoredReview[ans.questionId] = true;
        }
      }

      setAnswers(restoredAnswers);
      setMarkedForReview(restoredReview);
      setCurrentQIndex(startData.attempt.currentQuestionIndex || 0);
      setProctorLogs([]);
      setIsTerminated(false);
      setTerminationReason('');
      setLastSubmissionSummary(null);
      setActiveWarningPopup(null);
      setShowLiveQueryModal(false);
      setUnblockSubmitted(false);
      setUnblockReason('');
      setView(ViewState.EXAM_ACTIVE);
    } catch (err: any) {
      setExamEngineError(err?.message || 'Unable to start examination attempt.');
    } finally {
      setIsLoadingExam(false);
    }
  };

  const handleSelectOption = async (optionIndex: number) => {
    const currentQ = examQuestions[currentQIndex];
    if (!currentQ) return;
    const qId = currentQ.questionId || currentQ.id;

    const updatedAnswers = {
      ...answers,
      [qId]: optionIndex
    };
    setAnswers(updatedAnswers);

    if (activeAttempt) {
      try {
        await dbService.saveAttemptAnswers(activeAttempt.attemptId, {
          answers: buildBackendAnswersPayload(updatedAnswers, markedForReview),
          currentQuestionIndex: currentQIndex,
          warningCount: proctorLogs.length
        });
      } catch {
        // Non-blocking background save
      }
    }
  };

  const toggleMarkForReview = () => {
    const currentQ = examQuestions[currentQIndex];
    if (!currentQ) return;
    const qId = currentQ.questionId || currentQ.id;
    setMarkedForReview((prev) => ({
      ...prev,
      [qId]: !prev[qId]
    }));
  };

  const clearResponse = () => {
    const currentQ = examQuestions[currentQIndex];
    if (!currentQ) return;
    const qId = currentQ.questionId || currentQ.id;
    setAnswers((prev) => {
      const next = { ...prev };
      delete next[qId];
      return next;
    });
  };

  const finishExam = useCallback(
    async (terminated = false, reason = '') => {
      if (!activeAttempt) {
        setView(ViewState.DASHBOARD);
        return;
      }

      // Exit fullscreen if active
      if (typeof document !== 'undefined' && document.fullscreenElement && document.exitFullscreen) {
        document.exitFullscreen().catch(() => {});
      }
      setActiveWarningPopup(null);

      try {
        const submitRes = await dbService.submitExamAttempt(activeAttempt.attemptId, {
          answers: buildBackendAnswersPayload(answers, markedForReview),
          warningCount: proctorLogs.length,
          terminatedByProctor: terminated,
          terminationReason: reason
        });

        setLastSubmissionSummary({
          attempt: submitRes.attempt,
          resultPublished: submitRes.resultPublished,
          result: submitRes.result,
          message: submitRes.message
        });
        setView(ViewState.EXAM_RESULT);

        if (currentUser) {
          await loadRoleData(currentUser);
        }
      } catch (err: any) {
        setExamEngineError(err?.message || 'Failed to submit examination attempt');
        setView(ViewState.EXAM_RESULT);
      }
    },
    [activeAttempt, answers, markedForReview, proctorLogs.length, buildBackendAnswersPayload, currentUser, loadRoleData]
  );

  // Exam Countdown Timer
  useEffect(() => {
    if (view !== ViewState.EXAM_ACTIVE) return;

    const timer = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          finishExam(false, 'Server examination timer expired');
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [view, finishExam]);

  const handleProctorViolation = (log: ProctorLog) => {
    setProctorLogs((prev) => {
      const newLogs = [log, ...prev];
      const maxWarnings = 5;

      if (newLogs.length > maxWarnings && !isTerminated) {
        setIsTerminated(true);
        setActiveWarningPopup(null);
        const reason = `Exceeded maximum security warnings (${maxWarnings}). Last violation: ${log.message}`;
        setTerminationReason(reason);
        setTimeout(() => {
          finishExam(true, reason);
        }, 500);
      } else if (newLogs.length <= maxWarnings && !isTerminated) {
        setActiveWarningPopup({ log, count: newLogs.length });
      }
      return newLogs;
    });
  };

  const handleProctoringEvent = async (
    eventType: ProctoringEventRecord['eventType'],
    severity: ProctoringEventRecord['severity'],
    details: string
  ) => {
    if (!activeScheduledExam || !activeAttempt) return;
    try {
      await dbService.recordProctoringEvent({
        examId: activeScheduledExam.examId || activeScheduledExam.id,
        attemptId: activeAttempt.attemptId,
        eventType,
        severity,
        details
      });
    } catch {
      // Non-blocking event persistence
    }
  };

  const handleScreenshotDetected = (details: string) => {
    // Show security reminder popup, but DO NOT increment proctorLogs or warning counter!
    setScreenshotWarningMessage(details);
    setShowScreenshotWarning(true);
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

    if (view === ViewState.LANDING) {
    return (
      <LandingPage
        onNavigate={(target) => {
          setAuthError(null);
          if (target === 'LOGIN') {
            setView(ViewState.LOGIN);
          } else {
            setView(ViewState.LANDING);
          }
        }}
        onLogin={async (user) => {
          setCurrentUser(user);
          setPassword('');
          setActiveTab('overview');
          setSidebarCollapsed(true);
          try {
            localStorage.setItem(SIDEBAR_STORAGE_KEY, 'true');
          } catch {
            // Ignore storage errors
          }
          setView(ViewState.DASHBOARD);
          await loadRoleData(user);
        }}
        darkMode={darkMode}
        toggleTheme={() => setDarkMode(!darkMode)}
      />
    );
  }

  // LOGIN VIEW - Unified with LandingPage right-side Sign-In panel
  if (view === ViewState.LOGIN) {
    return (
      <LandingPage
        initialShowSignIn={true}
        onNavigate={(target) => {
          setAuthError(null);
          if (target === 'LOGIN') {
            setView(ViewState.LOGIN);
          } else {
            setView(ViewState.LANDING);
          }
        }}
        onLogin={async (user) => {
          setCurrentUser(user);
          setPassword('');
          setActiveTab('overview');
          setSidebarCollapsed(true);
          try {
            localStorage.setItem(SIDEBAR_STORAGE_KEY, 'true');
          } catch {
            // Ignore storage errors
          }
          setView(ViewState.DASHBOARD);
          await loadRoleData(user);
        }}
        darkMode={darkMode}
        toggleTheme={() => setDarkMode(!darkMode)}
      />
    );
  }

  return (
    <div className="examx-auth-app min-h-screen flex flex-col bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-white transition-colors duration-300 font-auth">
      <Header
        user={currentUser}
        darkMode={darkMode}
        onToggleDarkMode={() => setDarkMode(!darkMode)}
        onLogout={() => setShowLogoutConfirm(true)}
        hideSidebar={view === ViewState.EXAM_ACTIVE}
        sidebarCollapsed={sidebarCollapsed}
        onToggleSidebarCollapse={toggleSidebarCollapse}
        notifications={notifications}
        onClearNotifications={() => setNotifications([])}
        activeTab={activeTab}
        onSelectTab={tabId => {
          setActiveTab(tabId);
          if (view !== ViewState.DASHBOARD && view !== ViewState.EXAM_ACTIVE) {
            setView(ViewState.DASHBOARD);
          }
        }}
        onNavigateToDashboard={() => {
          setActiveTab('overview');
          if (view !== ViewState.EXAM_ACTIVE) {
            setView(ViewState.DASHBOARD);
          }
        }}
      />

      <main
        className={`flex-1 flex flex-col min-w-0 transition-all duration-200 ease-in-out ${
          currentUser && view !== ViewState.EXAM_ACTIVE
            ? sidebarCollapsed
              ? 'lg:pl-[72px]'
              : 'lg:pl-[256px]'
            : ''
        }`}
      >
        {view === ViewState.DASHBOARD && currentUser?.role === UserRole.STUDENT && (
          <StudentDashboard
            user={currentUser}
            activeTab={activeTab}
            onNavigateTab={setActiveTab}
            results={allResults}
            queries={allQueries}
            exams={scheduledExams}
            onStartExam={handleStartExam}
            onRaiseQuery={handleRaiseQuery}
            onRefreshData={() => loadRoleData(currentUser)}
          />
        )}

        {view === ViewState.DASHBOARD && currentUser?.role === UserRole.TEACHER && (
          <TeacherDashboard
            user={currentUser}
            activeTab={activeTab}
            onNavigateTab={setActiveTab}
            results={allResults}
            questions={questionBank}
            queries={allQueries}
            exams={scheduledExams}
            onAddQuestion={handleAddQuestion}
            onUpdateQuestion={handleUpdateQuestion}
            onDeleteQuestion={handleDeleteQuestion}
            onPublishResult={handlePublishResult}
            onPublishAllForExam={handlePublishExamResults}
            onResolveQuery={handleResolveQuery}
            onSaveExam={handleSaveExam}
            onDeleteExam={handleDeleteExam}
            onRefreshData={() => loadRoleData(currentUser)}
          />
        )}

        {view === ViewState.DASHBOARD && currentUser?.role === UserRole.ADMIN && (
          <AdminDashboard
            user={currentUser}
            activeTab={activeTab}
            onNavigateTab={setActiveTab}
            exams={scheduledExams}
            results={allResults}
            queries={allQueries}
            onSaveExam={handleSaveExam}
            onDeleteExam={handleDeleteExam}
            onPublishResult={handlePublishResult}
            onPublishAllForExam={handlePublishExamResults}
            onResolveQuery={handleResolveQuery}
            onRefreshGlobalData={() => loadRoleData(currentUser)}
          />
        )}

        {/* EXAM INTRO */}
        {view === ViewState.EXAM_INTRO && (
          <div className="flex-1 flex items-center justify-center p-6 animate-slide-up">
            <div className="max-w-xl w-full bg-white dark:bg-slate-800 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-700 p-8">
              <div className="w-12 h-12 bg-blue-50 dark:bg-blue-900/20 text-blue-600 rounded-xl flex items-center justify-center mb-5">
                <FileText className="w-6 h-6" />
              </div>
              <div className="text-[13px] font-mono text-slate-400 mb-1 tabular-nums">
                {activeScheduledExam?.examId}
              </div>
              <h2 className="text-[26px] font-semibold text-slate-900 dark:text-white mb-2 leading-tight">
                {activeScheduledExam ? activeScheduledExam.title : 'Assigned Examination'}
              </h2>
              <p className="text-slate-500 dark:text-slate-400 mb-6 text-[15px] leading-relaxed">
                {activeScheduledExam
                  ? `Subject: ${activeScheduledExam.subject} (${activeScheduledExam.course} - ${activeScheduledExam.semester})`
                  : 'You are about to begin a proctored examination.'}
              </p>

              {examEngineError && (
                <div className="mb-6 p-4 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-[14px] font-medium text-red-600 dark:text-red-400">
                  {examEngineError}
                </div>
              )}

              <div className="space-y-4 mb-8">
                <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-900/50 border border-slate-100 dark:border-slate-700 flex items-start space-x-3.5">
                  <Clock className="w-5 h-5 text-blue-500 shrink-0 mt-0.5" />
                  <div>
                    <h4 className="text-[15px] font-semibold text-slate-900 dark:text-white">
                      Server-Enforced Duration & Marks
                    </h4>
                    <p className="text-[14px] text-slate-500 mt-0.5 tabular-nums">
                      {activeScheduledExam
                        ? `${activeScheduledExam.durationMinutes} minutes • Total Marks: ${activeScheduledExam.totalMarks} (Passing: ${activeScheduledExam.passingMarks}) • Attempt Limit: ${activeScheduledExam.attemptLimit || 1}`
                        : '60 minutes'}
                    </p>
                  </div>
                </div>
                <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-900/50 border border-slate-100 dark:border-slate-700 flex items-start space-x-3.5">
                  <Shield className="w-5 h-5 text-emerald-500 shrink-0 mt-0.5" />
                  <div>
                    <h4 className="text-[15px] font-semibold text-slate-900 dark:text-white">
                      Active Proctoring & Instructions
                    </h4>
                    <p className="text-[14px] text-slate-500 whitespace-pre-line mt-0.5">
                      {activeScheduledExam
                        ? activeScheduledExam.instructions
                        : 'Webcam, fullscreen, and tab-switch events are logged to the server.'}
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex space-x-4">
                <button
                  onClick={() => setView(ViewState.DASHBOARD)}
                  disabled={isLoadingExam}
                  className="flex-1 h-12 px-6 rounded-xl border border-slate-200 dark:border-slate-700 font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors text-[15px] inline-flex items-center justify-center"
                >
                  Cancel
                </button>
                <button
                  onClick={handleConfirmStartExam}
                  disabled={isLoadingExam}
                  className="flex-1 h-12 px-6 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-medium shadow-md shadow-blue-500/20 transition-all text-[15px] inline-flex items-center justify-center"
                >
                  {isLoadingExam ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Starting Attempt...
                    </>
                  ) : (
                    'Launch Secure Exam'
                  )}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* EXAM ACTIVE */}
        {view === ViewState.EXAM_ACTIVE && examQuestions.length > 0 && (
          <div className="flex-1 bg-slate-100 dark:bg-slate-950 p-4 lg:p-6 w-full">
            <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-4 gap-6 items-start">
              {/* Left: Question Area (Natural Vertical Scroll) */}
              <div className="lg:col-span-3 space-y-4">
                {/* Exam Header Bar */}
                <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-800 flex flex-wrap justify-between items-center gap-4">
                  <div>
                    <span className="text-[12.5px] font-medium text-slate-500 dark:text-slate-400 block">
                      {activeScheduledExam?.title || 'Active Examination'} • Attempt #{activeAttempt?.attemptNumber || 1}
                    </span>
                    <div className="flex items-center space-x-2 mt-1">
                      <span className="px-2.5 py-0.5 rounded-md bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 text-[12.5px] font-medium">
                        {examQuestions[currentQIndex]?.topic}
                      </span>
                      <span className="px-2.5 py-0.5 rounded-md text-[12px] font-medium bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 tabular-nums">
                        {examQuestions[currentQIndex]?.marks || 1} Mark(s)
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center space-x-3 bg-slate-100 dark:bg-slate-800 px-3.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700">
                    <Clock
                      className={`w-4 h-4 ${
                        timeLeft < 300 ? 'text-red-500 animate-pulse' : 'text-blue-500'
                      }`}
                    />
                    <span
                      className={`font-mono text-[18px] font-semibold tabular-nums ${
                        timeLeft < 300
                          ? 'text-red-600 dark:text-red-400'
                          : 'text-slate-800 dark:text-white'
                      }`}
                    >
                      {formatTime(timeLeft)}
                    </span>
                  </div>
                </div>

                {/* Question Card */}
                <div className="bg-white dark:bg-slate-900 p-5 sm:p-7 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-800 relative">
                  <div className="absolute top-0 left-0 w-full h-1 bg-slate-100 dark:bg-slate-800 rounded-t-2xl overflow-hidden">
                    <div
                      className="bg-blue-600 h-full transition-all duration-300"
                      style={{
                        width: `${((currentQIndex + 1) / examQuestions.length) * 100}%`
                      }}
                    />
                  </div>

                  <div>
                    <div className="flex justify-between items-center mb-4 mt-1">
                      <span className="text-[13.5px] font-medium text-slate-500 tabular-nums">
                        Question {currentQIndex + 1} of {examQuestions.length}
                      </span>
                      {markedForReview[
                        examQuestions[currentQIndex]?.questionId || examQuestions[currentQIndex]?.id
                      ] && (
                        <span className="flex items-center text-[12px] font-medium text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-900/20 px-2.5 py-0.5 rounded-md">
                          <Bookmark className="w-3.5 h-3.5 mr-1 fill-current" /> Marked for Review
                        </span>
                      )}
                    </div>

                    <h3 className="text-[18px] sm:text-[19px] font-medium text-slate-900 dark:text-white mb-5 leading-relaxed">
                      {examQuestions[currentQIndex]?.text}
                    </h3>

                    <div className="space-y-2.5">
                      {examQuestions[currentQIndex]?.options.map((option, idx) => {
                        const qKey =
                          examQuestions[currentQIndex].questionId || examQuestions[currentQIndex].id;
                        const isSelected = answers[qKey] === idx;
                        return (
                          <button
                            key={idx}
                            onClick={() => handleSelectOption(idx)}
                            className={`w-full text-left py-3 px-3.5 sm:px-4 rounded-xl border-2 transition-all flex items-center space-x-3 sm:space-x-3.5 group ${
                              isSelected
                                ? 'border-blue-600 bg-blue-50/50 dark:bg-blue-900/20 text-blue-900 dark:text-blue-100 shadow-sm'
                                : 'border-slate-100 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 text-slate-700 dark:text-slate-300 bg-slate-50/50 dark:bg-slate-900/50'
                            }`}
                          >
                            <div
                              className={`w-7.5 h-7.5 rounded-lg flex items-center justify-center text-[13.5px] font-semibold transition-colors shrink-0 ${
                                isSelected
                                  ? 'bg-blue-600 text-white'
                                  : 'bg-white dark:bg-slate-800 text-slate-500 border border-slate-200 dark:border-slate-700 group-hover:border-blue-400'
                              }`}
                            >
                              {String.fromCharCode(65 + idx)}
                            </div>
                            <span className="text-[14.5px] font-normal leading-snug flex-1">{option}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Action Bar */}
                  <div className="flex flex-wrap justify-between items-center mt-7 pt-5 border-t border-slate-100 dark:border-slate-800 gap-3">
                    <div className="flex flex-wrap gap-2">
                      <button
                        onClick={toggleMarkForReview}
                        className={`h-9.5 px-3.5 rounded-xl font-medium text-[13px] inline-flex items-center transition-colors border ${
                          markedForReview[
                            examQuestions[currentQIndex]?.questionId ||
                              examQuestions[currentQIndex]?.id
                          ]
                            ? 'bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-800'
                            : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-50'
                        }`}
                      >
                        <Bookmark className="w-3.5 h-3.5 mr-1.5" />
                        {markedForReview[
                          examQuestions[currentQIndex]?.questionId || examQuestions[currentQIndex]?.id
                        ]
                          ? 'Unmark Review'
                          : 'Mark for Review'}
                      </button>
                      <button
                        onClick={clearResponse}
                        disabled={
                          answers[
                            examQuestions[currentQIndex]?.questionId ||
                              examQuestions[currentQIndex]?.id
                          ] === undefined
                        }
                        className="h-9.5 px-3 rounded-xl font-medium text-[13px] text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 transition-colors"
                      >
                        Clear
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setLiveQuerySuccess(null);
                          setLiveQueryMessage('');
                          setShowLiveQueryModal(true);
                        }}
                        className="h-9.5 px-3.5 rounded-xl font-medium text-[13px] text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 hover:bg-blue-100 dark:hover:bg-blue-900/40 inline-flex items-center transition-colors border border-blue-200 dark:border-blue-800"
                        title="Submit an official question inquiry to faculty proctor"
                      >
                        <HelpCircle className="w-3.5 h-3.5 mr-1.5" />
                        Raise Query
                      </button>
                    </div>

                    <div className="flex items-center gap-2.5">
                      <button
                        onClick={() => setCurrentQIndex((prev) => Math.max(0, prev - 1))}
                        disabled={currentQIndex === 0}
                        className="h-9.5 px-4 rounded-xl font-medium text-[13px] text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 disabled:opacity-40 inline-flex items-center transition-colors"
                      >
                        <ChevronLeft className="w-3.5 h-3.5 mr-1" /> Prev
                      </button>

                      {currentQIndex < examQuestions.length - 1 ? (
                        <button
                          onClick={() => setCurrentQIndex((prev) => prev + 1)}
                          className="h-9.5 px-5 bg-blue-600 text-white rounded-xl font-medium text-[13px] hover:bg-blue-700 inline-flex items-center transition-all"
                        >
                          Next <ChevronRight className="w-3.5 h-3.5 ml-1" />
                        </button>
                      ) : (
                        <button
                          onClick={handleRequestFinishExam}
                          className="h-9.5 px-5 bg-emerald-600 text-white rounded-xl font-medium text-[13px] hover:bg-emerald-700 inline-flex items-center transition-all"
                        >
                          Submit Exam <CheckCircle className="w-3.5 h-3.5 ml-1.5" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {/* Always Reachable Submit Exam Section */}
                <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col sm:flex-row items-center justify-between gap-3">
                  <div className="text-slate-600 dark:text-slate-400 text-[13px]">
                    <span className="font-semibold text-slate-800 dark:text-slate-200">
                      Answered {Object.keys(answers).length} of {examQuestions.length} questions
                    </span>
                    <span className="hidden sm:inline"> · Ready to finalize your submission?</span>
                  </div>
                  <button
                    type="button"
                    onClick={handleRequestFinishExam}
                    className="w-full sm:w-auto h-9.5 px-5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-medium text-[13px] shadow-sm shadow-emerald-600/20 inline-flex items-center justify-center gap-1.5 transition-colors"
                  >
                    <CheckCircle className="w-4 h-4" />
                    Submit Examination
                  </button>
                </div>
              </div>

              {/* Right Sidebar: Proctoring & Question Palette (Sticky on desktop, stacks cleanly on mobile) */}
              <div className="lg:col-span-1 space-y-5 lg:sticky lg:top-4">
                <ProctoringModule
                  isExamActive={view === ViewState.EXAM_ACTIVE}
                  warningCount={proctorLogs.length}
                  maxWarnings={5}
                  onViolation={handleProctorViolation}
                  onProctoringEvent={handleProctoringEvent}
                  onScreenshotDetected={handleScreenshotDetected}
                />

                {/* Question Palette */}
                <div className="bg-white dark:bg-slate-900 p-4 sm:p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col">
                  <div className="mb-4 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[13.5px] font-semibold text-slate-700 dark:text-slate-200">Question Palette</span>
                      <span className="text-[11.5px] font-medium px-2 py-0.5 rounded bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300">
                        {activeAttempt?.status || 'IN_PROGRESS'}
                      </span>
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-center text-[12px] font-medium pt-1 border-t border-slate-100 dark:border-slate-800">
                      <div className="text-emerald-600 dark:text-emerald-400">
                        <span className="font-semibold block tabular-nums">{Object.keys(answers).length}</span>
                        <span className="text-[11px] text-slate-500">Answered</span>
                      </div>
                      <div className="text-slate-600 dark:text-slate-400">
                        <span className="font-semibold block tabular-nums">
                          {examQuestions.length - Object.keys(answers).length}
                        </span>
                        <span className="text-[11px] text-slate-500">Unanswered</span>
                      </div>
                      <div className="text-purple-600 dark:text-purple-400">
                        <span className="font-semibold block tabular-nums">
                          {Object.values(markedForReview).filter(Boolean).length}
                        </span>
                        <span className="text-[11px] text-slate-500">Review</span>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-5 gap-2 mb-4">
                    {examQuestions.map((q, idx) => {
                      const qKey = q.questionId || q.id;
                      const isAnswered = answers[qKey] !== undefined;
                      const isMarked = markedForReview[qKey];
                      const isCurrent = currentQIndex === idx;

                      let btnStyle =
                        'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700';
                      if (isAnswered && isMarked) {
                        btnStyle =
                          'bg-purple-600 text-white border-purple-600';
                      } else if (isMarked) {
                        btnStyle =
                          'bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 border-purple-300 dark:border-purple-700';
                      } else if (isAnswered) {
                        btnStyle =
                          'bg-emerald-500 text-white border-emerald-500';
                      }

                      return (
                        <button
                          key={qKey}
                          onClick={() => setCurrentQIndex(idx)}
                          className={`h-9 rounded-lg font-medium text-[13px] border transition-all flex items-center justify-center relative tabular-nums ${btnStyle} ${
                            isCurrent
                              ? 'ring-2 ring-blue-600 ring-offset-2 dark:ring-offset-slate-900'
                              : 'hover:opacity-80'
                          }`}
                        >
                          {idx + 1}
                        </button>
                      );
                    })}
                  </div>

                  <div className="pt-3 border-t border-slate-100 dark:border-slate-800">
                    <button
                      onClick={handleRequestFinishExam}
                      className="w-full h-9.5 bg-slate-900 dark:bg-white text-white dark:text-slate-900 rounded-xl font-medium text-[13px] hover:opacity-90 transition-opacity inline-flex items-center justify-center"
                    >
                      Final Submit Exam
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* EXAM RESULT / SUBMISSION CONFIRMATION */}
        {view === ViewState.EXAM_RESULT && (
          <div className="flex-1 flex items-center justify-center p-6 animate-fade-in">
            <div className="max-w-lg w-full bg-white dark:bg-slate-800 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-700 p-8 text-center">
              {isTerminated ? (
                <>
                  <div className="w-16 h-16 bg-red-100 dark:bg-red-900/30 text-red-600 rounded-full flex items-center justify-center mx-auto mb-5">
                    <X className="w-8 h-8" />
                  </div>
                  <h2 className="text-[26px] font-semibold mb-2 text-red-600 dark:text-red-500 leading-tight">
                    Exam Terminated
                  </h2>
                  <p className="text-slate-500 mb-6 text-[15px]">
                    Your examination session was terminated due to proctoring policy violations.
                  </p>
                  <div className="bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-800/50 rounded-xl p-4 mb-6 text-left">
                    <h4 className="text-[13px] font-semibold text-red-800 dark:text-red-400 mb-1">
                      Reason for Termination
                    </h4>
                    <p className="text-[14.5px] text-red-600 dark:text-red-300 font-medium">
                      {terminationReason}
                    </p>
                  </div>

                  <div className="space-y-3 mb-6">
                    {unblockSubmitted ? (
                      <div className="p-3.5 rounded-xl bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 text-[14px] text-blue-800 dark:text-blue-300 font-medium">
                        ✓ Review Request Submitted — Awaiting Faculty Adjudication
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setShowUnblockRequestModal(true)}
                        className="w-full h-11 bg-amber-600 hover:bg-amber-700 text-white rounded-xl font-medium text-[14.5px] transition-colors inline-flex items-center justify-center gap-2"
                      >
                        Request Review / Request Unblock
                      </button>
                    )}
                  </div>
                </>
              ) : (
                <>
                  <div className="w-16 h-16 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 rounded-full flex items-center justify-center mx-auto mb-5">
                    <CheckCircle className="w-8 h-8" />
                  </div>
                  <h2 className="text-[26px] font-semibold text-slate-900 dark:text-white mb-2 leading-tight">
                    Examination Submitted
                  </h2>
                  <p className="text-slate-500 mb-6 text-[15px]">
                    {lastSubmissionSummary?.message ||
                      'Your responses have been securely recorded and evaluated on the server.'}
                  </p>

                  {lastSubmissionSummary?.resultPublished && lastSubmissionSummary.result ? (
                    <div className="bg-slate-50 dark:bg-slate-900 rounded-xl p-6 mb-6 grid grid-cols-2 gap-4 border border-slate-100 dark:border-slate-700">
                      <div className="text-center">
                        <span className="text-[13.5px] text-slate-500 font-medium">
                          Published Score
                        </span>
                        <p className="text-[32px] font-semibold text-blue-600 mt-1 tabular-nums">
                          {lastSubmissionSummary.result.score} /{' '}
                          {lastSubmissionSummary.result.totalMarks || 100}
                        </p>
                      </div>
                      <div className="text-center border-l border-slate-200 dark:border-slate-800">
                        <span className="text-[13.5px] text-slate-500 font-medium">
                          Percentage
                        </span>
                        <p className="text-[32px] font-semibold mt-1 text-emerald-500 tabular-nums">
                          {lastSubmissionSummary.result.percentage}%
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl p-5 mb-6 text-left flex items-start gap-3">
                      <Lock className="w-5 h-5 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
                      <div>
                        <h4 className="text-[15px] font-semibold text-slate-900 dark:text-white">
                          Awaiting Faculty Result Publication
                        </h4>
                        <p className="text-[14px] text-slate-600 dark:text-slate-300 mt-1">
                          Your exam attempt ({lastSubmissionSummary?.attempt.attemptId}) has been evaluated server-side.
                          In accordance with institutional policy, scores remain hidden until officially published by faculty.
                        </p>
                      </div>
                    </div>
                  )}
                </>
              )}

              <button
                onClick={() => setView(ViewState.DASHBOARD)}
                className="w-full h-12 bg-slate-900 dark:bg-white text-white dark:text-slate-900 rounded-xl font-medium text-[15px] hover:opacity-90 transition-opacity inline-flex items-center justify-center"
              >
                Return to Dashboard
              </button>
            </div>
          </div>
        )}
      </main>

      {/* Universal Logout Confirmation Modal for Admin, Teacher, and Student */}
      <Modal
        isOpen={showLogoutConfirm}
        onClose={() => {
          if (!isLoggingOut) setShowLogoutConfirm(false);
        }}
        title="Sign Out"
        size="compact"
        footer={
          <div className="flex items-center justify-end gap-3 w-full">
            <button
              type="button"
              onClick={() => setShowLogoutConfirm(false)}
              disabled={isLoggingOut}
              className="h-10 px-4 rounded-lg border border-slate-200 dark:border-slate-700 text-[14.5px] font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-slate-400"
            >
              No
            </button>
            <button
              type="button"
              onClick={handleConfirmLogout}
              disabled={isLoggingOut}
              className="h-10 px-5 rounded-lg bg-red-600 hover:bg-red-700 active:bg-red-800 text-white text-[14.5px] font-semibold transition-colors shadow-sm disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-red-500 inline-flex items-center justify-center gap-2"
            >
              {isLoggingOut ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Signing out...</span>
                </>
              ) : (
                'Yes, Sign Out'
              )}
            </button>
          </div>
        }
      >
        <p className="text-[15px] text-slate-600 dark:text-slate-300 leading-relaxed">
          Are you sure you want to sign out?
        </p>
      </Modal>

      {/* 21. PROCTORING WARNING POPUP */}
      {activeWarningPopup && (
        <Modal
          isOpen={!!activeWarningPopup}
          onClose={() => setActiveWarningPopup(null)}
          size="compact"
          title="PROCTORING WARNING"
          subtitle={`Warning ${activeWarningPopup.count} of 5`}
          footer={
            <div className="flex justify-end w-full">
              <button
                type="button"
                onClick={() => setActiveWarningPopup(null)}
                className="w-full h-11 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-[14.5px] font-medium transition-colors inline-flex items-center justify-center shadow-sm"
              >
                Continue Exam
              </button>
            </div>
          }
        >
          <div className="space-y-3.5 p-1">
            <div className="p-3.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-[14.5px] text-amber-900 dark:text-amber-200 flex items-start gap-2.5">
              <AlertCircle className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
              <div>
                <span className="font-semibold block mb-0.5">Violation Detected:</span>
                <span>{activeWarningPopup.log.message}</span>
              </div>
            </div>
            <p className="text-[13.5px] text-slate-500 dark:text-slate-400 leading-relaxed">
              Please maintain focus on your examination window. Reaching 6 confirmed violations will result in automatic examination termination and session block.
            </p>
          </div>
        </Modal>
      )}

      {/* 21B. SCREENSHOT / CAPTURE NOTIFICATION (EXCLUDED FROM PROCTORING WARNING COUNTER) */}
      {showScreenshotWarning && (
        <Modal
          isOpen={showScreenshotWarning}
          onClose={() => setShowScreenshotWarning(false)}
          size="compact"
          title="Screen Capture Detected"
          subtitle="Proctoring Security Advisory"
          footer={
            <div className="flex justify-end w-full">
              <button
                type="button"
                onClick={() => setShowScreenshotWarning(false)}
                className="w-full h-10 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-[13.5px] font-medium transition-colors inline-flex items-center justify-center shadow-sm"
              >
                Acknowledge & Continue Exam
              </button>
            </div>
          }
        >
          <div className="space-y-3 p-1">
            <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-[13.5px] text-amber-900 dark:text-amber-200 flex items-start gap-2.5">
              <AlertCircle className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
              <div>
                <span className="font-semibold block mb-0.5">Screen Capture Is Not Permitted</span>
                <span>{screenshotWarningMessage || 'Screen capture action or shortcut detected during examination.'}</span>
              </div>
            </div>
            <p className="text-[13px] text-slate-600 dark:text-slate-300 leading-relaxed">
              Screen captures, screenshot shortcuts, and browser printing are strictly restricted during live examinations to protect test integrity.
            </p>
            <p className="text-[12px] text-slate-400 dark:text-slate-500 bg-slate-50 dark:bg-slate-900/60 p-2.5 rounded-lg border border-slate-200 dark:border-slate-800">
              Note: This notice is security feedback only. It does <span className="font-semibold text-slate-600 dark:text-slate-300">not</span> increment your proctoring violation warnings ({proctorLogs.length} / 5).
            </p>
          </div>
        </Modal>
      )}

      {/* 25. LIVE EXAM QUESTION QUERY */}
      {showLiveQueryModal && (
        <Modal
          isOpen={showLiveQueryModal}
          onClose={() => setShowLiveQueryModal(false)}
          size="compact"
          title={`Raise Query · Question #${currentQIndex + 1}`}
          subtitle={examQuestions[currentQIndex]?.topic || activeScheduledExam?.title}
          footer={
            <div className="flex items-center justify-end gap-3 w-full">
              <button
                type="button"
                onClick={() => setShowLiveQueryModal(false)}
                className="h-10 px-4 rounded-lg border border-slate-200 dark:border-slate-700 text-[14px] font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isSubmittingLiveQuery || !liveQueryMessage.trim() || !!liveQuerySuccess}
                onClick={async () => {
                  const currentQ = examQuestions[currentQIndex];
                  if (!currentQ || !activeScheduledExam) return;
                  setIsSubmittingLiveQuery(true);
                  try {
                    await dbService.createQuery({
                      examId: activeScheduledExam.examId || activeScheduledExam.id,
                      attemptId: activeAttempt?.attemptId,
                      questionId: currentQ.questionId || currentQ.id,
                      questionText: currentQ.text,
                      reasonType: liveQueryReasonType,
                      message: liveQueryMessage.trim()
                    });
                    setLiveQuerySuccess('Your query has been dispatched to the faculty proctor.');
                    setTimeout(() => {
                      setShowLiveQueryModal(false);
                      setLiveQuerySuccess(null);
                      setLiveQueryMessage('');
                    }, 1200);
                  } catch (err: any) {
                    alert(err?.message || 'Failed to submit query');
                  } finally {
                    setIsSubmittingLiveQuery(false);
                  }
                }}
                className="h-10 px-5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-[14px] font-medium disabled:opacity-50 inline-flex items-center justify-center gap-2"
              >
                {isSubmittingLiveQuery ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" /> Submitting...
                  </>
                ) : (
                  'Submit Query'
                )}
              </button>
            </div>
          }
        >
          <div className="space-y-4">
            {liveQuerySuccess ? (
              <div className="p-4 rounded-xl bg-emerald-50 dark:bg-emerald-900/30 text-emerald-800 dark:text-emerald-300 text-[14px] font-medium flex items-center gap-2">
                <CheckCircle className="w-5 h-5 text-emerald-600" />
                <span>{liveQuerySuccess}</span>
              </div>
            ) : (
              <>
                <div className="p-3 bg-slate-50 dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-700 text-[13.5px] text-slate-700 dark:text-slate-300">
                  <span className="font-semibold block text-[13px] text-slate-500 mb-0.5">Question Statement:</span>
                  <p className="line-clamp-2">{examQuestions[currentQIndex]?.text}</p>
                </div>

                <div>
                  <label className="block text-[13.5px] font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Issue Category
                  </label>
                  <select
                    value={liveQueryReasonType}
                    onChange={e => setLiveQueryReasonType(e.target.value as any)}
                    className="w-full h-11 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-[14px] text-slate-800 dark:text-slate-200 outline-none"
                  >
                    <option value="INCORRECT_QUESTION">Ambiguous / Incorrect Question</option>
                    <option value="TYPO_ERROR">Typographical / Formatting Error</option>
                    <option value="TECHNICAL_ISSUE">Technical / Display Issue</option>
                    <option value="OTHER">Other Clarification</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[13.5px] font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Query Details *
                  </label>
                  <textarea
                    rows={3}
                    required
                    value={liveQueryMessage}
                    onChange={e => setLiveQueryMessage(e.target.value)}
                    placeholder="Describe the issue with this question..."
                    className="w-full p-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-[14px] text-slate-900 dark:text-white outline-none focus:border-blue-500"
                  />
                </div>
              </>
            )}
          </div>
        </Modal>
      )}

      {/* 22. UNBLOCK / REVIEW REQUEST MODAL */}
      {showUnblockRequestModal && (
        <Modal
          isOpen={showUnblockRequestModal}
          onClose={() => setShowUnblockRequestModal(false)}
          size="compact"
          title="Request Attempt Review"
          subtitle={`Attempt: ${activeAttempt?.attemptId} · ${activeScheduledExam?.title}`}
          footer={
            <div className="flex items-center justify-end gap-3 w-full">
              <button
                type="button"
                onClick={() => setShowUnblockRequestModal(false)}
                className="h-10 px-4 rounded-lg border border-slate-200 dark:border-slate-700 text-[14px] font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isSubmittingUnblock || !unblockReason.trim()}
                onClick={async () => {
                  if (!activeAttempt || !activeScheduledExam) return;
                  setIsSubmittingUnblock(true);
                  try {
                    await dbService.requestUnblock(
                      activeAttempt.attemptId,
                      activeScheduledExam.examId || activeScheduledExam.id,
                      unblockReason.trim()
                    );
                    setUnblockSubmitted(true);
                    setShowUnblockRequestModal(false);
                  } catch (err: any) {
                    alert(err?.message || 'Failed to submit unblock request');
                  } finally {
                    setIsSubmittingUnblock(false);
                  }
                }}
                className="h-10 px-5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-[14px] font-medium disabled:opacity-50 inline-flex items-center justify-center gap-2"
              >
                {isSubmittingUnblock ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" /> Submitting...
                  </>
                ) : (
                  'Submit Request'
                )}
              </button>
            </div>
          }
        >
          <div className="space-y-4">
            <p className="text-[14px] text-slate-600 dark:text-slate-300 leading-relaxed">
              Provide an official explanation for the security violations recorded during your session. Your proctoring audit log will be adjudicated by faculty.
            </p>
            <div>
              <label className="block text-[13.5px] font-medium text-slate-700 dark:text-slate-300 mb-1">
                Reason / Justification *
              </label>
              <textarea
                rows={4}
                required
                value={unblockReason}
                onChange={e => setUnblockReason(e.target.value)}
                placeholder="Describe what occurred (e.g. system notification popup, camera glitch, accidental keypress)..."
                className="w-full p-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-[14.5px] text-slate-900 dark:text-white outline-none focus:border-blue-500"
              />
            </div>
          </div>
        </Modal>
      )}

      {/* Global Confirmation Modal for Exam Engine & Actions */}
      <ConfirmModal />
    </div>
  );
}
