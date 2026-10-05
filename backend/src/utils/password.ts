import bcrypt from 'bcryptjs';
import { generateInitialPassword } from './credential.generator';

const SALT_ROUNDS = 12;

export async function hashPassword(plainText: string): Promise<string> {
  if (!plainText || typeof plainText !== 'string') {
    throw new Error('Invalid password input for hashing');
  }
  return bcrypt.hash(plainText, SALT_ROUNDS);
}

export async function createInitialPasswordCredential(
  name: string,
  dobYear: number | string
): Promise<{ password: string; passwordHash: string }> {
  const password = generateInitialPassword(name, dobYear);
  return {
    password,
    passwordHash: await hashPassword(password)
  };
}

export async function verifyPassword(plainText: string, hash: string): Promise<boolean> {
  if (!plainText || !hash) return false;
  return bcrypt.compare(plainText, hash);
}
