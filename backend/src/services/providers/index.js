import { config } from '../../config.js';
import * as openrouter from './openrouter.js';
import * as gemini from './gemini.js';
import * as ollama from './ollama.js';

export const PROVIDERS = {
  gemini: {
    ...gemini,
    label: 'Gemini (free API)',
    defaultModel: 'gemini-2.0-flash',
    configured: () => Boolean(config.geminiKey),
    hint: 'Set GEMINI_API_KEY in .env — free key at https://aistudio.google.com',
  },
  openrouter: {
    ...openrouter,
    label: 'OpenRouter',
    defaultModel: 'meta-llama/llama-3.3-70b-instruct:free',
    configured: () => Boolean(config.openrouterKey),
    hint: 'Set OPENROUTER_API_KEY in .env; use :free models for $0 (note: free models are throttled harder)',
  },
  ollama: {
    ...ollama,
    label: 'Ollama (local)',
    defaultModel: 'qwen2.5:7b',
    configured: () => true,
    hint: `Local models via ${config.ollamaUrl} — install Ollama on the ThinkPad for this to work`,
  },
};

export function getProvider(id) {
  const p = PROVIDERS[id];
  if (!p) {
    const err = new Error(`unknown provider: ${id}`);
    err.status = 400;
    throw err;
  }
  return p;
}

export function providerSummary() {
  return Object.entries(PROVIDERS).map(([id, p]) => ({
    id,
    label: p.label,
    configured: p.configured(),
    defaultModel: p.defaultModel,
    hint: p.hint,
  }));
}
