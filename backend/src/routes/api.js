import { Router } from 'express';
import { config } from '../config.js';
import { listModels, streamChatCompletion } from '../services/openrouter.js';
import { tileStore } from '../services/tileStore.js';
import { providerSummary } from '../services/providers/index.js';
import { agentStore } from '../services/agentStore.js';
import { TOOL_DEFS } from '../services/tools.js';
import {
  dispatchMissions,
  listMissions,
  getMission,
  cancelMission,
  resolveApproval,
  subscribe,
  isTerminal,
} from '../services/missions.js';

const router = Router();

// ---- public: health, non-sensitive config ----
router.get('/health', (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));

router.get('/config', (_req, res) =>
  res.json({
    hasOpenRouterKey: Boolean(config.openrouterKey),
    hasGeminiKey: Boolean(config.geminiKey),
    ollamaUrl: config.ollamaUrl,
  })
);

router.get('/models', async (_req, res) => {
  try {
    const models = await listModels();
    res.json({ models: models.map((m) => ({ id: m.id, name: m.name || m.id })) });
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) });
  }
});

router.get('/tiles', async (_req, res) => {
  res.json({ tiles: await tileStore.list() });
});

router.post('/tiles', async (req, res) => {
  try {
    const tile = await tileStore.add(req.body || {});
    res.status(201).json({ tile });
  } catch (e) {
    res.status(e.status || 400).json({ error: String(e.message || e) });
  }
});

router.delete('/tiles/:id', async (req, res) => {
  try {
    await tileStore.remove(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(e.status || 400).json({ error: String(e.message || e) });
  }
});

// Fan-out: one question -> N models in parallel -> SSE stream back.
// Event shapes: {model, type:'status', status} | {model, type:'token', text}
//              | {model, type:'done'} | {model, type:'error', error}
router.post('/ask', async (req, res) => {
  const { question, models } = req.body || {};
  if (!question || !String(question).trim()) return res.status(400).json({ error: 'question is required' });
  if (!Array.isArray(models) || models.length === 0 || models.length > 12)
    return res.status(400).json({ error: 'pick 1–12 models' });
  if (!config.openrouterKey) return res.status(400).json({ error: 'OPENROUTER_API_KEY is not set on the server' });

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  const send = (obj) => {
    try {
      res.write(`data: ${JSON.stringify(obj)}\n\n`);
    } catch {
      /* client went away */
    }
  };

  // If the client disconnects (or we finish), cancel the upstream calls.
  // NOTE: res 'close', not req 'close' — the request stream closes as soon as
  // express.json() consumes the body, which would abort every fan-out instantly.
  const controllers = new Map();
  res.on('close', () => {
    for (const c of controllers.values()) {
      try {
        c.abort();
      } catch {
        /* noop */
      }
    }
  });

  await Promise.allSettled(
    models.map(async (model) => {
      const controller = new AbortController();
      controllers.set(model, controller);
      try {
        send({ model, type: 'status', status: 'thinking' });
        await streamChatCompletion(String(model), String(question), (text) => send({ model, type: 'token', text }), controller.signal);
        send({ model, type: 'done' });
      } catch (e) {
        if (controller.signal.aborted) send({ model, type: 'error', error: 'stopped' });
        else send({ model, type: 'error', error: String(e.message || e) });
      } finally {
        controllers.delete(model);
      }
    })
  );

  try {
    res.write('data: [DONE]\n\n');
  } catch {
    /* noop */
  }
  res.end();
});

// ---------------- Barracks: the subagent fleet ----------------

// Providers & tools (what agents can be built from)
router.get('/providers', (_req, res) => res.json({ providers: providerSummary() }));
router.get('/tools', (_req, res) => res.json({ tools: TOOL_DEFS }));

// Agent roster
router.get('/agents', async (_req, res) => {
  try {
    res.json({ agents: await agentStore.list() });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

router.post('/agents', async (req, res) => {
  try {
    const agent = await agentStore.add(req.body || {});
    res.status(201).json({ agent });
  } catch (e) {
    res.status(e.status || 400).json({ error: String(e.message || e) });
  }
});

router.put('/agents/:id', async (req, res) => {
  try {
    const agent = await agentStore.update(req.params.id, req.body || {});
    res.json({ agent });
  } catch (e) {
    res.status(e.status || 400).json({ error: String(e.message || e) });
  }
});

router.delete('/agents/:id', async (req, res) => {
  try {
    await agentStore.remove(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(e.status || 400).json({ error: String(e.message || e) });
  }
});

// Missions
router.post('/missions', async (req, res) => {
  try {
    const missions = await dispatchMissions(req.body || {});
    res.status(201).json({ missions });
  } catch (e) {
    res.status(e.status || 400).json({ error: String(e.message || e) });
  }
});

router.get('/missions', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit, 10) || 50;
    const missions = await listMissions({ limit, activeOnly: req.query.active === 'true' });
    res.json({ missions });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// Live event stream for one mission. Replays the stored log, then stays open
// for live events until the mission reaches a terminal status.
router.get('/missions/:id/events', async (req, res) => {
  let mission;
  try {
    mission = await getMission(req.params.id);
  } catch (e) {
    return res.status(e.status || 404).json({ error: String(e.message || e) });
  }
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  const send = (obj) => {
    try {
      res.write(`data: ${JSON.stringify(obj)}\n\n`);
    } catch {
      /* client went away */
    }
  };
  for (const ev of mission.log) send(ev);
  if (isTerminal(mission.status)) {
    send({ type: 'mission_end', status: mission.status, replay: true });
    return res.end();
  }
  const onEvent = (ev) => send(ev);
  const off = subscribe(mission.id, onEvent);
  req.on('close', () => off());
});

router.get('/missions/:id', async (req, res) => {
  try {
    res.json({ mission: await getMission(req.params.id) });
  } catch (e) {
    res.status(e.status || 404).json({ error: String(e.message || e) });
  }
});

// Approve or deny a risky tool call the mission is paused on.
router.post('/missions/:id/approvals/:callId', async (req, res) => {
  try {
    const mission = await resolveApproval(req.params.id, req.params.callId, req.body?.approved === true);
    res.json({ mission });
  } catch (e) {
    res.status(e.status || 400).json({ error: String(e.message || e) });
  }
});

// Cancel a queued or running mission.
router.delete('/missions/:id', async (req, res) => {
  try {
    const mission = await cancelMission(req.params.id);
    res.json({ mission });
  } catch (e) {
    res.status(e.status || 404).json({ error: String(e.message || e) });
  }
});

export default router;
