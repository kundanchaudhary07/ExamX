import { randomUUID } from 'crypto';
import { JwtUserPayload } from '../types/auth.types';
import { Syllabus, ISyllabusDocument } from '../models/Syllabus';
import { ExamService } from './exam.service';
import { UploadedSyllabusInput, validateAndExtractSyllabus } from '../utils/syllabusExtractor';
import { SubjectService } from './subject.service';
import {
  checkSyllabusSubjectCompatibility,
  SyllabusSubjectCompatibility
} from '../utils/syllabusSubjectCompatibility';

export interface SyllabusMetadata {
  syllabusId: string;
  course: string;
  semester: string;
  subject: string;
  fileName: string;
  fileType: 'PDF' | 'DOCX' | 'TXT';
  charCount: number;
  wordCount: number;
  uploadedAt: Date;
}

export interface SyllabusUploadMetadata extends SyllabusMetadata {
  subjectCompatibility: SyllabusSubjectCompatibility;
}

export class SyllabusService {
  static async upload(
    file: UploadedSyllabusInput | undefined | null,
    metadata: { course?: string; semester?: string; subject?: string },
    user: JwtUserPayload
  ): Promise<SyllabusUploadMetadata> {
    if (user.role !== 'TEACHER' && user.role !== 'ADMIN') {
      const err: any = new Error('Only teachers and administrators may upload syllabi.');
      err.statusCode = 403;
      throw err;
    }

    const extracted = await validateAndExtractSyllabus(file);
    const subject = typeof metadata.subject === 'string' ? metadata.subject.trim() : '';
    if (!metadata.course || !metadata.semester || !subject) {
      const err: any = new Error('Course, semester, and subject are required when uploading a syllabus.');
      err.statusCode = 400;
      throw err;
    }

    const wordCount = extracted.text.split(/\s+/).filter(Boolean).length;
    if (extracted.charCount < 80 || wordCount < 12) {
      const err: any = new Error('The uploaded syllabus does not contain enough extracted text to be stored for question generation.');
      err.statusCode = 400;
      err.code = 'INSUFFICIENT_SYLLABUS_CONTEXT';
      throw err;
    }
    const normalizedSubject = await SubjectService.ensure(subject, user.userId);
    const syllabus = await Syllabus.create({
      syllabusId: `SYL-${randomUUID()}`,
      uploadedBy: user.userId,
      uploadedByRole: user.role,
      course: ExamService.normalizeCourse(metadata.course),
      semester: ExamService.normalizeSemester(metadata.semester),
      subject: normalizedSubject,
      fileName: extracted.fileName,
      fileType: extracted.fileType,
      charCount: extracted.charCount,
      wordCount,
      extractedText: extracted.text
    });

    return {
      ...this.toMetadata(syllabus),
      subjectCompatibility: checkSyllabusSubjectCompatibility(normalizedSubject, extracted.text)
    };
  }

  static async getForUser(syllabusId: string, user: JwtUserPayload): Promise<ISyllabusDocument> {
    const syllabus = await Syllabus.findOne({ syllabusId }).select('+extractedText');
    if (!syllabus) {
      const err: any = new Error('Syllabus was not found. Upload it again to continue.');
      err.statusCode = 404;
      throw err;
    }
    if (user.role === 'TEACHER' && syllabus.uploadedBy !== user.userId) {
      const err: any = new Error('You are not authorized to use this syllabus.');
      err.statusCode = 403;
      throw err;
    }
    return syllabus;
  }

  static toMetadata(syllabus: ISyllabusDocument): SyllabusMetadata {
    return {
      syllabusId: syllabus.syllabusId,
      course: syllabus.course,
      semester: syllabus.semester,
      subject: syllabus.subject,
      fileName: syllabus.fileName,
      fileType: syllabus.fileType,
      charCount: syllabus.charCount,
      wordCount: syllabus.wordCount,
      uploadedAt: syllabus.createdAt
    };
  }
}
