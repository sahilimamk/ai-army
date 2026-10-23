import express from 'express';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { applySecurity } from './middleware/security.js';
import api from './routes/api.js';

const app = express();

applySecurity(app);
app.use(express.json({ limit: '256kb' }));

app.use('/api', api);
// Unknown /api/* -> JSON 404 (never the SPA fallback).
app.use('/api', (_req, res) => res.status(404).json({ error: 'not found' }));

const here = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(here, '..', 'public');

if (existsSync(publicDir)) {
  app.use(express.static(publicDir));
  app.get('*', (_req, res) => res.sendFile(path.join(publicDir, 'index.html')));
} else {
  app.get('/', (_req, res) =>
    res.status(200).send('AI Army backend is up. Build the frontend (`npm run build` at repo root) to serve the dashboard here.')
  );
}

app.listen(config.port, () => {
  console.log(`[ai-army] listening on http://localhost:${config.port} (${config.nodeEnv})`);
});
