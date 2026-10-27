import { execFile } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';

// All file/shell tools are jailed to this workspace. Nothing outside it is
// reachable, no matter what path the model asks for.
const WORKDIR = path.resolve(config.workDir);

// Paths that look like secrets are never readable/writable by agents,
// even inside the workspace.
const SECRET_PATTERNS = [
  /(^|[\\/])\.env(\.|$)/i,
  /\.pem$/i,
  /\.key$/i,
  /(^|[\\/])\.ssh([\\/]|$)/i,
  /secret/i,
  /credential/i,
  /token/i,
];

// Shell commands matching these patterns don't run blind — the mission runner
// pauses and asks the operator for one-tap approval instead.
const RISKY_PATTERNS = [
  /\brm\s+(-[a-z]*r[a-z]*\s+)?\/( |$)/, // rm -rf /
  /:\(\)\s*\{/, // fork bomb
  /\bmkfs\b/,
  /\bdd\b.*\bof=/,
  /\b(shutdown|reboot|halt|poweroff)\b/,
  />\s*\/dev\//,
  /\bchmod\s+-R\s+777\s+\//,
  /\bcurl\b[^|]*\|\s*(ba)?sh/, // curl ... | sh
  /\bwget\b[^|]*\|\s*(ba)?sh/,
];

export function isRiskyCommand(cmd) {
  return RISKY_PATTERNS.some((re) => re.test(String(cmd)));
}

function jail(relPath) {
  const abs = path.resolve(WORKDIR, String(relPath || ''));
  if (abs !== WORKDIR && !abs.startsWith(WORKDIR + path.sep)) {
    const err = new Error('path escapes the mission workspace');
    err.status = 400;
    throw err;
  }
  if (SECRET_PATTERNS.some((re) => re.test(abs))) {
    const err = new Error('refusing: that path looks like secrets');
    err.status = 403;
    throw err;
  }
  return abs;
}

// Scrubbed env for child processes: agents never see API keys, even via `env`.
function scrubbedEnv() {
  return Object.fromEntries(
    Object.entries(process.env).filter(([k]) => !/(KEY|SECRET|TOKEN|PASSWORD|SESSION)/i.test(k))
  );
}

function runShell(cmd, timeoutMs) {
  const timeout = Math.min(Math.max(Number(timeoutMs) || 60000, 1000), 300000);
  return new Promise((resolve) => {
    execFile(
      'bash',
      ['-c', cmd],
      { timeout, cwd: WORKDIR, maxBuffer: 1024 * 1024, env: scrubbedEnv() },
      (err, stdout, stderr) => {
        const out = String(stdout || '') + (stderr ? `\n[stderr]\n${stderr}` : '');
        resolve(
          `exit=${err && typeof err.code === 'number' ? err.code : err ? 1 : 0}` +
            (err && err.killed ? ' (killed: timeout)' : '') +
            `\n${out.slice(0, 20000)}`
        );
      }
    );
  });
}

export const TOOL_DEFS = [
  {
    name: 'read_file',
    description:
      'Read a text file inside the mission workspace. Path is relative to the workspace root.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Relative file path' } },
      required: ['path'],
    },
  },
  {
    name: 'write_file',
    description:
      'Write (create or overwrite) a text file inside the mission workspace. Parent directories are created automatically.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative file path' },
        content: { type: 'string', description: 'Full file content' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'run_shell',
    description:
      'Run a non-interactive bash command inside the mission workspace. Destructive-looking commands need operator approval first.',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'The bash command to run' },
        timeout_ms: { type: 'number', description: 'Timeout in ms (default 60000, max 300000)' },
      },
      required: ['command'],
    },
  },
  {
    name: 'web_fetch',
    description: 'Fetch an https:// URL and return its text content (truncated).',
    parameters: {
      type: 'object',
      properties: { url: { type: 'string', description: 'The https URL to fetch' } },
      required: ['url'],
    },
  },
];

export const TOOL_NAMES = TOOL_DEFS.map((t) => t.name);

/**
 * Execute a tool. Returns a string result — except for run_shell with a risky
 * command, which returns { needsApproval: true, reason } so the mission runner
 * can pause for operator approval. Pass { force: true } to run it anyway
 * (used after the operator approves).
 */
export async function executeTool(name, args = {}, opts = {}) {
  switch (name) {
    case 'read_file': {
      const abs = jail(args.path);
      const text = await readFile(abs, 'utf8').catch((e) => {
        throw new Error(`read failed: ${e.message}`);
      });
      return text.slice(0, 40000);
    }
    case 'write_file': {
      const abs = jail(args.path);
      await mkdir(path.dirname(abs), { recursive: true });
      const content = String(args.content ?? '');
      await writeFile(abs, content);
      return `wrote ${args.path} (${content.length} chars)`;
    }
    case 'run_shell': {
      const cmd = String(args.command || '');
      if (!cmd.trim()) throw new Error('command is required');
      if (!opts.force && isRiskyCommand(cmd)) {
        return { needsApproval: true, reason: 'command matches a risky pattern' };
      }
      return await runShell(cmd, args.timeout_ms);
    }
    case 'web_fetch': {
      let u;
      try {
        u = new URL(String(args.url || ''));
      } catch {
        throw new Error('url is not valid');
      }
      if (u.protocol !== 'https:') throw new Error('only https:// URLs are allowed');
      const r = await fetch(u.toString(), {
        signal: AbortSignal.timeout(30000),
        headers: { 'User-Agent': 'AI-Army/1.0' },
      });
      if (!r.ok) throw new Error(`fetch failed: HTTP ${r.status}`);
      return (await r.text()).slice(0, 30000);
    }
    default:
      throw new Error(`unknown tool: ${name}`);
  }
}

export function ensureWorkDir() {
  return mkdir(WORKDIR, { recursive: true });
}

export function workDirPath() {
  return WORKDIR;
}
