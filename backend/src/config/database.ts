import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { ENV, isEmbeddedMongoAllowed } from './env';
import { logger } from '../utils/logger';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let memoryServer: any = null;
let usingEmbedded = false;
let connectingPromise: Promise<string> | null = null;

export const MONGO_BINARY_CACHE_DIR = path.resolve(
  __dirname,
  '../../../node_modules/.cache/mongodb-memory-server'
);

export async function connectDatabase(): Promise<string> {
  if (mongoose.connection.readyState === 1) {
    return 'Already connected';
  }

  if (connectingPromise) {
    return connectingPromise;
  }

  connectingPromise = (async () => {
    let uri = ENV.MONGODB_URI;

    if (uri) {
      try {
        logger.info('Attempting connection to configured MongoDB URI...');
        await mongoose.connect(uri, { serverSelectionTimeoutMS: 2500 });
        usingEmbedded = false;
        logger.info('MongoDB connected successfully via MONGODB_URI.');
        return uri;
      } catch (err: any) {
        logger.warn(
          `Could not connect to external MONGODB_URI (${err.message}).` +
            (isEmbeddedMongoAllowed() ? ' Proceeding with the test-only embedded fallback.' : '')
        );
        if (!isEmbeddedMongoAllowed()) {
          throw new Error(
            'MONGODB_URI is required for normal local development. Set MONGODB_URI in your .env file before starting the backend. The embedded MongoDB fallback is only allowed for tests.'
          );
        }
      }
    }

    if (!isEmbeddedMongoAllowed()) {
      throw new Error(
        'MONGODB_URI is required for normal local development. Set MONGODB_URI in your .env file before starting the backend. The embedded MongoDB fallback is only allowed for tests.'
      );
    }

    // Test-only embedded fallback. Not used for normal local development.
    try {
      const { MongoMemoryServer } = await import('mongodb-memory-server');
      memoryServer = await MongoMemoryServer.create({
        binary: {
          downloadDir: MONGO_BINARY_CACHE_DIR
        },
        instance: {
          dbName: 'exam_platform',
          args: ['--wiredTigerCacheSizeGB', '0.25']
        }
      });
      uri = memoryServer.getUri();
      await mongoose.connect(uri);
      usingEmbedded = true;
      logger.info('MongoDB connected successfully via embedded instance.');
      return uri;
    } catch (err: any) {
      logger.error('Failed to initialize MongoDB connection:', err.message);
      throw err;
    } finally {
      connectingPromise = null;
    }
  })();

  return connectingPromise;
}

export async function disconnectDatabase(): Promise<void> {
  connectingPromise = null;
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
  if (memoryServer) {
    await memoryServer.stop();
    memoryServer = null;
  }
  usingEmbedded = false;
  logger.info('MongoDB disconnected.');
}

export function isDatabaseConnected(): boolean {
  return mongoose.connection.readyState === 1;
}

export function isUsingEmbeddedDatabase(): boolean {
  return usingEmbedded;
}
