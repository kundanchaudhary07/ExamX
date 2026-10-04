import { jsPDF } from 'jspdf';
import { AiGenerationBatch, Question } from '../types';

const PAGE_MARGIN = 16;
const FOOTER_MARGIN = 14;

export function buildQuestionBatchPdf(
  batch: AiGenerationBatch,
  questions: Question[]
): jsPDF {
  if (!questions.length) throw new Error('There are no questions in this batch to download.');

  const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const contentWidth = pageWidth - PAGE_MARGIN * 2;
  let y = PAGE_MARGIN;

  const addPage = () => {
    pdf.addPage();
    y = PAGE_MARGIN;
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(9);
    pdf.text('ExamX / Question Bank (continued)', PAGE_MARGIN, y);
    y += 8;
    pdf.setDrawColor(210, 218, 230);
    pdf.line(PAGE_MARGIN, y, pageWidth - PAGE_MARGIN, y);
    y += 7;
  };

  const writeBlock = (text: string, fontSize: number, bold = false, indent = 0) => {
    pdf.setFont('helvetica', bold ? 'bold' : 'normal');
    pdf.setFontSize(fontSize);
    const lines = pdf.splitTextToSize(text, contentWidth - indent) as string[];
    const lineHeight = fontSize * 0.42;
    for (const line of lines) {
      if (y + lineHeight > pageHeight - FOOTER_MARGIN) addPage();
      pdf.text(line, PAGE_MARGIN + indent, y);
      y += lineHeight;
    }
    y += 2;
  };

  writeBlock('ExamX / Question Bank', 18, true);
  writeBlock(`Subject: ${batch.subject}`, 11, true);
  writeBlock(`Course: ${batch.course}    Semester: ${batch.semester}`, 10);
  writeBlock(`Difficulty: ${batch.difficulty}    Topic: ${batch.topic}`, 10);
  writeBlock(`Questions: ${questions.length}    Marks per question: ${batch.marksPerQuestion}`, 10);
  writeBlock(`Generated: ${new Date(batch.generatedAt).toLocaleString()}`, 9);
  y += 3;
  pdf.setDrawColor(180, 190, 205);
  pdf.line(PAGE_MARGIN, y, pageWidth - PAGE_MARGIN, y);
  y += 8;

  questions.forEach((question, index) => {
    writeBlock(
      `Question ${index + 1} - ${question.questionId || question.id} - ${question.marks ?? batch.marksPerQuestion} marks`,
      11,
      true
    );
    writeBlock(question.text, 10);
    question.options.forEach((option, optionIndex) => {
      writeBlock(`${String.fromCharCode(65 + optionIndex)}. ${option}`, 9, false, 4);
    });
    y += 3;
  });

  const pageCount = pdf.getNumberOfPages();
  for (let page = 1; page <= pageCount; page += 1) {
    pdf.setPage(page);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(8);
    pdf.setTextColor(110, 120, 135);
    pdf.text(
      `Generated ${new Date(batch.generatedAt).toLocaleDateString()} · Page ${page} of ${pageCount}`,
      pageWidth - PAGE_MARGIN,
      pageHeight - 7,
      { align: 'right' }
    );
  }

  return pdf;
}

export function downloadQuestionBatchPdf(
  batch: AiGenerationBatch,
  questions: Question[]
): void {
  const safeSubject = batch.subject.replace(/[^\p{L}\p{N}-]+/gu, '-').replace(/^-|-$/g, '') || 'questions';
  buildQuestionBatchPdf(batch, questions).save(`ExamX-${safeSubject}-${batch.generationId}.pdf`);
}
