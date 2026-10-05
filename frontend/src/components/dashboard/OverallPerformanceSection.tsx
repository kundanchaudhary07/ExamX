import React, { useMemo } from 'react';
import { StudentResult } from '../../types';

type StudentRankings = {
  overallRank: {
    rank: number;
    totalRankedStudents: number;
    percentile: number;
    averagePercentage: number;
    examsAttempted: number;
    passed: number;
  } | null;
};

interface OverallPerformanceSectionProps {
  results: StudentResult[];
  studentId?: string;
  studentRankings?: StudentRankings | null;
}

const PUBLISHED_STATUSES = new Set(['PUBLISHED', 'QUERIED', 'REVISED']);

const isPublished = (result: StudentResult): boolean =>
  result.isPublished === true || PUBLISHED_STATUSES.has(result.status);

const resultTimestamp = (result: StudentResult): number =>
  new Date(result.evaluatedAt || result.publishedAt || result.date).getTime();

export const OverallPerformanceSection: React.FC<OverallPerformanceSectionProps> = ({
  results,
  studentId,
  studentRankings
}) => {
  const finalizedResults = useMemo(() => {
    const latestByStudentAndExam = new Map<string, StudentResult>();
    results
      .filter(result =>
        isPublished(result) &&
        (!studentId || result.studentId === studentId) &&
        typeof result.percentage === 'number' &&
        Number.isFinite(result.percentage)
      )
      .forEach(result => {
        const key = `${result.studentId}:${result.examId}`;
        const current = latestByStudentAndExam.get(key);
        if (!current || resultTimestamp(result) >= resultTimestamp(current)) {
          latestByStudentAndExam.set(key, result);
        }
      });
    return Array.from(latestByStudentAndExam.values());
  }, [results, studentId]);

  const studentAverages = useMemo(() => {
    const scoresByStudent = new Map<string, number[]>();
    finalizedResults.forEach(result => {
      const scores = scoresByStudent.get(result.studentId) || [];
      scores.push(result.percentage as number);
      scoresByStudent.set(result.studentId, scores);
    });
    return Array.from(scoresByStudent, ([id, scores]) => ({
      id,
      average: scores.reduce((sum, score) => sum + score, 0) / scores.length
    })).sort((first, second) => second.average - first.average);
  }, [finalizedResults]);

  const overallAverage = finalizedResults.length
    ? finalizedResults.reduce((sum, result) => sum + result.percentage!, 0) / finalizedResults.length
    : null;
  const averageScore = finalizedResults.length
    ? finalizedResults.reduce((sum, result) => sum + result.score, 0) / finalizedResults.length
    : null;
  const highestPercentage = finalizedResults.length
    ? Math.max(...finalizedResults.map(result => result.percentage!))
    : null;
  const lowestPercentage = finalizedResults.length
    ? Math.min(...finalizedResults.map(result => result.percentage!))
    : null;
  const passedCount = finalizedResults.filter(result => result.passed === true).length;
  const passRate = finalizedResults.length ? (passedCount / finalizedResults.length) * 100 : null;

  const selfAverage = studentId
    ? studentAverages.find(row => row.id === studentId)?.average
    : undefined;
  const computedRank = selfAverage === undefined
    ? null
    : 1 + studentAverages.filter(row => row.average > selfAverage).length;
  const rank = studentId
    ? studentRankings?.overallRank?.rank ?? null
    : computedRank;
  const totalRankedStudents = studentId
    ? studentRankings?.overallRank?.totalRankedStudents ?? null
    : studentAverages.length;
  const percentile = studentId
    ? studentRankings?.overallRank?.percentile ?? null
    : rank && totalRankedStudents
      ? totalRankedStudents <= 1
        ? 100
        : Math.round(((totalRankedStudents - rank) / totalRankedStudents) * 10000) / 100
      : null;
  const attemptedCount = studentId
    ? studentRankings?.overallRank?.examsAttempted ?? finalizedResults.length
    : finalizedResults.length;
  const reportedPassedCount = studentId
    ? studentRankings?.overallRank?.passed ?? passedCount
    : passedCount;

  const metrics = [
    ['Overall Average Score', averageScore === null ? '—' : averageScore.toFixed(1)],
    ['Overall Percentage', overallAverage === null ? '—' : `${overallAverage.toFixed(1)}%`],
    ['Exams Attempted', attemptedCount],
    ['Exams Passed', reportedPassedCount],
    ['Pass Rate', passRate === null ? '—' : `${passRate.toFixed(1)}%`],
    ['Highest Score', highestPercentage === null ? '—' : `${highestPercentage.toFixed(1)}%`],
    ['Lowest Score', lowestPercentage === null ? '—' : `${lowestPercentage.toFixed(1)}%`],
    ['Overall Rank', rank && totalRankedStudents ? `#${rank} / ${totalRankedStudents}` : '—'],
    ['Total Ranked Students', totalRankedStudents || '—'],
    ['Percentile', percentile === null ? '—' : `${percentile.toFixed(1)}%`]
  ];

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-800">
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Overall Performance</h2>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          Based on finalized, published exam results only.
        </p>
      </div>
      {finalizedResults.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-200 py-8 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
          No finalized published results available.
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {metrics.map(([label, value]) => (
            <div key={String(label)} className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900/40">
              <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">{label}</p>
              <p className="mt-1 text-lg font-semibold tabular-nums text-slate-900 dark:text-white">{value}</p>
            </div>
          ))}
        </div>
      )}
    </section>
  );
};
