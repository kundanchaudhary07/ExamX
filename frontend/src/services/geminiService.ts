import { Question, Difficulty } from '../types';
import { dbService } from './dbService';

export interface GenerateQuestionsOptions {
  syllabusId: string;
  subject: string;
  course: string;
  semester: string;
  topic?: string;
  questionType?: 'MCQ';
}

/**
 * Generates adaptive assessment questions exclusively via the secure backend AI service.
 * Generates only from an already uploaded, server-persisted syllabus.
 */
export const generateAdaptiveQuestions = async (
  topic: string,
  difficulty: Difficulty | 'MIXED',
  count: number = 5,
  marks: number = 2,
  options: GenerateQuestionsOptions
): Promise<Question[]> => {
  const response = await dbService.generateAiQuestions({
    syllabusId: options.syllabusId,
    subject: options.subject,
    topic: options.topic || topic,
    course: options.course,
    semester: options.semester,
    difficulty,
    questionType: options.questionType || 'MCQ',
    count,
    marks
  });

  return response.generated;
};

export const generateQuestionsWithAI = generateAdaptiveQuestions;
