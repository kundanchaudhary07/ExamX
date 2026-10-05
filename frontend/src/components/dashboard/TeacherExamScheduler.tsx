import React, { useState, useEffect, useMemo } from 'react';
import { ScheduledExam, Question, SystemUser, AiGenerationBatch } from '../../types';
import {
  StatusBadge,
  EmptyState,
  ExamDetailModal,
  SearchableSelect,
  KpiCard,
  Modal,
  FormSection,
  useConfirmAction
} from '../common/SharedUI';
import { dbService } from '../../services/dbService';
import { CreatableSubjectCombobox } from '../common/CreatableSubjectCombobox';
import {
  Plus,
  Edit2,
  Play,
  X,
  Eye,
  Users,
  CheckSquare,
  Send,
  StopCircle,
  Trash2,
  Calendar,
  FileText,
  CheckCircle,
  Clock,
  Sparkles,
  Search,
  Filter,
  ArrowRight
} from 'lucide-react';

const COURSES = [
  'B.Tech CSE',
  'B.Tech IT',
  'B.Tech ECE',
  'B.Tech EE',
  'B.Tech ME',
  'B.Tech CE',
  'M.Tech CSE',
  'BCA',
  'MCA',
  'B.Sc Computer Science',
  'MBA',
  'BBA'
];

const SEMESTERS = [
  'Semester 1',
  'Semester 2',
  'Semester 3',
  'Semester 4',
  'Semester 5',
  'Semester 6',
  'Semester 7',
  'Semester 8'
];

const EXAM_STATUS_OPTIONS = [
  { value: 'DRAFT', label: 'DRAFT' },
  { value: 'SCHEDULED', label: 'SCHEDULED' },
  { value: 'LIVE', label: 'LIVE' },
  { value: 'ENDED', label: 'ENDED' },
  { value: 'RESULT_PUBLISHED', label: 'RESULT_PUBLISHED' },
  { value: 'PUBLISHED', label: 'PUBLISHED' }
];

interface TeacherExamSchedulerProps {
  exams: ScheduledExam[];
  questions?: Question[];
  generationBatches?: AiGenerationBatch[];
  students?: SystemUser[];
  onSaveExam: (exam: ScheduledExam) => Promise<void> | void;
  onDeleteExam?: (id: string) => Promise<void> | void;
  onStatusChange?: (
    examId: string,
    status:
      | 'DRAFT'
      | 'SCHEDULED'
      | 'LIVE'
      | 'ENDED'
      | 'PUBLISHED'
      | 'RESULT_PUBLISHED'
      | 'CLOSED'
      | 'ARCHIVED',
    publishResults?: boolean
  ) => Promise<void> | void;
  onRequestGenerateQuestions?: (context: {
    subject: string;
    course: string;
    semester: string;
    examTitle?: string;
    currentFormData: Partial<ScheduledExam>;
    editingExam: ScheduledExam | null;
  }) => void;
  savedDraft?: {
    formData: Partial<ScheduledExam>;
    editingExam: ScheduledExam | null;
    autoOpen?: boolean;
  } | null;
}

export const TeacherExamScheduler: React.FC<TeacherExamSchedulerProps> = ({
  exams,
  questions = [],
  generationBatches = [],
  students = [],
  onSaveExam,
  onDeleteExam,
  onStatusChange,
  onRequestGenerateQuestions,
  savedDraft
}) => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingExam, setEditingExam] = useState<ScheduledExam | null>(null);
  const [viewingPaperExam, setViewingPaperExam] = useState<ScheduledExam | null>(null);
  const [selectedExamDetails, setSelectedExamDetails] = useState<ScheduledExam | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Question selection filters & pagination
  const [questionSearch, setQuestionSearch] = useState('');
  const [questionDifficultyFilter, setQuestionDifficultyFilter] = useState<string>('ALL');
  const [matchCurrentExamFilter, setMatchCurrentExamFilter] = useState<boolean>(true);
  const [questionPage, setQuestionPage] = useState(1);
  const QUESTIONS_PER_PAGE = 6;
  const [isQuestionWorkspaceOpen, setIsQuestionWorkspaceOpen] = useState(false);
  const [selectedGenerationSet, setSelectedGenerationSet] = useState('');

  // Student assignment search & filters
  const [studentSearch, setStudentSearch] = useState('');
  const [studentCourseFilter, setStudentCourseFilter] = useState<string>('ALL');

  const todayStr = new Date().toISOString().split('T')[0];

  const courseOptions = Array.from(
    new Set([
      ...COURSES,
      ...exams.map(e => e.course?.trim()).filter((c): c is string => Boolean(c)),
      ...students.map(s => s.course?.trim()).filter((c): c is string => Boolean(c))
    ])
  ).map(c => ({ value: c, label: c }));

  const semesterOptions = Array.from(
    new Set([
      ...SEMESTERS,
      ...exams.map(e => e.semester?.trim()).filter((s): s is string => Boolean(s)),
      ...students.map(s => s.semester?.trim()).filter((s): s is string => Boolean(s))
    ])
  ).map(s => ({ value: s, label: s }));

  const [formData, setFormData] = useState<Partial<ScheduledExam>>({
    title: '',
    description: '',
    subject: '',
    course: 'B.Tech CSE',
    department: '',
    semester: 'Semester 4',
    scheduledDate: todayStr,
    startTime: '09:00',
    endTime: '11:00',
    durationMinutes: 60,
    totalMarks: 0,
    passingMarks: 0,
    attemptLimit: 1,
    instructions:
      '1. Ensure stable internet connection.\n2. Keep webcam active throughout the examination.\n3. Tab switching is strictly monitored.',
    questionIds: [],
    assignedStudentIds: [],
    proctoringConfig: {
      enableWebcam: true,
      FullScreenEnforcement: true,
      tabSwitchLimit: 3,
      aiSuspicionThreshold: 70
    },
    status: 'DRAFT'
  });

  // Restore saved draft (e.g., returning from AI Question Generation with state preserved)
  useEffect(() => {
    if (savedDraft && savedDraft.autoOpen) {
      setEditingExam(savedDraft.editingExam);
      setFormData(savedDraft.formData);
      setIsModalOpen(true);
    }
  }, [savedDraft]);

  const handleOpenModal = (exam?: ScheduledExam) => {
    setFormError(null);
    setActionError(null);
    if (exam) {
      setEditingExam(exam);
      const existingQIds = exam.questionIds || [];
      const selectedQuestionObjs = questions.filter(q =>
        existingQIds.includes(q.questionId || q.id)
      );
      const calculatedMarks =
        selectedQuestionObjs.length > 0
          ? selectedQuestionObjs.reduce((sum, q) => sum + (q.marks || 1), 0)
          : exam.totalMarks ?? 0;

      setFormData({
        ...exam,
        course: exam.course || 'B.Tech CSE',
        semester: exam.semester || 'Semester 4',
        totalMarks: calculatedMarks,
        passingMarks:
          calculatedMarks > 0
            ? Math.min(exam.passingMarks || Math.max(1, Math.round(calculatedMarks * 0.4)), calculatedMarks)
            : 0,
        questionIds: existingQIds,
        assignedStudentIds: exam.assignedStudentIds || []
      });
    } else {
      setEditingExam(null);
      const activeQuestions = questions.filter(
        q => q.status !== 'ARCHIVED' && q.status !== 'INACTIVE'
      );

      setFormData({
        title: '',
        description: '',
        subject: activeQuestions[0]?.subject || activeQuestions[0]?.topic || '',
        course: 'B.Tech CSE',
        department: '',
        semester: 'Semester 4',
        scheduledDate: todayStr,
        startTime: '09:00',
        endTime: '23:00',
        durationMinutes: 60,
        totalMarks: 0,
        passingMarks: 0,
        attemptLimit: 1,
        instructions:
          '1. Ensure stable internet connection.\n2. Keep webcam active throughout the examination.\n3. Tab switching is strictly monitored.',
        questionIds: [],
        assignedStudentIds: [],
        proctoringConfig: {
          enableWebcam: true,
          FullScreenEnforcement: true,
          tabSwitchLimit: 3,
          aiSuspicionThreshold: 70
        },
        status: 'DRAFT'
      });
    }
    setIsModalOpen(true);
  };

  const toggleQuestionId = (qId: string) => {
    const current = formData.questionIds || [];
    const exists = current.includes(qId);
    const updated = exists ? current.filter(id => id !== qId) : [...current, qId];
    const selectedQuestionObjs = questions.filter(q => updated.includes(q.questionId || q.id));
    const calculatedMarks = selectedQuestionObjs.reduce((sum, q) => sum + (q.marks || 1), 0);

    setFormData({
      ...formData,
      questionIds: updated,
      totalMarks: calculatedMarks,
      passingMarks: calculatedMarks > 0 ? Math.max(1, Math.round(calculatedMarks * 0.4)) : 0
    });
  };

  const selectAllQuestions = () => {
    const activeQs = questions.filter(q => q.status !== 'ARCHIVED' && q.status !== 'INACTIVE');
    const allQIds = activeQs.map(q => q.questionId || q.id);
    const calculatedMarks = activeQs.reduce((sum, q) => sum + (q.marks || 1), 0);
    setFormData({
      ...formData,
      questionIds: allQIds,
      totalMarks: calculatedMarks,
      passingMarks: calculatedMarks > 0 ? Math.max(1, Math.round(calculatedMarks * 0.4)) : 0
    });
  };

  const applyGenerationSet = () => {
    const batch = generationBatches.find((item) => item.generationId === selectedGenerationSet);
    if (!batch) {
      setActionError('Select a previous question set first.');
      return;
    }
    const batchIds = new Set(batch.questionIds || []);
    const reusableQuestions = questions.filter((question) => {
      const questionId = question.questionId || question.id;
      return batchIds.has(questionId) &&
        question.status === 'ACTIVE' &&
        question.reviewStatus === 'APPROVED' &&
        String(question.subject || '').trim().toLocaleLowerCase() === String(formData.subject || '').trim().toLocaleLowerCase() &&
        (!question.course || question.course.trim().toLocaleLowerCase() === String(formData.course || '').trim().toLocaleLowerCase()) &&
        (!question.semester || question.semester.trim().toLocaleLowerCase() === String(formData.semester || '').trim().toLocaleLowerCase());
    });
    if (!reusableQuestions.length) {
      setActionError('This question set has no approved questions matching the exam subject, course, and semester.');
      return;
    }
    const existingIds = new Set(formData.questionIds || []);
    const nextIds = [...existingIds, ...reusableQuestions
      .map((question) => question.questionId || question.id)
      .filter((questionId) => !existingIds.has(questionId))];
    const selectedQuestionObjs = questions.filter((question) =>
      nextIds.includes(question.questionId || question.id)
    );
    const calculatedMarks = selectedQuestionObjs.reduce((sum, question) => sum + (question.marks || 1), 0);
    setFormData({
      ...formData,
      questionIds: nextIds,
      totalMarks: calculatedMarks,
      passingMarks: calculatedMarks > 0 ? Math.max(1, Math.round(calculatedMarks * 0.4)) : 0
    });
    setActionError(null);
  };

  const toggleStudentId = (sId: string) => {
    const current = formData.assignedStudentIds || [];
    const exists = current.includes(sId);
    const updated = exists ? current.filter(id => id !== sId) : [...current, sId];
    setFormData({
      ...formData,
      assignedStudentIds: updated
    });
  };

  const selectAllStudents = () => {
    const allIds = students.filter(s => s.status === 'ACTIVE').map(s => s.userId || s.id);
    setFormData({ ...formData, assignedStudentIds: allIds });
  };

  // Eligible questions: only ACTIVE / APPROVED questions can be added to exams
  const eligibleQuestions = useMemo(() => {
    return questions.filter(
      q => q.status === 'ACTIVE' || q.status === 'APPROVED' || (!q.status && (q as any).isApproved)
    );
  }, [questions]);

  // Matching questions for automatic question filtering (Subject, Course, Semester)
  const filteredQuestions = useMemo(() => {
    return eligibleQuestions.filter(q => {
      if (matchCurrentExamFilter) {
        if (formData.subject?.trim()) {
          const normSub = formData.subject.toLowerCase().trim();
          const qSub = (q.subject || q.topic || '').toLowerCase().trim();
          const matchSubject = qSub.includes(normSub) || normSub.includes(qSub);
          if (!matchSubject) return false;
        }
        if (q.course && formData.course && q.course.toLowerCase().trim() !== formData.course.toLowerCase().trim()) {
          return false;
        }
        if (q.semester && formData.semester && q.semester.toLowerCase().trim() !== formData.semester.toLowerCase().trim()) {
          return false;
        }
      }
      if (questionDifficultyFilter !== 'ALL') {
        if (q.difficulty !== questionDifficultyFilter) return false;
      }
      if (questionSearch.trim()) {
        const qTerm = questionSearch.toLowerCase().trim();
        const matchesText = q.text?.toLowerCase().includes(qTerm);
        const matchesTopic = q.topic?.toLowerCase().includes(qTerm);
        const matchesId = (q.questionId || q.id)?.toLowerCase().includes(qTerm);
        if (!matchesText && !matchesTopic && !matchesId) return false;
      }
      return true;
    });
  }, [eligibleQuestions, matchCurrentExamFilter, formData.subject, formData.course, formData.semester, questionDifficultyFilter, questionSearch]);

  const totalQuestionPages = Math.max(1, Math.ceil(filteredQuestions.length / QUESTIONS_PER_PAGE));
  const paginatedQuestions = useMemo(() => {
    const start = (questionPage - 1) * QUESTIONS_PER_PAGE;
    return filteredQuestions.slice(start, start + QUESTIONS_PER_PAGE);
  }, [filteredQuestions, questionPage]);

  // Students filtering
  const filteredStudents = useMemo(() => {
    return students.filter(s => {
      if (s.status && s.status !== 'ACTIVE') return false;
      if (studentCourseFilter !== 'ALL' && s.course !== studentCourseFilter) {
        return false;
      }
      if (studentSearch.trim()) {
        const sTerm = studentSearch.toLowerCase().trim();
        const matchesName = s.name?.toLowerCase().includes(sTerm);
        const matchesId = (s.userId || s.id)?.toLowerCase().includes(sTerm);
        const matchesDept = s.department?.toLowerCase().includes(sTerm);
        if (!matchesName && !matchesId && !matchesDept) return false;
      }
      return true;
    });
  }, [students, studentCourseFilter, studentSearch]);
  const { confirmAction, ConfirmModal } = useConfirmAction();

  const handleInlineStatusChange = async (
    exam: ScheduledExam,
    nextStatus:
      | 'DRAFT'
      | 'SCHEDULED'
      | 'LIVE'
      | 'ENDED'
      | 'PUBLISHED'
      | 'RESULT_PUBLISHED'
      | 'CLOSED'
      | 'ARCHIVED',
    publishResults = false
  ) => {
    const examKey = exam.examId || exam.id;
    setActionError(null);
    try {
      if (onStatusChange) {
        await onStatusChange(examKey, nextStatus, publishResults);
      } else {
        await dbService.updateExamStatus(examKey, nextStatus, publishResults);
      }
    } catch (err: any) {
      setActionError(err?.message || `Failed to transition exam to ${nextStatus}`);
    }
  };

  const handleConfirmDeleteExam = (exam: ScheduledExam) => {
    const examKey = exam.examId || exam.id;
    confirmAction({
      title: 'Delete Examination',
      subtitle: `Exam ID: ${examKey}`,
      message: `Are you sure you want to delete "${exam.title}"?`,
      consequence: 'This examination will be removed from active schedules. Any pending or assigned students will immediately lose access.',
      variant: 'danger',
      confirmLabel: 'Yes, Delete',
      cancelLabel: 'No',
      details: [
        { label: 'Exam Title', value: exam.title },
        { label: 'Subject', value: exam.subject },
        { label: 'Status', value: exam.status },
        { label: 'Assigned Students', value: `${exam.assignedStudentIds?.length || 0} students` }
      ],
      action: async () => {
        if (onDeleteExam) {
          await onDeleteExam(examKey);
        }
      }
    });
  };

  const handleConfirmPublishResults = (exam: ScheduledExam) => {
    const examKey = exam.examId || exam.id;
    confirmAction({
      title: 'Publish Results',
      subtitle: `Exam: ${exam.title}`,
      message: 'Are you sure you want to publish these results? Students will be able to view the published results.',
      consequence: 'Once published, candidate test scores, performance summaries, and question answer keys will immediately become visible to all students on their dashboards.',
      variant: 'primary',
      confirmLabel: 'Yes, Publish',
      cancelLabel: 'No',
      details: [
        { label: 'Exam Title', value: exam.title },
        { label: 'Subject', value: exam.subject },
        { label: 'Passing Marks', value: `${exam.passingMarks} / ${exam.totalMarks}` },
        { label: 'Assigned Students', value: `${exam.assignedStudentIds?.length || 0} Candidates` }
      ],
      action: async () => {
        setActionError(null);
        await handleInlineStatusChange(exam, 'RESULT_PUBLISHED', true);
      }
    });
  };

  const handleConfirmStatusChange = (
    exam: ScheduledExam,
    nextStatus: 'SCHEDULED' | 'LIVE' | 'ENDED' | 'CLOSED'
  ) => {
    let title = `Set Status to ${nextStatus}`;
    let confirmLabel = `Yes, Set to ${nextStatus}`;
    let consequence = '';
    let variant: 'warning' | 'primary' | 'danger' = 'warning';

    if (nextStatus === 'LIVE') {
      title = 'Start Live Examination';
      confirmLabel = 'Yes, Set Live';
      consequence = 'Students will immediately be permitted to enter the examination room and begin their proctored attempt.';
      variant = 'primary';
    } else if (nextStatus === 'ENDED') {
      title = 'End Exam';
      confirmLabel = 'Yes, End Exam';
      consequence = 'Active or pending examination sessions will be ended and locked from further answers.';
      variant = 'danger';
    } else if (nextStatus === 'CLOSED') {
      title = 'Close Exam';
      confirmLabel = 'Yes, Close Exam';
      consequence = 'The examination will be closed and locked from further attempts or edits.';
      variant = 'danger';
    } else {
      title = 'Schedule Exam';
      confirmLabel = 'Yes, Schedule';
      consequence = 'The examination will be marked as scheduled for registered candidates.';
      variant = 'primary';
    }

    confirmAction({
      title,
      subtitle: `Exam: ${exam.title}`,
      message: `Are you sure you want to transition "${exam.title}" to ${nextStatus}?`,
      consequence,
      variant,
      confirmLabel,
      cancelLabel: 'No',
      details: [
        { label: 'Exam Title', value: exam.title },
        { label: 'Current Status', value: exam.status },
        { label: 'Target Status', value: nextStatus }
      ],
      action: async () => {
        await handleInlineStatusChange(exam, nextStatus, false);
      }
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!formData.title?.trim() || !formData.subject?.trim()) {
      setFormError('Exam title and subject are required.');
      return;
    }

    if (!formData.course?.trim()) {
      setFormError('Please select a course / program.');
      return;
    }

    if (!formData.semester?.trim()) {
      setFormError('Please select a semester.');
      return;
    }

    const durationMins = Number(formData.durationMinutes || 0);
    if (!Number.isFinite(durationMins) || durationMins <= 0) {
      setFormError('Duration in minutes must be greater than zero.');
      return;
    }

    const dateStr = formData.scheduledDate || todayStr;
    const startClock = formData.startTime || '09:00';
    const endClock = formData.endTime || '23:00';
    const startDt = new Date(`${dateStr}T${startClock}:00`);
    const endDt = new Date(`${dateStr}T${endClock}:00`);

    if (isNaN(startDt.getTime()) || isNaN(endDt.getTime())) {
      setFormError('Please provide valid start and end times.');
      return;
    }

    if (endDt.getTime() <= startDt.getTime()) {
      setFormError('Exam end time must be strictly after start time.');
      return;
    }

    const windowMinutes = (endDt.getTime() - startDt.getTime()) / (1000 * 60);
    if (windowMinutes < durationMins) {
      setFormError(
        `Schedule window (${Math.floor(windowMinutes)} mins) is shorter than exam duration (${durationMins} mins).`
      );
      return;
    }

    const targetStatus = formData.status || 'DRAFT';
    const selectedQIds = formData.questionIds || [];
    const selectedSIds = formData.assignedStudentIds || [];

    if (targetStatus !== 'DRAFT' && targetStatus !== 'ARCHIVED') {
      if (selectedQIds.length === 0) {
        setFormError(
          `Cannot set exam to ${targetStatus} without at least one question. Save as DRAFT or select questions below.`
        );
        return;
      }
      if (selectedSIds.length === 0) {
        setFormError(
          `Cannot set exam to ${targetStatus} without at least one assigned student. Save as DRAFT or select students below.`
        );
        return;
      }
    }

    setIsSubmitting(true);
    try {
      const selectedQuestionObjs = questions.filter(q =>
        selectedQIds.includes(q.questionId || q.id)
      );
      const authoritativeMarks = selectedQuestionObjs.reduce((sum, q) => sum + (q.marks || 1), 0);

      const newExam: ScheduledExam = {
        ...(formData as ScheduledExam),
        id: editingExam ? editingExam.examId || editingExam.id : '',
        examId: editingExam ? editingExam.examId || editingExam.id : '',
        createdBy: editingExam?.createdBy || '',
        totalMarks: authoritativeMarks,
        passingMarks:
          authoritativeMarks > 0
            ? Math.min(
                formData.passingMarks || Math.max(1, Math.round(authoritativeMarks * 0.4)),
                authoritativeMarks
              )
            : 0,
        status: targetStatus
      };
      await onSaveExam(newExam);
      setIsModalOpen(false);
    } catch (err: any) {
      setFormError(err?.message || 'Failed to save examination.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const draftCount = exams.filter(e => e.status === 'DRAFT').length;
  const liveCount = exams.filter(e => e.status === 'LIVE').length;
  const scheduledCount = exams.filter(
    e => e.status === 'SCHEDULED' || e.status === 'PUBLISHED'
  ).length;
  const completedCount = exams.filter(
    e =>
      e.status === 'ENDED' ||
      e.status === 'CLOSED' ||
      e.status === 'COMPLETED' ||
      e.status === 'RESULT_PUBLISHED'
  ).length;
  const resultsPublishedCount = exams.filter(
    e => e.status === 'RESULT_PUBLISHED' || e.resultPublished
  ).length;

  return (
    <div className="space-y-6">
      {/* Exam Lifecycle KSI Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          label="Total Exams"
          value={exams.length}
          subValue="All created examinations"
          icon={<FileText className="w-5 h-5 text-blue-600 dark:text-blue-400" />}
        />
        <KpiCard
          label="Live & Scheduled"
          value={liveCount + scheduledCount}
          subValue={`${liveCount} Live · ${scheduledCount} Scheduled`}
          icon={<Clock className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />}
        />
        <KpiCard
          label="Draft Exams"
          value={draftCount}
          subValue="Unpublished papers"
          icon={<FileText className="w-5 h-5 text-amber-600 dark:text-amber-400" />}
        />
        <KpiCard
          label="Concluded Exams"
          value={completedCount}
          subValue={`${resultsPublishedCount} Results published`}
          icon={<CheckCircle className="w-5 h-5 text-purple-600 dark:text-purple-400" />}
        />
      </div>

      <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
      {/* Header & Action */}
      <div className="p-6 border-b border-slate-200 dark:border-slate-700 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <h2 className="text-[20px] font-semibold text-slate-900 dark:text-white leading-snug">
          Exams ({exams.length})
        </h2>
        <button
          type="button"
          onClick={() => handleOpenModal()}
          className="h-11 px-4 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-[14.5px] font-medium transition-colors shrink-0 inline-flex items-center justify-center gap-2"
        >
          <Plus className="w-4 h-4" /> Create Exam
        </button>
      </div>

      {actionError && (
        <div className="mx-6 mt-4 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg flex items-center justify-between gap-3 text-[14px] font-medium text-red-600 dark:text-red-400">
          <span>{actionError}</span>
          <button
            type="button"
            onClick={() => setActionError(null)}
            className="p-1 text-red-500 hover:text-red-700"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Exams Table or Empty State */}
      {exams.length === 0 ? (
        <EmptyState
          message="No exams yet."
          actionLabel="Create Exam"
          onAction={() => handleOpenModal()}
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-900/50 text-slate-500 dark:text-slate-400 text-[13.5px] font-semibold border-b border-slate-200 dark:border-slate-700">
                <th className="py-3.5 px-4 whitespace-nowrap">Exam ID</th>
                <th className="py-3.5 px-4">Title</th>
                <th className="py-3.5 px-4 whitespace-nowrap">Created By</th>
                <th className="py-3.5 px-4 whitespace-nowrap">Start</th>
                <th className="py-3.5 px-4 whitespace-nowrap">End</th>
                <th className="py-3.5 px-4 whitespace-nowrap">Duration</th>
                <th className="py-3.5 px-4 whitespace-nowrap">Status</th>
                <th className="py-3.5 px-4 whitespace-nowrap">Assigned Students</th>
                <th className="py-3.5 px-4 text-right whitespace-nowrap">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-700 text-[14.5px]">
              {exams.map(exam => {
                const examKey = exam.examId || exam.id;
                const assignedCount =
                  exam.assignedStudentsCount ?? exam.assignedStudentIds?.length ?? 0;
                return (
                  <tr key={examKey} className="hover:bg-slate-50 dark:hover:bg-slate-700/30">
                    <td className="py-4 px-4 whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => setSelectedExamDetails(exam)}
                        className="font-mono text-[14px] font-medium text-blue-600 dark:text-blue-400 hover:underline tabular-nums"
                      >
                        {examKey}
                      </button>
                    </td>
                    <td className="py-4 px-4">
                      <button
                        type="button"
                        onClick={() => setSelectedExamDetails(exam)}
                        className="font-medium text-slate-900 dark:text-white hover:text-blue-600 dark:hover:text-blue-400 text-left"
                      >
                        {exam.title}
                      </button>
                      <div className="text-[13px] text-slate-500 tabular-nums mt-0.5">
                        {exam.subject} · {exam.questionCount ?? exam.questionIds?.length ?? 0} Questions ·{' '}
                        {exam.totalMarks} Marks
                      </div>
                    </td>
                    <td className="py-4 px-4 text-slate-600 dark:text-slate-400 text-[14px] whitespace-nowrap">
                      {exam.createdByName || exam.createdBy || '—'}
                    </td>
                    <td className="py-4 px-4 text-slate-600 dark:text-slate-400 text-[14px] whitespace-nowrap tabular-nums">
                      {exam.scheduledDate} {exam.startTime}
                    </td>
                    <td className="py-4 px-4 text-slate-600 dark:text-slate-400 text-[14px] whitespace-nowrap tabular-nums">
                      {exam.scheduledDate} {exam.endTime}
                    </td>
                    <td className="py-4 px-4 text-slate-600 dark:text-slate-400 text-[14px] whitespace-nowrap tabular-nums">
                      {exam.durationMinutes} mins
                    </td>
                    <td className="py-4 px-4 whitespace-nowrap">
                      <StatusBadge status={exam.status} />
                    </td>
                    <td className="py-4 px-4 text-slate-800 dark:text-slate-200 font-medium tabular-nums whitespace-nowrap">
                      {assignedCount}
                    </td>
                    <td className="py-4 px-4 text-right whitespace-nowrap">
                      <div className="inline-flex items-center justify-end gap-2">
                        {exam.status === 'DRAFT' && (
                          <button
                            type="button"
                            onClick={() => handleConfirmStatusChange(exam, 'SCHEDULED')}
                            className="h-9 px-3 rounded-lg border border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/40 text-[14px] font-medium inline-flex items-center gap-1.5"
                            title="Schedule Exam"
                          >
                            <Calendar className="w-3.5 h-3.5" /> Schedule
                          </button>
                        )}
                        {(exam.status === 'SCHEDULED' || exam.status === 'PUBLISHED') && (
                          <button
                            type="button"
                            onClick={() => handleConfirmStatusChange(exam, 'LIVE')}
                            className="h-9 px-3 rounded-lg border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 text-[14px] font-medium inline-flex items-center gap-1.5"
                            title="Set Exam Live"
                          >
                            <Play className="w-3.5 h-3.5" /> Live
                          </button>
                        )}
                        {exam.status === 'LIVE' && (
                          <button
                            type="button"
                            onClick={() => handleConfirmStatusChange(exam, 'ENDED')}
                            className="h-9 px-3 rounded-lg border border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-emerald-950/40 text-[14px] font-medium inline-flex items-center gap-1.5"
                            title="End Exam"
                          >
                            <StopCircle className="w-3.5 h-3.5" /> End
                          </button>
                        )}
                        {(exam.status === 'ENDED' || exam.status === 'CLOSED') && (
                          <button
                            type="button"
                            onClick={() => handleConfirmPublishResults(exam)}
                            className="h-9 px-3 rounded-lg border border-purple-200 dark:border-purple-800 text-purple-700 dark:text-purple-400 hover:bg-purple-50 dark:hover:bg-purple-950/40 text-[14px] font-medium inline-flex items-center gap-1.5"
                            title="Publish Results"
                          >
                            <Send className="w-3.5 h-3.5" /> Publish
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => setViewingPaperExam(exam)}
                          className="h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 text-[14px] font-medium inline-flex items-center gap-1.5"
                          title="View Paper"
                        >
                          <Eye className="w-3.5 h-3.5" /> View
                        </button>
                        <button
                          type="button"
                          onClick={() => handleOpenModal(exam)}
                          className="h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 text-[14px] font-medium inline-flex items-center gap-1.5"
                          title="Edit Exam"
                        >
                          <Edit2 className="w-3.5 h-3.5" /> Edit
                        </button>
                        {onDeleteExam && (
                          <button
                            type="button"
                            onClick={() => handleConfirmDeleteExam(exam)}
                            className="h-9 px-2.5 rounded-lg border border-red-200 dark:border-red-900/50 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 text-[14px] font-medium inline-flex items-center justify-center"
                            title="Delete Exam"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <ExamDetailModal exam={selectedExamDetails} onClose={() => setSelectedExamDetails(null)} />

      {/* Workspace Modal for Create/Edit Exam */}
      {isModalOpen && (
        <Modal
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          size="workspace"
          title={editingExam ? `Edit Exam (${editingExam.examId || editingExam.id})` : 'Create Exam'}
          footer={
            <div className="flex items-center justify-between w-full">
              <div className="text-[13.5px] text-slate-500 dark:text-slate-400">
                <span className="font-semibold text-slate-700 dark:text-slate-200 tabular-nums">
                  {formData.questionIds?.length || 0} Questions
                </span>{' '}
                ({formData.totalMarks ?? 0} Marks) ·{' '}
                <span className="font-semibold text-slate-700 dark:text-slate-200 tabular-nums">
                  {formData.assignedStudentIds?.length || 0} Students
                </span>
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="h-11 px-4 rounded-lg text-[14.5px] font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 inline-flex items-center justify-center transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSubmit as any}
                  disabled={isSubmitting}
                  className="h-11 px-6 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-[14.5px] font-medium inline-flex items-center justify-center shadow-sm transition-colors"
                >
                  {isSubmitting ? (editingExam ? 'Saving...' : 'Creating Exam...') : editingExam ? 'Save Changes' : 'Create Exam'}
                </button>
              </div>
            </div>
          }
        >
          <form onSubmit={handleSubmit} className="space-y-6">
            {formError && (
              <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl text-[14px] font-medium text-red-600 dark:text-red-400 flex items-center gap-2">
                <X className="w-4 h-4 shrink-0" />
                <span>{formError}</span>
              </div>
            )}

            {/* 1. EXAM DETAILS */}
            <FormSection
              title="Exam Details"
              icon={<FileText className="w-4 h-4" />}
            >
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="md:col-span-2">
                  <label className="block text-[14px] font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                    Exam Title *
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.title || ''}
                    onChange={e => setFormData({ ...formData, title: e.target.value })}
                    placeholder="e.g., Mid-Term Assessment: Data Structures"
                    className="w-full h-12 px-3.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-[15px] text-slate-900 dark:text-white outline-none focus:border-blue-500"
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-[14px] font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                    Subject *
                  </label>
                  <CreatableSubjectCombobox
                    value={formData.subject || ''}
                    onChange={subject => setFormData(current => ({ ...current, subject }))}
                    onError={setFormError}
                    placeholder="Search or create a subject"
                    required
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[14px] font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                      Course *
                    </label>
                    <SearchableSelect
                      value={formData.course || ''}
                      onChange={val => setFormData({ ...formData, course: val })}
                      options={courseOptions}
                      placeholder="Select course"
                      searchable={true}
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-[14px] font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                      Semester *
                    </label>
                    <SearchableSelect
                      value={formData.semester || ''}
                      onChange={val => setFormData({ ...formData, semester: val })}
                      options={semesterOptions}
                      placeholder="Select semester"
                      searchable={false}
                      required
                    />
                  </div>
                </div>
              </div>
            </FormSection>

            {/* 2. SCHEDULE & CONFIGURATION */}
            <FormSection
              title="Schedule & Configuration"
              icon={<Calendar className="w-4 h-4" />}
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                <div>
                  <label className="block text-[14px] font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                    Date *
                  </label>
                  <input
                    type="date"
                    required
                    value={formData.scheduledDate || todayStr}
                    onChange={e => setFormData({ ...formData, scheduledDate: e.target.value })}
                    className="w-full h-12 px-3.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-[15px] text-slate-900 dark:text-white outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-[14px] font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                    Start Window *
                  </label>
                  <input
                    type="time"
                    required
                    value={formData.startTime || '09:00'}
                    onChange={e => setFormData({ ...formData, startTime: e.target.value })}
                    className="w-full h-12 px-3.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-[15px] text-slate-900 dark:text-white outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-[14px] font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                    End Window *
                  </label>
                  <input
                    type="time"
                    required
                    value={formData.endTime || '23:00'}
                    onChange={e => setFormData({ ...formData, endTime: e.target.value })}
                    className="w-full h-12 px-3.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-[15px] text-slate-900 dark:text-white outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-[14px] font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                    Duration (Minutes) *
                  </label>
                  <input
                    type="number"
                    required
                    min="5"
                    value={formData.durationMinutes || 60}
                    onChange={e =>
                      setFormData({ ...formData, durationMinutes: Number(e.target.value) })
                    }
                    className="w-full h-12 px-3.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-[15px] text-slate-900 dark:text-white outline-none focus:border-blue-500 tabular-nums"
                  />
                </div>
                <div>
                  <label className="block text-[14px] font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                    Attempt Limit *
                  </label>
                  <input
                    type="number"
                    required
                    min="1"
                    max="10"
                    value={formData.attemptLimit || 1}
                    onChange={e =>
                      setFormData({ ...formData, attemptLimit: Number(e.target.value) })
                    }
                    className="w-full h-12 px-3.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-[15px] text-slate-900 dark:text-white outline-none focus:border-blue-500 tabular-nums"
                  />
                </div>
                <div>
                  <label className="block text-[14px] font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                    Lifecycle Status
                  </label>
                  <SearchableSelect
                    value={formData.status || 'DRAFT'}
                    onChange={val => setFormData({ ...formData, status: val as any })}
                    options={EXAM_STATUS_OPTIONS}
                    placeholder="Select status"
                    searchable={false}
                  />
                </div>
              </div>
            </FormSection>

            {/* 3. QUESTIONS SECTION — SUBJECT SUMMARY & SELECTION WORKSPACE */}
            <FormSection
              title="Questions"
              icon={<CheckSquare className="w-4 h-4" />}
            >
              <div className="space-y-4">
                {/* Workflow Actions Header with Subject Summary */}
                <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700 space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5">
                      <button
                        type="button"
                        onClick={() => setIsQuestionWorkspaceOpen(true)}
                        className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-[13.5px] font-medium flex items-center gap-2 shadow-sm transition-colors"
                      >
                        <CheckSquare className="w-4 h-4" /> Select Questions from Bank
                      </button>
                      {onRequestGenerateQuestions && (
                        <button
                          type="button"
                          onClick={() => {
                            onRequestGenerateQuestions({
                              subject: formData.subject || '',
                              course: formData.course || '',
                              semester: formData.semester || '',
                              examTitle: formData.title || '',
                              currentFormData: formData,
                              editingExam
                            });
                          }}
                          className="px-3.5 py-2 rounded-lg border border-purple-200 dark:border-purple-800 bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300 hover:bg-purple-100 dark:hover:bg-purple-900/40 text-[13.5px] font-medium flex items-center gap-1.5 transition-colors"
                          title="Open AI Question Generator with current exam context prefilled"
                        >
                          <Sparkles className="w-4 h-4 text-purple-600 dark:text-purple-400" />
                          Generate Questions (AI)
                        </button>
                      )}
                      {generationBatches.some((batch) => batch.approvedCount > 0) && (
                        <div className="flex flex-wrap items-center gap-2">
                          <select
                            value={selectedGenerationSet}
                            onChange={(event) => setSelectedGenerationSet(event.target.value)}
                            aria-label="Select a previous AI question set"
                            className="h-9 max-w-[260px] rounded-lg border border-slate-200 bg-white px-2.5 text-[12.5px] text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                          >
                            <option value="">Previous question set...</option>
                            {generationBatches.filter((batch) => batch.approvedCount > 0).map((batch) => (
                              <option key={batch.generationId} value={batch.generationId}>
                                {batch.subject} · {batch.course} · {batch.semester} · {batch.approvedCount} approved
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            onClick={applyGenerationSet}
                            disabled={!selectedGenerationSet}
                            className="h-9 rounded-lg border border-slate-200 px-3 text-[12.5px] font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-700"
                          >
                            Use Set
                          </button>
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-[13.5px]">
                      <span className="font-semibold text-slate-700 dark:text-slate-200 tabular-nums">
                        {formData.questionIds?.length || 0} questions selected
                      </span>
                      <span className="text-slate-300 dark:text-slate-600">·</span>
                      <span className="font-semibold text-blue-600 dark:text-blue-400 tabular-nums">
                        Total Marks: {formData.totalMarks ?? 0}
                      </span>
                    </div>
                  </div>

                  {/* Subject Summary Card */}
                  <div className="pt-2 border-t border-slate-200 dark:border-slate-800 grid grid-cols-2 sm:grid-cols-4 gap-3 text-[13px]">
                    <div>
                      <span className="text-slate-500 block">Exam Subject</span>
                      <span className="font-medium text-slate-800 dark:text-slate-200">
                        {formData.subject || 'All Subjects'}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500 block">Available Questions</span>
                      <span className="font-medium text-slate-800 dark:text-slate-200 tabular-nums">
                        {filteredQuestions.length} in Bank
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500 block">Attached Questions</span>
                      <span className="font-medium text-blue-600 dark:text-blue-400 tabular-nums">
                        {formData.questionIds?.length || 0} Questions
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500 block">Passing Marks</span>
                      <span className="font-medium text-emerald-600 dark:text-emerald-400 tabular-nums">
                        {formData.passingMarks || 0} Marks
                      </span>
                    </div>
                  </div>
                </div>

                {/* Selected Questions Preview / Table */}
                {(formData.questionIds && formData.questionIds.length > 0) ? (
                  <div className="border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden bg-white dark:bg-slate-900">
                    <div className="p-3 bg-slate-50 dark:bg-slate-900/50 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between text-[13.5px]">
                      <span className="font-medium text-slate-700 dark:text-slate-300">
                        Selected Question Paper ({formData.questionIds.length} items)
                      </span>
                      <button
                        type="button"
                        onClick={() => setIsQuestionWorkspaceOpen(true)}
                        className="text-blue-600 dark:text-blue-400 font-medium hover:underline text-[13px]"
                      >
                        Modify Selection
                      </button>
                    </div>
                    <div className="max-h-60 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
                      {formData.questionIds.map((qId, idx) => {
                        const q = questions.find(item => (item.questionId || item.id) === qId);
                        return (
                          <div key={qId} className="p-3 flex items-start justify-between gap-3 text-[13.5px]">
                            <div className="flex-1 min-w-0">
                              <span className="font-semibold text-slate-800 dark:text-slate-200 mr-2">
                                Q{idx + 1}.
                              </span>
                              <span className="text-slate-700 dark:text-slate-300">
                                {q?.text || `Question ID ${qId}`}
                              </span>
                              <div className="flex items-center gap-2 mt-1 text-[12.5px] text-slate-500">
                                <span className="font-mono tabular-nums">{qId}</span>
                                <span>·</span>
                                <span>{q?.subject || formData.subject}</span>
                                <span>·</span>
                                <span>{q?.marks || 1} Marks</span>
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() => toggleQuestionId(qId)}
                              className="text-red-500 hover:text-red-700 text-[12.5px] font-medium shrink-0"
                            >
                              Remove
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  <div className="p-6 text-center rounded-xl bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-700">
                    <p className="text-[14px] text-slate-500 dark:text-slate-400">
                      No questions attached to this exam yet.
                    </p>
                    <button
                      type="button"
                      onClick={() => setIsQuestionWorkspaceOpen(true)}
                      className="mt-2.5 text-[13.5px] font-medium text-blue-600 dark:text-blue-400 hover:underline"
                    >
                      Open Question Bank to add questions
                    </button>
                  </div>
                )}
              </div>
            </FormSection>

            {/* 4. STUDENT ASSIGNMENT */}
            <FormSection
              title="Students"
              icon={<Users className="w-4 h-4" />}
            >
              <div className="space-y-4">
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 p-3.5 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700">
                  <div className="flex-1 relative">
                    <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={studentSearch}
                      onChange={e => setStudentSearch(e.target.value)}
                      placeholder="Search students by name, ID, or department..."
                      className="w-full h-9 pl-9 pr-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-[13.5px] text-slate-900 dark:text-white outline-none focus:border-blue-500"
                    />
                  </div>
                  <div className="flex items-center justify-between sm:justify-end gap-3 text-[13.5px]">
                    <span className="font-semibold text-slate-700 dark:text-slate-200 tabular-nums">
                      {formData.assignedStudentIds?.length || 0} students assigned
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          const activeIds = filteredStudents.map(s => s.userId || s.id);
                          const combined = Array.from(new Set([...(formData.assignedStudentIds || []), ...activeIds]));
                          setFormData({ ...formData, assignedStudentIds: combined });
                        }}
                        className="text-blue-600 dark:text-blue-400 font-medium hover:underline text-[13px]"
                      >
                        Select Filtered
                      </button>
                      <span className="text-slate-300 dark:text-slate-600">·</span>
                      <button
                        type="button"
                        onClick={() => setFormData({ ...formData, assignedStudentIds: [] })}
                        className="text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 font-medium hover:underline text-[13px]"
                      >
                        Clear
                      </button>
                    </div>
                  </div>
                </div>

                {filteredStudents.length === 0 ? (
                  <div className="p-6 text-center rounded-xl bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-700 text-[14px] text-slate-500">
                    No matching students found.
                  </div>
                ) : (
                  <div className="max-h-56 overflow-y-auto border border-slate-200 dark:border-slate-700 rounded-xl divide-y divide-slate-100 dark:divide-slate-800 bg-white dark:bg-slate-900">
                    {filteredStudents.map(s => {
                      const sId = s.userId || s.id;
                      const checked = (formData.assignedStudentIds || []).includes(sId);
                      return (
                        <label
                          key={sId}
                          className={`flex items-center justify-between p-3 hover:bg-slate-50 dark:hover:bg-slate-800/60 cursor-pointer text-[14px] transition-colors ${
                            checked ? 'bg-blue-50/40 dark:bg-blue-950/20' : ''
                          }`}
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleStudentId(sId)}
                              className="w-4 h-4 text-blue-600 rounded border-slate-300 focus:ring-blue-500 shrink-0"
                            />
                            <div className="truncate">
                              <span className="font-medium text-slate-900 dark:text-white">
                                {s.name}
                              </span>
                              <span className="font-mono text-[13px] text-slate-500 dark:text-slate-400 ml-2 tabular-nums">
                                ({sId})
                              </span>
                            </div>
                          </div>
                          <span className="text-[13px] text-slate-500 dark:text-slate-400 shrink-0 ml-2">
                            {s.department || 'Academic'} · {s.course || 'All'}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>
            </FormSection>
          </form>
        </Modal>
      )}

      {/* Question Selection Workspace Modal */}
      {isQuestionWorkspaceOpen && (
        <Modal
          isOpen={isQuestionWorkspaceOpen}
          onClose={() => setIsQuestionWorkspaceOpen(false)}
          size="workspace"
          title={`Question Bank Selection · ${formData.subject || 'All Subjects'}`}
          subtitle={`Curate assessment paper questions · ${formData.questionIds?.length || 0} attached · Total Marks: ${formData.totalMarks ?? 0}`}
          footer={
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4 w-full">
              <div className="flex items-center gap-4 text-[13.5px]">
                <span className="font-semibold text-slate-800 dark:text-slate-200 tabular-nums">
                  {formData.questionIds?.length || 0} Question(s) Selected
                </span>
                <span className="text-slate-300 dark:text-slate-600">·</span>
                <span className="font-semibold text-blue-600 dark:text-blue-400 tabular-nums">
                  Total Marks: {formData.totalMarks ?? 0}
                </span>
                <span className="text-slate-300 dark:text-slate-600">·</span>
                <span className="font-medium text-emerald-600 dark:text-emerald-400 tabular-nums">
                  Passing: {formData.passingMarks || 0}
                </span>
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setIsQuestionWorkspaceOpen(false)}
                  className="h-10 px-5 rounded-lg border border-slate-200 dark:border-slate-700 text-[14px] font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                >
                  Done Selecting
                </button>
              </div>
            </div>
          }
        >
          <div className="space-y-4">
            {/* Search and Filter Bar */}
            <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-center bg-slate-50 dark:bg-slate-900/60 p-4 rounded-xl border border-slate-200 dark:border-slate-700">
              <div className="sm:col-span-5 relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={questionSearch}
                  onChange={e => {
                    setQuestionSearch(e.target.value);
                    setQuestionPage(1);
                  }}
                  placeholder="Search questions by statement, topic, or ID..."
                  className="w-full h-10 pl-9 pr-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-[14px] text-slate-900 dark:text-white outline-none focus:border-blue-500"
                />
              </div>
              <div className="sm:col-span-3">
                <select
                  value={questionDifficultyFilter}
                  onChange={e => {
                    setQuestionDifficultyFilter(e.target.value);
                    setQuestionPage(1);
                  }}
                  className="w-full h-10 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-[13.5px] text-slate-700 dark:text-slate-300 outline-none"
                >
                  <option value="ALL">All Difficulties</option>
                  <option value="EASY">Easy</option>
                  <option value="MEDIUM">Medium</option>
                  <option value="HARD">Hard</option>
                </select>
              </div>
              <div className="sm:col-span-4 flex items-center justify-between sm:justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setMatchCurrentExamFilter(prev => !prev);
                    setQuestionPage(1);
                  }}
                  className={`h-10 px-3 rounded-lg text-[13px] font-medium border transition-colors whitespace-nowrap ${
                    matchCurrentExamFilter
                      ? 'border-blue-300 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300'
                      : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400'
                  }`}
                  title="Filter questions to match current exam subject"
                >
                  {matchCurrentExamFilter ? 'Matching Subject' : 'All Subjects'}
                </button>
                {filteredQuestions.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      const current = new Set(formData.questionIds || []);
                      filteredQuestions.forEach(q => current.add(q.questionId || q.id));
                      const updated = Array.from(current);
                      const selectedObjs = questions.filter(q => updated.includes(q.questionId || q.id));
                      const marks = selectedObjs.reduce((s, q) => s + (q.marks || 1), 0);
                      setFormData({
                        ...formData,
                        questionIds: updated,
                        totalMarks: marks,
                        passingMarks: marks > 0 ? Math.max(1, Math.round(marks * 0.4)) : 0
                      });
                    }}
                    className="text-[13px] font-medium text-blue-600 dark:text-blue-400 hover:underline shrink-0"
                  >
                    Select Page
                  </button>
                )}
                {formData.questionIds && formData.questionIds.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setFormData({
                        ...formData,
                        questionIds: [],
                        totalMarks: 0,
                        passingMarks: 0
                      });
                    }}
                    className="text-[13px] font-medium text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 hover:underline shrink-0 ml-1"
                  >
                    Clear All
                  </button>
                )}
              </div>
            </div>

            {/* Questions Table Workspace */}
            {filteredQuestions.length === 0 ? (
              <div className="p-12 text-center rounded-xl bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-700 space-y-3">
                <p className="text-[15px] text-slate-500 dark:text-slate-400">
                  No eligible questions found in Question Bank
                  {matchCurrentExamFilter && formData.subject ? ` for "${formData.subject}"` : ''}.
                </p>
                <div className="flex items-center justify-center gap-3">
                  {matchCurrentExamFilter && (
                    <button
                      type="button"
                      onClick={() => setMatchCurrentExamFilter(false)}
                      className="text-[13.5px] text-blue-600 dark:text-blue-400 font-medium hover:underline"
                    >
                      View questions from all subjects
                    </button>
                  )}
                  {onRequestGenerateQuestions && (
                    <button
                      type="button"
                      onClick={() => {
                        setIsQuestionWorkspaceOpen(false);
                        onRequestGenerateQuestions({
                          subject: formData.subject || '',
                          course: formData.course || '',
                          semester: formData.semester || '',
                          examTitle: formData.title || '',
                          currentFormData: formData,
                          editingExam
                        });
                      }}
                      className="text-[13.5px] text-purple-600 dark:text-purple-400 font-medium hover:underline flex items-center gap-1"
                    >
                      <Sparkles className="w-3.5 h-3.5" /> Generate new questions with AI
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <div className="border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden bg-white dark:bg-slate-900">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-[14px]">
                    <thead>
                      <tr className="bg-slate-50 dark:bg-slate-900/50 text-slate-500 text-[13px] font-semibold border-b border-slate-200 dark:border-slate-800">
                        <th className="py-3 px-4 w-12 text-center">Attach</th>
                        <th className="py-3 px-4">Question ID</th>
                        <th className="py-3 px-4">Statement</th>
                        <th className="py-3 px-4">Subject & Topic</th>
                        <th className="py-3 px-4">Difficulty</th>
                        <th className="py-3 px-4 text-right">Marks</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {paginatedQuestions.map(q => {
                        const qId = q.questionId || q.id;
                        const isAttached = (formData.questionIds || []).includes(qId);
                        return (
                          <tr
                            key={qId}
                            onClick={() => toggleQuestionId(qId)}
                            className={`hover:bg-slate-50 dark:hover:bg-slate-800/60 cursor-pointer transition-colors ${
                              isAttached ? 'bg-blue-50/40 dark:bg-blue-950/20' : ''
                            }`}
                          >
                            <td className="py-3 px-4 text-center">
                              <input
                                type="checkbox"
                                checked={isAttached}
                                onChange={() => {}}
                                className="w-4 h-4 text-blue-600 rounded border-slate-300 focus:ring-blue-500"
                              />
                            </td>
                            <td className="py-3 px-4 font-mono text-[13px] text-slate-600 dark:text-slate-400 tabular-nums">
                              {qId}
                            </td>
                            <td className="py-3 px-4 font-medium text-slate-900 dark:text-white max-w-md">
                              <div className="line-clamp-2">{q.text}</div>
                            </td>
                            <td className="py-3 px-4 text-slate-600 dark:text-slate-300">
                              <div>{q.subject}</div>
                              {q.topic && q.topic !== q.subject && (
                                <div className="text-[12.5px] text-slate-400">{q.topic}</div>
                              )}
                            </td>
                            <td className="py-3 px-4">
                              <StatusBadge status={q.difficulty} />
                            </td>
                            <td className="py-3 px-4 text-right font-medium text-slate-800 dark:text-slate-200 tabular-nums">
                              {q.marks || 1}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Workspace Pagination */}
                {totalQuestionPages > 1 && (
                  <div className="p-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-[13px] text-slate-500">
                    <span>
                      Page {questionPage} of {totalQuestionPages} ({filteredQuestions.length} total questions)
                    </span>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        disabled={questionPage === 1}
                        onClick={() => setQuestionPage(p => Math.max(1, p - 1))}
                        className="px-3 py-1 rounded border border-slate-200 dark:border-slate-700 disabled:opacity-40 hover:bg-slate-50 dark:hover:bg-slate-800"
                      >
                        Previous
                      </button>
                      <button
                        type="button"
                        disabled={questionPage === totalQuestionPages}
                        onClick={() => setQuestionPage(p => Math.min(totalQuestionPages, p + 1))}
                        className="px-3 py-1 rounded border border-slate-200 dark:border-slate-700 disabled:opacity-40 hover:bg-slate-50 dark:hover:bg-slate-800"
                      >
                        Next
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </Modal>
      )}

      {/* View Paper Modal */}
      {viewingPaperExam && (
        <Modal
          isOpen={!!viewingPaperExam}
          onClose={() => setViewingPaperExam(null)}
          size="workspace"
          title={viewingPaperExam.title}
          subtitle={`Paper Preview: ${viewingPaperExam.examId || viewingPaperExam.id} · ${viewingPaperExam.subject} · ${viewingPaperExam.totalMarks} Marks`}
        >
          <div className="space-y-4">
            {(() => {
              const attachedQuestions = questions.filter(q =>
                (viewingPaperExam.questionIds || []).includes(q.questionId || q.id)
              );
              if (attachedQuestions.length === 0) {
                return <EmptyState message="No questions attached to this exam." />;
              }
              return attachedQuestions.map((q, idx) => (
                <div
                  key={q.questionId || q.id}
                  className="p-5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 space-y-3"
                >
                  <div className="flex justify-between items-center text-[13px] text-slate-500 tabular-nums">
                    <span className="font-semibold text-slate-800 dark:text-slate-200">
                      Question {idx + 1} ({q.questionId || q.id})
                    </span>
                    <div className="flex items-center gap-2">
                      <StatusBadge status={q.difficulty} />
                      <span className="font-medium text-slate-700 dark:text-slate-300">
                        {q.marks || 1} Marks
                      </span>
                    </div>
                  </div>
                  <p className="text-[15px] font-medium text-slate-900 dark:text-white leading-relaxed">
                    {q.text}
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {q.options.map((opt, oIdx) => (
                      <div
                        key={oIdx}
                        className={`text-[14px] px-3.5 py-2.5 rounded-lg border ${
                          oIdx === q.correctAnswer
                            ? 'border-emerald-300 dark:border-emerald-700 bg-emerald-50/50 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-300 font-medium'
                            : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400'
                        }`}
                      >
                        {String.fromCharCode(65 + oIdx)}. {opt}
                      </div>
                    ))}
                  </div>
                </div>
              ));
            })()}
          </div>
        </Modal>
      )}

      {/* Global Action Confirmation Modal */}
      <ConfirmModal />
    </div>
    </div>
  );
};
