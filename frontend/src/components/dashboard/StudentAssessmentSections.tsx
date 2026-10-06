import React, { useEffect, useMemo, useState } from 'react';
import { StudentDetailsData, StudentExamHistoryItem } from '../../types';
import { ScrollReveal } from '../common/SharedUI';

interface Props {
  details: StudentDetailsData;
}

const PAGE_SIZE = 10;

const formatScore = (value: number | null | undefined) =>
  value === null || value === undefined || !Number.isFinite(Number(value))
    ? '—'
    : `${Number(value).toFixed(1)}%`;

const formatDate = (value?: string | null) => {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString();
};

const rankLabel = (rank: { rank: number; totalRankedStudents: number } | null | undefined) =>
  rank ? `#${rank.rank} / ${rank.totalRankedStudents}` : '—';

const displayStatus = (status: string) => ({
  NOT_ATTEMPTED: 'Not Attempted',
  IN_PROGRESS: 'In Progress',
  SUBMITTED: 'Submitted',
  AUTO_SUBMITTED: 'Auto Submitted',
  EXPIRED: 'Expired',
  EVALUATED: 'Evaluated',
  TERMINATED: 'Terminated',
  FORCE_SUBMITTED: 'Force Submitted',
  NOT_STARTED: 'Not Attempted'
}[status] || status.replaceAll('_', ' '));

const Metric = ({ label, value }: { label: string; value: React.ReactNode }) => (
  <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/70 p-3">
    <div className="text-xs text-slate-500 dark:text-slate-400">{label}</div>
    <div className="mt-1 text-lg font-semibold text-slate-900 dark:text-white tabular-nums">{value}</div>
  </div>
);

const ExamInsights = ({ exam }: { exam: StudentExamHistoryItem }) => {
  const counts = Object.entries(exam.proctoring.eventTypes)
    .sort(([, left], [, right]) => right - left)
    .slice(0, 4);

  return (
    <div className="mt-2 rounded-lg bg-slate-50 dark:bg-slate-900/60 p-3 text-xs text-slate-600 dark:text-slate-300">
      <div className="flex flex-wrap gap-x-5 gap-y-1">
        <span>Warnings: <strong>{exam.proctoring.warnings}</strong></span>
        <span>High/Critical: <strong>{exam.proctoring.high + exam.proctoring.critical}</strong></span>
        <span>Events: <strong>{exam.proctoring.totalEvents}</strong></span>
      </div>
      {counts.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {counts.map(([type, count]) => (
            <span key={type} className="rounded bg-white dark:bg-slate-800 px-2 py-1">
              {type.replaceAll('_', ' ')}: {count}
            </span>
          ))}
        </div>
      )}
    </div>
  );
};

export default function StudentAssessmentSections({ details }: Props) {
  const [page, setPage] = useState(0);
  const [expandedExamId, setExpandedExamId] = useState<string | null>(null);
  useEffect(() => {
    setPage(0);
    setExpandedExamId(null);
  }, [details.student.userId]);
  const history = details.examHistory || [];
  const publishedHistory = useMemo(
    () => history.filter(exam => exam.resultVisibility === 'PUBLISHED' && exam.percentage !== null),
    [history]
  );
  const chronologicalResults = useMemo(
    () => publishedHistory.slice().sort((left, right) =>
      new Date(left.examDate || 0).getTime() - new Date(right.examDate || 0).getTime()
    ),
    [publishedHistory]
  );
  const pageCount = Math.max(1, Math.ceil(history.length / PAGE_SIZE));
  const pageItems = history.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const summary = details.proctoringSummary;
  const assistance = details.assistance;
  const eventTypeCounts = Object.entries(summary?.eventTypes || {})
    .sort(([, left], [, right]) => right - left)
    .slice(0, 8);
  const eventCount = (eventType: string) => summary?.eventTypes[eventType] || 0;
  const maximumEventCount = Math.max(1, ...eventTypeCounts.map(([, count]) => count));
  const overallRank = details.kpis.overallRank || details.performance?.overallRank;

  const trendPoints = chronologicalResults.slice(-12);
  const polyline = trendPoints.map((exam, index) => {
    const x = trendPoints.length === 1 ? 250 : 12 + (index / (trendPoints.length - 1)) * 476;
    const y = 92 - (Math.max(0, Math.min(100, Number(exam.percentage) || 0)) / 100) * 78;
    return `${x},${y}`;
  }).join(' ');

  return (
    <div className="space-y-5">
      <ScrollReveal>
      <section className="space-y-3">
        <div>
          <h3 className="text-base font-semibold text-slate-900 dark:text-white">Overall Performance</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">Published results only; in-progress and unpublished exams are excluded.</p>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
          <Metric label="Exams Assigned" value={details.kpis.assignedExams ?? history.length} />
          <Metric label="Exams Attempted" value={details.kpis.examsAttempted ?? 0} />
          <Metric label="Not Attempted" value={details.kpis.examsNotAttempted ?? 0} />
          <Metric label="Exams Passed" value={details.kpis.examsPassed ?? 0} />
          <Metric label="Exams Failed" value={details.kpis.examsFailed ?? 0} />
          <Metric label="Average Score" value={formatScore(details.kpis.averageScore)} />
          <Metric label="Highest / Lowest" value={`${formatScore(details.kpis.highestScore)} / ${formatScore(details.kpis.lowestScore)}`} />
          <Metric label="Pass Rate" value={details.kpis.passRate == null ? '—' : formatScore(details.kpis.passRate)} />
          <Metric label="Overall Rank" value={rankLabel(overallRank)} />
          <Metric label="Total Ranked Students" value={overallRank?.totalRankedStudents ?? details.kpis.totalRankedStudents ?? 0} />
        </div>
      </section>

      </ScrollReveal>

      <ScrollReveal>
      <section className="grid md:grid-cols-2 gap-4">
        <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-4">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Score Trend</h3>
          {trendPoints.length ? (
            <>
              <svg viewBox="0 0 500 110" role="img" aria-label="Published exam percentage trend" className="mt-2 w-full h-28">
                <line x1="12" y1="14" x2="488" y2="14" stroke="currentColor" className="text-slate-200 dark:text-slate-700" />
                <line x1="12" y1="53" x2="488" y2="53" stroke="currentColor" className="text-slate-200 dark:text-slate-700" />
                <line x1="12" y1="92" x2="488" y2="92" stroke="currentColor" className="text-slate-200 dark:text-slate-700" />
                {trendPoints.length > 1 && <polyline points={polyline} fill="none" stroke="#2563eb" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />}
                {trendPoints.map((exam, index) => {
                  const x = trendPoints.length === 1 ? 250 : 12 + (index / (trendPoints.length - 1)) * 476;
                  const y = 92 - (Math.max(0, Math.min(100, Number(exam.percentage) || 0)) / 100) * 78;
                  return <circle key={exam.examId} cx={x} cy={y} r="4" fill="#2563eb"><title>{exam.title}: {formatScore(exam.percentage)}</title></circle>;
                })}
              </svg>
              <div className="flex justify-between text-[11px] text-slate-500">
                <span>{trendPoints[0]?.title}</span>
                <span>{trendPoints[trendPoints.length - 1]?.title}</span>
              </div>
            </>
          ) : (
            <p className="py-8 text-center text-sm text-slate-500">No published results yet.</p>
          )}
        </div>
        <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-4">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Subject-wise Performance</h3>
          {details.performance?.subjectBreakdown.length ? (
            <div className="mt-3 space-y-3">
              {details.performance.subjectBreakdown.map(subject => (
                <div key={subject.subject}>
                  <div className="mb-1 flex justify-between gap-3 text-xs">
                    <span className="truncate text-slate-700 dark:text-slate-300">{subject.subject} <span className="text-slate-400">({subject.exams})</span></span>
                    <span className="font-medium tabular-nums text-slate-700 dark:text-slate-200">{formatScore(subject.averagePercentage)}</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700">
                    <div className="h-full rounded-full bg-blue-600" style={{ width: `${Math.max(0, Math.min(100, subject.averagePercentage))}%` }} />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="py-8 text-center text-sm text-slate-500">No published subject results yet.</p>
          )}
        </div>
      </section>

      </ScrollReveal>

      <ScrollReveal>
      <section className="space-y-3">
        <div className="flex items-end justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-slate-900 dark:text-white">Exam History & Results</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">One row per exam. Scores are hidden until the result is published.</p>
          </div>
          {history.length > PAGE_SIZE && (
            <div className="flex items-center gap-2 text-xs">
              <button className="rounded border border-slate-300 dark:border-slate-600 px-2 py-1 disabled:opacity-40" disabled={page === 0} onClick={() => setPage(current => current - 1)}>Previous</button>
              <span className="text-slate-500">{page + 1} / {pageCount}</span>
              <button className="rounded border border-slate-300 dark:border-slate-600 px-2 py-1 disabled:opacity-40" disabled={page + 1 >= pageCount} onClick={() => setPage(current => current + 1)}>Next</button>
            </div>
          )}
        </div>
        <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
          <table className="min-w-[950px] w-full text-left text-xs">
            <thead className="bg-slate-50 dark:bg-slate-900/70 text-slate-500">
              <tr>
                <th className="p-2.5">Exam / Subject</th><th className="p-2.5">Date</th><th className="p-2.5">Attempt</th>
                <th className="p-2.5">Submission</th><th className="p-2.5">Score</th><th className="p-2.5">Percentage</th>
                <th className="p-2.5">Result</th><th className="p-2.5">Rank</th><th className="p-2.5">Visibility</th><th className="p-2.5">Details</th>
              </tr>
            </thead>
            <tbody>
              {pageItems.map(exam => (
                <React.Fragment key={exam.examId}>
                  <tr className="border-t border-slate-100 dark:border-slate-700/70">
                    <td className="p-2.5"><div className="font-medium text-slate-800 dark:text-slate-200">{exam.examId} · {exam.title}</div><div className="text-slate-500">{exam.subject || '—'}</div></td>
                    <td className="p-2.5 whitespace-nowrap">{formatDate(exam.examDate)}</td>
                    <td className="p-2.5">{displayStatus(exam.attemptStatus)}</td>
                    <td className="p-2.5">{displayStatus(exam.submissionStatus)}</td>
                    <td className="p-2.5 tabular-nums">{exam.score == null ? '—' : `${exam.score}${exam.totalMarks == null ? '' : ` / ${exam.totalMarks}`}`}</td>
                    <td className="p-2.5 tabular-nums">{formatScore(exam.percentage)}</td>
                    <td className="p-2.5">{exam.passed == null ? '—' : exam.passed ? 'Pass' : 'Fail'}</td>
                    <td className="p-2.5">{rankLabel(exam.examRank)}</td>
                    <td className="p-2.5">{exam.resultVisibility === 'PUBLISHED' ? `Published (${exam.resultStatus})` : exam.resultVisibility === 'UNPUBLISHED' ? 'Unpublished' : 'Not available'}</td>
                    <td className="p-2.5"><button className="text-blue-600 dark:text-blue-400 hover:underline" onClick={() => setExpandedExamId(current => current === exam.examId ? null : exam.examId)}>{expandedExamId === exam.examId ? 'Hide' : 'View'}</button></td>
                  </tr>
                  {expandedExamId === exam.examId && <tr className="border-t border-slate-100 dark:border-slate-700/70"><td colSpan={10} className="px-3 pb-3"><ExamInsights exam={exam} /></td></tr>}
                </React.Fragment>
              ))}
              {!pageItems.length && <tr><td colSpan={10} className="p-8 text-center text-slate-500">No assigned exam history.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-3">
        <div>
          <h3 className="text-base font-semibold text-slate-900 dark:text-white">Integrity & Proctoring</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">Aggregated events for this student; alerts are not treated as confirmed violations.</p>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
          <Metric label="Monitored Exams" value={summary?.totalMonitoredExams ?? 0} />
          <Metric label="Proctoring Warnings" value={summary?.totalWarnings ?? 0} />
          <Metric label="Low / Medium" value={`${summary?.low ?? 0} / ${summary?.medium ?? 0}`} />
          <Metric label="High / Critical Alerts" value={`${summary?.high ?? 0} / ${summary?.critical ?? 0}`} />
          <Metric label="Exams with Warnings" value={summary?.examsWithWarnings ?? 0} />
          <Metric label="Times Blocked (Recorded Requests)" value={assistance?.total ?? 0} />
          <Metric label="Times Unblocked" value={assistance?.approved ?? 0} />
          <Metric label="Blocked Attempts" value={assistance?.blockedAttempts ?? 0} />
          <Metric label="Assistance Requests" value={assistance?.total ?? 0} />
          <Metric label="Approved / Rejected" value={`${assistance?.approved ?? 0} / ${assistance?.rejected ?? 0}`} />
          <Metric label="Fullscreen Exits" value={eventCount('FULLSCREEN_EXIT')} />
          <Metric label="Tab Switches" value={eventCount('TAB_SWITCH')} />
          <Metric label="Window Blur / Focus" value={`${eventCount('WINDOW_BLUR')} / ${eventCount('WINDOW_FOCUS')}`} />
          <Metric label="Camera Incidents" value={eventCount('CAMERA_OFF') + eventCount('CAMERA_BLOCKED')} />
        </div>
        <div className="grid md:grid-cols-2 gap-4">
          <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-4">
            <h4 className="text-sm font-semibold text-slate-800 dark:text-slate-200">Event Types</h4>
            {eventTypeCounts.length ? <div className="mt-3 space-y-2">
              {eventTypeCounts.map(([eventType, count]) => (
                <div key={eventType}>
                  <div className="mb-1 flex justify-between text-xs text-slate-600 dark:text-slate-300"><span>{eventType.replaceAll('_', ' ')}</span><span>{count}</span></div>
                  <div className="h-1.5 rounded-full bg-slate-100 dark:bg-slate-700"><div className="h-full rounded-full bg-amber-500" style={{ width: `${(count / maximumEventCount) * 100}%` }} /></div>
                </div>
              ))}
            </div> : <p className="py-5 text-sm text-slate-500">No proctoring events recorded.</p>}
          </div>
          <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-4">
            <h4 className="text-sm font-semibold text-slate-800 dark:text-slate-200">Block / Assistance History</h4>
            {assistance?.blockHistory.length ? <div className="mt-2 max-h-52 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-700">
              {assistance.blockHistory.map(item => (
                <div key={item.requestId} className="py-2 text-xs">
                  <div className="flex flex-wrap justify-between gap-2"><span className="font-medium text-slate-800 dark:text-slate-200">{item.examId} · {item.examTitle}</span><span className="text-slate-500">{item.blockedAt ? new Date(item.blockedAt).toLocaleString() : '—'} · {item.status}</span></div>
                  <p className="mt-1 text-slate-600 dark:text-slate-400">{item.reason}</p>
                  {item.unblockedAt && <p className="mt-1 text-emerald-700 dark:text-emerald-400">Unblocked {new Date(item.unblockedAt).toLocaleString()}</p>}
                  {item.remarks && <p className="mt-1 text-slate-500">Review: {item.remarks}</p>}
                </div>
              ))}
            </div> : <p className="py-5 text-sm text-slate-500">No block or assistance history recorded.</p>}
          </div>
        </div>
      </section>
      </ScrollReveal>
    </div>
  );
}
