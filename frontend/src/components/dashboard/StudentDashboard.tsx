import React, { useState, useEffect, useRef } from 'react';
import { User, StudentResult, StudentQuery, ScheduledExam, ProctoringEventRecord } from '../../types';
import { dbService } from '../../services/dbService';
import { realtimeService } from '../../services/realtimeService';
import { PerformanceTrendChart } from '../Charts';
import { ProctoringExamInsightsModal } from './ProctoringExamInsightsModal';
import { OverallPerformanceSection } from './OverallPerformanceSection';
import {
  PageHeader,
  KpiCard,
  StatusBadge,
  EmptyState,
  LoadingState,
  ErrorState,
  Modal,
  SearchableSelect,
  ResultDetailModal,
  QueryDetailModal,
  ExamDetailModal,
  useConfirmAction
} from '../common/SharedUI';
import {
  Play,
  Award,
  CheckCircle,
  Clock,
  FileText,
  MessageSquare,
  Send,
  RefreshCw,
  Eye,
  Shield
} from 'lucide-react';

interface StudentDashboardProps {
  user: User;
  activeTab: string;
  onNavigateTab: (tab: string) => void;
  results: StudentResult[];
  queries: StudentQuery[];
  exams: ScheduledExam[];
  onStartExam: (subject: string, examId?: string) => Promise<void> | void;
  onRaiseQuery: (
    topic: string,
    question: string,
    examId?: string,
    resultId?: string
  ) => Promise<void> | void;
  onRefreshData?: () => Promise<boolean | void> | void;
  onRefreshExamData?: (user: User) => Promise<boolean>;
}

const isFinalizedAttempt = (status?: string): boolean =>
  status === 'SUBMITTED' ||
  status === 'AUTO_SUBMITTED' ||
  status === 'EVALUATED' ||
  status === 'TERMINATED' ||
  status === 'EXPIRED' ||
  status === 'FORCE_SUBMITTED';

const getStudentAttemptStatusLabel = (status?: string): string =>
  status === 'AUTO_SUBMITTED' || status === 'FORCE_SUBMITTED' || status === 'EXPIRED'
    ? 'Auto Submitted'
    : status === 'IN_PROGRESS'
    ? 'In Progress'
    : status === 'EVALUATED'
    ? 'Submitted'
    : status || 'Not Attempted';

export const StudentDashboard: React.FC<StudentDashboardProps> = ({
  user,
  activeTab,
  onNavigateTab,
  results,
  queries,
  exams,
  onStartExam,
  onRaiseQuery,
  onRefreshData,
  onRefreshExamData
}) => {
  const [showQueryModal, setShowQueryModal] = useState(false);
  const [queryExamId, setQueryExamId] = useState('');
  const [queryTopic, setQueryTopic] = useState('');
  const [queryText, setQueryText] = useState('');
  const [isSubmittingQuery, setIsSubmittingQuery] = useState(false);
  const [queryFeedback, setQueryFeedback] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);
  const [startingExamId, setStartingExamId] = useState<string | null>(null);
  const [examError, setExamError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [examPollingEnabled, setExamPollingEnabled] = useState(false);
  const refreshInProgressRef = useRef(false);
  const [proctoringEvents, setProctoringEvents] = useState<ProctoringEventRecord[]>([]);
  const [isLoadingProctoring, setIsLoadingProctoring] = useState(false);
  const [proctoringError, setProctoringError] = useState<string | null>(null);
  const [selectedProctoringExamId, setSelectedProctoringExamId] = useState<string | null>(null);
  const [studentRankings, setStudentRankings] = useState<Awaited<
    ReturnType<typeof dbService.getMyRankings>
  > | null>(null);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [passwordChangeMessage, setPasswordChangeMessage] = useState('');
  const [isChangingPassword, setIsChangingPassword] = useState(false);

  // Detail Modals
  const [selectedExam, setSelectedExam] = useState<ScheduledExam | null>(null);
  const [selectedResult, setSelectedResult] = useState<StudentResult | null>(null);
  const [selectedQuery, setSelectedQuery] = useState<StudentQuery | null>(null);
  const [examListFilter, setExamListFilter] = useState<'ALL' | 'LIVE' | 'IN_PROGRESS'>('ALL');

  const loadProctoring = async (): Promise<boolean> => {
    setIsLoadingProctoring(true);
    setProctoringError(null);
    try {
      const events = await dbService.getProctoringEvents();
      setProctoringEvents(events.filter(event =>
        event.studentId === user.userId || event.studentId === user.id
      ));
      return true;
    } catch {
      setProctoringError('Unable to load proctoring events.');
      return false;
    } finally {
      setIsLoadingProctoring(false);
    }
  };

  useEffect(() => {
    if (activeTab !== 'analytics') return;
    let active = true;
    dbService.getMyRankings()
      .then(rankings => {
        if (active) setStudentRankings(rankings);
      })
      .catch(() => {
        if (active) setStudentRankings(null);
      });
    return () => {
      active = false;
    };
  }, [activeTab]);

  useEffect(() => {
    loadProctoring();

    const unsub = realtimeService.subscribe(payload => {
      if (payload.event === 'proctoring.event' && payload.data?.event) {
        setProctoringEvents(prev => {
          const incoming = payload.data.event as ProctoringEventRecord;
          if (incoming.studentId !== user.userId && incoming.studentId !== user.id) return prev;
          if (prev.some(e => e.eventId === incoming.eventId)) return prev;
          return [incoming, ...prev];
        });
      }
    });

    return () => {
      unsub();
    };
  }, []);

  useEffect(() => {
    if (
      !examPollingEnabled ||
      !['overview', 'exams', 'results', 'queries'].includes(activeTab)
    ) {
      return;
    }
    const interval = window.setInterval(() => {
      if (refreshInProgressRef.current || realtimeService.isConnected()) return;
      refreshInProgressRef.current = true;
      const refresh = onRefreshExamData?.(user);
      if (!refresh) {
        refreshInProgressRef.current = false;
        return;
      }
      void refresh.finally(() => {
        refreshInProgressRef.current = false;
      });
    }, 5000);
    return () => window.clearInterval(interval);
  }, [activeTab, examPollingEnabled, onRefreshExamData, user]);

  // Only published results belonging to this student
  const publishedResults = results.filter(
    r => (r.studentId === user.userId || r.studentId === user.id) && r.isPublished
  );
  const getExamCardState = (exam: ScheduledExam) => {
    const latestAttempt = exam.studentAttempts?.[0] ||
      (exam.studentAttemptId && exam.studentAttemptStatus
        ? {
            attemptId: exam.studentAttemptId,
            status: exam.studentAttemptStatus,
            resultPublished: Boolean(exam.resultPublished)
          }
        : undefined);
    const result = latestAttempt
      ? publishedResults.find(
          item =>
            item.studentId === user.userId &&
            item.examId === exam.examId &&
            item.attemptId === latestAttempt.attemptId
        )
      : undefined;
    const status = latestAttempt?.status || (result ? 'EVALUATED' : undefined);
    const isInProgress = status === 'IN_PROGRESS';
    const isFinalized = !isInProgress && (isFinalizedAttempt(status) || Boolean(result));
    const isEligible =
      exam.canAttempt ??
      ((exam.status === 'PUBLISHED' || exam.status === 'LIVE') &&
        !latestAttempt &&
        !result);

    return {
      latestAttempt,
      result,
      status,
      isInProgress,
      isFinalized,
      canStart: !latestAttempt && !result && isEligible
    };
  };
  const examHistory = exams;
  const attemptedExamRows = exams.flatMap(exam =>
    (exam.studentAttempts || (exam.studentAttemptId && exam.studentAttemptStatus
      ? [{
          attemptId: exam.studentAttemptId,
          status: exam.studentAttemptStatus,
          resultPublished: publishedResults.some(
            result =>
              result.studentId === user.userId &&
              result.examId === exam.examId &&
              result.attemptId === exam.studentAttemptId
          )
        }]
      : []
    )).map(attempt => ({
      exam,
      attempt,
      result: publishedResults.find(
        result =>
          (result.studentId === user.userId || result.studentId === user.id) &&
          result.examId === exam.examId &&
          result.attemptId === attempt.attemptId
      )
    }))
  );

  const myQueries = queries.filter(
    q => q.studentId === user.userId || q.studentId === user.id
  );

  const avgIntegrity =
    publishedResults.length > 0
      ? Math.round(
          publishedResults.reduce((acc, curr) => acc + (curr.integrityScore ?? 100), 0) /
            publishedResults.length
        )
      : 100;

  const availableExams = exams.filter(
    exam => {
      const state = getExamCardState(exam);
      return (
        (exam.status === 'PUBLISHED' || exam.status === 'LIVE') &&
        !state.isFinalized &&
        (state.canStart || state.isInProgress)
      );
    }
  );
  const visibleAvailableExams = availableExams.filter(exam => {
    const state = getExamCardState(exam);
    if (examListFilter === 'LIVE') return exam.status === 'LIVE';
    if (examListFilter === 'IN_PROGRESS') return state.isInProgress;
    return true;
  });
  const completedExams = exams.filter(
    e =>
      e.studentAttemptStatus === 'SUBMITTED' ||
      e.studentAttemptStatus === 'AUTO_SUBMITTED' ||
      e.studentAttemptStatus === 'EVALUATED' ||
      e.studentAttemptStatus === 'TERMINATED' ||
      e.studentAttemptStatus === 'EXPIRED' ||
      e.studentAttemptStatus === 'FORCE_SUBMITTED' ||
      e.status === 'ENDED' ||
      e.status === 'CLOSED' ||
      e.status === 'RESULT_PUBLISHED'
  );

  // Authoritative Derived Real Metrics
  const liveExamsCount = exams.filter(e => e.status === 'LIVE').length;
  const inProgressExamsCount = exams.filter(e => e.studentAttemptStatus === 'IN_PROGRESS').length;
  const passedResultsCount = publishedResults.filter(
    r => r.passed !== false && (r.percentage ?? r.accuracy ?? 0) >= 40
  ).length;
  const avgScore =
    publishedResults.length > 0
      ? Math.round(
          publishedResults.reduce((acc, r) => acc + (r.percentage ?? r.accuracy ?? 0), 0) /
            publishedResults.length
        )
      : 0;
  const highestScore =
    publishedResults.length > 0
      ? Math.max(...publishedResults.map(r => r.percentage ?? r.accuracy ?? 0))
      : 0;

  const openQueriesCount = myQueries.filter(
    q => q.status === 'OPEN' || q.status === 'PENDING' || q.status === 'UNDER_REVIEW'
  ).length;
  const resolvedQueriesCount = myQueries.filter(
    q =>
      q.status === 'RESOLVED' ||
      q.status === 'APPROVED' ||
      q.status === 'REJECTED' ||
      q.status === 'RESOLVED_ACCEPTED' ||
      q.status === 'RESOLVED_REJECTED'
  ).length;
  const distinctQueriedExamsCount = Array.from(
    new Set(myQueries.map(q => q.examId).filter(Boolean))
  ).length;

  const submittedAttemptsCount = completedExams.filter(
    e =>
      e.studentAttemptStatus === 'SUBMITTED' ||
      e.studentAttemptStatus === 'AUTO_SUBMITTED' ||
      e.studentAttemptStatus === 'EVALUATED' ||
      e.studentAttemptStatus === 'FORCE_SUBMITTED' ||
      e.status === 'RESULT_PUBLISHED'
  ).length;

  const ownProctoringEvents = proctoringEvents.filter(event =>
    event.studentId === user.userId || event.studentId === user.id
  );
  const proctoringStanding = ownProctoringEvents.some(
    e => e.severity === 'HIGH' || e.severity === 'CRITICAL'
  )
    ? 'WARNED'
    : ownProctoringEvents.length > 0
    ? 'MONITORED'
    : 'CLEAN';
  const proctoringSummaryByExam = new Map<string, {
    examId: string;
    title: string;
    subject: string;
    eventCount: number;
    latestTimestamp: string | null;
  }>();
  exams.forEach(exam => {
    const examId = exam.examId || exam.id;
    proctoringSummaryByExam.set(examId, {
     examId,
     title: exam.title || examId,
     subject: exam.subject || exam.course || '—',
     eventCount: 0,
     latestTimestamp: null
    });
  });
  ownProctoringEvents.forEach(event => {
    const summary = proctoringSummaryByExam.get(event.examId);
    if (!summary) return;
    summary.eventCount += 1;
    if (
     !summary.latestTimestamp ||
     new Date(event.timestamp).getTime() > new Date(summary.latestTimestamp).getTime()
    ) {
     summary.latestTimestamp = event.timestamp;
    }
  });
  const proctoringExamSummaries = Array.from(proctoringSummaryByExam.values()).sort((first, second) =>
    (second.latestTimestamp ? new Date(second.latestTimestamp).getTime() : 0) -
    (first.latestTimestamp ? new Date(first.latestTimestamp).getTime() : 0)
  );
  const selectedExamProctoringEvents = ownProctoringEvents
    .filter(event => event.examId === selectedProctoringExamId)
    .sort((first, second) => new Date(second.timestamp).getTime() - new Date(first.timestamp).getTime());

  const { confirmAction, ConfirmModal } = useConfirmAction();

  const handleChangePassword = async (event: React.FormEvent) => {
    event.preventDefault();
    setPasswordChangeMessage('');
    if (newPassword !== confirmNewPassword) {
      setPasswordChangeMessage('New passwords do not match.');
      return;
    }
    setIsChangingPassword(true);
    try {
      await dbService.changeStudentPassword(currentPassword, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmNewPassword('');
      setPasswordChangeMessage('Password changed successfully.');
    } catch (error) {
      setPasswordChangeMessage(
        error instanceof Error ? error.message : 'Unable to change password.'
      );
    } finally {
      setIsChangingPassword(false);
    }
  };

  const handleLaunchExam = (exam: ScheduledExam) => {
    confirmAction({
      title: 'Start Examination',
      subtitle: exam.title,
      message: `Are you sure you want to begin "${exam.title}"?`,
      consequence:
        'Once launched, your examination attempt and active proctoring session will begin. Webcam monitoring and the countdown timer will start immediately.',
      confirmLabel: 'Yes, Start Exam',
      cancelLabel: 'No',
      variant: 'primary',
      details: [
        { label: 'Exam Title', value: exam.title },
        { label: 'Subject', value: exam.subject },
        { label: 'Duration', value: `${exam.durationMinutes} minutes` },
        { label: 'Total Marks', value: exam.totalMarks },
        { label: 'Passing Marks', value: exam.passingMarks }
      ],
      action: async () => {
        setExamError(null);
        setStartingExamId(exam.examId || exam.id);
        try {
          await onStartExam(exam.subject, exam.examId || exam.id);
        } catch (err: any) {
          setExamError(err.message || 'Unable to start examination.');
        } finally {
          setStartingExamId(null);
        }
      }
    });
  };

  const handleSubmitQuery = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!queryText.trim()) return;
    setIsSubmittingQuery(true);
    setQueryFeedback(null);
    try {
      const foundExam = exams.find(ex => (ex.examId || ex.id) === queryExamId);
      const topicLabel =
        queryTopic.trim() || foundExam?.title || foundExam?.subject || 'General';
      await onRaiseQuery(topicLabel, queryText.trim(), queryExamId || undefined);
      setQueryText('');
      setQueryTopic('');
      setQueryExamId('');
      setShowQueryModal(false);
      setQueryFeedback({
        type: 'success',
        message: 'Query submitted.'
      });
    } catch (err: any) {
      setQueryFeedback({
        type: 'error',
        message: err.message || 'Unable to submit query.'
      });
    } finally {
      setIsSubmittingQuery(false);
    }
  };

  const handleRefresh = async () => {
    if (!onRefreshData || refreshInProgressRef.current) return;
    refreshInProgressRef.current = true;
    setIsRefreshing(true);
    try {
      const [dataResult, proctoringResult] = await Promise.all([onRefreshData(), loadProctoring()]);
      if (dataResult !== false && proctoringResult) setExamPollingEnabled(true);
    } finally {
      refreshInProgressRef.current = false;
      setIsRefreshing(false);
    }
  };

  const pageTitleMap: Record<string, string> = {
    overview: 'Dashboard',
    exams: 'Exams',
    history: 'Exam History',
    results: 'Results',
    analytics: 'Analytics',
    queries: 'Queries',
    proctoring: 'Proctoring Status',
    profile: 'Profile'
  };

  return (
    <div className="max-w-[1440px] w-full mx-auto px-4 md:px-6 lg:px-8 py-7 space-y-6">
      <PageHeader
        title={pageTitleMap[activeTab] || 'Dashboard'}
        subtitle={`${user.name} · ID: ${user.userId || user.id} · ${user.department || 'Student'}`}
        actions={
          <>
            {onRefreshData && (
              <button
                type="button"
                onClick={handleRefresh}
                className="h-9 px-3.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-[13px] font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 inline-flex items-center justify-center gap-1.5 transition-colors"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
                Refresh
              </button>
            )}
            <button
              type="button"
              onClick={() => setShowQueryModal(true)}
              className="h-9 px-3.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-[13px] font-medium inline-flex items-center justify-center gap-1.5 transition-colors"
            >
              <MessageSquare className="w-3.5 h-3.5" /> Raise Query
            </button>
          </>
        }
      />

      {examError && <ErrorState message={examError} onRetry={() => setExamError(null)} />}

      {queryFeedback && (
        <div
          className={`p-4 rounded-lg border text-[15px] flex items-center justify-between ${
            queryFeedback.type === 'success'
              ? 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300'
              : 'bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800 text-red-800 dark:text-red-300'
          }`}
        >
          <span>{queryFeedback.message}</span>
          <button
            type="button"
            onClick={() => setQueryFeedback(null)}
            className="text-[13.5px] font-medium underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* 1. OVERVIEW TAB */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          {/* Student KPI Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            <KpiCard
              label="Available Exams"
              value={availableExams.length}
              subValue="Assigned and not yet completed"
              icon={<FileText className="w-5 h-5 text-blue-600 dark:text-blue-400" />}
              onClick={() => {
                setExamListFilter('ALL');
                onNavigateTab('exams');
              }}
            />
            <KpiCard
              label="Live Exams"
              value={liveExamsCount}
              subValue="Available to launch now"
              icon={<Clock className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />}
              onClick={() => {
                setExamListFilter('LIVE');
                onNavigateTab('exams');
              }}
            />
            <KpiCard
              label="In Progress"
              value={inProgressExamsCount}
              subValue="Resume a saved attempt"
              icon={<CheckCircle className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />}
              onClick={() => {
                setExamListFilter('IN_PROGRESS');
                onNavigateTab('exams');
              }}
            />
            <KpiCard
              label="Published Results"
              value={publishedResults.length}
              subValue={publishedResults.length > 0 ? `Avg score: ${avgScore}%` : 'Awaiting publication'}
              icon={<Award className="w-5 h-5 text-purple-600 dark:text-purple-400" />}
              onClick={() => onNavigateTab('results')}
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Assigned Exams */}
            <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-[20px] font-semibold text-slate-900 dark:text-white leading-snug">
                  Assigned Exams
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
                <EmptyState message="No exams yet." />
              ) : (
                <div className="divide-y divide-slate-100 dark:divide-slate-700/60">
                  {exams.slice(0, 5).map(exam => {
                    const state = getExamCardState(exam);
                    return (
                      <div key={exam.id} className="py-3.5 flex items-center justify-between gap-3">
                        <div>
                          <button
                            type="button"
                            onClick={() => setSelectedExam(exam)}
                            className="text-[15px] font-medium text-slate-900 dark:text-white hover:text-blue-600 dark:hover:text-blue-400 text-left"
                          >
                            {exam.title}
                          </button>
                          <p className="text-[13px] text-slate-500 dark:text-slate-400 tabular-nums mt-0.5">
                            {exam.examId || exam.id} · {exam.subject} · {exam.durationMinutes} mins ·{' '}
                            {exam.totalMarks} marks
                          </p>
                          {state.result && (
                            <p className="text-[12px] text-slate-600 dark:text-slate-300 mt-1 tabular-nums">
                              Score: {state.result.score} / {state.result.totalMarks ?? exam.totalMarks}
                            </p>
                          )}
                          {state.isInProgress && (
                            <p className="text-[12px] text-amber-700 dark:text-amber-300 mt-1">
                              Exam {exam.title} — In Progress
                              {exam.activeAttemptId ? ` · Attempt ${exam.activeAttemptId}` : ''}
                            </p>
                          )}
                        </div>
                        {state.isFinalized ? (
                          <StatusBadge status={getStudentAttemptStatusLabel(state.status)} />
                        ) : state.isInProgress ? (
                          <>
                            <StatusBadge status={getStudentAttemptStatusLabel(state.status)} />
                            <button
                              type="button"
                              disabled={startingExamId === (exam.examId || exam.id)}
                              onClick={() => handleLaunchExam(exam)}
                              className="h-9 px-3.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-[14px] font-medium inline-flex items-center gap-1.5"
                            >
                              <Play className="w-3.5 h-3.5" />
                              Resume
                            </button>
                          </>
                        ) : (
                          <>
                            <StatusBadge status="Not Attempted" />
                            {state.canStart && (
                              <button
                                type="button"
                                disabled={startingExamId === (exam.examId || exam.id)}
                                onClick={() => handleLaunchExam(exam)}
                                className="h-9 px-3.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-[14px] font-medium inline-flex items-center gap-1.5"
                              >
                                <Play className="w-3.5 h-3.5" />
                                Start
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Published Results */}
            <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-[20px] font-semibold text-slate-900 dark:text-white leading-snug">
                  Published Results
                </h2>
                <button
                  type="button"
                  onClick={() => onNavigateTab('results')}
                  className="text-[14px] font-medium text-blue-600 dark:text-blue-400 hover:underline"
                >
                  View all
                </button>
              </div>

              {publishedResults.length === 0 ? (
                <EmptyState message="No results available." />
              ) : (
                <div className="divide-y divide-slate-100 dark:divide-slate-700/60">
                  {publishedResults.slice(0, 5).map(res => (
                    <div
                      key={res.id}
                      className="py-3.5 flex items-center justify-between text-[15px]"
                    >
                      <div>
                        <button
                          type="button"
                          onClick={() => setSelectedResult(res)}
                          className="font-medium text-slate-900 dark:text-white hover:text-blue-600 dark:hover:text-blue-400 text-left"
                        >
                          {res.examTitle || res.topic}
                        </button>
                        <p className="text-[13px] text-slate-500 dark:text-slate-400 tabular-nums mt-0.5">
                          {res.resultId || res.id} · {res.date}
                        </p>
                      </div>
                      <div className="text-right tabular-nums">
                        <p className="font-semibold text-slate-900 dark:text-white mb-1">
                          {res.score} / {res.totalMarks || res.totalQuestions} (
                          {res.percentage ?? res.accuracy ?? 0}%)
                        </p>
                        <StatusBadge status={res.passed === false ? 'FAIL' : 'PASS'} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 2. EXAMS TAB */}
      {activeTab === 'exams' && (
        <div className="space-y-6">
          {/* Exams KSI Summary */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiCard
              label="Total Assigned"
              value={exams.length}
              subValue="Institutional examinations"
              icon={<FileText className="w-5 h-5 text-blue-600 dark:text-blue-400" />}
            />
            <KpiCard
              label="Available to Take"
              value={availableExams.length}
              subValue={`${liveExamsCount} Currently live`}
              icon={<Clock className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />}
            />
            <KpiCard
              label="In Progress"
              value={inProgressExamsCount}
              subValue="Active attempt session"
              icon={<Play className="w-5 h-5 text-amber-600 dark:text-amber-400" />}
            />
            <KpiCard
              label="Concluded Exams"
              value={completedExams.length}
              subValue={`${publishedResults.length} Results published`}
              icon={<CheckCircle className="w-5 h-5 text-purple-600 dark:text-purple-400" />}
            />
          </div>

          <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
            <div className="p-6 border-b border-slate-200 dark:border-slate-700">
              <h2 className="text-[20px] font-semibold text-slate-900 dark:text-white leading-snug">
                Available Exams ({visibleAvailableExams.length})
              </h2>
            </div>

          {visibleAvailableExams.length === 0 ? (
            <EmptyState message="No exams available." />
          ) : (
            <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">
              {visibleAvailableExams.map(exam => {
                const state = getExamCardState(exam);
                const exId = exam.examId || exam.id;
                return (
                  <article
                    key={exId}
                    className="flex min-w-0 flex-col rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-mono text-[12px] font-medium text-slate-500 dark:text-slate-400 tabular-nums">
                          {exId}
                        </p>
                        <h3 className="mt-1 truncate text-[15px] font-semibold text-slate-900 dark:text-white">
                          {exam.title}
                        </h3>
                      </div>
                      <StatusBadge status={getStudentAttemptStatusLabel(state.status)} />
                    </div>

                    <p className="mt-2 truncate text-[13px] text-slate-600 dark:text-slate-300">
                      {exam.subject}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-slate-500 dark:text-slate-400 tabular-nums">
                      <span>{exam.durationMinutes} mins</span>
                      <span>{exam.totalMarks} marks</span>
                      {exam.scheduledDate && (
                        <span>
                          {exam.scheduledDate} · {exam.startTime}–{exam.endTime}
                        </span>
                      )}
                    </div>
                    {state.result && (
                      <p className="mt-2 text-[13px] font-medium text-slate-700 dark:text-slate-200 tabular-nums">
                        Score: {state.result.score} / {state.result.totalMarks ?? exam.totalMarks}
                      </p>
                    )}
                    {state.isInProgress && exam.activeAttemptId && (
                      <p className="mt-2 text-[12px] text-amber-700 dark:text-amber-300">
                        Attempt {exam.activeAttemptId}
                      </p>
                    )}

                    <div className="mt-auto flex items-center justify-end gap-2 border-t border-slate-100 pt-3 dark:border-slate-700">
                      <button
                        type="button"
                        onClick={() => setSelectedExam(exam)}
                        className="h-9 rounded-lg border border-slate-200 px-3 text-[13px] font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-700"
                      >
                        View
                      </button>
                      {(state.isInProgress || state.canStart) && (
                        <button
                          type="button"
                          disabled={startingExamId === exId}
                          onClick={() => handleLaunchExam(exam)}
                          className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 text-[13px] font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <Play className="h-3.5 w-3.5" />
                          {state.isInProgress ? 'Resume' : 'Start'}
                        </button>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
        </div>
      )}

      {/* 3. EXAM HISTORY TAB */}
      {activeTab === 'history' && (
        <div className="space-y-6">
          {/* Exam History KSI Summary */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiCard
              label="Completed Attempts"
              value={completedExams.length}
              subValue="Concluded examinations"
              icon={<CheckCircle className="w-5 h-5 text-blue-600 dark:text-blue-400" />}
            />
            <KpiCard
              label="Submitted Attempts"
              value={submittedAttemptsCount}
              subValue="Finalized candidate submissions"
              icon={<CheckCircle className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />}
            />
            <KpiCard
              label="Published Results"
              value={publishedResults.length}
              subValue={`${completedExams.length - publishedResults.length} Awaiting publication`}
              icon={<Award className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />}
            />
            <KpiCard
              label="Passed Exams"
              value={passedResultsCount}
              subValue={`${publishedResults.length - passedResultsCount} Below passing mark`}
              icon={<CheckCircle className="w-5 h-5 text-purple-600 dark:text-purple-400" />}
            />
          </div>

          <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
            <div className="p-6 border-b border-slate-200 dark:border-slate-700">
              <h2 className="text-[20px] font-semibold text-slate-900 dark:text-white leading-snug">
                Exam History ({examHistory.length})
              </h2>
            </div>

          {examHistory.length === 0 ? (
            <EmptyState message="No exams yet." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-900/50 text-slate-500 dark:text-slate-400 text-[13.5px] font-semibold border-b border-slate-200 dark:border-slate-700">
                    <th className="py-3.5 px-4 whitespace-nowrap">Exam ID</th>
                    <th className="py-3.5 px-4">Title</th>
                    <th className="py-3.5 px-4">Subject</th>
                    <th className="py-3.5 px-4 whitespace-nowrap">Duration</th>
                    <th className="py-3.5 px-4 whitespace-nowrap">Exam Status</th>
                    <th className="py-3.5 px-4 whitespace-nowrap">Attempt Status</th>
                    <th className="py-3.5 px-4 whitespace-nowrap">Result Visibility</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-700 text-[14.5px]">
                  {examHistory.map(exam => {
                    const state = getExamCardState(exam);
                    return (
                      <tr key={exam.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/30">
                        <td className="py-4 px-4 whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => setSelectedExam(exam)}
                            className="font-mono text-[14px] font-medium text-blue-600 dark:text-blue-400 hover:underline tabular-nums"
                          >
                            {exam.examId || exam.id}
                          </button>
                        </td>
                        <td className="py-4 px-4 font-medium text-slate-900 dark:text-white">
                          {exam.title}
                        </td>
                        <td className="py-4 px-4 text-slate-600 dark:text-slate-300">
                          {exam.subject}
                        </td>
                        <td className="py-4 px-4 text-slate-600 dark:text-slate-300 tabular-nums">
                          {exam.durationMinutes} mins
                        </td>
                        <td className="py-4 px-4">
                          <StatusBadge status={exam.status} />
                        </td>
                        <td className="py-4 px-4">
                          {state.result && (
                            <span className="block mb-1 text-[13px] text-slate-600 dark:text-slate-300 tabular-nums">
                              Score: {state.result.score} / {state.result.totalMarks ?? exam.totalMarks}
                            </span>
                          )}
                          <StatusBadge
                            status={getStudentAttemptStatusLabel(state.status)}
                          />
                        </td>
                        <td className="py-4 px-4 text-[14px] font-medium text-slate-600 dark:text-slate-400">
                          {state.isInProgress
                            ? 'In Progress'
                            : state.result
                            ? 'Published'
                            : state.isFinalized
                            ? 'Awaiting Publication'
                            : '—'}
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

      {/* 4. RESULTS TAB */}
      {activeTab === 'results' && (
        <div className="space-y-6">
          {/* Results KSI Summary */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiCard
              label="Published Results"
              value={publishedResults.length}
              subValue="Official verified grades"
              icon={<Award className="w-5 h-5 text-blue-600 dark:text-blue-400" />}
            />
            <KpiCard
              label="Overall Average"
              value={publishedResults.length > 0 ? `${avgScore}%` : '—'}
              subValue="Score percentage"
              icon={<FileText className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />}
            />
            <KpiCard
              label="Highest Score"
              value={publishedResults.length > 0 ? `${highestScore}%` : '—'}
              subValue="Best performance"
              icon={<CheckCircle className="w-5 h-5 text-purple-600 dark:text-purple-400" />}
            />
            <KpiCard
              label="Passed Exams"
              value={passedResultsCount}
              subValue={`${publishedResults.length - passedResultsCount} Below passing mark`}
              icon={<CheckCircle className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />}
            />
          </div>

          <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
            <div className="p-6 border-b border-slate-200 dark:border-slate-700">
              <h2 className="text-[20px] font-semibold text-slate-900 dark:text-white leading-snug">
                Exam Results ({attemptedExamRows.length})
              </h2>
            </div>

            {attemptedExamRows.length === 0 ? (
              <EmptyState message="No exam attempts yet." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-50 dark:bg-slate-900/50 text-slate-500 dark:text-slate-400 text-[13.5px] font-semibold border-b border-slate-200 dark:border-slate-700">
                      <th className="py-3.5 px-4 whitespace-nowrap">Exam ID / Attempt</th>
                      <th className="py-3.5 px-4">Exam</th>
                      <th className="py-3.5 px-4">Subject</th>
                      <th className="py-3.5 px-4 whitespace-nowrap">Score</th>
                      <th className="py-3.5 px-4 whitespace-nowrap">Percentage</th>
                      <th className="py-3.5 px-4 whitespace-nowrap">Attempt Status</th>
                      <th className="py-3.5 px-4 whitespace-nowrap">Result Status / Visibility</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-700 text-[14.5px]">
                    {attemptedExamRows.map(({ exam, attempt, result }) => {
                      return (
                        <tr key={attempt.attemptId} className="hover:bg-slate-50 dark:hover:bg-slate-700/30">
                          <td className="py-4 px-4 whitespace-nowrap">
                            <span className="font-mono text-[14px] font-medium text-slate-700 dark:text-slate-300 tabular-nums">
                              {exam.examId} · {attempt.attemptId}
                            </span>
                          </td>
                          <td className="py-4 px-4 font-medium text-slate-900 dark:text-white">
                            {exam.title}
                          </td>
                          <td className="py-4 px-4 text-slate-600 dark:text-slate-300">
                            {exam.subject}
                          </td>
                          <td className="py-4 px-4 font-semibold text-slate-900 dark:text-white tabular-nums">
                            {result
                              ? `${result.score} / ${result.totalMarks ?? exam.totalMarks}`
                              : '—'}
                          </td>
                          <td className="py-4 px-4 text-slate-700 dark:text-slate-300 tabular-nums">
                            {result ? `${result.percentage ?? result.accuracy}%` : '—'}
                          </td>
                          <td className="py-4 px-4">
                            <StatusBadge status={getStudentAttemptStatusLabel(attempt.status)} />
                          </td>
                          <td className="py-4 px-4 text-[14px] text-slate-500 tabular-nums">
                            <StatusBadge
                              status={
                                result?.status ||
                                (isFinalizedAttempt(attempt.status)
                                  ? 'Awaiting Publication'
                                  : attempt.status === 'IN_PROGRESS'
                                  ? 'In Progress'
                                  : 'Not Published')
                              }
                            />
                            {result?.publishedAt && (
                              <span className="block mt-1">
                                {new Date(result.publishedAt).toLocaleDateString()}
                              </span>
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

      {activeTab === 'analytics' && (
        <div className="space-y-5">
          <section className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-700 dark:bg-slate-800">
            <h2 className="mb-2 text-[20px] font-semibold text-slate-900 dark:text-white">
              Performance trend
            </h2>
            {publishedResults.length < 2 ? (
              <EmptyState message="Complete more exams to see your performance trend." />
            ) : (
              <PerformanceTrendChart data={[...publishedResults].reverse()} />
            )}
          </section>
          <OverallPerformanceSection
            results={publishedResults}
            studentId={user.userId || user.id}
            studentRankings={studentRankings}
          />
        </div>
      )}

      {/* 5. QUERIES TAB */}
      {activeTab === 'queries' && (
        <div className="space-y-6">
          {/* Queries KSI Summary */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiCard
              label="Total Queries"
              value={myQueries.length}
              subValue="Submitted academic inquiries"
              icon={<MessageSquare className="w-5 h-5 text-blue-600 dark:text-blue-400" />}
            />
            <KpiCard
              label="Open Inquiries"
              value={openQueriesCount}
              subValue="Under faculty review"
              icon={<Clock className="w-5 h-5 text-amber-600 dark:text-amber-400" />}
            />
            <KpiCard
              label="Resolved"
              value={resolvedQueriesCount}
              subValue="Adjudicated responses"
              icon={<CheckCircle className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />}
            />
            <KpiCard
              label="Exams Queried"
              value={distinctQueriedExamsCount}
              subValue="Distinct examinations"
              icon={<FileText className="w-5 h-5 text-purple-600 dark:text-purple-400" />}
            />
          </div>

          <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
            <div className="p-6 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
              <h2 className="text-[20px] font-semibold text-slate-900 dark:text-white leading-snug">
                Queries ({myQueries.length})
              </h2>
              <button
                type="button"
                onClick={() => setShowQueryModal(true)}
                className="h-11 px-4 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-[14.5px] font-medium inline-flex items-center justify-center"
              >
                Raise Query
              </button>
            </div>

          {myQueries.length === 0 ? (
            <EmptyState message="No queries yet." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-900/50 text-slate-500 dark:text-slate-400 text-[13.5px] font-semibold border-b border-slate-200 dark:border-slate-700">
                    <th className="py-3.5 px-4 whitespace-nowrap">Query ID</th>
                    <th className="py-3.5 px-4">Student</th>
                    <th className="py-3.5 px-4">Exam</th>
                    <th className="py-3.5 px-4">Subject</th>
                    <th className="py-3.5 px-4 whitespace-nowrap">Status</th>
                    <th className="py-3.5 px-4 whitespace-nowrap">Created</th>
                    <th className="py-3.5 px-4 text-right whitespace-nowrap">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-700 text-[14.5px]">
                  {myQueries.map(q => {
                    const qId = q.queryId || q.id;
                    return (
                      <tr key={qId} className="hover:bg-slate-50 dark:hover:bg-slate-700/30">
                        <td className="py-4 px-4 whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => setSelectedQuery(q)}
                            className="font-mono text-[14px] font-medium text-blue-600 dark:text-blue-400 hover:underline tabular-nums"
                          >
                            {qId}
                          </button>
                        </td>
                        <td className="py-4 px-4 text-slate-700 dark:text-slate-300">
                          {q.studentName || user.name}
                        </td>
                        <td className="py-4 px-4 text-slate-700 dark:text-slate-300">
                          {q.examTitle || q.examId || 'General'}
                        </td>
                        <td className="py-4 px-4 font-medium text-slate-900 dark:text-white">
                          {q.subject || q.topic}
                        </td>
                        <td className="py-4 px-4 whitespace-nowrap">
                          <StatusBadge status={q.status} />
                        </td>
                        <td className="py-4 px-4 text-[14px] text-slate-500 whitespace-nowrap tabular-nums">
                          {q.createdAt || q.timestamp || '—'}
                        </td>
                        <td className="py-4 px-4 text-right whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => setSelectedQuery(q)}
                            className="h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-700 text-[14px] font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 inline-flex items-center gap-1.5"
                          >
                            <Eye className="w-3.5 h-3.5" /> View
                          </button>
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

      {/* 6. PROCTORING STATUS TAB */}
      {activeTab === 'proctoring' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiCard
              label="Proctoring Status"
              value={proctoringStanding}
              subValue="Audit standing"
              icon={<Shield className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />}
            />
            <KpiCard
              label="Warning Count"
              value={ownProctoringEvents.length}
              subValue={`${ownProctoringEvents.filter(e => e.severity === 'HIGH' || e.severity === 'CRITICAL').length} High / Critical alerts`}
              icon={<Shield className="w-5 h-5 text-blue-600 dark:text-blue-400" />}
            />
            <KpiCard
              label="Account Standing"
              value={user.status || 'ACTIVE'}
              subValue="Institutional portal access"
              icon={<CheckCircle className="w-5 h-5 text-purple-600 dark:text-purple-400" />}
            />
            <KpiCard
              label="Average Integrity Score"
              value={`${avgIntegrity}%`}
              subValue="Real-time compliance rating"
              icon={<Shield className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />}
            />
          </div>

          <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-6 space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-[20px] font-semibold text-slate-900 dark:text-white leading-snug">
                Proctoring Audit Trail ({ownProctoringEvents.length})
              </h2>
            </div>

            {proctoringError && <ErrorState message={proctoringError} onRetry={loadProctoring} />}

            {isLoadingProctoring ? (
              <LoadingState message="Loading proctoring events..." />
            ) : proctoringExamSummaries.length === 0 ? (
                <EmptyState message="No proctoring events recorded" />
              ) : (
                <div className="overflow-x-auto border border-slate-200 dark:border-slate-700 rounded-xl">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-slate-50 dark:bg-slate-900/50 text-slate-500 dark:text-slate-400 text-[13.5px] font-semibold border-b border-slate-200 dark:border-slate-700">
                        <th className="py-3.5 px-4">Exam ID</th>
                        <th className="py-3.5 px-4">Exam Title</th>
                        <th className="py-3.5 px-4">Subject</th>
                        <th className="py-3.5 px-4">Events</th>
                        <th className="py-3.5 px-4">Latest Event</th>
                        <th className="py-3.5 px-4"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 dark:divide-slate-700 text-[14.5px]">
                      {proctoringExamSummaries.map(summary => (
                        <tr key={summary.examId} className="hover:bg-slate-50 dark:hover:bg-slate-700/30">
                          <td className="py-3.5 px-4 font-mono text-blue-600 dark:text-blue-400">{summary.examId}</td>
                          <td className="py-3.5 px-4 font-medium text-slate-900 dark:text-white">{summary.title}</td>
                          <td className="py-3.5 px-4 text-slate-600 dark:text-slate-300">{summary.subject}</td>
                          <td className="py-3.5 px-4 text-slate-600 dark:text-slate-300">{summary.eventCount}</td>
                          <td className="py-3.5 px-4 text-sm text-slate-500 dark:text-slate-400 whitespace-nowrap">
                            {summary.latestTimestamp ? new Date(summary.latestTimestamp).toLocaleString() : '—'}
                          </td>
                          <td className="py-3.5 px-4 text-right">
                            <button
                              type="button"
                              onClick={() => setSelectedProctoringExamId(summary.examId)}
                              className="text-sm font-semibold text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
                            >
                              View
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                </table>
              </div>
            )}
        </div>
        {selectedProctoringExamId && (
          <ProctoringExamInsightsModal
            exam={exams.find(exam => exam.examId === selectedProctoringExamId)}
            examId={selectedProctoringExamId}
            events={selectedExamProctoringEvents}
            results={results}
            studentId={user.userId || user.id}
            isStudent
            onClose={() => setSelectedProctoringExamId(null)}
          />
        )}
        </div>
      )}

      {/* 7. PROFILE TAB */}
      {activeTab === 'profile' && (
        <div className="space-y-5">
          <section className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-800">
            <div className="flex min-w-0 items-center gap-4">
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-blue-100 text-lg font-bold text-blue-700 dark:bg-blue-900/50 dark:text-blue-200">
                {user.name.split(/\s+/).map(part => part[0]).slice(0, 2).join('').toUpperCase()}
              </div>
              <div className="min-w-0">
                <h2 className="truncate text-xl font-semibold text-slate-900 dark:text-white">{user.name}</h2>
                <p className="mt-1 font-mono text-xs text-slate-500">{user.userId || user.id} · Student</p>
                <div className="mt-2"><StatusBadge status={user.status || 'ACTIVE'} /></div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => void handleRefresh()} disabled={isRefreshing} className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200 px-3 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-700">
                <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? 'animate-spin' : ''}`} /> Refresh
              </button>
            </div>
          </section>

          <section className="max-w-2xl rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-800">
              <h3 className="mb-4 text-base font-semibold text-slate-900 dark:text-white">Profile information</h3>
              <dl className="divide-y divide-slate-100 text-sm dark:divide-slate-700">
                {[
                  ['Student ID', user.userId || user.id],
                  ['Email', user.email || '—'],
                  ['Phone', user.phone || '—'],
                  ['Course', user.course || '—'],
                  ['Department', user.department || '—'],
                  ['Semester', user.semester || '—'],
                  ['Academic year', user.academicYear || '—']
                ].map(([label, value]) => (
                  <div key={label} className="flex justify-between gap-4 py-2.5">
                    <dt className="text-slate-500 dark:text-slate-400">{label}</dt>
                    <dd className="text-right font-medium text-slate-800 dark:text-slate-200">{value}</dd>
                  </div>
                ))}
              </dl>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-800">
            <h3 className="mb-3 text-base font-semibold text-slate-900 dark:text-white">Security</h3>
            <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">Update your account password. ExamX will never display your password.</p>
            <form onSubmit={handleChangePassword} className="grid gap-3 md:grid-cols-3">
              <input type="password" autoComplete="current-password" value={currentPassword} onChange={event => setCurrentPassword(event.target.value)} placeholder="Current password" required className="min-w-0 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-white" />
              <input type="password" autoComplete="new-password" value={newPassword} onChange={event => setNewPassword(event.target.value)} placeholder="New password (at least 8 characters)" minLength={8} maxLength={72} required className="min-w-0 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-white" />
              <input type="password" autoComplete="new-password" value={confirmNewPassword} onChange={event => setConfirmNewPassword(event.target.value)} placeholder="Confirm new password" minLength={8} maxLength={72} required className="min-w-0 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-white" />
              <div className="flex flex-wrap items-center gap-3 md:col-span-3">
                <button type="submit" disabled={isChangingPassword} className="rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50">
                  {isChangingPassword ? 'Changing password...' : 'Change password'}
                </button>
                {passwordChangeMessage && <p role="status" className="text-sm text-slate-600 dark:text-slate-300">{passwordChangeMessage}</p>}
              </div>
            </form>
          </section>
        </div>
      )}

      {/* DETAIL MODALS */}
      <ExamDetailModal exam={selectedExam} onClose={() => setSelectedExam(null)} />
      <ResultDetailModal result={selectedResult} onClose={() => setSelectedResult(null)} />
      <QueryDetailModal query={selectedQuery} onClose={() => setSelectedQuery(null)} />

      {/* RAISE QUERY MODAL */}
      <Modal
        isOpen={showQueryModal}
        onClose={() => setShowQueryModal(false)}
        size="standard"
        title="Raise Query"
        footer={
          <div className="flex items-center justify-end gap-3 w-full">
            <button
              type="button"
              onClick={() => setShowQueryModal(false)}
              className="h-11 px-4 rounded-lg text-[14.5px] font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 inline-flex items-center justify-center transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              form="student-raise-query-form"
              disabled={isSubmittingQuery}
              className="h-11 px-5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-[14.5px] font-medium inline-flex items-center justify-center gap-2 shadow-sm transition-colors"
            >
              <Send className="w-4 h-4" />
              {isSubmittingQuery ? 'Submitting...' : 'Submit Query'}
            </button>
          </div>
        }
      >
        <form id="student-raise-query-form" onSubmit={handleSubmitQuery} className="space-y-4">
          <div>
            <label className="block text-[14px] font-medium text-slate-700 dark:text-slate-300 mb-1.5">
              Related Examination
            </label>
            <SearchableSelect
              value={queryExamId}
              onChange={val => setQueryExamId(val)}
              options={[
                { value: '', label: 'General / No specific exam' },
                ...exams.map(ex => ({
                  value: ex.examId || ex.id,
                  label: `${ex.title} (${ex.subject})`
                }))
              ]}
              placeholder="Select examination (optional)"
              searchable={true}
            />
          </div>
          <div>
            <label className="block text-[14px] font-medium text-slate-700 dark:text-slate-300 mb-1.5">
              Subject / Topic *
            </label>
            <input
              type="text"
              required
              value={queryTopic}
              onChange={e => setQueryTopic(e.target.value)}
              placeholder="Enter subject or topic name"
              className="w-full h-12 px-3.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-[15px] text-slate-900 dark:text-white outline-none focus:border-blue-500"
            />
          </div>
          <div>
            <label className="block text-[14px] font-medium text-slate-700 dark:text-slate-300 mb-1.5">
              Query Details *
            </label>
            <textarea
              rows={4}
              required
              value={queryText}
              onChange={e => setQueryText(e.target.value)}
              placeholder="Describe your question, issue, or clarification in detail..."
              className="w-full p-3.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-[15px] text-slate-900 dark:text-white outline-none focus:border-blue-500"
            />
          </div>
        </form>
      </Modal>

      {/* Global Action Confirmation Modal */}
      <ConfirmModal />
    </div>
  );
};
