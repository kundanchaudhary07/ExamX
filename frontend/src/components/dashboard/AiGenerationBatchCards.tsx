import React, { useMemo, useState } from 'react';
import { Download, FileText, Loader2, Sparkles } from 'lucide-react';
import { AiGenerationBatch, Question } from '../../types';
import { dbService } from '../../services/dbService';
import { Modal, StatusBadge } from '../common/SharedUI';

interface AiGenerationBatchCardsProps {
  batches: AiGenerationBatch[];
  search?: string;
  subject?: string;
  questionSearchTextByBatch?: Record<string, string>;
  unbatchedQuestions?: Question[];
  onViewQuestion?: (question: Question) => void;
  onEditQuestion?: (question: Question) => void;
  onDeleteQuestion?: (question: Question) => void;
  onReviewBatch?: () => void;
  emptyMessage?: string;
}

export const AiGenerationBatchCards: React.FC<AiGenerationBatchCardsProps> = ({
  batches,
  search: controlledSearch,
  subject: controlledSubject,
  questionSearchTextByBatch = {},
  unbatchedQuestions = [],
  onViewQuestion,
  onEditQuestion,
  onDeleteQuestion,
  onReviewBatch,
  emptyMessage = 'No AI generation batches yet.'
}) => {
  const [questionsByBatch, setQuestionsByBatch] = useState<Record<string, Question[]>>({});
  const [loadingBatchIds, setLoadingBatchIds] = useState<Set<string>>(new Set());
  const [loadErrors, setLoadErrors] = useState<Record<string, string>>({});
  const [selectedBatch, setSelectedBatch] = useState<AiGenerationBatch | null>(null);
  const [pdfError, setPdfError] = useState('');
  const [isDownloadingPdf, setIsDownloadingPdf] = useState(false);
  const [localSearch, setLocalSearch] = useState('');
  const [localSubject, setLocalSubject] = useState('ALL');
  const [courseFilter, setCourseFilter] = useState('ALL');
  const [semesterFilter, setSemesterFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const effectiveSubject = controlledSubject ?? localSubject;
  const effectiveSearch = controlledSearch ?? localSearch;
  const subjects = Array.from(new Set(batches.map((batch) => batch.subject))).sort();
  const courses = Array.from(new Set(batches.map((batch) => batch.course))).sort();
  const semesters = Array.from(new Set(batches.map((batch) => batch.semester))).sort();
  const statuses = Array.from(new Set<string>(batches.map((batch) => batch.reviewStatus))).sort();

  const filteredBatches = useMemo(() => {
    const term = effectiveSearch.trim().toLocaleLowerCase();
    return batches.filter((batch) => {
      if (effectiveSubject !== 'ALL' && batch.subject.toLocaleLowerCase() !== effectiveSubject.toLocaleLowerCase()) return false;
      if (courseFilter !== 'ALL' && batch.course !== courseFilter) return false;
      if (semesterFilter !== 'ALL' && batch.semester !== semesterFilter) return false;
      if (statusFilter !== 'ALL' && batch.reviewStatus !== statusFilter) return false;
      if (!term) return true;
      return [
        batch.generationId,
        batch.subject,
        batch.course,
        batch.semester,
        batch.topic,
        batch.sourceFileName,
        batch.generatedByName,
        batch.generatedBy,
        batch.reviewStatus
      ].some((value) => value.toLocaleLowerCase().includes(term)) ||
        (questionSearchTextByBatch[batch.generationId] || '').toLocaleLowerCase().includes(term);
    });
  }, [batches, courseFilter, effectiveSearch, effectiveSubject, questionSearchTextByBatch, semesterFilter, statusFilter]);

  const openBatch = async (batch: AiGenerationBatch) => {
    setSelectedBatch(batch);
    setPdfError('');
    const generationId = batch.generationId;
    if (questionsByBatch[generationId] || loadingBatchIds.has(generationId)) return;
    setLoadingBatchIds((current) => new Set(current).add(generationId));
    setLoadErrors((current) => ({ ...current, [generationId]: '' }));
    try {
      const questions = await dbService.getAiGenerationBatchQuestions(generationId);
      setQuestionsByBatch((current) => ({ ...current, [generationId]: questions }));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to load this generation batch.';
      setLoadErrors((current) => ({ ...current, [generationId]: message }));
    } finally {
      setLoadingBatchIds((current) => {
        const next = new Set(current);
        next.delete(generationId);
        return next;
      });
    }
  };

  const downloadSelectedBatch = async () => {
    if (!selectedBatch) return;
    const questions = questionsByBatch[selectedBatch.generationId];
    if (!questions?.length) {
      setPdfError('Questions are not available to download yet.');
      return;
    }
    setIsDownloadingPdf(true);
    setPdfError('');
    try {
      const { downloadQuestionBatchPdf } = await import('../../utils/questionBatchPdf');
      await downloadQuestionBatchPdf(selectedBatch, questions);
    } catch (error) {
      setPdfError(error instanceof Error ? error.message : 'Unable to create this PDF.');
    } finally {
      setIsDownloadingPdf(false);
    }
  };

  if (!filteredBatches.length && !unbatchedQuestions.length) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white px-6 py-10 text-center text-[14px] text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
        {emptyMessage}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {controlledSearch === undefined && (
          <input
            type="search"
            value={localSearch}
            onChange={(event) => setLocalSearch(event.target.value)}
            placeholder="Search batches..."
            aria-label="Search AI generation batches"
            className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-[13px] text-slate-800 outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
          />
        )}
        {controlledSubject === undefined && (
          <select
            value={localSubject}
            onChange={(event) => setLocalSubject(event.target.value)}
            aria-label="Filter batches by subject"
            className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-[13px] text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
          >
            <option value="ALL">All Subjects</option>
            {subjects.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        )}
        <select
          value={courseFilter}
          onChange={(event) => setCourseFilter(event.target.value)}
          aria-label="Filter batches by course"
          className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-[13px] text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
        >
          <option value="ALL">All Courses</option>
          {courses.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
        <select
          value={semesterFilter}
          onChange={(event) => setSemesterFilter(event.target.value)}
          aria-label="Filter batches by semester"
          className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-[13px] text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
        >
          <option value="ALL">All Semesters</option>
          {semesters.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
        <select
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value)}
          aria-label="Filter batches by review status"
          className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-[13px] text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
        >
          <option value="ALL">All Review Statuses</option>
          {statuses.map((item) => <option key={item} value={item}>{item.replace(/_/g, ' ')}</option>)}
        </select>
      </div>
      {filteredBatches.map((batch) => {
        return (
          <section key={batch.generationId} className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800">
            <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex min-w-0 gap-3">
                <span className="mt-0.5 rounded-lg bg-purple-50 p-2.5 text-purple-600 dark:bg-purple-900/30 dark:text-purple-300">
                  <Sparkles className="h-5 w-5" />
                </span>
                <div className="min-w-0">
                  <p className="text-[12px] font-medium uppercase tracking-wide text-purple-700 dark:text-purple-300">
                    AI Generation Batch · {batch.generationId}
                  </p>
                  <h3 className="mt-0.5 break-words text-[17px] font-semibold text-slate-900 dark:text-white">{batch.subject}</h3>
                  <p className="mt-1 text-[13.5px] text-slate-600 dark:text-slate-300">
                    {batch.generatedCount} Questions · {batch.difficulty} · {batch.marksPerQuestion} Mark{batch.marksPerQuestion === 1 ? '' : 's'}/Q
                  </p>
                  <p className="text-[13px] text-slate-500 dark:text-slate-400">
                    {batch.course} · {batch.semester} · Topic: {batch.topic}
                  </p>
                  <p className="mt-1 flex items-center gap-1.5 text-[13px] text-slate-500 dark:text-slate-400">
                    <FileText className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{batch.sourceFileName}</span>
                  </p>
                  <p className="mt-1 text-[12.5px] text-slate-500 dark:text-slate-400">
                    Generated by {batch.generatedByName} · {new Date(batch.generatedAt).toLocaleString()}
                  </p>
                  <p className="text-[12px] text-slate-500 dark:text-slate-400">
                    Provider: {batch.provider} · Model: {batch.aiModel}
                  </p>
                  {batch.legacy && (
                    <p className="mt-1 text-[12px] font-medium text-amber-700 dark:text-amber-300">
                      Historical run matched to its generation audit
                    </p>
                  )}
                </div>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
                <StatusBadge status={batch.reviewStatus === 'PENDING_REVIEW' ? 'PENDING' : batch.reviewStatus} />
                <span className="text-[12px] text-slate-500 dark:text-slate-400">
                  {batch.approvedCount} approved · {batch.pendingCount} pending · {batch.discardedCount} discarded
                </span>
                <button
                  type="button"
                  onClick={() => void openBatch(batch)}
                  className="h-9 rounded-lg border border-slate-200 px-3 text-[13.5px] font-medium text-blue-700 hover:bg-blue-50 dark:border-slate-700 dark:text-blue-300 dark:hover:bg-slate-700"
                >
                  View Questions
                </button>
              </div>
            </div>
          </section>
        );
      })}
      {unbatchedQuestions.length > 0 && (
        <section className="overflow-hidden rounded-xl border border-amber-300 bg-amber-50/70 dark:border-amber-800 dark:bg-amber-950/20">
          <div className="border-b border-amber-200 px-5 py-4 dark:border-amber-800">
            <h3 className="text-[15px] font-semibold text-amber-900 dark:text-amber-200">
              AI questions without a verifiable generation batch ({unbatchedQuestions.length})
            </h3>
            <p className="mt-1 text-[12.5px] text-amber-800 dark:text-amber-300">
              No exact matching generation audit was found; these questions are kept separate rather than grouped into an assumed run.
            </p>
          </div>
          <div className="space-y-3 p-4">
            {unbatchedQuestions.map((question) => (
              <article key={question.questionId || question.id} className="rounded-lg border border-amber-200 bg-white p-4 dark:border-amber-800 dark:bg-slate-800">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[12.5px] font-medium text-slate-500 dark:text-slate-400">
                    {question.questionId || question.id} · {question.subject} · {question.topic}
                  </p>
                  <span className="text-[12px] text-slate-500 dark:text-slate-400">
                    {question.difficulty} · {question.marks} marks · {question.status}
                  </span>
                </div>
                <p className="mt-2 break-words text-[14px] font-medium text-slate-900 dark:text-white">{question.text}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {onViewQuestion && (
                    <button type="button" onClick={() => onViewQuestion(question)} className="text-[12.5px] font-medium text-blue-700 hover:underline dark:text-blue-300">
                      View
                    </button>
                  )}
                  {onEditQuestion && (
                    <button type="button" onClick={() => onEditQuestion(question)} className="text-[12.5px] font-medium text-blue-700 hover:underline dark:text-blue-300">
                      Edit
                    </button>
                  )}
                  {onDeleteQuestion && (
                    <button type="button" onClick={() => onDeleteQuestion(question)} className="text-[12.5px] font-medium text-red-700 hover:underline dark:text-red-300">
                      Delete
                    </button>
                  )}
                </div>
              </article>
            ))}
          </div>
        </section>
      )}
      <Modal
        isOpen={!!selectedBatch}
        onClose={() => setSelectedBatch(null)}
        title="Generation Batch Questions"
        subtitle={selectedBatch ? `${selectedBatch.subject} · ${selectedBatch.generationId}` : undefined}
        size="large"
        actions={(
          <button
            type="button"
            onClick={() => void downloadSelectedBatch()}
            disabled={!selectedBatch || !questionsByBatch[selectedBatch.generationId]?.length || isDownloadingPdf}
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-blue-600 px-3 text-[13px] font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isDownloadingPdf ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            Download PDF
          </button>
        )}
      >
        {selectedBatch && (
          <>
            <div className="grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-[13px] dark:border-slate-700 dark:bg-slate-900/60 sm:grid-cols-2 lg:grid-cols-3">
              <p><span className="font-semibold">Subject:</span> {selectedBatch.subject}</p>
              <p><span className="font-semibold">Questions:</span> {selectedBatch.generatedCount}</p>
              <p><span className="font-semibold">Course:</span> {selectedBatch.course}</p>
              <p><span className="font-semibold">Semester:</span> {selectedBatch.semester}</p>
              <p><span className="font-semibold">Difficulty:</span> {selectedBatch.difficulty}</p>
              <p><span className="font-semibold">Marks:</span> {selectedBatch.marksPerQuestion} per question</p>
              <p><span className="font-semibold">Topic:</span> {selectedBatch.topic}</p>
              <p><span className="font-semibold">Generated by:</span> {selectedBatch.generatedByName}</p>
              <p><span className="font-semibold">Provider:</span> {selectedBatch.provider} · {selectedBatch.aiModel}</p>
              <p className="sm:col-span-2 lg:col-span-3">
                <span className="font-semibold">Generated:</span> {new Date(selectedBatch.generatedAt).toLocaleString()}
              </p>
            </div>
            {pdfError && <p role="alert" className="rounded-lg bg-red-50 p-3 text-[13px] text-red-700 dark:bg-red-950/30 dark:text-red-300">{pdfError}</p>}
            {loadingBatchIds.has(selectedBatch.generationId) && (
              <p className="py-8 text-center text-[13px] text-slate-500">Loading questions…</p>
            )}
            {loadErrors[selectedBatch.generationId] && (
              <p role="alert" className="rounded-lg bg-red-50 p-3 text-[13px] text-red-700 dark:bg-red-950/30 dark:text-red-300">
                {loadErrors[selectedBatch.generationId]}
              </p>
            )}
            {(questionsByBatch[selectedBatch.generationId] || []).map((question, index) => (
              <article key={question.questionId || question.id} className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[12.5px] font-medium text-slate-500 dark:text-slate-400">
                    Question {index + 1} · {question.questionId || question.id}
                  </p>
                  <span className="text-[12px] text-slate-500 dark:text-slate-400">
                    {question.difficulty} · {question.marks ?? selectedBatch.marksPerQuestion} marks · {question.status}
                  </span>
                </div>
                <p className="mt-2 break-words text-[14px] font-medium text-slate-900 dark:text-white">{question.text}</p>
                <ol className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1 text-[13px] text-slate-600 dark:text-slate-300 sm:grid-cols-2">
                  {question.options.map((option, optionIndex) => (
                    <li key={`${question.id}-${optionIndex}`} className="break-words">
                      {String.fromCharCode(65 + optionIndex)}. {option}
                    </li>
                  ))}
                </ol>
                <p className="mt-2 text-[12px] text-slate-500 dark:text-slate-400">
                  {question.reviewStatus === 'APPROVED' ? 'Approved' : question.reviewStatus === 'DISCARDED' ? 'Discarded' : 'Pending teacher review'}
                </p>
                <div className="mt-3 flex flex-wrap gap-3">
                  {onViewQuestion && (
                    <button type="button" onClick={() => onViewQuestion(question)} className="text-[12.5px] font-medium text-blue-700 hover:underline dark:text-blue-300">
                      View
                    </button>
                  )}
                  {onEditQuestion && (
                    <button type="button" onClick={() => onEditQuestion(question)} className="text-[12.5px] font-medium text-blue-700 hover:underline dark:text-blue-300">
                      Edit
                    </button>
                  )}
                  {onDeleteQuestion && (
                    <button type="button" onClick={() => onDeleteQuestion(question)} className="text-[12.5px] font-medium text-red-700 hover:underline dark:text-red-300">
                      Delete
                    </button>
                  )}
                </div>
              </article>
            ))}
            {!loadingBatchIds.has(selectedBatch.generationId) &&
              !loadErrors[selectedBatch.generationId] &&
              questionsByBatch[selectedBatch.generationId]?.length === 0 && (
                <p className="py-8 text-center text-[13px] text-slate-500">This generation batch has no questions.</p>
              )}
            {questionsByBatch[selectedBatch.generationId]?.length && selectedBatch.pendingCount > 0 && onReviewBatch && (
              <div className="flex justify-end">
                <button type="button" onClick={onReviewBatch} className="text-[13px] font-medium text-blue-700 hover:underline dark:text-blue-300">
                  Review pending questions
                </button>
              </div>
            )}
          </>
        )}
      </Modal>
    </div>
  );
};
