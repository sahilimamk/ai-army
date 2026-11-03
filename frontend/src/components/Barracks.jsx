import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import MissionCard from './MissionCard.jsx';

function AgentForm({ providers, toolDefs, initial, onSave, onCancel }) {
  const [f, setF] = useState(
    initial || { name: '', provider: providers[0]?.id || 'gemini', model: '', systemPrompt: '', tools: [] }
  );
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const prov = providers.find((p) => p.id === f.provider);

  const toggleTool = (t) =>
    setF((prev) => ({
      ...prev,
      tools: prev.tools.includes(t) ? prev.tools.filter((x) => x !== t) : [...prev.tools, t],
    }));

  const save = async () => {
    setSaving(true);
    setErr('');
    try {
      await onSave({ name: f.name, provider: f.provider, model: f.model, systemPrompt: f.systemPrompt, tools: f.tools });
    } catch (e) {
      setErr(e.message);
      setSaving(false);
    }
  };

  return (
    <div className="agent-form">
      <h4>{initial?.id ? 'Edit agent' : 'New agent'}</h4>
      {err && <div className="error">{err}</div>}
      <div className="form-grid">
        <label>
          Name
          <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Scout" />
        </label>
        <label>
          Provider
          <select value={f.provider} onChange={(e) => setF({ ...f, provider: e.target.value, model: '' })}>
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <label className="full">
          Model
          <input
            value={f.model}
            onChange={(e) => setF({ ...f, model: e.target.value })}
            placeholder={prov?.defaultModel || 'model id'}
          />
        </label>
        <label className="full">
          System prompt (who this agent is)
          <textarea
            value={f.systemPrompt}
            onChange={(e) => setF({ ...f, systemPrompt: e.target.value })}
            rows={3}
            placeholder="You are Scout, a fast research operative…"
          />
        </label>
        <div className="full">
          <div className="small muted" style={{ marginBottom: 6 }}>Tools</div>
          <div className="tool-picks">
            {toolDefs.map((t) => (
              <button
                key={t.name}
                className={f.tools.includes(t.name) ? 'soldier-toggle on' : 'soldier-toggle'}
                onClick={() => toggleTool(t.name)}
                title={t.description}
              >
                <span className="tname">{t.name}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="form-actions">
        <button className="primary" onClick={save} disabled={saving || !f.name.trim() || !f.model.trim()}>
          {saving ? 'Saving…' : initial?.id ? 'Save changes' : 'Add agent'}
        </button>
        <button className="ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

export default function Barracks() {
  const [providers, setProviders] = useState([]);
  const [toolDefs, setToolDefs] = useState([]);
  const [agents, setAgents] = useState([]);
  const [selected, setSelected] = useState([]);
  const [prompt, setPrompt] = useState('');
  const [missions, setMissions] = useState({});
  const [inbox, setInbox] = useState([]);
  const [expanded, setExpanded] = useState(null);
  const [form, setForm] = useState(null);
  const [error, setError] = useState('');
  const [deploying, setDeploying] = useState(false);
  const subsRef = useRef({});

  const refreshInbox = () =>
    api
      .missions({ limit: 30 })
      .then((r) => setInbox(r.missions))
      .catch(() => {});

  const loadAgents = () =>
    api
      .agents()
      .then((r) => {
        setAgents(r.agents);
        setSelected((prev) => prev.filter((id) => r.agents.some((a) => a.id === id)));
      })
      .catch((e) => setError(e.message));

  const watch = (id) => {
    if (subsRef.current[id]) return;
    api
      .mission(id)
      .then((r) => {
        // Base metadata now; the event stream replays the full log itself.
        setMissions((prev) => ({ ...prev, [id]: { ...r.mission, log: [] } }));
        const { promise, abort } = api.missionEvents(id, (ev) => {
          setMissions((prev) => {
            const m = prev[id];
            if (!m) return prev;
            const next = { ...m };
            if (ev.type === 'mission_end') {
              next.status = ev.status;
              if (ev.error) next.error = ev.error;
              next.pendingApproval = null;
            } else if (ev.type === 'needs_approval') {
              next.status = 'awaiting_approval';
              next.pendingApproval = {
                callId: ev.callId,
                tool: ev.tool,
                args: ev.args,
                reason: ev.reason,
              };
            } else if (ev.type === 'approval') {
              next.status = 'running';
              next.pendingApproval = null;
            } else if (ev.type === 'status') {
              next.status = ev.status;
            }
            next.log = [...(next.log || []), ev];
            return { ...prev, [id]: next };
          });
          if (ev.type === 'mission_end') {
            setTimeout(() => {
              try {
                subsRef.current[id]?.abort();
              } catch {
                /* noop */
              }
              delete subsRef.current[id];
              setMissions((prev) => {
                const n = { ...prev };
                delete n[id];
                return n;
              });
              refreshInbox();
            }, 2000);
          }
        });
        subsRef.current[id] = { promise, abort };
        promise.catch(() => {});
      })
      .catch((e) => setError(e.message));
  };

  useEffect(() => {
    api.providers().then((r) => setProviders(r.providers)).catch(() => {});
    api.tools().then((r) => setToolDefs(r.tools)).catch(() => {});
    loadAgents();
    refreshInbox();
    api
      .missions({ active: true })
      .then((r) => r.missions.forEach((m) => watch(m.id)))
      .catch(() => {});
    return () => {
      Object.values(subsRef.current).forEach((s) => {
        try {
          s.abort();
        } catch {
          /* noop */
        }
      });
      subsRef.current = {};
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleAgent = (id) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const deploy = async () => {
    const p = prompt.trim();
    if (!p || selected.length === 0 || deploying) return;
    setDeploying(true);
    setError('');
    try {
      const r = await api.dispatchMissions(p, selected);
      setPrompt('');
      r.missions.forEach((m) => watch(m.id));
    } catch (e) {
      setError(e.message);
    } finally {
      setDeploying(false);
    }
  };

  const approve = async (missionId, callId, ok) => {
    try {
      await api.approveTool(missionId, callId, ok);
    } catch (e) {
      setError(e.message);
    }
  };

  const cancel = async (id) => {
    try {
      await api.cancelMission(id);
    } catch (e) {
      setError(e.message);
    }
  };

  const removeAgent = async (id) => {
    if (!window.confirm('Delete this agent?')) return;
    try {
      await api.deleteAgent(id);
      loadAgents();
    } catch (e) {
      setError(e.message);
    }
  };

  const saveAgent = async (fields) => {
    if (form.id) await api.updateAgent(form.id, fields);
    else await api.addAgent(fields);
    setForm(null);
    loadAgents();
  };

  const unconfigured = providers.filter((p) => !p.configured);
  const activeList = Object.values(missions);

  return (
    <section className="barracks">
      {unconfigured.length > 0 && (
        <div className="warn">
          Not configured: {unconfigured.map((p) => p.label).join(', ')}. {unconfigured[0].hint}
        </div>
      )}

      <div className="barracks-head">
        <h3>Roster</h3>
        <button className="ghost" onClick={() => setForm({})}>
          + New agent
        </button>
      </div>
      {form && (
        <AgentForm
          providers={providers}
          toolDefs={toolDefs}
          initial={form.id ? form : null}
          onSave={saveAgent}
          onCancel={() => setForm(null)}
        />
      )}
      <div className="agent-grid">
        {agents.map((a) => {
          const prov = providers.find((p) => p.id === a.provider);
          return (
            <div key={a.id} className="agent-card">
              <div className="soldier-head">
                <span className="soldier-name">{a.name}</span>
                {!prov?.configured && <span className="bad small">not configured</span>}
              </div>
              <div className="small muted">
                {prov?.label || a.provider} · <code>{a.model}</code>
              </div>
              <div className="tool-badges">
                {a.tools.map((t) => (
                  <span key={t} className="tool-badge">
                    {t}
                  </span>
                ))}
                {a.tools.length === 0 && <span className="muted small">no tools — answers only</span>}
              </div>
              <div className="agent-actions">
                <button className="ghost small" onClick={() => setForm({ ...a })}>
                  Edit
                </button>
                <button className="danger-text small" onClick={() => removeAgent(a.id)}>
                  Delete
                </button>
              </div>
            </div>
          );
        })}
      </div>
      {agents.length === 0 && <p className="muted">No agents yet — add your first above.</p>}

      <h3>Deploy a mission</h3>
      <div className="askbar">
        <textarea
          placeholder="Orders for the squad — e.g. research the cheapest NVMe VPS in India and save a comparison to notes/vps.md"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={3}
        />
        <div className="roster-grid">
          {agents.map((a) => (
            <button
              key={a.id}
              className={selected.includes(a.id) ? 'soldier-toggle on' : 'soldier-toggle'}
              onClick={() => toggleAgent(a.id)}
            >
              <span className="tname">{a.name}</span>
            </button>
          ))}
        </div>
        <div className="askbar-actions">
          <button
            className="primary big"
            onClick={deploy}
            disabled={deploying || !prompt.trim() || selected.length === 0}
          >
            {deploying ? 'Deploying…' : `Deploy to ${selected.length} agent${selected.length === 1 ? '' : 's'}`}
          </button>
        </div>
      </div>
      {error && <div className="error">{error}</div>}

      <h3>Active missions</h3>
      {activeList.length === 0 && <p className="muted">No active missions. The squad is standing by.</p>}
      <div className="missions">
        {activeList.map((m) => (
          <MissionCard key={m.id} mission={m} onApprove={approve} onCancel={cancel} />
        ))}
      </div>

      <h3>Inbox</h3>
      {inbox.length === 0 && <p className="muted">Nothing completed yet.</p>}
      <div className="inbox-list">
        {inbox.map((m) => (
          <div key={m.id} className="inbox-item">
            <button className="inbox-head" onClick={() => setExpanded(expanded === m.id ? null : m.id)}>
              <span className={m.status === 'done' ? 'dot done' : 'dot error'} />
              <span className="inbox-agent">{m.agentName}</span>
              <span className="inbox-prompt muted">{m.prompt.slice(0, 80)}</span>
              <span className="muted small">{new Date(m.createdAt).toLocaleString()}</span>
            </button>
            {expanded === m.id && (
              <div className="inbox-body">
                <MissionCard mission={m} onApprove={() => {}} onCancel={() => {}} />
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
