import React, { useState, useEffect, useCallback } from 'react';
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
  ExamAttemptRecord
} from '../../types';
import { TopicMasteryChart } from '../Charts';
import { TeacherExamScheduler } from './TeacherExamScheduler';
import {
  SUBJECTS,
  DEPARTMENTS,
  COURSES,
  ACADEMIC_YEARS,
  SEMESTERS,
  SECTIONS
} from '../../constants';
import { generateQuestionsWithAI } from '../../services/geminiService';
import { dbService } from '../../services/dbService';
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
  BarChart2,
  Upload,
  Eye,
  User as UserIcon
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
  results: StudentResult[];
  queries: StudentQuery[];
  exams: ScheduledExam[];
  onAddQuestion: (q: Question) => Promise<void> | void;
  onUpdateQuestion: (q: Question) => Promise<void> | void;
  onDeleteQuestion: (id: string) => Promise<void> | void;
  onPublishResult: (id: string) => Promise<void> | void;
  onPublishAllForExam?: (examId: string) => Promise<void> | void;
  onResolveQuery: (id: string, response: string, status?: 'RESOLVED' | 'REJECTED') => Promise<void> | void;
  onSaveExam: (exam: ScheduledExam) => Promise<void> | void;
  onDeleteExam?: (examId: string) => Promise<void> | void;
  onRefreshData?: () => Promise<void> | void;
}

export const TeacherDashboard: React.FC<TeacherDashboardProps> = ({
  user,
  activeTab,
  onNavigateTab,
  questions,
  results,
  queries,
  exams,
  onAddQuestion,
  onUpdateQuestion,
  onDeleteQuestion,
  onPublishResult,
  onPublishAllForExam,
  onResolveQuery,
  onSaveExam,
  onDeleteExam,
  onRefreshData
}) => {
  // Supervised Students & Proctoring Events
  const [students, setStudents] = useState<SystemUser[]>([]);
  const [proctoringEvents, setProctoringEvents] = useState<ProctoringEventRecord[]>([]);
  const [attempts, setAttempts] = useState<ExamAttemptRecord[]>([]);
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
  const [replyText, setReplyText] = useState<Record<string, string>>({});
  const [submittingQueryId, setSubmittingQueryId] = useState<string | null>(null);

  // Exam draft preservation when jumping between Create Exam and AI Generator
  const [savedExamDraft, setSavedExamDraft] = useState<{
    formData: Partial<ScheduledExam>;
    editingExam: ScheduledExam | null;
    autoOpen?: boolean;
  } | null>(null);

  // Feedback banner
  const [feedbackBanner, setFeedbackBanner] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const loadTeacherData = useCallback(async () => {
    setIsLoadingDirectory(true);
    setDirectoryError(null);
    try {
      const [studentList, proctorList, attemptList] = await Promise.all([
        dbService.getStudents(),
        dbService.getProctoringEvents().catch(() => []),
        dbService.getAttempts().catch(() => [])
      ]);
      setStudents(studentList);
      setProctoringEvents(proctorList);
      setAttempts(attemptList);
    } catch (err: any) {
      setDirectoryError(err.message || 'Unable to load dashboard data. Try again.');
    } finally {
      setIsLoadingDirectory(false);
    }
  }, []);

  useEffect(() => {
    loadTeacherData();
  }, [loadTeacherData]);

  useEffect(() => {
    refreshAiReviewData();
  }, [refreshAiReviewData]);

  useEffect(() => {
    const unsub = realtimeService.subscribe(payload => {
      if (
        payload.event.startsWith('student.') ||
        payload.event.startsWith('proctoring.') ||
        payload.event.startsWith('exam.') ||
        payload.event.startsWith('question.') ||
        payload.event.startsWith('result.') ||
        payload.event.startsWith('query.')
      ) {
        loadTeacherData();
        if (payload.event.startsWith('question.')) refreshAiReviewData();
      }
    });
    return () => unsub();
  }, [loadTeacherData, refreshAiReviewData]);

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
      if (onRefreshData) await onRefreshData();
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
      await loadTeacherData();
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
          await dbService.updateUserStatus(student.userId || student.id, nextStatus);
          await loadTeacherData();
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
          await dbService.submitExamAttempt(attemptId, {
            terminatedByProctor: true,
            terminationReason: 'Faculty / Proctoring policy violation'
          });
          setSelectedProctoringDetail(null);
          await loadTeacherData();
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

  // Compute Topic Mastery from real results
  const subjectStatsMap: Record<string, { totalPct: number; count: number }> = {};
  results.forEach(r => {
    const key = r.subject || r.topic || 'General';
    if (!subjectStatsMap[key]) subjectStatsMap[key] = { totalPct: 0, count: 0 };
    const pct =
      r.accuracy !== undefined
        ? r.accuracy
        : r.totalQuestions > 0
        ? Math.round((r.score / r.totalQuestions) * 100)
        : 0;
    subjectStatsMap[key].totalPct += pct;
    subjectStatsMap[key].count += 1;
  });
  const masteryData = Object.entries(subjectStatsMap).map(([subject, data]) => ({
    subject: subject.length > 18 ? `${subject.slice(0, 18)}...` : subject,
    A: Math.round(data.totalPct / data.count),
    fullMark: 100
  }));

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

  const publishedResultsCount = results.filter(
    r => r.isPublished || r.status === 'PUBLISHED'
  ).length;
  const unpublishedResultsCount = results.length - publishedResultsCount;
  const passedResultsCount = results.filter(
    r => r.passed === true || (r.percentage ?? r.accuracy ?? 0) >= 40
  ).length;

  const openQueriesCount = queries.filter(
    q => q.status === 'OPEN' || q.status === 'PENDING' || q.status === 'UNDER_REVIEW'
  ).length;
  const resolvedQueriesCount = queries.filter(
    q =>
      q.status === 'RESOLVED' ||
      q.status === 'APPROVED' ||
      q.status === 'REJECTED' ||
      q.status === 'RESOLVED_ACCEPTED' ||
      q.status === 'RESOLVED_REJECTED'
  ).length;

  const criticalEventsCount = proctoringEvents.filter(
    e => e.severity === 'HIGH' || e.severity === 'CRITICAL'
  ).length;

  const activeAttemptsCount = attempts.filter(a => a.status === 'IN_PROGRESS').length;
  const blockedAttemptsCount = attempts.filter(
    a => a.status === 'TERMINATED' || a.proctoringStatus === 'TERMINATED'
  ).length;
  const submittedAttemptsCount = attempts.filter(
    a => a.status === 'SUBMITTED' || a.status === 'EVALUATED'
  ).length;

  return (
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
            {activeTab === 'results' && 'Results'}
            {activeTab === 'queries' && 'Queries'}
            {activeTab === 'analytics' && 'Analytics'}
            {activeTab === 'profile' && 'Profile'}
          </h1>
          <p className="text-[13px] font-normal text-slate-500 dark:text-slate-400 mt-1">
            {user?.name} · ID: {user?.userId || user?.id} · {user?.department || 'Faculty'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() => {
              loadTeacherData();
              if (onRefreshData) onRefreshData();
            }}
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
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
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
              label="Open Queries"
              value={openQueriesCount}
              subValue={`${resolvedQueriesCount} Resolved`}
              icon={<MessageSquare className="w-5 h-5 text-amber-600 dark:text-amber-400" />}
              onClick={() => onNavigateTab('queries')}
            />

            <KpiCard
              label="Published Results"
              value={publishedResultsCount}
              subValue={`${unpublishedResultsCount} Pending publication`}
              icon={<CheckCircle className="w-5 h-5 text-teal-600 dark:text-teal-400" />}
              onClick={() => onNavigateTab('results')}
            />

            <KpiCard
              label="Exam Monitoring"
              value={proctoringEvents.length}
              subValue={`${criticalEventsCount} Flagged events`}
              icon={<Shield className="w-5 h-5 text-rose-600 dark:text-rose-400" />}
              isLoading={isLoadingDirectory}
              onClick={() => onNavigateTab('monitoring')}
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
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
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

            {/* Recent Submissions */}
            <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-[20px] font-semibold text-slate-900 dark:text-white leading-snug">
                  Results
                </h2>
                <button
                  type="button"
                  onClick={() => onNavigateTab('results')}
                  className="text-[14px] font-medium text-blue-600 dark:text-blue-400 hover:underline"
                >
                  View all
                </button>
              </div>
              {results.length === 0 ? (
                <p className="text-[15px] text-slate-500 dark:text-slate-400 py-8 text-center">
                  No results available.
                </p>
              ) : (
                <div className="divide-y divide-slate-100 dark:divide-slate-700/60">
                  {results.slice(0, 5).map(r => (
                    <div key={r.id} className="py-3 flex items-center justify-between text-[14.5px]">
                      <div>
                        <p className="font-medium text-slate-900 dark:text-white">
                          {r.studentName} ({r.studentId})
                        </p>
                        <p className="text-[13px] text-slate-500 dark:text-slate-400 mt-0.5 tabular-nums">
                          {r.examTitle || r.topic} · Score: {r.score}/{r.totalQuestions}
                        </p>
                      </div>
                      <span className="text-[13px] font-medium text-slate-600 dark:text-slate-300">
                        {r.isPublished ? 'Published' : 'Unpublished'}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 2. STUDENTS TAB */}
      {activeTab === 'students' && (
        <div className="space-y-6">
          {/* Supervised Students KSI Summary */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
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
              label="Student Queries"
              value={queries.length}
              subValue={`${openQueriesCount} Open inquiries`}
              icon={<MessageSquare className="w-5 h-5 text-amber-600 dark:text-amber-400" />}
              isLoading={isLoadingDirectory}
            />
          </div>

          <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
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
            <div className="overflow-x-auto">
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
            </div>
          )}
        </div>
        </div>
      )}

      {/* 3. EXAMS TAB */}
      {activeTab === 'exams' && (
        <TeacherExamScheduler
          exams={exams}
          questions={questions}
          students={students}
          onSaveExam={onSaveExam}
          onDeleteExam={onDeleteExam}
          onRefresh={onRefreshData}
          onPublishExamResults={onPublishAllForExam}
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
      )}

      {/* 4. QUESTION BANK TAB */}
      {activeTab === 'questions' && (
        <div className="space-y-6">
          {/* Question Bank KSI Summary */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
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
          </div>

          <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
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

          <div className="p-5">
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
          </div>

          {filteredManualQuestions.length === 0 ? (
            <div className="p-12 text-center text-[15px] text-slate-500 dark:text-slate-400">
              {filteredQuestions.length > 0 || aiGenerationBatches.length > 0
                ? 'No manual questions match these filters.'
                : 'No questions in the question bank.'}
            </div>
          ) : (
            <div className="overflow-x-auto">
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
            </div>
          )}
        </div>
        </div>
      )}

      {/* 5. AI QUESTION GENERATION TAB */}
      {activeTab === 'ai_generator' && (
        <div className="space-y-6">
          {/* AI Generation KSI Summary */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
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
          </div>

          <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-6 space-y-5">
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
                  }}
                  className="w-full h-12 px-3.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-[15px] text-slate-900 dark:text-white"
                >
                  <option value="">Select semester</option>
                  {SEMESTERS.map(semester => <option key={semester} value={semester}>{semester}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[14px] font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                  Topic / Focus Unit
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
          </div>

          {/* Teacher Review Queue */}
          <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-6">
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
          </div>
        </div>
      )}

      {/* 6. EXAM MONITORING (PROCTORING) TAB */}
      {activeTab === 'monitoring' && (
        <div className="space-y-6">
          {/* Proctoring KSI Summary */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiCard
              label="Active Attempts"
              value={activeAttemptsCount}
              subValue="Live candidate sessions"
              icon={<Shield className="w-5 h-5 text-blue-600 dark:text-blue-400" />}
              isLoading={isLoadingDirectory}
            />
            <KpiCard
              label="Warning Events"
              value={proctoringEvents.length}
              subValue={`${criticalEventsCount} Critical / High alerts`}
              icon={<Shield className="w-5 h-5 text-amber-600 dark:text-amber-400" />}
              isLoading={isLoadingDirectory}
            />
            <KpiCard
              label="Blocked Attempts"
              value={blockedAttemptsCount}
              subValue="Terminated policy violations"
              icon={<Shield className="w-5 h-5 text-rose-600 dark:text-rose-400" />}
              isLoading={isLoadingDirectory}
            />
            <KpiCard
              label="Submitted Attempts"
              value={submittedAttemptsCount}
              subValue="Finalized candidate submissions"
              icon={<CheckCircle className="w-5 h-5 text-purple-600 dark:text-purple-400" />}
              isLoading={isLoadingDirectory}
            />
          </div>

          <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
            <div className="p-6 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
              <h2 className="text-[20px] font-semibold text-slate-900 dark:text-white leading-snug">
                Exam Monitoring ({proctoringEvents.length})
              </h2>
            </div>

          {proctoringEvents.length === 0 ? (
            <div className="p-12 text-center text-[15px] text-slate-500 dark:text-slate-400">
              No proctoring records available.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-900/50 text-slate-500 dark:text-slate-400 text-[13.5px] font-semibold border-b border-slate-200 dark:border-slate-700">
                    <th className="p-3.5">Session ID</th>
                    <th className="p-3.5">Student</th>
                    <th className="p-3.5">Exam</th>
                    <th className="p-3.5">Violations</th>
                    <th className="p-3.5">Risk Status</th>
                    <th className="p-3.5">Timestamp</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-700 text-[14.5px]">
                  {proctoringEvents.map(ev => (
                    <tr
                      key={ev.eventId}
                      onClick={() => setSelectedProctoringDetail(ev)}
                      className="hover:bg-slate-50 dark:hover:bg-slate-700/30 cursor-pointer transition-colors"
                    >
                      <td className="p-3.5 font-mono text-[14px] font-medium text-blue-600 dark:text-blue-400 tabular-nums">
                        {ev.eventId}
                      </td>
                      <td className="p-3.5 font-mono text-[14px] font-medium text-slate-900 dark:text-white tabular-nums">
                        {ev.studentId}
                      </td>
                      <td className="p-3.5 font-mono text-[14px] text-slate-600 dark:text-slate-300 tabular-nums">
                        {ev.examId}
                      </td>
                      <td className="p-3.5 font-medium text-slate-800 dark:text-slate-200">
                        <div>{ev.eventType}</div>
                        <div className="text-[13px] font-normal text-slate-500">{ev.message}</div>
                      </td>
                      <td className="p-3.5 text-[13px] font-medium text-slate-700 dark:text-slate-300">
                        {ev.severity}
                      </td>
                      <td className="p-3.5 text-[14px] text-slate-500 tabular-nums">
                        {new Date(ev.timestamp).toLocaleString()}
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

      {/* 7. RESULTS TAB */}
      {activeTab === 'results' && (
        <div className="space-y-6">
          {/* Results KSI Summary */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiCard
              label="Total Submissions"
              value={results.length}
              subValue="Evaluated attempts"
              icon={<CheckCircle className="w-5 h-5 text-blue-600 dark:text-blue-400" />}
            />
            <KpiCard
              label="Published Results"
              value={publishedResultsCount}
              subValue="Released to students"
              icon={<CheckCircle className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />}
            />
            <KpiCard
              label="Pending Publication"
              value={unpublishedResultsCount}
              subValue="Awaiting release"
              icon={<AlertCircle className="w-5 h-5 text-amber-600 dark:text-amber-400" />}
            />
            <KpiCard
              label="Qualified Candidates"
              value={passedResultsCount}
              subValue={`${results.length - passedResultsCount} Below threshold`}
              icon={<CheckCircle className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />}
            />
          </div>

          <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
            <div className="p-6 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
              <h2 className="text-[20px] font-semibold text-slate-900 dark:text-white leading-snug">
                Results ({results.length})
              </h2>
            {unpublishedResultsCount > 0 && (
              <span className="text-[13.5px] font-medium text-amber-600 dark:text-amber-400">
                {unpublishedResultsCount} pending publication
              </span>
            )}
          </div>

          {results.length === 0 ? (
            <div className="p-12 text-center text-[15px] text-slate-500 dark:text-slate-400">
              No results available.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-900/50 text-slate-500 dark:text-slate-400 text-[13.5px] font-semibold border-b border-slate-200 dark:border-slate-700">
                    <th className="p-3.5">Result ID</th>
                    <th className="p-3.5">Student</th>
                    <th className="p-3.5">Exam</th>
                    <th className="p-3.5">Marks</th>
                    <th className="p-3.5">Percentage</th>
                    <th className="p-3.5">Grade</th>
                    <th className="p-3.5">Status</th>
                    <th className="p-3.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-700 text-[14.5px]">
                  {results.map(r => {
                    const pct =
                      r.percentage ??
                      r.accuracy ??
                      (r.totalMarks
                        ? Math.round((r.score / r.totalMarks) * 100)
                        : r.totalQuestions
                          ? Math.round((r.score / r.totalQuestions) * 100)
                          : 0);
                    return (
                      <tr key={r.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/30">
                        <td className="p-3.5 font-mono text-[14px] font-medium tabular-nums">
                          <button
                            type="button"
                            onClick={() => setSelectedResultDetail(r)}
                            className="text-blue-600 dark:text-blue-400 hover:underline"
                          >
                            {r.resultId || r.id}
                          </button>
                        </td>
                        <td className="p-3.5">
                          <div className="font-medium text-slate-900 dark:text-white">
                            {r.studentName}
                          </div>
                          <div className="text-[13px] font-mono text-slate-500 tabular-nums">{r.studentId}</div>
                        </td>
                        <td className="p-3.5">
                          <div className="font-medium text-slate-800 dark:text-slate-200">
                            {r.examTitle || r.topic}
                          </div>
                          <div className="text-[13px] text-slate-500 tabular-nums">{r.date}</div>
                        </td>
                        <td className="p-3.5 font-semibold text-slate-900 dark:text-white tabular-nums">
                          {r.score} / {r.totalMarks || r.totalQuestions}
                        </td>
                        <td className="p-3.5 text-slate-700 dark:text-slate-300 tabular-nums">
                          {pct}%
                        </td>
                        <td className="p-3.5 font-semibold text-blue-600 dark:text-blue-400">
                          {r.grade || (pct >= 80 ? 'A' : pct >= 60 ? 'B' : pct >= 40 ? 'C' : 'F')}
                        </td>
                        <td className="p-3.5 text-[13px] font-medium text-slate-700 dark:text-slate-300">
                          {r.isPublished ? 'PUBLISHED' : 'PENDING'}
                        </td>
                        <td className="p-3.5 text-right whitespace-nowrap space-x-2">
                          <button
                            type="button"
                            onClick={() => setSelectedResultDetail(r)}
                            className="h-9 px-3 rounded-lg border border-blue-200 dark:border-blue-800 text-[14px] font-medium text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20"
                          >
                            View
                          </button>
                          {!r.isPublished && (
                            <button
                              type="button"
                              onClick={() => {
                                confirmAction({
                                  title: 'Publish Results',
                                  message: `Are you sure you want to publish the results for ${r.studentName}? Students will be able to view the published results.`,
                                  confirmLabel: 'Yes, Publish',
                                  cancelLabel: 'No',
                                  variant: 'primary',
                                  action: async () => {
                                    await onPublishResult(r.resultId || r.id);
                                  }
                                });
                              }}
                              className="h-9 px-3.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-[14px] font-medium"
                            >
                              Publish
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

      {/* 8. QUERIES TAB */}
      {activeTab === 'queries' && (
        <div className="space-y-6">
          {/* Queries KSI Summary */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiCard
              label="Total Queries"
              value={queries.length}
              subValue="From student submissions"
              icon={<MessageSquare className="w-5 h-5 text-blue-600 dark:text-blue-400" />}
            />
            <KpiCard
              label="Open Queries"
              value={openQueriesCount}
              subValue="Requires faculty response"
              icon={<MessageSquare className="w-5 h-5 text-amber-600 dark:text-amber-400" />}
            />
            <KpiCard
              label="Resolved"
              value={resolvedQueriesCount}
              subValue="Adjudicated inquiries"
              icon={<CheckCircle className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />}
            />
            <KpiCard
              label="Exams with Queries"
              value={Array.from(new Set(queries.map(q => q.examId).filter(Boolean))).length}
              subValue="Distinct examinations"
              icon={<FileText className="w-5 h-5 text-purple-600 dark:text-purple-400" />}
            />
          </div>

          <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
            <div className="p-6 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
              <h2 className="text-[20px] font-semibold text-slate-900 dark:text-white leading-snug">
                Queries ({queries.length})
              </h2>
            </div>
          {queries.length === 0 ? (
            <div className="py-12 text-center text-[15px] text-slate-500 dark:text-slate-400">
              No queries available.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-900/50 text-slate-500 dark:text-slate-400 text-[13.5px] font-semibold border-b border-slate-200 dark:border-slate-700">
                    <th className="p-3.5">Query ID</th>
                    <th className="p-3.5">Student</th>
                    <th className="p-3.5">Exam</th>
                    <th className="p-3.5">Assigned To</th>
                    <th className="p-3.5">Status</th>
                    <th className="p-3.5">Created</th>
                    <th className="p-3.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-700 text-[14.5px]">
                  {queries.map(q => {
                    const qKey = q.queryId || q.id;
                    return (
                      <tr key={qKey} className="hover:bg-slate-50 dark:hover:bg-slate-700/30">
                        <td className="p-3.5 font-mono text-[14px] font-medium tabular-nums">
                          <button
                            type="button"
                            onClick={() => setSelectedQueryDetail(q)}
                            className="text-blue-600 dark:text-blue-400 hover:underline"
                          >
                            {qKey}
                          </button>
                        </td>
                        <td className="p-3.5">
                          <div className="font-medium text-slate-900 dark:text-white">
                            {q.studentName}
                          </div>
                          <div className="text-[13px] font-mono text-slate-500 tabular-nums">{q.studentId}</div>
                        </td>
                        <td className="p-3.5 text-slate-700 dark:text-slate-300">
                          <div>{q.examTitle || q.subject || q.topic}</div>
                          <div className="text-[13px] text-slate-500 line-clamp-1 max-w-xs">{q.question}</div>
                        </td>
                        <td className="p-3.5 text-[14px] text-slate-600 dark:text-slate-300">
                          {q.assignedTeacherId || user?.name || 'Assigned Faculty'}
                        </td>
                        <td className="p-3.5 text-[13px] font-medium text-slate-600 dark:text-slate-300">
                          {q.status}
                        </td>
                        <td className="p-3.5 text-[14px] text-slate-500 tabular-nums">
                          {q.timestamp}
                        </td>
                        <td className="p-3.5 text-right whitespace-nowrap">
                          <div className="flex items-center justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => setSelectedQueryDetail(q)}
                              className="h-9 px-3 rounded-lg border border-blue-200 dark:border-blue-800 text-[14px] font-medium text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20"
                            >
                              View
                            </button>
                            {q.status === 'OPEN' && (
                              <div className="flex items-center gap-2">
                                <input
                                  type="text"
                                  placeholder="Write response..."
                                  value={replyText[qKey] || ''}
                                  onChange={e =>
                                    setReplyText(prev => ({ ...prev, [qKey]: e.target.value }))
                                  }
                                  className="w-48 h-10 px-3 text-[14px] bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white outline-none"
                                />
                                <button
                                  type="button"
                                  disabled={submittingQueryId === qKey || !(replyText[qKey] || '').trim()}
                                  onClick={() => {
                                    const reply = (replyText[qKey] || '').trim();
                                    if (!reply) return;
                                    confirmAction({
                                      title: 'Resolve Query',
                                      subtitle: `Query ID: ${qKey}`,
                                      message: `Are you sure you want to send this resolution to ${q.studentName || 'the student'}?`,
                                      confirmLabel: 'Yes, Resolve',
                                      cancelLabel: 'No',
                                      variant: 'primary',
                                      details: [
                                        { label: 'Student', value: q.studentName },
                                        { label: 'Subject', value: q.subject || q.topic || 'General' },
                                        { label: 'Response', value: reply }
                                      ],
                                      action: async () => {
                                        setSubmittingQueryId(qKey);
                                        try {
                                          await onResolveQuery(qKey, reply, 'RESOLVED');
                                        } finally {
                                          setSubmittingQueryId(null);
                                        }
                                      }
                                    });
                                  }}
                                  className="h-10 px-3.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg text-[14px] font-medium"
                                >
                                  Resolve
                                </button>
                              </div>
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
        </div>
        </div>
      )}

      {/* 9. ANALYTICS TAB */}
      {activeTab === 'analytics' && (
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-6">
          <h2 className="text-[20px] font-semibold text-slate-900 dark:text-white mb-4 leading-snug">
            Subject Performance Analytics
          </h2>
          {masteryData.length === 0 ? (
            <div className="py-12 text-center text-[15px] text-slate-500 dark:text-slate-400">
              No results available.
            </div>
          ) : (
            <TopicMasteryChart data={masteryData} />
          )}
        </div>
      )}

      {/* 10. PROFILE TAB */}
      {activeTab === 'profile' && (
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-6 max-w-xl">
          <h2 className="text-[20px] font-semibold text-slate-900 dark:text-white mb-4 leading-snug">
            Faculty Profile
          </h2>
          <div className="space-y-3 text-[15px]">
            <div className="flex justify-between py-2.5 border-b border-slate-100 dark:border-slate-700">
              <span className="text-slate-500">Teacher ID</span>
              <span className="font-mono font-medium text-slate-900 dark:text-white tabular-nums">
                {user?.userId || user?.id}
              </span>
            </div>
            <div className="flex justify-between py-2.5 border-b border-slate-100 dark:border-slate-700">
              <span className="text-slate-500">Full Name</span>
              <span className="font-medium text-slate-900 dark:text-white">{user?.name}</span>
            </div>
            <div className="flex justify-between py-2.5 border-b border-slate-100 dark:border-slate-700">
              <span className="text-slate-500">Role</span>
              <span className="font-medium text-slate-900 dark:text-white">{user?.role}</span>
            </div>
            <div className="flex justify-between py-2.5 border-b border-slate-100 dark:border-slate-700">
              <span className="text-slate-500">Department</span>
              <span className="font-medium text-slate-900 dark:text-white">
                {user?.department || 'Computer Science'}
              </span>
            </div>
            <div className="flex justify-between py-2.5">
              <span className="text-slate-500">Supervised Students</span>
              <span className="font-medium text-slate-900 dark:text-white tabular-nums">{students.length}</span>
            </div>
          </div>
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

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5">
                  <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
                    <div className="text-[13.5px] font-medium text-slate-500">Exams Taken</div>
                    <div className={`${getKpiPrimaryValueClass(selectedStudentDetails.kpis.examsTakenCount)} text-blue-600 dark:text-blue-400 mt-1 tabular-nums`}>
                      {selectedStudentDetails.kpis.examsTakenCount}
                    </div>
                  </div>
                  <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
                    <div className="text-[13.5px] font-medium text-slate-500">Average Percentage</div>
                    <div className={`${getKpiPrimaryValueClass(`${selectedStudentDetails.kpis.averagePercentage}%`)} text-emerald-600 dark:text-emerald-400 mt-1 tabular-nums`}>
                      {selectedStudentDetails.kpis.averagePercentage}%
                    </div>
                  </div>
                  <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
                    <div className="text-[13.5px] font-medium text-slate-500">Published Results</div>
                    <div className={`${getKpiPrimaryValueClass(selectedStudentDetails.kpis.publishedResultsCount)} text-indigo-600 dark:text-indigo-400 mt-1 tabular-nums`}>
                      {selectedStudentDetails.kpis.publishedResultsCount}
                    </div>
                  </div>
                  <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
                    <div className="text-[13.5px] font-medium text-slate-500">Queries Raised</div>
                    <div className={`${getKpiPrimaryValueClass(selectedStudentDetails.kpis.queriesCount)} text-amber-600 dark:text-amber-400 mt-1 tabular-nums`}>
                      {selectedStudentDetails.kpis.queriesCount}
                    </div>
                  </div>
                </div>

                <div>
                  <h4 className="text-[15px] font-semibold text-slate-900 dark:text-white mb-2.5">
                    Examination Results ({selectedStudentDetails.results.length})
                  </h4>
                  <div className="border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden">
                    <table className="w-full text-left border-collapse text-[14px]">
                      <thead>
                        <tr className="bg-slate-50 dark:bg-slate-900/50 text-slate-500 text-[13px] font-semibold">
                          <th className="py-2.5 px-3.5">Subject</th>
                          <th className="py-2.5 px-3.5">Score</th>
                          <th className="py-2.5 px-3.5">Grade</th>
                          <th className="py-2.5 px-3.5">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
                        {selectedStudentDetails.results.map(r => (
                          <tr key={r.id}>
                            <td className="py-2.5 px-3.5 font-medium text-slate-900 dark:text-white">
                              {r.subjectTitle}
                            </td>
                            <td className="py-2.5 px-3.5 font-semibold text-slate-800 dark:text-slate-200 tabular-nums">
                              {r.score} / {r.totalMarks} ({r.percentage}%)
                            </td>
                            <td className="py-2.5 px-3.5 font-semibold text-blue-600 dark:text-blue-400">
                              {r.grade}
                            </td>
                            <td className="py-2.5 px-3.5">
                              <span
                                className={`px-2 py-0.5 rounded-md text-[12.5px] font-medium ${
                                  r.status === 'PUBLISHED'
                                    ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
                                    : 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
                                }`}
                              >
                                {r.status}
                              </span>
                            </td>
                          </tr>
                        ))}
                        {selectedStudentDetails.results.length === 0 && (
                          <tr>
                            <td colSpan={4} className="py-5 text-center text-slate-400 text-[14px]">
                              No examination results recorded for this student yet.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Assigned Examinations Summary */}
                <div>
                  <h4 className="text-[15px] font-semibold text-slate-900 dark:text-white mb-2.5">
                    Assigned Examinations ({selectedStudentDetails.recentExams?.length || 0})
                  </h4>
                  <div className="border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden">
                    <table className="w-full text-left border-collapse text-[14px]">
                      <thead>
                        <tr className="bg-slate-50 dark:bg-slate-900/50 text-slate-500 text-[13px] font-semibold">
                          <th className="py-2.5 px-3.5">Exam Title</th>
                          <th className="py-2.5 px-3.5">Subject</th>
                          <th className="py-2.5 px-3.5">Duration</th>
                          <th className="py-2.5 px-3.5">Total Marks</th>
                          <th className="py-2.5 px-3.5">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
                        {(selectedStudentDetails.recentExams || []).map(ex => (
                          <tr key={ex.id}>
                            <td className="py-2.5 px-3.5 font-medium text-slate-900 dark:text-white">
                              {ex.title}
                            </td>
                            <td className="py-2.5 px-3.5 text-slate-600 dark:text-slate-300">
                              {ex.subject}
                            </td>
                            <td className="py-2.5 px-3.5 text-slate-500 tabular-nums">
                              {ex.durationMinutes} mins
                            </td>
                            <td className="py-2.5 px-3.5 text-slate-600 dark:text-slate-300 tabular-nums">
                              {ex.totalMarks}
                            </td>
                            <td className="py-2.5 px-3.5">
                              <span className="px-2 py-0.5 rounded-md text-[12.5px] font-medium bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
                                {ex.status}
                              </span>
                            </td>
                          </tr>
                        ))}
                        {(!selectedStudentDetails.recentExams || selectedStudentDetails.recentExams.length === 0) && (
                          <tr>
                            <td colSpan={5} className="py-5 text-center text-slate-400 text-[14px]">
                              No assigned examinations found for this student.
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
            }
          });
        }}
        canPublish={true}
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

      <ConfirmModal />
    </div>
  );
};
