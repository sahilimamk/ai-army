import { Router } from 'express';
import { config } from '../config.js';
import { listModels, streamChatCompletion } from '../services/openrouter.js';
import { tileStore } from '../services/tileStore.js';

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

export default router;
