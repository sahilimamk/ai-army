// Built-in web-app launchpad tiles. `ask` builds the prefilled URL (or null when
// the site has no reliable prefill param — the question is copied to clipboard instead).
const enc = encodeURIComponent;

export const builtinTiles = [
  { id: 'chatgpt', name: 'ChatGPT', open: 'https://chatgpt.com', ask: (q) => `https://chatgpt.com/?q=${enc(q)}` },
  { id: 'claude', name: 'Claude', open: 'https://claude.ai/new', ask: (q) => `https://claude.ai/new?q=${enc(q)}` },
  { id: 'perplexity', name: 'Perplexity', open: 'https://www.perplexity.ai', ask: (q) => `https://www.perplexity.ai/?q=${enc(q)}` },
  { id: 'gemini', name: 'Gemini', open: 'https://gemini.google.com/app', ask: (q) => `https://gemini.google.com/app?q=${enc(q)}` },
  { id: 'grok', name: 'Grok', open: 'https://x.com/i/grok', ask: (q) => `https://x.com/i/grok?text=${enc(q)}` },
  { id: 'deepseek', name: 'DeepSeek', open: 'https://chat.deepseek.com', ask: (q) => `https://chat.deepseek.com/?q=${enc(q)}` },
  { id: 'copilot', name: 'Copilot', open: 'https://copilot.microsoft.com', ask: null },
  { id: 'lechat', name: 'Le Chat (Mistral)', open: 'https://chat.mistral.ai', ask: null },
  { id: 'meta', name: 'Meta AI', open: 'https://www.meta.ai', ask: null },
  { id: 'qwen', name: 'Qwen', open: 'https://chat.qwen.ai', ask: null },
  { id: 'poe', name: 'Poe', open: 'https://poe.com', ask: null },
  { id: 'ddg', name: 'DuckDuckGo AI', open: 'https://duck.ai/chat', ask: null },
];
