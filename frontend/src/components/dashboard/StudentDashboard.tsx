import React, { useState, useEffect } from 'react';
import { User, StudentResult, StudentQuery, ScheduledExam, ProctoringEventRecord } from '../../types';
import { dbService } from '../../services/dbService';
import { realtimeService } from '../../services/realtimeService';
import { PerformanceTrendChart } from '../Charts';
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
  onRefreshData?: () => Promise<void> | void;
}

export const StudentDashboard: React.FC<StudentDashboardProps> = ({
  user,
  activeTab,
  onNavigateTab,
  results,
  queries,
  exams,
  onStartExam,
  onRaiseQuery,
  onRefreshData
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
  const [proctoringEvents, setProctoringEvents] = useState<ProctoringEventRecord[]>([]);
  const [isLoadingProctoring, setIsLoadingProctoring] = useState(false);
  const [proctoringError, setProctoringError] = useState<string | null>(null);

  // Detail Modals
  const [selectedExam, setSelectedExam] = useState<ScheduledExam | null>(null);
  const [selectedResult, setSelectedResult] = useState<StudentResult | null>(null);
  const [selectedQuery, setSelectedQuery] = useState<StudentQuery | null>(null);

  const loadProctoring = async () => {
    setIsLoadingProctoring(true);
    setProctoringError(null);
    try {
      const events = await dbService.getProctoringEvents();
      setProctoringEvents(events);
    } catch {
      setProctoringError('Unable to load proctoring events.');
    } finally {
      setIsLoadingProctoring(false);
    }
  };

  useEffect(() => {
    loadProctoring();

    const unsub = realtimeService.subscribe(payload => {
      if (payload.event === 'proctoring.event' && payload.data?.event) {
        setProctoringEvents(prev => {
          const incoming = payload.data.event as ProctoringEventRecord;
          if (prev.some(e => e.eventId === incoming.eventId)) return prev;
          return [incoming, ...prev];
        });
      }
    });

    return () => {
      unsub();
    };
  }, []);

  // Only published results belonging to this student
  const publishedResults = results.filter(
    r => (r.studentId === user.userId || r.studentId === user.id) && r.isPublished
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
    e =>
      (e.status === 'PUBLISHED' || e.status === 'LIVE' || e.status === 'SCHEDULED') &&
      e.studentAttemptStatus !== 'SUBMITTED' &&
      e.studentAttemptStatus !== 'EVALUATED' &&
      e.studentAttemptStatus !== 'TERMINATED' &&
      e.studentAttemptStatus !== 'EXPIRED'
  );

  const completedExams = exams.filter(
    e =>
      e.studentAttemptStatus === 'SUBMITTED' ||
      e.studentAttemptStatus === 'EVALUATED' ||
      e.studentAttemptStatus === 'TERMINATED' ||
      e.studentAttemptStatus === 'EXPIRED' ||
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
      e.studentAttemptStatus === 'EVALUATED' ||
      e.status === 'RESULT_PUBLISHED'
  ).length;

  const proctoringStanding = proctoringEvents.some(
    e => e.severity === 'HIGH' || e.severity === 'CRITICAL'
  )
    ? 'WARNED'
    : proctoringEvents.length > 0
    ? 'MONITORED'
    : 'CLEAN';

  const { confirmAction, ConfirmModal } = useConfirmAction();

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
    if (!onRefreshData) return;
    setIsRefreshing(true);
    try {
      await Promise.all([onRefreshData(), loadProctoring()]);
    } finally {
      setIsRefreshing(false);
    }
  };

  const pageTitleMap: Record<string, string> = {
    overview: 'Dashboard',
    exams: 'Exams',
    history: 'Exam History',
    results: 'Results',
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
              label="Assigned Exams"
              value={exams.length}
              subValue={`${availableExams.length} Available to attempt`}
              icon={<FileText className="w-5 h-5 text-blue-600 dark:text-blue-400" />}
              onClick={() => onNavigateTab('exams')}
            />
            <KpiCard
              label="Upcoming & Live"
              value={availableExams.length}
              subValue={`${liveExamsCount} Live now`}
              icon={<Clock className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />}
              onClick={() => onNavigateTab('exams')}
            />
            <KpiCard
              label="Completed Exams"
              value={completedExams.length}
              subValue={`${publishedResults.length} Results published`}
              icon={<CheckCircle className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />}
              onClick={() => onNavigateTab('history')}
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
                    const isSubmitted =
                      exam.studentAttemptStatus === 'SUBMITTED' ||
                      exam.studentAttemptStatus === 'EVALUATED' ||
                      exam.studentAttemptStatus === 'TERMINATED' ||
                      exam.studentAttemptStatus === 'EXPIRED';
                    const isInProgress = exam.studentAttemptStatus === 'IN_PROGRESS';
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
                        </div>
                        {isSubmitted ? (
                          <StatusBadge status={exam.studentAttemptStatus || 'SUBMITTED'} />
                        ) : (
                          <button
                            type="button"
                            disabled={startingExamId === (exam.examId || exam.id)}
                            onClick={() => handleLaunchExam(exam)}
                            className="h-9 px-3.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-[14px] font-medium inline-flex items-center gap-1.5"
                          >
                            <Play className="w-3.5 h-3.5" />
                            {isInProgress ? 'Resume' : 'Start'}
                          </button>
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
                Assigned Exams ({availableExams.length})
              </h2>
            </div>

          {availableExams.length === 0 ? (
            <EmptyState message="No exams yet." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-900/50 text-slate-500 dark:text-slate-400 text-[13.5px] font-semibold border-b border-slate-200 dark:border-slate-700">
                    <th className="py-3.5 px-4 whitespace-nowrap">Exam ID</th>
                    <th className="py-3.5 px-4">Title</th>
                    <th className="py-3.5 px-4">Subject</th>
                    <th className="py-3.5 px-4 whitespace-nowrap">Start</th>
                    <th className="py-3.5 px-4 whitespace-nowrap">End</th>
                    <th className="py-3.5 px-4 whitespace-nowrap">Duration</th>
                    <th className="py-3.5 px-4 whitespace-nowrap">Status</th>
                    <th className="py-3.5 px-4 text-right whitespace-nowrap">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-700 text-[14.5px]">
                  {availableExams.map(exam => {
                    const isInProgress = exam.studentAttemptStatus === 'IN_PROGRESS';
                    const exId = exam.examId || exam.id;
                    return (
                      <tr key={exId} className="hover:bg-slate-50 dark:hover:bg-slate-700/30">
                        <td className="py-4 px-4 whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => setSelectedExam(exam)}
                            className="font-mono text-[14px] font-medium text-blue-600 dark:text-blue-400 hover:underline tabular-nums"
                          >
                            {exId}
                          </button>
                        </td>
                        <td className="py-4 px-4 font-medium text-slate-900 dark:text-white">
                          {exam.title}
                        </td>
                        <td className="py-4 px-4 text-slate-600 dark:text-slate-300">{exam.subject}</td>
                        <td className="py-4 px-4 text-[14px] text-slate-500 whitespace-nowrap tabular-nums">
                          {exam.scheduledDate} {exam.startTime}
                        </td>
                        <td className="py-4 px-4 text-[14px] text-slate-500 whitespace-nowrap tabular-nums">
                          {exam.scheduledDate} {exam.endTime}
                        </td>
                        <td className="py-4 px-4 text-slate-600 dark:text-slate-300 whitespace-nowrap tabular-nums">
                          {exam.durationMinutes} mins
                        </td>
                        <td className="py-4 px-4 whitespace-nowrap">
                          <StatusBadge status={exam.status} />
                        </td>
                        <td className="py-4 px-4 text-right whitespace-nowrap space-x-2">
                          <button
                            type="button"
                            onClick={() => setSelectedExam(exam)}
                            className="h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-700 text-[14px] font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 inline-flex items-center gap-1.5"
                          >
                            <Eye className="w-3.5 h-3.5" /> View
                          </button>
                          {exam.studentAttemptStatus === 'SUBMITTED' ||
                          exam.studentAttemptStatus === 'EVALUATED' ||
                          exam.studentAttemptStatus === 'TERMINATED' ||
                          exam.studentAttemptStatus === 'EXPIRED' ? (
                            <StatusBadge status={exam.studentAttemptStatus || 'SUBMITTED'} />
                          ) : (
                            <button
                              type="button"
                              disabled={startingExamId === exId}
                              onClick={() => handleLaunchExam(exam)}
                              className="h-9 px-3.5 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-[14px] font-medium inline-flex items-center gap-1.5"
                            >
                              <Play className="w-3.5 h-3.5" />
                              {isInProgress ? 'Resume' : 'Start'}
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
                Exam History ({completedExams.length})
              </h2>
            </div>

          {completedExams.length === 0 ? (
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
                    <th className="py-3.5 px-4 whitespace-nowrap">Status</th>
                    <th className="py-3.5 px-4 whitespace-nowrap">Result Visibility</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-700 text-[14.5px]">
                  {completedExams.map(exam => (
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
                      <td className="py-4 px-4 text-slate-600 dark:text-slate-300">{exam.subject}</td>
                      <td className="py-4 px-4 text-slate-600 dark:text-slate-300 tabular-nums">
                        {exam.durationMinutes} mins
                      </td>
                      <td className="py-4 px-4">
                        <StatusBadge status={exam.studentAttemptStatus || exam.status} />
                      </td>
                      <td className="py-4 px-4 text-[14px] font-medium text-slate-600 dark:text-slate-400">
                        {exam.resultPublished ? 'Published' : 'Pending Faculty Publication'}
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
                Published Results ({publishedResults.length})
              </h2>
            </div>

            {publishedResults.length === 0 ? (
              <EmptyState message="No results available." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-50 dark:bg-slate-900/50 text-slate-500 dark:text-slate-400 text-[13.5px] font-semibold border-b border-slate-200 dark:border-slate-700">
                      <th className="py-3.5 px-4 whitespace-nowrap">Result ID</th>
                      <th className="py-3.5 px-4">Exam</th>
                      <th className="py-3.5 px-4">Student</th>
                      <th className="py-3.5 px-4 whitespace-nowrap">Score</th>
                      <th className="py-3.5 px-4 whitespace-nowrap">Percentage</th>
                      <th className="py-3.5 px-4 whitespace-nowrap">Status</th>
                      <th className="py-3.5 px-4 whitespace-nowrap">Published At</th>
                      <th className="py-3.5 px-4 text-right whitespace-nowrap">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-700 text-[14.5px]">
                    {publishedResults.map(res => {
                      const rId = res.resultId || res.id;
                      return (
                        <tr key={rId} className="hover:bg-slate-50 dark:hover:bg-slate-700/30">
                          <td className="py-4 px-4 whitespace-nowrap">
                            <button
                              type="button"
                              onClick={() => setSelectedResult(res)}
                              className="font-mono text-[14px] font-medium text-blue-600 dark:text-blue-400 hover:underline tabular-nums"
                            >
                              {rId}
                            </button>
                          </td>
                          <td className="py-4 px-4 font-medium text-slate-900 dark:text-white">
                            {res.examTitle || res.topic}
                          </td>
                          <td className="py-4 px-4 text-slate-600 dark:text-slate-300">
                            {res.studentName || user.name}
                          </td>
                          <td className="py-4 px-4 font-semibold text-slate-900 dark:text-white tabular-nums">
                            {res.score} / {res.totalMarks || res.totalQuestions}
                          </td>
                          <td className="py-4 px-4 text-slate-700 dark:text-slate-300 tabular-nums">
                            {res.percentage ?? res.accuracy ?? 0}%
                          </td>
                          <td className="py-4 px-4">
                            <StatusBadge status={res.status || 'PUBLISHED'} />
                          </td>
                          <td className="py-4 px-4 text-[14px] text-slate-500 tabular-nums">
                            {res.publishedAt
                              ? new Date(res.publishedAt).toLocaleDateString()
                              : res.date}
                          </td>
                          <td className="py-4 px-4 text-right whitespace-nowrap space-x-2">
                            <button
                              type="button"
                              onClick={() => setSelectedResult(res)}
                              className="h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-700 text-[14px] font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 inline-flex items-center gap-1.5"
                            >
                              <Eye className="w-3.5 h-3.5" /> View
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setQueryExamId(res.examId || '');
                                setQueryTopic(res.examTitle || res.topic);
                                setShowQueryModal(true);
                              }}
                              className="h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-700 text-[14px] font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 inline-flex items-center"
                            >
                              Raise Query
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

          {publishedResults.length > 0 && (
            <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-6">
              <h3 className="text-[20px] font-semibold text-slate-900 dark:text-white mb-4 leading-snug">
                Performance Trend
              </h3>
              <PerformanceTrendChart data={publishedResults} />
            </div>
          )}
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
              value={proctoringEvents.length}
              subValue={`${proctoringEvents.filter(e => e.severity === 'HIGH' || e.severity === 'CRITICAL').length} High / Critical alerts`}
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
            <h2 className="text-[20px] font-semibold text-slate-900 dark:text-white leading-snug">
              Proctoring Audit Trail
            </h2>

            {proctoringError && <ErrorState message={proctoringError} onRetry={loadProctoring} />}

          {isLoadingProctoring ? (
            <LoadingState message="Loading proctoring events..." />
          ) : proctoringEvents.length === 0 ? (
            <EmptyState message="No proctoring events." />
          ) : (
            <div className="overflow-x-auto border border-slate-200 dark:border-slate-700 rounded-xl">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-900/50 text-slate-500 dark:text-slate-400 text-[13.5px] font-semibold border-b border-slate-200 dark:border-slate-700">
                    <th className="py-3.5 px-4">Event ID</th>
                    <th className="py-3.5 px-4">Exam</th>
                    <th className="py-3.5 px-4">Type</th>
                    <th className="py-3.5 px-4">Severity</th>
                    <th className="py-3.5 px-4">Details</th>
                    <th className="py-3.5 px-4">Timestamp</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-700 text-[14.5px]">
                  {proctoringEvents.map(ev => (
                    <tr key={ev.eventId}>
                      <td className="py-4 px-4 font-mono text-[14px] text-slate-500 tabular-nums">{ev.eventId}</td>
                      <td className="py-4 px-4 font-mono text-[14px] text-blue-600 dark:text-blue-400 tabular-nums">
                        {ev.examId}
                      </td>
                      <td className="py-4 px-4 font-medium text-slate-900 dark:text-white">
                        {ev.eventType}
                      </td>
                      <td className="py-4 px-4">
                        <StatusBadge status={ev.severity} />
                      </td>
                      <td className="py-4 px-4 text-slate-600 dark:text-slate-300">
                        {ev.details || ev.message}
                      </td>
                      <td className="py-4 px-4 text-[14px] text-slate-500 tabular-nums">
                        {ev.timestamp ? new Date(ev.timestamp).toLocaleString() : '—'}
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

      {/* 7. PROFILE TAB */}
      {activeTab === 'profile' && (
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-6 max-w-2xl">
          <h2 className="text-[20px] font-semibold text-slate-900 dark:text-white mb-5 leading-snug">
            Student Profile
          </h2>
          <div className="space-y-3.5 text-[15px]">
            <div className="flex justify-between py-2.5 border-b border-slate-100 dark:border-slate-700">
              <span className="text-slate-500">Student ID</span>
              <span className="font-mono font-medium text-slate-900 dark:text-white tabular-nums">
                {user.userId || user.id}
              </span>
            </div>
            <div className="flex justify-between py-2.5 border-b border-slate-100 dark:border-slate-700">
              <span className="text-slate-500">Full Name</span>
              <span className="font-medium text-slate-900 dark:text-white">{user.name}</span>
            </div>
            <div className="flex justify-between py-2.5 border-b border-slate-100 dark:border-slate-700">
              <span className="text-slate-500">Email</span>
              <span className="font-medium text-slate-900 dark:text-white">
                {user.email || '—'}
              </span>
            </div>
            <div className="flex justify-between py-2.5 border-b border-slate-100 dark:border-slate-700">
              <span className="text-slate-500">Role</span>
              <span className="font-medium text-slate-900 dark:text-white">{user.role}</span>
            </div>
            <div className="flex justify-between py-2.5 border-b border-slate-100 dark:border-slate-700">
              <span className="text-slate-500">Course / Program</span>
              <span className="font-medium text-slate-900 dark:text-white">
                {user.course || '—'}
              </span>
            </div>
            <div className="flex justify-between py-2.5 border-b border-slate-100 dark:border-slate-700">
              <span className="text-slate-500">Department</span>
              <span className="font-medium text-slate-900 dark:text-white">
                {user.department || '—'}
              </span>
            </div>
            <div className="flex justify-between py-2.5">
              <span className="text-slate-500">Status</span>
              <StatusBadge status={user.status || 'ACTIVE'} />
            </div>
          </div>
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
