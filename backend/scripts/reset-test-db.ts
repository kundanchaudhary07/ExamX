import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';

function extractDatabaseName(uri: string): string {
  const trimmed = uri.trim();
  const parsed = new URL(trimmed);
  const dbName = parsed.pathname.replace(/^\/+/, '').split('?')[0];
  return dbName || '';
}

export function assertSafeTestDatabaseUri(uri: string): string {
  const candidate = (uri || '').trim();
  if (!candidate) {
    throw new Error('MONGODB_URI is required to reset the local test database.');
  }

  const dbName = extractDatabaseName(candidate);
  const isSafe = Boolean(dbName) && dbName.toLowerCase().endsWith('_test');

  if (!isSafe) {
    throw new Error(
      `Refusing to reset non-test database "${dbName || '<unknown>'}". Only dedicated test databases such as "examx_test" are allowed.`
    );
  }

  return candidate;
}

export async function resetTestDatabase(uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/examx_test'): Promise<void> {
  const safeUri = assertSafeTestDatabaseUri(uri);

  await mongoose.connect(safeUri, { serverSelectionTimeoutMS: 15000 });

  const db = mongoose.connection.db;
  if (!db) {
    throw new Error('Database handle unavailable while resetting the test database.');
  }

  await db.dropDatabase();
  console.log(`Reset test database: ${safeUri}`);
  await mongoose.disconnect();
}

const isDirectExecution =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isDirectExecution) {
  resetTestDatabase().catch((error) => {
    console.error('Failed to reset database for test suite:', error);
    process.exit(1);
  });
}
