import { EventEmitter } from 'node:events';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { getProvider } from './providers/index.js';
import { TOOL_DEFS, executeTool, ensureWorkDir } from './tools.js';
import { agentStore } from './agentStore.js';
import { config } from '../config.js';

const FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'missions.json');
const MAX_MISSIONS = 200;
const MAX_LOG = 500;
const TERMINAL = new Set(['done', 'failed', 'cancelled']);

// Concurrency per provider: free tiers punish stampedes, and Ollama is one
// local CPU. Missions beyond the cap wait in a FIFO queue.
const CONCURRENCY = { gemini: 2, openrouter: 2, ollama: 1 };
const inFlight = { gemini: 0, openrouter: 0, ollama: 0 };
const queues = { gemini: [], openrouter: [], ollama: [] };

const bus = new EventEmitter();
bus.setMaxListeners(200);

const controllers = new Map(); // missionId -> AbortController
const cancelledSet = new Set(); // missionId
const approvalWaiters = new Map(); // `${missionId}:${callId}` -> resolve fn

const TOOL_GUIDANCE = `
You have tools. Use them to gather facts and do work before answering — never claim you ran a tool you didn't.
Call one or more tools per step when useful. When the mission is complete, reply with your final mission report as plain text and no further tool calls.
Keep tool arguments small and precise. The mission workspace is your sandbox for files and shell commands.`;

// ---------- persistence ----------
async function readAll() {
  try {
    const raw = await readFile(FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeAll(missions) {
  await mkdir(path.dirname(FILE), { recursive: true });
  // Write to temp + atomic rename so concurrent readers never see a torn file.
  const tmp = `${FILE}.tmp`;
  await writeFile(tmp, JSON.stringify(missions, null, 2) + '\n');
  await rename(tmp, FILE);
}

// All read-modify-write cycles go through this chain: concurrent saves can
// otherwise interleave (read torn file -> parse to [] -> wipe other missions).
let writeChain = Promise.resolve();
function serialized(fn) {
  const run = writeChain.then(fn, fn);
  writeChain = run.catch(() => {});
  return run;
}

async function save(mission) {
  mission.updatedAt = new Date().toISOString();
  return serialized(async () => {
    const missions = await readAll();
    const i = missions.findIndex((m) => m.id === mission.id);
    if (i === -1) {
      missions.unshift(mission);
    } else {
      // Merge with whatever is on disk: a concurrent writer (approval resolve,
      // cancel) may have added events or flipped status since this object was
      // last saved. Union the logs by event id so nothing is ever clobbered.
      const stored = missions[i];
      const seen = new Set((stored.log || []).map((e) => e.id));
      const mergedLog = [...(stored.log || []), ...(mission.log || []).filter((e) => !seen.has(e.id))];
      mergedLog.sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0));
      missions[i] = {
        ...stored,
        ...mission,
        log: mergedLog.slice(-MAX_LOG),
        // A concurrent terminal write (cancel) must never be resurrected by a
        // stale loop save.
        ...(TERMINAL.has(stored.status) && !TERMINAL.has(mission.status)
          ? { status: stored.status, error: stored.error }
          : {}),
      };
    }
    await writeAll(missions.slice(0, MAX_MISSIONS));
  });
}

function emit(mission, event) {
  const ev = { id: crypto.randomUUID(), t: new Date().toISOString(), ...event };
  mission.log.push(ev);
  if (mission.log.length > MAX_LOG) mission.log = mission.log.slice(-MAX_LOG);
  bus.emit(mission.id, ev);
  return save(mission).catch(() => {});
}

// ---------- semaphores ----------
function acquire(providerId) {
  return new Promise((resolve) => {
    const tryTake = () => {
      if ((inFlight[providerId] ?? 0) < (CONCURRENCY[providerId] ?? 1)) {
        inFlight[providerId] = (inFlight[providerId] ?? 0) + 1;
        resolve();
        return true;
      }
      return false;
    };
    if (!tryTake()) (queues[providerId] = queues[providerId] || []).push(tryTake);
  });
}

function release(providerId) {
  inFlight[providerId] = Math.max(0, (inFlight[providerId] ?? 1) - 1);
  const next = (queues[providerId] || []).shift();
  if (next) next();
}

// ---------- retry ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function withRetry(mission, fn) {
  const delays = [2000, 6000, 18000];
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (e && e.retryable && attempt < delays.length && !cancelledSet.has(mission.id)) {
        await emit(mission, { type: 'backoff', waitMs: delays[attempt], error: String(e.message || e) });
        await sleep(delays[attempt]);
        continue;
      }
      throw e;
    }
  }
}

// ---------- approvals ----------
function requestApproval(mission, callId, toolCall, reason) {
  return new Promise((resolve) => {
    const key = `${mission.id}:${callId}`;
    mission.status = 'awaiting_approval';
    mission.pendingApproval = {
      callId,
      tool: toolCall.name,
      args: toolCall.args,
      reason,
      requestedAt: new Date().toISOString(),
    };
    emit(mission, { type: 'needs_approval', callId, tool: toolCall.name, args: toolCall.args, reason });
    const timer = setTimeout(() => {
      approvalWaiters.delete(key);
      resolve(false); // approval timed out -> treated as denied
    }, config.approvalTimeoutMs);
    approvalWaiters.set(key, (approved) => {
      clearTimeout(timer);
      approvalWaiters.delete(key);
      resolve(approved);
    });
  });
}

export async function resolveApproval(missionId, callId, approved) {
  const missions = await readAll();
  const mission = missions.find((m) => m.id === missionId);
  if (!mission) throw Object.assign(new Error('mission not found'), { status: 404 });
  if (mission.status !== 'awaiting_approval' || mission.pendingApproval?.callId !== callId) {
    throw Object.assign(new Error('no pending approval for that call'), { status: 409 });
  }
  mission.pendingApproval = null;
  mission.status = 'running';
  // NOTE: the 'approval' log event is emitted by the mission loop itself when
  // it resumes (single writer for the log), not here.
  await save(mission);
  const waiter = approvalWaiters.get(`${missionId}:${callId}`);
  if (waiter) waiter(Boolean(approved));
  return mission;
}

// ---------- the agentic loop ----------
async function runLoop(mission, agent) {
  const provider = getProvider(agent.provider);
  const tools = TOOL_DEFS.filter((t) => agent.tools.includes(t.name));
  const controller = new AbortController();
  controllers.set(mission.id, controller);

  const messages = [
    {
      role: 'system',
      content: `${agent.systemPrompt || `You are ${agent.name}, an AI operative.`}${TOOL_GUIDANCE}`,
    },
    { role: 'user', content: mission.prompt },
  ];

  await emit(mission, { type: 'status', status: 'running' });
  const deadline = Date.now() + config.missionTimeoutMs;
  let finalText = '';

  try {
    for (let step = 1; step <= config.missionMaxSteps; step++) {
      if (cancelledSet.has(mission.id)) throw Object.assign(new Error('cancelled by operator'), { cancelled: true });
      if (Date.now() > deadline) throw new Error('mission timed out');

      await emit(mission, { type: 'step', step, status: 'thinking' });
      const resp = await withRetry(mission, () =>
        provider.chat({ model: agent.model, messages, tools, signal: controller.signal })
      );

      if (!resp.toolCalls || resp.toolCalls.length === 0) {
        finalText = resp.content || '';
        break;
      }

      messages.push({ role: 'assistant', content: resp.content || '', toolCalls: resp.toolCalls });

      for (const tc of resp.toolCalls) {
        if (cancelledSet.has(mission.id)) throw Object.assign(new Error('cancelled by operator'), { cancelled: true });
        await emit(mission, { type: 'tool_call', step, callId: tc.id, tool: tc.name, args: tc.args });

        let result;
        try {
          const first = await executeTool(tc.name, tc.args || {});
          if (first && typeof first === 'object' && first.needsApproval) {
            // Risky command: pause the loop until the operator approves or denies.
            // NOTE: the provider concurrency slot stays held during approval;
            // the approval timeout bounds how long that can last.
            const approved = await requestApproval(mission, tc.id, tc, first.reason);
            // The loop is the single writer of the log: it records the
            // approval outcome itself so concurrent saves can't clobber it.
            mission.status = 'running';
            mission.pendingApproval = null;
            await emit(mission, { type: 'approval', callId: tc.id, approved });
            if (approved) {
              result = await executeTool(tc.name, tc.args || {}, { force: true });
            } else {
              result = 'BLOCKED: the operator denied this command. Work around it or finish without it.';
            }
          } else {
            result = first;
          }
        } catch (e) {
          result = `TOOL ERROR: ${e.message || e}`;
        }

        await emit(mission, {
          type: 'tool_result',
          step,
          callId: tc.id,
          tool: tc.name,
          result: String(result).slice(0, 4000),
        });
        messages.push({ role: 'tool', toolCallId: tc.id, name: tc.name, content: String(result) });
      }
    }

    mission.status = 'done';
    mission.result = finalText;
    await emit(mission, { type: 'mission_end', status: 'done' });
  } catch (e) {
    if (e && (e.cancelled || e.name === 'AbortError')) {
      mission.status = 'cancelled';
      mission.error = 'cancelled by operator';
    } else {
      mission.status = 'failed';
      mission.error = String(e.message || e).slice(0, 500);
    }
    await emit(mission, { type: 'mission_end', status: mission.status, error: mission.error });
  } finally {
    controllers.delete(mission.id);
    cancelledSet.delete(mission.id);
    mission.pendingApproval = null;
    release(agent.provider);
    await save(mission);
  }
}

// ---------- public API ----------
export async function dispatchMissions({ prompt, agentIds }) {
  const cleanPrompt = String(prompt || '').trim();
  if (!cleanPrompt) throw Object.assign(new Error('prompt is required'), { status: 400 });
  if (!Array.isArray(agentIds) || agentIds.length === 0 || agentIds.length > 8) {
    throw Object.assign(new Error('pick 1–8 agents'), { status: 400 });
  }

  const agents = [];
  for (const id of agentIds) {
    const agent = await agentStore.get(id);
    if (!agent) throw Object.assign(new Error(`agent not found: ${id}`), { status: 404 });
    const provider = getProvider(agent.provider);
    if (!provider.configured()) {
      throw Object.assign(
        new Error(`agent "${agent.name}" uses ${provider.label}, which is not configured. ${provider.hint}`),
        { status: 400 }
      );
    }
    agents.push(agent);
  }

  await ensureWorkDir();
  const created = [];
  for (const agent of agents) {
    const mission = {
      id: crypto.randomUUID(),
      agentId: agent.id,
      agentName: agent.name,
      provider: agent.provider,
      model: agent.model,
      prompt: cleanPrompt,
      status: 'queued',
      log: [],
      result: '',
      error: '',
      pendingApproval: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await save(mission);
    created.push(mission);
    // Fire and forget: the loop runs in the background, progress via SSE/inbox.
    (async () => {
      await acquire(agent.provider);
      if (cancelledSet.has(mission.id)) {
        // cancelMission already recorded the terminal state on its own copy;
        // just free the slot, don't let this stale object clobber it.
        cancelledSet.delete(mission.id);
        release(agent.provider);
        return;
      }
      mission.status = 'running';
      await save(mission);
      await runLoop(mission, agent);
    })().catch((e) => console.error('[missions] background runner crashed:', e));
  }
  return created;
}

export async function listMissions({ limit = 50, activeOnly = false } = {}) {
  const missions = await readAll();
  const filtered = activeOnly ? missions.filter((m) => !TERMINAL.has(m.status)) : missions;
  return filtered.slice(0, Math.min(Math.max(limit, 1), 200));
}

export async function getMission(id) {
  const missions = await readAll();
  const mission = missions.find((m) => m.id === id);
  if (!mission) throw Object.assign(new Error('mission not found'), { status: 404 });
  return mission;
}

export async function cancelMission(id) {
  const mission = await getMission(id);
  if (TERMINAL.has(mission.status)) return mission;
  cancelledSet.add(id);
  const c = controllers.get(id);
  if (c) {
    try {
      c.abort();
    } catch {
      /* noop */
    }
  } else {
    // Still queued: mark cancelled now; the background starter checks the set.
    mission.status = 'cancelled';
    mission.error = 'cancelled by operator';
    await emit(mission, { type: 'mission_end', status: 'cancelled', error: mission.error });
  }
  return mission;
}

/** Subscribe to live events for a mission. Returns an unsubscribe function. */
export function subscribe(missionId, listener) {
  bus.on(missionId, listener);
  return () => bus.off(missionId, listener);
}

export function isTerminal(status) {
  return TERMINAL.has(status);
}
