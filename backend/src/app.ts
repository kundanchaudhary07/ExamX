import express, { Application } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import authRoutes from './routes/auth.routes';
import userRoutes from './routes/user.routes';
import questionRoutes from './routes/question.routes';
import examRoutes from './routes/exam.routes';
import studentRoutes from './routes/student.routes';
import aiRoutes from './routes/ai.routes';
import attemptRoutes from './routes/attempt.routes';
import resultRoutes from './routes/result.routes';
import queryRoutes from './routes/query.routes';
import proctoringRoutes from './routes/proctoring.routes';
import communicationRoutes from './routes/communication.routes';
import auditRoutes from './routes/audit.routes';
import dashboardRoutes from './routes/dashboard.routes';
import { errorHandler } from './middleware/error.middleware';
import { notFoundHandler } from './middleware/notFound.middleware';
import { isDatabaseConnected, connectDatabase } from './config/database';
import { scheduleSnapshotSave } from './config/persistence';
import { ENV } from './config/env';

export function createApp(): Application {
  const app = express();
  app.set('trust proxy', 1);

  // Baseline Security (configured for iframe preview compatibility)
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
      crossOriginOpenerPolicy: false,
      crossOriginResourcePolicy: false,
      frameguard: false
    })
  );

  const configuredOrigins = ENV.CORS_ORIGIN.split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  app.use(
    cors({
      origin: (requestOrigin, callback) => {
        if (!requestOrigin || configuredOrigins.includes('*')) {
          callback(null, true);
          return;
        }
        if (
          configuredOrigins.includes(requestOrigin) ||
          /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(requestOrigin) ||
          /^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)*\.run\.app$/i.test(requestOrigin)
        ) {
          callback(null, true);
          return;
        }
        callback(null, false);
      },
      credentials: true
    })
  );

  // Body Parsing
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true, limit: '2mb' }));

  // Health Check Endpoint (checks backend & MongoDB connectivity)
  app.get('/api/health', (_req, res) => {
    const dbOk = isDatabaseConnected();
    res.status(200).json({
      success: true,
      status: dbOk ? 'healthy' : 'starting',
      service: 'ai-examination-platform-api',
      database: dbOk ? 'connected' : 'connecting',
      timestamp: new Date().toISOString(),
      uptime: process.uptime()
    });
  });

  // Ensure database connection is ready before handling API routes and persist mutations
  app.use('/api', async (req, res, next) => {
    try {
      if (!isDatabaseConnected()) {
        await connectDatabase();
      }
      if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS') {
        res.on('finish', () => {
          if (res.statusCode < 400) {
            scheduleSnapshotSave(50);
          }
        });
      }
      next();
    } catch (err) {
      next(err);
    }
  });

  // API Routes
  app.use('/api/auth', authRoutes);
  app.use('/api/users', userRoutes);
  app.use('/api/questions', questionRoutes);
  app.use('/api/question-bank', questionRoutes);
  app.use('/api/ai', aiRoutes);
  app.use('/api/exams', examRoutes);
  app.use('/api/student', studentRoutes);
  app.use('/api/attempts', attemptRoutes);
  app.use('/api/results', resultRoutes);
  app.use('/api/queries', queryRoutes);
  app.use('/api/proctoring', proctoringRoutes);
  app.use('/api/communication', communicationRoutes);
  app.use('/api/audit-logs', auditRoutes);
  app.use('/api/dashboard', dashboardRoutes);

  // Unmatched API Route 404 Handler
  app.use('/api', notFoundHandler);

  // Centralized Error Handling
  app.use(errorHandler);

  return app;
}
