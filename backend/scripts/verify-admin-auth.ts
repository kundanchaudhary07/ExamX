import { connectDatabase, disconnectDatabase } from '../src/config/database';
import { User } from '../src/models/User';
import { verifyPassword } from '../src/utils/password';
import { ENV } from '../src/config/env';
import { seedAdmin } from './seed-admin';
import { signToken, verifyToken } from '../src/utils/token';

async function verifyAll() {
  console.log('=== ADMIN AUTHENTICATION ROOT CAUSE ANALYSIS & VERIFICATION ===');
  
  // 1. Connect DB
  await connectDatabase();
  console.log('1. Database connected.');

  // 2. Run seedAdmin
  await seedAdmin();
  console.log('2. seedAdmin() executed.');

  // 3. Inspect Admin record in MongoDB
  const adminUsers = await User.find({ userId: ENV.ADMIN_USER_ID }).select('+passwordHash');
  console.log(`3. Admin records found with userId ${ENV.ADMIN_USER_ID}: ${adminUsers.length}`);

  if (adminUsers.length !== 1) {
    throw new Error(`CRITICAL: Found ${adminUsers.length} admin records instead of exactly 1!`);
  }

  const admin = adminUsers[0];
  console.log('4. Admin record verified:', {
    userId: admin.userId,
    role: admin.role,
    status: admin.status,
    hasPasswordHash: !!admin.passwordHash,
    hashPrefix: admin.passwordHash.slice(0, 7),
    isBcrypt: admin.passwordHash.startsWith('$2')
  });

  if (admin.role !== 'ADMIN') throw new Error('Admin role mismatch');
  if (admin.status !== 'ACTIVE') throw new Error('Admin is not ACTIVE');
  if (!admin.passwordHash.startsWith('$2')) throw new Error('Password is not bcrypt hash');

  // 4. Verify password against bcrypt
  const isMatch = await verifyPassword(ENV.ADMIN_INITIAL_PASSWORD, admin.passwordHash);
  console.log(`5. bcrypt.compare("${ENV.ADMIN_USER_ID}", password, hash) = ${isMatch}`);

  if (!isMatch) {
    throw new Error('CRITICAL: Password mismatch between ENV.ADMIN_INITIAL_PASSWORD and stored bcrypt hash!');
  }

  // 5. Test JWT token generation & verification
  const token = signToken({
    id: admin._id.toString(),
    userId: admin.userId,
    name: admin.name,
    role: admin.role
  });
  console.log('6. JWT generated successfully.');

  const payload = verifyToken(token);
  console.log('7. JWT verified successfully:', {
    id: payload.id,
    userId: payload.userId,
    role: payload.role
  });

  if (payload.userId !== ENV.ADMIN_USER_ID || payload.role !== 'ADMIN') {
    throw new Error('JWT payload mismatch');
  }

  // 6. Test toJSON sanitization (ensure passwordHash is stripped)
  const json = admin.toJSON();
  if ('passwordHash' in json) {
    throw new Error('CRITICAL: passwordHash was leaked in serialized user object!');
  }
  console.log('8. User serialization strictly strips passwordHash: OK');

  await disconnectDatabase();
  console.log('=== ALL ADMIN AUTHENTICATION CHECKS PASSED ===');
}

verifyAll()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('VERIFICATION FAILED:', err);
    process.exit(1);
  });
