import fs from 'fs';
import path from 'path';
import http from 'http';
import { fileURLToPath } from 'url';
import express from 'express';
import { createApp } from './app';
import { connectDatabase } from './config/database';
import {
  enableDatabasePersistence,
  restoreDatabaseSnapshot,
  saveDatabaseSnapshot
} from './config/persistence';
import { seedAdmin } from '../scripts/seed-admin';
import { initSocketServer } from './realtime/socket';
import { ENV } from './config/env';
import { logger } from './utils/logger';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function startServer() {
  try {
    enableDatabasePersistence();

    const dbReadyPromise = (async () => {
      try {
        await connectDatabase();
        await restoreDatabaseSnapshot();
        await seedAdmin();
        await saveDatabaseSnapshot();
      } catch (err: any) {
        logger.error('Database initialization error:', err.message);
        throw err;
      }
    })();

    const isProductionBuild = ENV.NODE_ENV === 'production';
    const isDevLifecycle = process.env.npm_lifecycle_event === 'dev';
    if (!isProductionBuild || isDevLifecycle) {
      await dbReadyPromise;
    }

    // Initialize Express Application with API routes
    const app = createApp();
    const portArgIndex = process.argv.indexOf('--port');
    const port =
      portArgIndex !== -1 && process.argv[portArgIndex + 1]
        ? parseInt(process.argv[portArgIndex + 1], 10)
        : ENV.PORT || 3000;
    const frontendDir = path.resolve(__dirname, '../../frontend');
    const distPath = path.resolve(frontendDir, 'dist');
    const distIndexHtml = path.join(distPath, 'index.html');
    const srcIndexHtml = path.join(frontendDir, 'index.html');
    const hasBuiltFrontend = fs.existsSync(distIndexHtml);

    const sendSpaIndex = (_req: express.Request, res: express.Response) => {
      const targetHtml = fs.existsSync(distIndexHtml) ? distIndexHtml : srcIndexHtml;
      res.sendFile(targetHtml, (err) => {
        if (err && !res.headersSent) {
          res
            .status(503)
            .send(
              '<!doctype html><html><head><meta http-equiv="refresh" content="1"></head><body>Loading application...</body></html>'
            );
        }
      });
    };

    // Mount Vite development middleware or static production build
    if (!isProductionBuild || isDevLifecycle || !hasBuiltFrontend) {
      try {
        if (
          !process.env.VITE_API_URL ||
          /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/i.test(process.env.VITE_API_URL.trim())
        ) {
          process.env.VITE_API_URL = '/api';
        }
        const { createServer: createViteServer } = await import('vite');
        const vite = await createViteServer({
          root: frontendDir,
          server: { middlewareMode: true, hmr: false },
          appType: 'spa'
        });
        app.use(vite.middlewares);
        logger.info(`Vite development middleware mounted with root: ${frontendDir}`);
      } catch (viteErr: any) {
        logger.warn('Vite dev middleware could not be loaded:', viteErr.message);
        app.use(express.static(distPath));
        app.get('/{*splat}', sendSpaIndex);
      }
    } else {
      app.use(express.static(distPath));
      app.get('/{*splat}', sendSpaIndex);
      logger.info(`Static production assets served from ${distPath}`);
    }

    // Create HTTP Server & attach Authenticated Socket.IO Real-Time Layer
    const httpServer = http.createServer(app);
    initSocketServer(httpServer);

    httpServer.listen(Number(port), '0.0.0.0', () => {
      logger.info(
        `AI Examination Platform running at http://localhost:${port} [${ENV.NODE_ENV}] (HTTP + WebSocket)`
      );
    });

    const shutdown = async () => {
      logger.info('Gracefully terminating server...');
      await saveDatabaseSnapshot().catch(() => {});
      httpServer.close(() => {
        logger.info('HTTP server closed.');
        process.exit(0);
      });
    };

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);

    return httpServer;
  } catch (err: any) {
    logger.error('Fatal server startup failure:', err.message);
    process.exit(1);
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === __filename;
if (isMain) {
  startServer();
}
