import { config } from '../../config.js';
import { safeParseArgs, newCallId } from './util.js';

/**
 * Local models via Ollama's /api/chat (OpenAI-style tools supported on recent
 * Ollama versions with capable models). No API key, no rate limits — just the
 * ThinkPad's CPU doing the thinking, so the runner caps this provider at 1
 * concurrent mission.
 */
function toMessages(messages) {
  return messages.map((m) => {
    if (m.role === 'tool') return { role: 'tool', content: String(m.content ?? '') };
    const out = { role: m.role, content: String(m.content ?? '') };
    if (m.toolCalls && m.toolCalls.length > 0) {
      out.tool_calls = m.toolCalls.map((tc) => ({
        function: { name: tc.name, arguments: tc.args ?? {} },
      }));
    }
    return out;
  });
}

export async function chat({ model, messages, tools = [], signal }) {
  const url = `${config.ollamaUrl}/api/chat`;
  let r;
  try {
    r = await fetch(url, {
      method: 'POST',
      signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        stream: false,
        messages: toMessages(messages),
        tools: tools.map((t) => ({
          type: 'function',
          function: { name: t.name, description: t.description, parameters: t.parameters },
        })),
      }),
    });
  } catch (e) {
    throw Object.assign(
      new Error(`Ollama is unreachable at ${config.ollamaUrl} — is Ollama installed and running on this machine?`),
      { status: 502, cause: e }
    );
  }
  if (!r.ok) {
    const body = await r.text().catch(() => '');
    const err = new Error(`Ollama HTTP ${r.status} ${body.slice(0, 200)}`.trim());
    err.status = r.status;
    err.retryable = r.status === 429 || r.status >= 500;
    throw err;
  }
  const j = await r.json();
  const msg = j.message || {};
  const toolCalls = (msg.tool_calls || [])
    .map((tc) => ({
      id: newCallId(),
      name: tc.function?.name,
      args: safeParseArgs(tc.function?.arguments),
    }))
    .filter((tc) => tc.name);
  return { content: msg.content || '', toolCalls };
}
