import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { User } from '../models/User';
import { Exam } from '../models/Exam';
import { Question } from '../models/Question';
import { ExamAssignment } from '../models/ExamAssignment';
import { ExamAttempt } from '../models/ExamAttempt';
import { Result } from '../models/Result';
import { StudentQuery } from '../models/StudentQuery';
import { ProctoringEvent } from '../models/ProctoringEvent';
import { AuditLog } from '../models/AuditLog';
import { isDatabaseConnected, isUsingEmbeddedDatabase } from './database';
import { logger } from '../utils/logger';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.resolve(__dirname, '../../../.data');
const SNAPSHOT_FILE = path.join(DATA_DIR, 'db-snapshot.json');

let persistenceEnabled = false;
let saveTimer: NodeJS.Timeout | null = null;
let isSaving = false;

export function enableDatabasePersistence(): void {
  persistenceEnabled = true;
}

export function isPersistenceEnabled(): boolean {
  return persistenceEnabled;
}

export async function saveDatabaseSnapshot(): Promise<void> {
  if (!persistenceEnabled || !isUsingEmbeddedDatabase() || !isDatabaseConnected() || isSaving) {
    return;
  }

  isSaving = true;
  try {
    const [
      users,
      exams,
      questions,
      assignments,
      attempts,
      results,
      queries,
      proctoringEvents,
      auditLogs
    ] = await Promise.all([
      User.find({}).select('+passwordHash').lean(),
      Exam.find({}).lean(),
      Question.find({}).lean(),
      ExamAssignment.find({}).lean(),
      ExamAttempt.find({}).lean(),
      Result.find({}).lean(),
      StudentQuery.find({}).lean(),
      ProctoringEvent.find({}).lean(),
      AuditLog.find({}).lean()
    ]);

    await fs.promises.mkdir(DATA_DIR, { recursive: true });
    const tempFile = `${SNAPSHOT_FILE}.tmp`;
    await fs.promises.writeFile(
      tempFile,
      JSON.stringify(
        {
          updatedAt: new Date().toISOString(),
          users,
          exams,
          questions,
          assignments,
          attempts,
          results,
          queries,
          proctoringEvents,
          auditLogs
        },
        null,
        2
      ),
      'utf8'
    );
    await fs.promises.rename(tempFile, SNAPSHOT_FILE);
  } catch (err: any) {
    logger.info(`Snapshot save skipped: ${err.message}`);
  } finally {
    isSaving = false;
  }
}

export function scheduleSnapshotSave(delayMs = 150): void {
  if (!persistenceEnabled || !isUsingEmbeddedDatabase()) {
    return;
  }
  if (saveTimer) {
    clearTimeout(saveTimer);
  }
  saveTimer = setTimeout(() => {
    saveTimer = null;
    saveDatabaseSnapshot().catch(() => {});
  }, delayMs);
}

async function restoreModelCollection(Model: any, docs: any[] | undefined): Promise<number> {
  if (!Array.isArray(docs) || docs.length === 0) {
    return 0;
  }

  const ops = docs.map(rawDoc => {
    const hydrated = Model.hydrate(rawDoc);
    const obj = hydrated.toObject();
    return {
      replaceOne: {
        filter: { _id: obj._id },
        replacement: obj,
        upsert: true
      }
    };
  });

  if (ops.length > 0) {
    await Model.collection.bulkWrite(ops, { ordered: false });
  }
  return ops.length;
}

export async function restoreDatabaseSnapshot(): Promise<void> {
  if (!persistenceEnabled || !isUsingEmbeddedDatabase() || !isDatabaseConnected()) {
    return;
  }

  if (!fs.existsSync(SNAPSHOT_FILE)) {
    return;
  }

  try {
    const raw = await fs.promises.readFile(SNAPSHOT_FILE, 'utf8');
    const snapshot = JSON.parse(raw);

    const restoredUsers = await restoreModelCollection(User, snapshot.users);
    const restoredQuestions = await restoreModelCollection(Question, snapshot.questions);
    const restoredExams = await restoreModelCollection(Exam, snapshot.exams);
    await restoreModelCollection(ExamAssignment, snapshot.assignments);
    await restoreModelCollection(ExamAttempt, snapshot.attempts);
    await restoreModelCollection(Result, snapshot.results);
    await restoreModelCollection(StudentQuery, snapshot.queries);
    await restoreModelCollection(ProctoringEvent, snapshot.proctoringEvents);
    await restoreModelCollection(AuditLog, snapshot.auditLogs);

    logger.info(
      `Restored persistent database snapshot (${restoredUsers} users, ${restoredExams} exams, ${restoredQuestions} questions).`
    );
  } catch (err: any) {
    logger.info(`Could not restore database snapshot: ${err.message}`);
  }
}
