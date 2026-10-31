import SoldierCard from './SoldierCard.jsx';
import RosterPicker from './RosterPicker.jsx';
import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';

function pickDiverseFree(models, n = 4) {
  const free = models.filter((m) => m.id.endsWith(':free'));
  const picked = [];
  const vendors = new Set();
  for (const m of free) {
    const vendor = m.id.split('/')[0];
    if (vendors.has(vendor)) continue;
    vendors.add(vendor);
    picked.push(m.id);
    if (picked.length === n) break;
  }
  if (picked.length === 0) return models.slice(0, n).map((m) => m.id);
  return picked;
}

export default function WarRoom() {
  const [models, setModels] = useState([]);
  const [selected, setSelected] = useState([]);
  const [question, setQuestion] = useState('');
  const [results, setResults] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [hasKey, setHasKey] = useState(true);
  const runRef = useRef(null);

  useEffect(() => {
    api
      .config()
      .then((c) => setHasKey(c.hasOpenRouterKey))
      .catch(() => {});
    api
      .models()
      .then((r) => {
        setModels(r.models);
        setSelected(pickDiverseFree(r.models));
      })
      .catch((e) => setError(`Could not load model roster: ${e.message}`));
  }, []);

  const patch = (model, fn) =>
    setResults((prev) => ({ ...prev, [model]: fn(prev[model] || { status: 'idle', text: '' }) }));

  const deploy = () => {
    const q = question.trim();
    if (!q || selected.length === 0 || busy) return;
    setError('');
    const fresh = {};
    for (const m of selected) fresh[m] = { status: 'thinking', text: '' };
    setResults(fresh);
    setBusy(true);

    const { promise, abort } = api.ask(q, selected, (ev) => {
      if (ev.type === 'all-done') {
        setBusy(false);
        runRef.current = null;
        return;
      }
      const { model, type } = ev;
      if (type === 'token') {
        patch(model, (r) => ({ status: 'streaming', text: r.text + ev.text }));
      } else if (type === 'done') {
        patch(model, (r) => ({ ...r, status: 'done' }));
      } else if (type === 'status') {
        patch(model, (r) => ({ ...r, status: ev.status }));
      } else if (type === 'error') {
        patch(model, (r) => ({ status: 'error', text: r.text, error: ev.error }));
      }
    });
    runRef.current = { promise, abort };
    promise.catch((e) => {
      if (e.code !== 401 && e.name !== 'AbortError') setError(e.message);
      setBusy(false);
      runRef.current = null;
    });
  };

  const stop = () => {
    runRef.current?.abort();
    runRef.current = null;
    setBusy(false);
  };

  const copyAll = async () => {
    const parts = selected.map((m) => {
      const r = results[m];
      return `## ${m}\n\n${r?.text || '(no answer)'}`;
    });
    try {
      await navigator.clipboard.writeText(parts.join('\n\n---\n\n'));
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <section className="warroom">
      {!hasKey && (
        <div className="warn">
          No <code>OPENROUTER_API_KEY</code> on the server. Add it to <code>.env</code> and restart the backend — the War Room stays
          dark until then.
        </div>
      )}
      <div className="askbar">
        <textarea
          placeholder="One question for the whole army…"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          rows={3}
        />
        <div className="askbar-actions">
          <button className="primary big" onClick={deploy} disabled={busy || !question.trim() || selected.length === 0}>
            {busy ? 'Deployed…' : `Deploy to ${selected.length} soldier${selected.length === 1 ? '' : 's'}`}
          </button>
          {busy && (
            <button className="danger" onClick={stop}>
              Stop all
            </button>
          )}
          <button className="ghost" onClick={copyAll} disabled={Object.keys(results).length === 0}>
            Copy all answers
          </button>
        </div>
      </div>
      {error && <div className="error">{error}</div>}
      <RosterPicker models={models} selected={selected} onChange={setSelected} disabled={busy} />
      <div className="soldiers">
        {selected.map((m) => (
          <SoldierCard key={m} name={m} result={results[m] || { status: 'idle', text: '' }} />
        ))}
      </div>
      {selected.length === 0 && <p className="muted">Select at least one soldier above to deploy.</p>}
    </section>
  );
}
