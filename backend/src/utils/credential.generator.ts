import { User } from '../models/User';

export const TEACHER_ID_REGEX = /^1251[0-9]{4}$/;
export const STUDENT_ID_REGEX = /^1261[0-9]{4}$/;

/**
 * Validates Teacher ID format:
 * - Exactly 8 digits
 * - Numbers only
 * - Must start with 1251
 * Pattern: ^1251[0-9]{4}$
 */
export function isValidTeacherId(id: string): boolean {
  if (!id || typeof id !== 'string') return false;
  return TEACHER_ID_REGEX.test(id.trim());
}

/**
 * Validates Student ID format:
 * - Exactly 8 digits
 * - Numbers only
 * - Must start with 1261
 * Pattern: ^1261[0-9]{4}$
 */
export function isValidStudentId(id: string): boolean {
  if (!id || typeof id !== 'string') return false;
  return STUDENT_ID_REGEX.test(id.trim());
}

/**
 * Extracts a 4-digit calendar year from either a 4-digit year (e.g. 1985) or date string (e.g. "1985-05-12")
 */
export function extractBirthYear(dobOrYear?: number | string): number {
  if (dobOrYear === undefined || dobOrYear === null || String(dobOrYear).trim() === '') {
    const err: any = new Error('DOB or DOB Year is required to generate initial password');
    err.statusCode = 400;
    throw err;
  }

  const raw = String(dobOrYear).trim();
  const yearCandidate = raw.includes('-') ? raw.split('-')[0] : raw;

  if (!/^[12][0-9]{3}$/.test(yearCandidate)) {
    const err: any = new Error('DOB Year must be a valid 4-digit calendar year (e.g., 1985, 2004)');
    err.statusCode = 400;
    throw err;
  }

  return parseInt(yearCandidate, 10);
}

/**
 * Generates initial password using rule:
 * FirstName + "@" + DOB Year
 */
export function generateInitialPassword(name: string, dobYear: number | string): string {
  if (!name || typeof name !== 'string' || !name.trim()) {
    const err: any = new Error('Valid name is required to generate initial password');
    err.statusCode = 400;
    throw err;
  }

  const validYear = extractBirthYear(dobYear);

  // Extract base name: clean first name or single name
  const cleanName = name.trim().split(/\s+/)[0];
  return `${cleanName}@${validYear}`;
}

/**
 * Generates next unique Teacher ID starting with 1251
 * Range: 12510001 to 12519999
 */
export async function generateNextTeacherId(): Promise<string> {
  const latest = await User.find({ userId: { $regex: '^1251[0-9]{4}$' } })
    .sort({ userId: -1 })
    .limit(1)
    .lean();

  let nextSeq = 1;
  if (latest.length > 0 && latest[0]?.userId) {
    const currentSeq = parseInt(latest[0].userId.slice(4), 10);
    if (!isNaN(currentSeq)) {
      nextSeq = currentSeq + 1;
    }
  }

  let candidateId = `1251${String(nextSeq).padStart(4, '0')}`;
  // Collision guard
  while (await User.exists({ userId: candidateId })) {
    nextSeq++;
    if (nextSeq > 9999) {
      throw new Error('Teacher ID sequence capacity (12519999) exhausted');
    }
    candidateId = `1251${String(nextSeq).padStart(4, '0')}`;
  }

  return candidateId;
}

/**
 * Generates next unique Student ID starting with 1261
 * Range: 12610001 to 12619999
 */
export async function generateNextStudentId(): Promise<string> {
  const latest = await User.find({ userId: { $regex: '^1261[0-9]{4}$' } })
    .sort({ userId: -1 })
    .limit(1)
    .lean();

  let nextSeq = 1;
  if (latest.length > 0 && latest[0]?.userId) {
    const currentSeq = parseInt(latest[0].userId.slice(4), 10);
    if (!isNaN(currentSeq)) {
      nextSeq = currentSeq + 1;
    }
  }

  let candidateId = `1261${String(nextSeq).padStart(4, '0')}`;
  // Collision guard
  while (await User.exists({ userId: candidateId })) {
    nextSeq++;
    if (nextSeq > 9999) {
      throw new Error('Student ID sequence capacity (12619999) exhausted');
    }
    candidateId = `1261${String(nextSeq).padStart(4, '0')}`;
  }

  return candidateId;
}
