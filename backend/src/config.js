import dotenv from 'dotenv';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Load ai-army/.env no matter which directory the server is started from
// (`npm --prefix backend start` runs with cwd=backend/, so a bare
// dotenv.config() would look for backend/.env and miss the real one).
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
dotenv.config({ path: path.join(ROOT, '.env') });

function num(v, fallback) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

export const config = {
  port: num(process.env.PORT, 3001),
  nodeEnv: process.env.NODE_ENV || 'development',
  openrouterKey: process.env.OPENROUTER_API_KEY || '',
  allowedOrigins: (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  // ---- Barracks (subagent fleet) ----
  geminiKey: process.env.GEMINI_API_KEY || '',
  ollamaUrl: (process.env.OLLAMA_URL || 'http://localhost:11434').replace(/\/+$/, ''),
  workDir:
    process.env.AI_ARMY_WORKDIR ||
    path.join(os.homedir(), 'workspace', 'ai-army', 'work'),
  missionMaxSteps: num(process.env.MISSION_MAX_STEPS, 10),
  missionTimeoutMs: num(process.env.MISSION_TIMEOUT_MS, 10 * 60 * 1000),
  approvalTimeoutMs: num(process.env.APPROVAL_TIMEOUT_MS, 10 * 60 * 1000),
};

if (!config.openrouterKey) {
  console.warn('[warn] OPENROUTER_API_KEY is not set — the War Room will refuse to deploy until you add it.');
}
if (!config.geminiKey) {
  console.info('[info] GEMINI_API_KEY is not set — Gemini-powered agents will refuse to deploy until you add it (free key: https://aistudio.google.com).');
}
