import { config } from '../../config.js';
import { safeParseArgs, newCallId } from './util.js';

const BASE = 'https://openrouter.ai/api/v1';
const HEADERS = {
  'HTTP-Referer': 'https://localhost',
  'X-Title': 'AI Army Command',
};

function toMessages(messages) {
  return messages.map((m) => {
    if (m.role === 'tool') {
      return { role: 'tool', tool_call_id: m.toolCallId, content: String(m.content ?? '') };
    }
    const out = { role: m.role, content: String(m.content ?? '') };
    if (m.toolCalls && m.toolCalls.length > 0) {
      out.tool_calls = m.toolCalls.map((tc) => ({
        id: tc.id,
        type: 'function',
        function: { name: tc.name, arguments: JSON.stringify(tc.args ?? {}) },
      }));
    }
    return out;
  });
}

/** Single non-streamed chat completion with OpenAI-style function calling. */
export async function chat({ model, messages, tools = [], signal }) {
  if (!config.openrouterKey) {
    throw Object.assign(new Error('OPENROUTER_API_KEY is not set on the server'), { status: 400 });
  }
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
      messages: toMessages(messages),
      tools: tools.map((t) => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.parameters },
      })),
      stream: false,
    }),
  });
  if (!r.ok) {
    const body = await r.text().catch(() => '');
    const err = new Error(`OpenRouter HTTP ${r.status} ${body.slice(0, 200)}`.trim());
    err.status = r.status;
    err.retryable = r.status === 429 || r.status >= 500;
    throw err;
  }
  const j = await r.json();
  const msg = j.choices?.[0]?.message || {};
  const toolCalls = (msg.tool_calls || [])
    .map((tc) => ({
      id: tc.id || newCallId(),
      name: tc.function?.name,
      args: safeParseArgs(tc.function?.arguments),
    }))
    .filter((tc) => tc.name);
  return { content: msg.content || '', toolCalls };
}
