import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { config } from '../config.js';

export function applySecurity(app) {
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(
    helmet({
      // Keep the default protections; CSP is left to the frontend build.
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
    })
  );

  app.use(
    cors({
      origin: config.allowedOrigins.length ? config.allowedOrigins : true,
      credentials: true,
    })
  );

  // General API throttle.
  app.use('/api/', rateLimit({ windowMs: 60_000, max: 180, standardHeaders: true }));
}
