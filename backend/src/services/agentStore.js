import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { PROVIDERS } from './providers/index.js';
import { TOOL_NAMES } from './tools.js';

const FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'agents.json');

// First-run roster: one agent per provider so the Barracks isn't empty.
// Sahil can edit, delete, or add agents from the UI.
const SEEDS = [
  {
    name: 'Scout',
    provider: 'gemini',
    model: 'gemini-2.0-flash',
    systemPrompt:
      'You are Scout, a fast research operative. Gather facts with your tools before answering, cite what you found, and keep reports tight.',
    tools: ['web_fetch'],
  },
  {
    name: 'Tinker',
    provider: 'ollama',
    model: 'qwen2.5:7b',
    systemPrompt:
      'You are Tinker, a hands-on builder running on the local machine. Read files, write files, and run shell commands to get things done. Small, careful steps; verify with a tool call rather than guessing.',
    tools: ['read_file', 'write_file', 'run_shell'],
  },
  {
    name: 'Analyst',
    provider: 'openrouter',
    model: 'meta-llama/llama-3.3-70b-instruct:free',
    systemPrompt:
      'You are Analyst, a careful reasoner. Break the mission into parts, use tools to check facts, and deliver a structured report.',
    tools: ['web_fetch', 'read_file'],
  },
];

function validateAgent(input) {
  const name = String(input.name || '').trim();
  if (!name) throw Object.assign(new Error('name is required'), { status: 400 });
  if (!PROVIDERS[input.provider]) {
    throw Object.assign(
      new Error(`provider must be one of: ${Object.keys(PROVIDERS).join(', ')}`),
      { status: 400 }
    );
  }
  const model = String(input.model || '').trim();
  if (!model) throw Object.assign(new Error('model is required'), { status: 400 });
  const tools = Array.isArray(input.tools) ? input.tools : [];
  for (const t of tools) {
    if (!TOOL_NAMES.includes(t)) {
      throw Object.assign(new Error(`unknown tool: ${t} (known: ${TOOL_NAMES.join(', ')})`), {
        status: 400,
      });
    }
  }
  return {
    name,
    provider: input.provider,
    model,
    systemPrompt: String(input.systemPrompt || '').slice(0, 4000),
    tools: [...new Set(tools)],
  };
}

async function readAll() {
  try {
    const raw = await readFile(FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return null; // missing file -> seed below
  }
}

async function writeAll(agents) {
  await mkdir(path.dirname(FILE), { recursive: true });
  const tmp = `${FILE}.tmp`;
  await writeFile(tmp, JSON.stringify(agents, null, 2) + '\n');
  await rename(tmp, FILE);
}

async function all() {
  let agents = await readAll();
  if (agents === null) {
    agents = SEEDS.map((s) => ({ id: crypto.randomUUID(), ...s, createdAt: new Date().toISOString() }));
    await writeAll(agents);
  }
  return agents;
}

export const agentStore = {
  list: all,
  async get(id) {
    const agents = await all();
    return agents.find((a) => a.id === id) || null;
  },
  async add(input) {
    const clean = validateAgent(input);
    const agents = await all();
    const agent = { id: crypto.randomUUID(), ...clean, createdAt: new Date().toISOString() };
    agents.push(agent);
    await writeAll(agents);
    return agent;
  },
  async update(id, input) {
    const clean = validateAgent(input);
    const agents = await all();
    const i = agents.findIndex((a) => a.id === id);
    if (i === -1) throw Object.assign(new Error('agent not found'), { status: 404 });
    agents[i] = { ...agents[i], ...clean };
    await writeAll(agents);
    return agents[i];
  },
  async remove(id) {
    const agents = await all();
    const next = agents.filter((a) => a.id !== id);
    if (next.length === agents.length) throw Object.assign(new Error('agent not found'), { status: 404 });
    await writeAll(next);
  },
};
