/** Parse a JSON string, returning {} on failure (tool args must never crash the loop). */
export function safeParseArgs(s) {
  if (s == null) return {};
  if (typeof s === 'object') return s;
  try {
    const v = JSON.parse(String(s));
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}

export function newCallId() {
  return `call_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Common provider contract (documented here, implemented per adapter):
 *
 *   chat({ model, messages, tools, signal }) -> Promise<{ content, toolCalls }>
 *
 * messages: [{ role: 'system'|'user'|'assistant'|'tool',
 *              content: string,
 *              toolCalls?: [{ id, name, args }],   // on assistant messages
 *              toolCallId?: string, name?: string }] // on tool messages
 * tools:    [{ name, description, parameters }] (JSON Schema)
 * Returns:  { content: string, toolCalls: [{ id, name, args }] }
 *
 * Errors may carry .status (HTTP-ish) and .retryable (safe to retry, e.g. 429/5xx).
 */
