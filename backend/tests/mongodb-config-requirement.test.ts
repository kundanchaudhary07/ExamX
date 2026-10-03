import assert from 'node:assert/strict';
import { connectDatabase, disconnectDatabase } from '../src/config/database';
import { resetTestDatabase } from '../scripts/reset-test-db';

async function run() {
  const previousMongoUri = process.env.MONGODB_URI;
  const previousAllowEmbedded = process.env.ALLOW_EMBEDDED_MONGO;

  try {
    delete process.env.MONGODB_URI;
    delete process.env.ALLOW_EMBEDDED_MONGO;

    await assert.rejects(
      connectDatabase(),
      /MONGODB_URI is required for normal local development/i,
      'Normal local development should fail clearly when MONGODB_URI is missing'
    );

    await assert.rejects(
      () => resetTestDatabase('mongodb://localhost:27017/examx'),
      /Refusing to reset non-test database/i,
      'Reset script must refuse to operate on the normal development database'
    );

    console.log('✓ Missing MONGODB_URI fails clearly during local dev');
    console.log('✓ Reset guard refuses to touch the development database');
  } finally {
    if (previousMongoUri === undefined) {
      delete process.env.MONGODB_URI;
    } else {
      process.env.MONGODB_URI = previousMongoUri;
    }

    if (previousAllowEmbedded === undefined) {
      delete process.env.ALLOW_EMBEDDED_MONGO;
    } else {
      process.env.ALLOW_EMBEDDED_MONGO = previousAllowEmbedded;
    }

    await disconnectDatabase().catch(() => {});
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
