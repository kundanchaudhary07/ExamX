import { Exam } from '../models/Exam';
import { Question } from '../models/Question';
import { Subject } from '../models/Subject';
import { Syllabus } from '../models/Syllabus';

export function normalizeSubjectName(value: unknown): string {
  if (typeof value !== 'string') {
    const error: any = new Error('Subject must be text.');
    error.statusCode = 400;
    error.code = 'INVALID_SUBJECT';
    throw error;
  }
  const name = value.trim().replace(/\s+/g, ' ');
  if (!name || /[\u0000-\u001f\u007f]/.test(name) || !/[\p{L}\p{N}]/u.test(name)) {
    const error: any = new Error('Enter a valid, non-empty subject name.');
    error.statusCode = 400;
    error.code = 'INVALID_SUBJECT';
    throw error;
  }
  return name;
}

function subjectKey(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

export class SubjectService {
  static async list(): Promise<string[]> {
    const [registered, questionSubjects, examSubjects, syllabusSubjects] = await Promise.all([
      Subject.find({}).select('name').lean(),
      Question.distinct('subject', { subject: { $type: 'string', $ne: '' } }),
      Exam.distinct('subject', { subject: { $type: 'string', $ne: '' } }),
      Syllabus.distinct('subject', { subject: { $type: 'string', $ne: '' } })
    ]);
    const unique = new Map<string, string>();
    for (const value of [...registered.map((item) => item.name), ...questionSubjects, ...examSubjects, ...syllabusSubjects]) {
      if (typeof value !== 'string') continue;
      try {
        const name = normalizeSubjectName(value);
        const key = subjectKey(name);
        if (!unique.has(key)) unique.set(key, name);
      } catch {
        // Ignore legacy invalid subject values in suggestion results.
      }
    }
    return [...unique.values()].sort((left, right) => left.localeCompare(right));
  }

  static async ensure(value: unknown, createdBy?: string): Promise<string> {
    const name = normalizeSubjectName(value);
    const key = subjectKey(name);
    const existingSuggestions = await this.list();
    const existing = existingSuggestions.find((subject) => subjectKey(subject) === key);
    if (existing) {
      await Subject.updateOne(
        { normalizedName: key },
        { $setOnInsert: { name: existing, normalizedName: key, createdBy } },
        { upsert: true }
      );
      return existing;
    }

    try {
      const registered = await Subject.findOneAndUpdate(
        { normalizedName: key },
        { $setOnInsert: { name, normalizedName: key, createdBy } },
        { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
      );
      return registered?.name || name;
    } catch (error: any) {
      if (error?.code !== 11000) throw error;
      const duplicate = await Subject.findOne({ normalizedName: key }).select('name');
      if (!duplicate) throw error;
      return duplicate.name;
    }
  }
}
