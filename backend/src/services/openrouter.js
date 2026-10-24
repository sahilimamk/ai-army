import { config } from '../config.js';

const BASE = 'https://openrouter.ai/api/v1';
const HEADERS = {
  'HTTP-Referer': 'https://localhost',
  'X-Title': 'AI Army Command',
};

let rosterCache = { at: 0, data: null };
const ROSTER_TTL_MS = 3600_000;

/** Live model roster from OpenRouter, cached for an hour. */
export async function listModels() {
  if (rosterCache.data && Date.now() - rosterCache.at < ROSTER_TTL_MS) return rosterCache.data;
  const r = await fetch(`${BASE}/models`, { headers: HEADERS });
  if (!r.ok) throw new Error(`model roster failed: HTTP ${r.status}`);
  const j = await r.json();
  rosterCache = { at: Date.now(), data: j.data || [] };
  return rosterCache.data;
}

/**
 * Streams one chat completion, calling onToken(text) for each delta.
 * The SAME plain question goes to every model — no roles, no personas,
 * models never see each other. (The council rule.)
 */
export async function streamChatCompletion(model, question, onToken, signal) {
  const r = await fetch(`${BASE}/chat/completions`, {
    method: 'POST',
    signal,
    headers: {
      ...HEADERS,
      Authorization: `Bearer ${config.openrouterKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: question }],
      stream: true,
    }),
  });
  if (!r.ok) {
    const body = await r.text().catch(() => '');
    throw new Error(`HTTP ${r.status} ${body.slice(0, 180)}`.trim());
  }

  const reader = r.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n\n')) >= 0) {
      const chunk = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      for (const line of chunk.split('\n')) {
        const t = line.trim();
        if (!t.startsWith('data:')) continue;
        const data = t.slice(5).trim();
        if (data === '[DONE]') return;
        try {
          const token = JSON.parse(data).choices?.[0]?.delta?.content || '';
          if (token) onToken(token);
        } catch {
          /* ignore malformed SSE frames */
        }
      }
    }
  }
}
