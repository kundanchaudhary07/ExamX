import path from 'path';
import { fileURLToPath } from 'url';
import { connectDatabase, disconnectDatabase } from '../src/config/database';
import { ENV } from '../src/config/env';
import { User } from '../src/models/User';
import { hashPassword, verifyPassword } from '../src/utils/password';
import { logger } from '../src/utils/logger';

const __filename = fileURLToPath(import.meta.url);

export async function seedAdmin(): Promise<void> {
  const adminUserId = (ENV.ADMIN_USER_ID || '12412699').trim();
  const initialPassword = (ENV.ADMIN_INITIAL_PASSWORD || '').trim();

  if (!initialPassword) {
    throw new Error('ADMIN_INITIAL_PASSWORD must be provided via secure environment configuration.');
  }

  try {
    await connectDatabase();

    // Prevent duplicate Admin accounts under different user IDs
    await User.deleteMany({ role: 'ADMIN', userId: { $ne: adminUserId } });

    const existingAdmin = await User.findOne({ userId: adminUserId }).select('+passwordHash');

    if (existingAdmin) {
      const isMatch = await verifyPassword(initialPassword, existingAdmin.passwordHash);
      if (!isMatch || existingAdmin.status !== 'ACTIVE' || existingAdmin.role !== 'ADMIN') {
        logger.info(`Synchronizing Admin [${adminUserId}] password hash and active status with current environment configuration.`);
        const passwordHash = await hashPassword(initialPassword);
        existingAdmin.passwordHash = passwordHash;
        existingAdmin.status = 'ACTIVE';
        existingAdmin.role = 'ADMIN' as any;
        await existingAdmin.save();
        logger.info(`Admin account [${adminUserId}] successfully synchronized with current environment password.`);
      } else {
        logger.info(`Idempotent check: Admin account [${adminUserId}] already exists.`);
      }
      return;
    }

    const passwordHash = await hashPassword(initialPassword);

    await User.create({
      userId: adminUserId,
      name: 'System Administrator',
      email: 'admin@examination.local',
      passwordHash,
      role: 'ADMIN',
      status: 'ACTIVE',
      department: 'Controller of Examinations',
      managedBy: [],
      createdBy: 'SYSTEM_BOOTSTRAP'
    });

    logger.info(`Admin account [${adminUserId}] successfully seeded with secure password hash.`);
  } catch (err: any) {
    logger.error('Failed to seed admin account:', err.message);
    throw err;
  }
}

// Allow direct CLI execution
if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  seedAdmin()
    .then(async () => {
      await disconnectDatabase();
      process.exit(0);
    })
    .catch(async (err) => {
      logger.error('Seed process terminated with error:', err.message);
      await disconnectDatabase();
      process.exit(1);
    });
}
