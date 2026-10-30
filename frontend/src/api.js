async function req(path, opts = {}) {
  let r;
  try {
    r = await fetch(path, {
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      ...opts,
    });
  } catch {
    const err = new Error('network');
    err.code = 'network';
    throw err;
  }
  if (!r.ok) {
    let msg = `HTTP ${r.status}`;
    try {
      const j = await r.json();
      if (j && j.error) msg = j.error;
    } catch {
      /* keep default */
    }
    const err = new Error(msg);
    err.code = r.status;
    throw err;
  }
  const ct = r.headers.get('content-type') || '';
  return ct.includes('json') ? r.json() : r.text();
}

/**
 * POST /api/ask and parse the SSE stream.
 * onEvent receives {model, type:'status'|'token'|'done'|'error', ...} and {type:'all-done'}.
 * Returns { promise, abort }.
 */
function ask(question, models, onEvent) {
  const ctrl = new AbortController();
  const promise = (async () => {
    const r = await fetch('/api/ask', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question, models }),
      signal: ctrl.signal,
    });
    if (!r.ok) {
      let msg = `HTTP ${r.status}`;
      try {
        const j = await r.json();
        if (j.error) msg = j.error;
      } catch {
        /* keep default */
      }
      const err = new Error(msg);
      err.code = r.status;
      throw err;
    }
    const reader = r.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    const handleLine = (raw) => {
      if (raw === '[DONE]') {
        onEvent({ type: 'all-done' });
        return;
      }
      try {
        onEvent(JSON.parse(raw));
      } catch {
        /* ignore malformed frames */
      }
    };
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const chunk = buf.slice(0, i);
        buf = buf.slice(i + 2);
        for (const line of chunk.split('\n')) {
          const t = line.trim();
          if (t.startsWith('data:')) handleLine(t.slice(5).trim());
        }
      }
    }
  })();
  return { promise, abort: () => ctrl.abort() };
}

export const api = {
  config: () => req('/api/config'),
  health: () => req('/api/health'),
  models: () => req('/api/models'),
  tiles: () => req('/api/tiles'),
  addTile: (tile) => req('/api/tiles', { method: 'POST', body: JSON.stringify(tile) }),
  deleteTile: (id) => req(`/api/tiles/${id}`, { method: 'DELETE' }),
  ask,
  // ---- Barracks ----
  providers: () => req('/api/providers'),
  tools: () => req('/api/tools'),
  agents: () => req('/api/agents'),
  addAgent: (agent) => req('/api/agents', { method: 'POST', body: JSON.stringify(agent) }),
  updateAgent: (id, agent) => req(`/api/agents/${id}`, { method: 'PUT', body: JSON.stringify(agent) }),
  deleteAgent: (id) => req(`/api/agents/${id}`, { method: 'DELETE' }),
  dispatchMissions: (prompt, agentIds) =>
    req('/api/missions', { method: 'POST', body: JSON.stringify({ prompt, agentIds }) }),
  missions: (opts = {}) => {
    const q = new URLSearchParams();
    if (opts.limit) q.set('limit', opts.limit);
    if (opts.active) q.set('active', 'true');
    const qs = q.toString();
    return req(`/api/missions${qs ? `?${qs}` : ''}`);
  },
  mission: (id) => req(`/api/missions/${id}`),
  cancelMission: (id) => req(`/api/missions/${id}`, { method: 'DELETE' }),
  approveTool: (missionId, callId, approved) =>
    req(`/api/missions/${missionId}/approvals/${callId}`, {
      method: 'POST',
      body: JSON.stringify({ approved }),
    }),
  missionEvents,
};

/**
 * GET /api/missions/:id/events and parse the SSE stream.
 * onEvent receives the mission log events; {type:'mission_end'} closes it.
 * Returns { promise, abort }. The server replays the stored log first, so
 * late subscribers still see the full story.
 */
function missionEvents(id, onEvent) {
  const ctrl = new AbortController();
  const promise = (async () => {
    const r = await fetch(`/api/missions/${id}/events`, {
      credentials: 'include',
      signal: ctrl.signal,
    });
    if (!r.ok) {
      let msg = `HTTP ${r.status}`;
      try {
        const j = await r.json();
        if (j.error) msg = j.error;
      } catch {
        /* keep default */
      }
      throw Object.assign(new Error(msg), { code: r.status });
    }
    const reader = r.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const chunk = buf.slice(0, i);
        buf = buf.slice(i + 2);
        for (const line of chunk.split('\n')) {
          const t = line.trim();
          if (!t.startsWith('data:')) continue;
          const raw = t.slice(5).trim();
          if (raw === '[DONE]') return;
          try {
            onEvent(JSON.parse(raw));
          } catch {
            /* ignore malformed frames */
          }
        }
      }
    }
  })();
  return { promise, abort: () => ctrl.abort() };
}
