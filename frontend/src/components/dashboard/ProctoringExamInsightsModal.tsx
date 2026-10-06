import React, { useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';
import { ProctoringEventRecord, ScheduledExam, StudentResult } from '../../types';
import { dbService } from '../../services/dbService';
import { ScrollReveal } from '../common/SharedUI';

type StudentRankings = Awaited<ReturnType<typeof dbService.getMyRankings>>;

interface ProctoringExamInsightsModalProps {
  exam: ScheduledExam | undefined;
  examId: string;
  events: ProctoringEventRecord[];
  results: StudentResult[];
  studentId?: string;
  isStudent: boolean;
  onClose: () => void;
}

const PUBLISHED_RESULT_STATUSES = new Set(['PUBLISHED', 'QUERIED', 'REVISED']);
const SEVERITY_COLORS: Record<string, string> = {
  LOW: '#22c55e',
  MEDIUM: '#f59e0b',
  HIGH: '#f97316',
  CRITICAL: '#e11d48'
};

const isVisibleFinalResult = (result: StudentResult): boolean =>
  result.isPublished === true || PUBLISHED_RESULT_STATUSES.has(result.status);

const keepLatestAttemptResults = (results: StudentResult[]): StudentResult[] => {
  const byStudentAndExam = new Map<string, StudentResult>();
  results.forEach(result => {
    const key = `${result.studentId}:${result.examId}`;
    const existing = byStudentAndExam.get(key);
    const resultDate = new Date(result.evaluatedAt || result.publishedAt || result.date).getTime();
    const existingDate = existing
      ? new Date(existing.evaluatedAt || existing.publishedAt || existing.date).getTime()
      : Number.NEGATIVE_INFINITY;
    if (!existing || resultDate >= existingDate) byStudentAndExam.set(key, result);
  });
  return Array.from(byStudentAndExam.values());
};

const getScorePercentage = (result: StudentResult): number | null => {
  if (typeof result.percentage === 'number' && Number.isFinite(result.percentage)) {
    return result.percentage;
  }
  const totalMarks = result.totalMarks;
  return typeof totalMarks === 'number' && totalMarks > 0
    ? (result.score / totalMarks) * 100
    : null;
};

export const ProctoringExamInsightsModal: React.FC<ProctoringExamInsightsModalProps> = ({
  exam,
  examId,
  events,
  results,
  studentId,
  isStudent,
  onClose
}) => {
  const [visibleEventCount, setVisibleEventCount] = useState(100);
  const [studentRankings, setStudentRankings] = useState<StudentRankings | null>(null);
  const [isLoadingRankings, setIsLoadingRankings] = useState(false);
  const [rankingsError, setRankingsError] = useState<string | null>(null);
  const scrollRootRef = useRef<HTMLDivElement | null>(null);
  const safeEvents = useMemo(
    () => events.filter(event => event.examId === examId && (!isStudent || event.studentId === studentId)),
    [events, examId, isStudent, studentId]
  );
  const selectedResults = useMemo(
    () => keepLatestAttemptResults(results.filter(result =>
      result.examId === examId &&
      isVisibleFinalResult(result) &&
      (!isStudent || result.studentId === studentId)
    )),
    [examId, isStudent, results, studentId]
  );
  const authorizedResults = useMemo(
    () => keepLatestAttemptResults(results.filter(result =>
      isVisibleFinalResult(result) && (!isStudent || result.studentId === studentId)
    )),
    [isStudent, results, studentId]
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  useEffect(() => {
    setVisibleEventCount(100);
  }, [examId]);

  useEffect(() => {
    if (!isStudent) return;
    let active = true;
    setIsLoadingRankings(true);
    setRankingsError(null);
    dbService.getMyRankings(examId)
      .then(rankings => {
        if (active) setStudentRankings(rankings);
      })
      .catch(() => {
        if (active) setRankingsError('Unable to load your ranking information.');
      })
      .finally(() => {
        if (active) setIsLoadingRankings(false);
      });
    return () => {
      active = false;
    };
  }, [examId, isStudent]);

  const severityData = useMemo(() => (['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const)
    .map(severity => ({
      severity,
      count: safeEvents.filter(event => event.severity === severity).length
    }))
    .filter(item => item.count > 0), [safeEvents]);
  const eventTypeData = useMemo(() => {
    const counts = new Map<string, number>();
    safeEvents.forEach(event => counts.set(event.eventType, (counts.get(event.eventType) || 0) + 1));
    return Array.from(counts, ([eventType, count]) => ({ eventType, count }))
      .sort((first, second) => second.count - first.count);
  }, [safeEvents]);
  const timelineData = useMemo(() => {
    const buckets = new Map<number, number>();
    safeEvents.forEach(event => {
      const timestamp = new Date(event.timestamp).getTime();
      if (!Number.isFinite(timestamp)) return;
      const bucketStart = Math.floor(timestamp / (15 * 60 * 1000)) * 15 * 60 * 1000;
      buckets.set(bucketStart, (buckets.get(bucketStart) || 0) + 1);
    });
    return Array.from(buckets, ([timestamp, count]) => ({
      time: new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      count
    }));
  }, [safeEvents]);

  const warningCount = useMemo(() => {
    const perAttempt = new Map<string, number>();
    safeEvents.forEach(event => {
      perAttempt.set(
        event.attemptId,
        Math.max(perAttempt.get(event.attemptId) || 0, event.warningCountAfter || 0)
      );
    });
    return Array.from(perAttempt.values()).reduce((total, count) => total + count, 0);
  }, [safeEvents]);
  const mediumCount = safeEvents.filter(event => event.severity === 'MEDIUM').length;
  const lowCount = safeEvents.filter(event => event.severity === 'LOW').length;
  const highCount = safeEvents.filter(event => event.severity === 'HIGH').length;
  const criticalCount = safeEvents.filter(event => event.severity === 'CRITICAL').length;

  const rankedExamResults = useMemo(() => selectedResults
    .slice()
    .sort((first, second) =>
      second.score - first.score ||
      new Date(first.evaluatedAt || first.publishedAt || first.date).getTime() -
        new Date(second.evaluatedAt || second.publishedAt || second.date).getTime()
    ), [selectedResults]);
  const studentExamResult = isStudent
    ? rankedExamResults.find(result => result.studentId === studentId &&
      safeEvents.some(event => event.attemptId === result.attemptId)) ||
      rankedExamResults.find(result => result.studentId === studentId)
    : undefined;
  const rankedOverallByStudent = useMemo(() => {
    const latestByStudentAndExam = new Map<string, StudentResult>();
    authorizedResults.forEach(result => {
      const key = `${result.studentId}:${result.examId}`;
      const existing = latestByStudentAndExam.get(key);
      const resultDate = new Date(result.evaluatedAt || result.publishedAt || result.date).getTime();
      const existingDate = existing
        ? new Date(existing.evaluatedAt || existing.publishedAt || existing.date).getTime()
        : Number.NEGATIVE_INFINITY;
      if (!existing || resultDate >= existingDate) latestByStudentAndExam.set(key, result);
    });
    const aggregates = new Map<string, {
      studentId: string;
      studentName: string;
      percentages: number[];
      passed: number;
    }>();
    latestByStudentAndExam.forEach(result => {
      const percentage = getScorePercentage(result);
      if (percentage === null) return;
      const aggregate = aggregates.get(result.studentId) || {
        studentId: result.studentId,
        studentName: result.studentName,
        percentages: [],
        passed: 0
      };
      aggregate.percentages.push(percentage);
      if (result.passed === true) aggregate.passed += 1;
      aggregates.set(result.studentId, aggregate);
    });
    return Array.from(aggregates.values())
      .map(aggregate => ({
        ...aggregate,
        examsAttempted: aggregate.percentages.length,
        averagePercentage: aggregate.percentages.reduce((sum, value) => sum + value, 0) /
          aggregate.percentages.length
      }))
      .sort((first, second) => second.averagePercentage - first.averagePercentage);
  }, [authorizedResults]);
  const ownOverall = isStudent
    ? rankedOverallByStudent.find(row => row.studentId === studentId)
    : undefined;
  const ownOverallRank = studentRankings?.overallRank ?? null;
  const examDate = exam?.scheduledDate
    ? [exam.scheduledDate, exam.startTime].filter(Boolean).join(' · ')
    : null;
  const overallAverage = ownOverallRank?.averagePercentage ?? ownOverall?.averagePercentage ??
    (rankedOverallByStudent.length
      ? rankedOverallByStudent.reduce((sum, row) => sum + row.averagePercentage, 0) /
        rankedOverallByStudent.length
      : null);
  const overallAttempted = ownOverallRank?.examsAttempted ?? ownOverall?.examsAttempted ??
    new Set(authorizedResults.map(result => `${result.studentId}:${result.examId}`)).size;
  const overallPassed = ownOverallRank?.passed ?? ownOverall?.passed ??
    authorizedResults.filter(result => result.passed === true).length;
  const overallRankValue = isStudent && ownOverallRank
    ? `#${ownOverallRank.rank} / ${ownOverallRank.totalRankedStudents}`
    : isStudent
      ? 'Unavailable'
      : `${rankedOverallByStudent.length} students`;
  const examRankValue = isStudent && studentRankings?.examRank
    ? `#${studentRankings.examRank.rank} / ${studentRankings.examRank.totalRankedStudents}`
    : isStudent
      ? 'Unavailable'
      : `${rankedExamResults.length} ranked`;

  return (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-950/50 p-3 sm:p-5"
      onMouseDown={event => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="proctoring-exam-modal-title"
        className="flex h-[86vh] w-[96vw] max-w-6xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900 md:w-[68vw]"
      >
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-200 px-5 py-4 dark:border-slate-700 sm:px-6">
          <div className="min-w-0">
            <p className="font-mono text-xs font-semibold tracking-wide text-blue-600 dark:text-blue-400">{examId}</p>
            <h2 id="proctoring-exam-modal-title" className="mt-1 truncate text-lg font-semibold text-slate-900 dark:text-white">
              {exam?.title || safeEvents[0]?.examTitle || examId}
            </h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              {[exam?.subject || exam?.course || safeEvents[0]?.examTitle, examDate, exam?.status]
                .filter(Boolean)
                .join(' · ')}
              {' · '}{safeEvents.length} Proctoring Events
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close exam proctoring details"
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-slate-800 dark:hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        <div ref={scrollRootRef} className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4 sm:p-6">
          <ScrollReveal root={scrollRootRef}>
          <section aria-label="Exam proctoring summary">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Exam Analytics</h3>
              {exam?.status && (
                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                  {exam.status.replaceAll('_', ' ')}
                </span>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              {[
                ['Total Events', safeEvents.length],
                ['Warning Count', warningCount],
                ['Low', lowCount],
                ['Medium', mediumCount],
                ['High', highCount],
                ['Critical', criticalCount]
              ].map(([label, value]) => (
                <div key={String(label)} className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/70">
                  <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">{label}</p>
                  <p className="mt-1 text-xl font-semibold tabular-nums text-slate-900 dark:text-white">{value}</p>
                </div>
              ))}
            </div>
          </section>
          </ScrollReveal>

          <ScrollReveal root={scrollRootRef}>
          <section>
            <h3 className="mb-3 text-sm font-semibold text-slate-900 dark:text-white">Event Analytics</h3>
            <div className="grid gap-4 lg:grid-cols-2">
              <ChartPanel title="Severity Distribution">
                {severityData.length === 0 ? <NoChartData /> : (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={severityData} dataKey="count" nameKey="severity" innerRadius={45} outerRadius={76} paddingAngle={3}>
                        {severityData.map(item => <Cell key={item.severity} fill={SEVERITY_COLORS[item.severity]} />)}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                )}
                {severityData.length > 0 && (
                  <div className="flex flex-wrap justify-center gap-x-3 gap-y-1 text-[11px] text-slate-500 dark:text-slate-400">
                    {severityData.map(item => (
                      <span key={item.severity} className="inline-flex items-center gap-1">
                        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: SEVERITY_COLORS[item.severity] }} />
                        {item.severity}: {item.count}
                      </span>
                    ))}
                  </div>
                )}
              </ChartPanel>
              <ChartPanel title="Event Type Distribution">
                {eventTypeData.length === 0 ? <NoChartData /> : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={eventTypeData} margin={{ bottom: 28, left: -18, right: 8, top: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis dataKey="eventType" angle={-25} textAnchor="end" interval={0} height={58} fontSize={9} />
                      <YAxis allowDecimals={false} fontSize={10} />
                      <Tooltip />
                      <Bar dataKey="count" fill="#4f46e5" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </ChartPanel>
              <div className="lg:col-span-2">
                <ChartPanel title="Event Timeline">
                  {timelineData.length === 0 ? <NoChartData /> : (
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={timelineData} margin={{ bottom: 5, left: -18, right: 10, top: 8 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                        <XAxis dataKey="time" fontSize={10} />
                        <YAxis allowDecimals={false} fontSize={10} />
                        <Tooltip />
                        <Line type="monotone" dataKey="count" stroke="#2563eb" strokeWidth={2} dot={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  )}
                </ChartPanel>
              </div>
            </div>
          </section>
          </ScrollReveal>

          <ScrollReveal root={scrollRootRef}>
          <section className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-lg border border-slate-200 p-4 dark:border-slate-700">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Exam Rank</h3>
              <p className="mt-2 text-xl font-semibold text-blue-700 dark:text-blue-300">{examRankValue}</p>
              {isStudent ? (
                studentRankings?.examRank || studentExamResult ? (
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    Score: {studentRankings?.examRank?.score ?? studentExamResult?.score}
                    {' / '}
                    {studentRankings?.examRank?.totalMarks ?? studentExamResult?.totalMarks ?? exam?.totalMarks ?? '—'}
                    {studentRankings?.examRank && ` · ${studentRankings.examRank.percentile}% percentile`}
                  </p>
                ) : (
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    {isLoadingRankings
                      ? 'Loading your rank…'
                      : rankingsError || 'A rank is available after a published result exists.'}
                  </p>
                )
              ) : rankedExamResults.length > 0 ? (
                <div className="mt-3 max-h-36 overflow-y-auto divide-y divide-slate-100 text-xs dark:divide-slate-800">
                  {rankedExamResults.slice(0, 50).map(result => (
                    <div key={result.attemptId} className="flex justify-between gap-3 py-1.5 text-slate-600 dark:text-slate-300">
                      <span>#{1 + rankedExamResults.filter(item => item.score > result.score).length} · {result.studentName || 'Student'}</span>
                      <span className="tabular-nums">{result.score} / {result.totalMarks ?? exam?.totalMarks ?? '—'}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">No published results available.</p>
              )}
            </div>
            <div className="rounded-lg border border-slate-200 p-4 dark:border-slate-700">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Overall Performance</h3>
              <p className="mt-2 text-xl font-semibold text-violet-700 dark:text-violet-300">
                {isStudent ? overallRankValue : `${rankedOverallByStudent.length} students ranked`}
              </p>
              <div className="mt-2 grid grid-cols-3 gap-2 text-xs text-slate-500 dark:text-slate-400">
                <span>Average Score<br /><strong className="text-slate-800 dark:text-slate-200">{overallAverage === null ? '—' : `${Math.round(overallAverage)}%`}</strong></span>
                <span>Exams Attempted<br /><strong className="text-slate-800 dark:text-slate-200">{overallAttempted}</strong></span>
                <span>Passed<br /><strong className="text-slate-800 dark:text-slate-200">{overallPassed}</strong></span>
              </div>
              {isStudent && ownOverallRank === null && (
                <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">
                  {isLoadingRankings
                    ? 'Loading overall rank…'
                    : rankingsError || 'Overall rank is available after published results exist.'}
                </p>
              )}
              {isStudent && ownOverallRank && (
                <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">
                  {ownOverallRank.percentile}% percentile
                </p>
              )}
              {!isStudent && rankedOverallByStudent.length > 0 && (
                <div className="mt-3 max-h-36 overflow-y-auto divide-y divide-slate-100 text-xs dark:divide-slate-800">
                  {rankedOverallByStudent.slice(0, 50).map(row => (
                    <div key={row.studentId} className="flex justify-between gap-3 py-1.5 text-slate-600 dark:text-slate-300">
                      <span>
                        #{1 + rankedOverallByStudent.filter(item => item.averagePercentage > row.averagePercentage).length}
                        {' · '}{row.studentName || 'Student'}
                      </span>
                      <span className="tabular-nums">{Math.round(row.averagePercentage)}%</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>
          </ScrollReveal>

          <ScrollReveal root={scrollRootRef}>
          <section>
            <div className="mb-2 flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Proctoring Audit Trail</h3>
              <span className="text-xs tabular-nums text-slate-500 dark:text-slate-400">{safeEvents.length} events</span>
            </div>
            {safeEvents.length === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
                No proctoring events recorded
              </div>
            ) : (
              <div className="max-h-[38vh] overflow-auto rounded-lg border border-slate-200 dark:border-slate-700">
                <table className="w-full min-w-[720px] text-left text-xs">
                  <thead className="sticky top-0 bg-slate-50 text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                    <tr>
                      <th className="p-3">Event ID</th>
                      <th className="p-3">Event Type</th>
                      <th className="p-3">Severity</th>
                      <th className="p-3">Details</th>
                      <th className="p-3">Timestamp</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {safeEvents.slice(0, visibleEventCount).map(event => (
                      <tr key={event.eventId}>
                        <td className="p-3 font-mono text-slate-500">{event.eventId}</td>
                        <td className="p-3 font-medium text-slate-800 dark:text-slate-200">{event.eventType}</td>
                        <td className="p-3">
                          <span className="rounded-full px-2 py-1 font-semibold" style={{
                            color: SEVERITY_COLORS[event.severity],
                            backgroundColor: `${SEVERITY_COLORS[event.severity]}18`
                          }}>{event.severity}</span>
                        </td>
                        <td className="max-w-[30rem] whitespace-normal p-3 text-slate-600 dark:text-slate-300">{event.details || event.message || '—'}</td>
                        <td className="whitespace-nowrap p-3 text-slate-500">
                          {event.timestamp ? new Date(event.timestamp).toLocaleString() : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {visibleEventCount < safeEvents.length && (
                  <button
                    type="button"
                    onClick={() => setVisibleEventCount(count => count + 100)}
                    className="w-full border-t border-slate-200 p-2.5 text-xs font-semibold text-blue-600 hover:bg-slate-50 dark:border-slate-700 dark:text-blue-400 dark:hover:bg-slate-800"
                  >
                    Load next events ({safeEvents.length - visibleEventCount} remaining)
                  </button>
                )}
              </div>
            )}
          </section>
          </ScrollReveal>
        </div>
      </section>
    </div>
  );
};

const ChartPanel: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
    <h4 className="mb-2 text-xs font-semibold text-slate-700 dark:text-slate-300">{title}</h4>
    <div className="h-44 w-full">{children}</div>
  </div>
);

const NoChartData: React.FC = () => (
  <div className="flex h-full items-center justify-center rounded-md border border-dashed border-slate-200 text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
    No data available
  </div>
);
