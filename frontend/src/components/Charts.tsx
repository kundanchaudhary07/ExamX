import React from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar
} from 'recharts';
import { StudentResult } from '../types';

export const ScoreHistoryChart: React.FC<{ data: StudentResult[] }> = ({ data }) => {
  if (!data || data.length === 0) {
    return (
      <div className="h-56 w-full flex items-center justify-center text-[15px] text-slate-500 dark:text-slate-400 border border-dashed border-slate-200 dark:border-slate-700 rounded-lg">
        No data available.
      </div>
    );
  }

  const chartData = data
    .filter(d => typeof d.percentage === 'number' && Number.isFinite(d.percentage))
    .slice()
    .sort((first, second) => new Date(first.date).getTime() - new Date(second.date).getTime())
    .map((result, index) => ({
      label: `Exam ${index + 1}`,
      score: Math.max(0, Math.min(100, result.percentage!)),
      exam: result.examTitle || result.subject || 'Exam',
      date: result.date
    }));

  if (chartData.length === 0) {
    return (
      <div className="h-56 w-full flex items-center justify-center text-[15px] text-slate-500 dark:text-slate-400 border border-dashed border-slate-200 dark:border-slate-700 rounded-lg">
        No data available.
      </div>
    );
  }

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis dataKey="label" stroke="#64748b" fontSize={13} />
          <YAxis stroke="#64748b" fontSize={13} domain={[0, 100]} />
          <Tooltip
            labelFormatter={(_label, payload) => {
              const point = payload?.[0]?.payload as { exam?: string; date?: string } | undefined;
              return point ? `${point.exam || 'Exam'} · ${point.date || ''}` : '';
            }}
            contentStyle={{
              backgroundColor: '#1e293b',
              border: 'none',
              borderRadius: '8px',
              color: '#fff',
              fontSize: '13.5px'
            }}
          />
          <Line
            type="monotone"
            dataKey="score"
            stroke="#2563eb"
            strokeWidth={2.5}
            activeDot={{ r: 6 }}
            name="Percentage (%)"
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
};

export interface SubjectMetricPoint {
  subject: string;
  averagePercentage: number;
  submissions: number;
}

export const TopicMasteryChart: React.FC<{ data?: SubjectMetricPoint[] }> = ({ data = [] }) => {
  if (!data || data.length === 0) {
    return (
      <div className="h-56 w-full flex items-center justify-center text-[15px] text-slate-500 dark:text-slate-400 border border-dashed border-slate-200 dark:border-slate-700 rounded-lg">
        No data available.
      </div>
    );
  }

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis dataKey="subject" stroke="#64748b" fontSize={13} />
          <YAxis stroke="#64748b" fontSize={13} domain={[0, 100]} />
          <Tooltip
            contentStyle={{
              backgroundColor: '#1e293b',
              border: 'none',
              borderRadius: '8px',
              color: '#fff',
              fontSize: '13.5px'
            }}
          />
          <Bar
            dataKey="averagePercentage"
            fill="#2563eb"
            radius={[6, 6, 0, 0]}
            name="Average Score (%)"
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
};

export const PerformanceTrendChart = ScoreHistoryChart;
export const PerformanceRadar = TopicMasteryChart;
