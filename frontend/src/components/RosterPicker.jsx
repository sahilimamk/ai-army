import { useState } from 'react';

export default function RosterPicker({ models, selected, onChange, disabled }) {
  const [filter, setFilter] = useState('');

  const toggle = (id) => {
    if (selected.includes(id)) onChange(selected.filter((s) => s !== id));
    else if (selected.length < 12) onChange([...selected, id]);
  };

  const visible = models.filter((m) => m.id.toLowerCase().includes(filter.toLowerCase())).slice(0, 200);

  return (
    <div className="roster">
      <div className="roster-head">
        <strong>Soldiers ({selected.length}/12)</strong>
        <input
          className="filter"
          placeholder="Filter models…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <button
          className="ghost small"
          disabled={disabled}
          onClick={() => {
            const free = models.filter((m) => m.id.endsWith(':free')).slice(0, 4).map((m) => m.id);
            if (free.length) onChange(free);
          }}
        >
          4 free
        </button>
        <button className="ghost small" disabled={disabled} onClick={() => onChange([])}>
          Clear
        </button>
      </div>
      <div className="roster-grid">
        {visible.map((m) => (
          <label key={m.id} className={selected.includes(m.id) ? 'soldier-toggle on' : 'soldier-toggle'}>
            <input type="checkbox" checked={selected.includes(m.id)} disabled={disabled} onChange={() => toggle(m.id)} />
            <span className="tname" title={m.id}>
              {m.name}
            </span>
            {m.id.endsWith(':free') && <span className="free-badge">free</span>}
          </label>
        ))}
      </div>
      {models.length === 0 && <p className="muted">Loading roster…</p>}
    </div>
  );
}
