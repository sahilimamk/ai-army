import { config } from '../../config.js';
import { newCallId } from './util.js';

/**
 * Direct Gemini API (free tier) via the v1beta generateContent REST endpoint.
 * Uses x-goog-api-key header auth. Free tier limits are generous for a small
 * fleet; the mission runner still caps concurrency (2) and backs off on 429s.
 */
function toContents(messages) {
  const contents = [];
  for (const m of messages) {
    if (m.role === 'system') continue; // sent via systemInstruction instead
    if (m.role === 'tool') {
      contents.push({
        role: 'user',
        parts: [{ functionResponse: { name: m.name, response: { result: String(m.content ?? '') } } }],
      });
      continue;
    }
    const parts = [];
    if (m.content) parts.push({ text: String(m.content) });
    for (const tc of m.toolCalls || []) {
      parts.push({ functionCall: { name: tc.name, args: tc.args ?? {} } });
    }
    contents.push({ role: m.role === 'assistant' ? 'model' : 'user', parts });
  }
  return contents;
}

export async function chat({ model, messages, tools = [], signal }) {
  if (!config.geminiKey) {
    throw Object.assign(
      new Error('GEMINI_API_KEY is not set on the server (free key: https://aistudio.google.com)'),
      { status: 400 }
    );
  }
  const system = messages.find((m) => m.role === 'system')?.content || '';
  const body = {
    contents: toContents(messages),
    generationConfig: { maxOutputTokens: 4096 },
  };
  if (system) body.systemInstruction = { parts: [{ text: String(system) }] };
  if (tools.length > 0) {
    body.tools = [
      {
        functionDeclarations: tools.map((t) => ({
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        })),
      },
    ];
  }

  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: 'POST',
      signal,
      headers: { 'x-goog-api-key': config.geminiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }
  );
  if (!r.ok) {
    const bodyText = await r.text().catch(() => '');
    const err = new Error(`Gemini HTTP ${r.status} ${bodyText.slice(0, 200)}`.trim());
    err.status = r.status;
    err.retryable = r.status === 429 || r.status >= 500;
    throw err;
  }
  const j = await r.json();
  const parts = j.candidates?.[0]?.content?.parts || [];
  let content = '';
  const toolCalls = [];
  for (const p of parts) {
    if (p.text) content += p.text;
    if (p.functionCall) {
      toolCalls.push({ id: newCallId(), name: p.functionCall.name, args: p.functionCall.args || {} });
    }
  }
  return { content, toolCalls };
}
