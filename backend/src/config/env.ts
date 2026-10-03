import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables from workspace root .env and backend/.env without overriding explicit runtime env values.
// This preserves developer/local configuration while allowing test commands and runtime injection to target an isolated test database.
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config();

export function sanitizeMongoUri(rawUri: string): string {
  if (!rawUri) return '';
  const trimmed = rawUri.trim().replace(/^['"]|['"]$/g, '');
  const match = trimmed.match(/^(mongodb(?:\+srv)?:\/\/)(.+)$/);
  if (!match) return trimmed;

  const scheme = match[1];
  const rest = match[2];
  const lastAt = rest.lastIndexOf('@');
  if (lastAt === -1) return trimmed;

  const userInfo = rest.slice(0, lastAt);
  let hostAndPath = rest.slice(lastAt + 1);
  const colonIdx = userInfo.indexOf(':');
  if (colonIdx === -1) return trimmed;

  const user = userInfo.slice(0, colonIdx);
  const pass = userInfo.slice(colonIdx + 1);

  let encodedUser = user;
  let encodedPass = pass;
  try {
    encodedUser = encodeURIComponent(decodeURIComponent(user));
  } catch {
    encodedUser = encodeURIComponent(user);
  }
  try {
    encodedPass = encodeURIComponent(decodeURIComponent(pass));
  } catch {
    encodedPass = encodeURIComponent(pass);
  }

  // Ensure default database name 'exam_platform' if path is empty ("/" or "/?...")
  if (/^[^/?]+\/\?/.test(hostAndPath)) {
    hostAndPath = hostAndPath.replace(/\/\?/, '/exam_platform?');
  } else if (/^[^/?]+\/$/.test(hostAndPath)) {
    hostAndPath = `${hostAndPath}exam_platform`;
  } else if (!hostAndPath.includes('/')) {
    hostAndPath = `${hostAndPath}/exam_platform`;
  }

  return `${scheme}${encodedUser}:${encodedPass}@${hostAndPath}`;
}

const requiredEnv = (name: string): string => {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}. Set it in your secure .env file before starting the server.`);
  }
  return value;
};

export function isEmbeddedMongoAllowed(): boolean {
  return process.env.ALLOW_EMBEDDED_MONGO === 'true';
}

export const ENV = {
  get NODE_ENV() {
    return process.env.NODE_ENV || 'development';
  },
  get PORT() {
    return parseInt(process.env.PORT || '3000', 10);
  },
  get MONGODB_URI() {
    return sanitizeMongoUri(process.env.MONGODB_URI || '');
  },
  get JWT_SECRET() {
    return requiredEnv('JWT_SECRET');
  },
  get JWT_EXPIRES_IN() {
    return process.env.JWT_EXPIRES_IN || '24h';
  },
  get CORS_ORIGIN() {
    return process.env.CORS_ORIGIN || 'http://localhost:3000';
  },
  get ADMIN_USER_ID() {
    return (process.env.ADMIN_USER_ID || '12412699').trim();
  },
  get ADMIN_INITIAL_PASSWORD() {
    return process.env.ADMIN_INITIAL_PASSWORD?.trim() || '';
  },
  get ALLOW_EMBEDDED_MONGO() {
    return isEmbeddedMongoAllowed();
  }
};
