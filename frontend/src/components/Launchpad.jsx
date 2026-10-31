import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { builtinTiles } from '../data/builtinTiles.js';
import TileCard from './TileCard.jsx';
import CustomTileForm from './CustomTileForm.jsx';

function customAskUrl(tile, q) {
  if (tile.param === 'none') return tile.open;
  const sep = tile.open.includes('?') ? '&' : '?';
  return `${tile.open}${sep}${tile.param}=${encodeURIComponent(q)}`;
}

export default function Launchpad() {
  const [question, setQuestion] = useState('');
  const [custom, setCustom] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const load = () =>
    api
      .tiles()
      .then((r) => setCustom(r.tiles))
      .catch((e) => setError(e.message));

  useEffect(() => {
    load();
  }, []);

  const flash = (msg) => {
    setNotice(msg);
    setTimeout(() => setNotice(''), 3500);
  };

  const launch = async (tile) => {
    const q = question.trim();
    let url = tile.open;
    if (q) {
      if (tile.ask) url = tile.ask(q);
      else if (tile.param) url = customAskUrl(tile, q);
      try {
        await navigator.clipboard.writeText(q);
        flash('Question copied — paste it if the site did not prefill it.');
      } catch {
        /* clipboard unavailable */
      }
    }
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const remove = async (id) => {
    try {
      await api.deleteTile(id);
      load();
    } catch (e) {
      setError(e.message);
    }
  };

  const exportJson = async () => {
    const blob = new Blob([JSON.stringify(custom, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'ai-army-tiles.json';
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const importJson = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const tiles = JSON.parse(await file.text());
      if (!Array.isArray(tiles)) throw new Error('not a tile list');
      for (const t of tiles) {
        await api.addTile({ name: t.name, url: t.open || t.url, param: t.param || 'none' });
      }
      load();
      flash('Tiles imported.');
    } catch (err) {
      setError(`Import failed: ${err.message}`);
    }
    e.target.value = '';
  };

  return (
    <section className="launchpad">
      <div className="askbar">
        <textarea
          placeholder="Question for the web apps — opens each site with it prefilled (or copied)…"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          rows={2}
        />
      </div>
      {notice && <div className="notice">{notice}</div>}
      {error && <div className="error">{error}</div>}

      <h3>Built-in</h3>
      <p className="muted small">
        These sites block embedding, so they open in new tabs — log into each once and your browser keeps you signed in.
      </p>
      <div className="tile-grid">
        {builtinTiles.map((t) => (
          <TileCard key={t.id} name={t.name} onOpen={() => launch({ open: t.open })} onAsk={() => launch(t)} canAsk={Boolean(question.trim())} />
        ))}
      </div>

      <div className="custom-head">
        <h3>Your sites ({custom.length})</h3>
        <div className="row">
          <button className="ghost small" onClick={() => setShowForm((s) => !s)}>
            {showForm ? 'Close' : '+ Add site'}
          </button>
          <button className="ghost small" onClick={exportJson} disabled={custom.length === 0}>
            Export
          </button>
          <label className="ghost small file-label">
            Import
            <input type="file" accept="application/json" hidden onChange={importJson} />
          </label>
        </div>
      </div>
      {showForm && (
        <CustomTileForm
          onAdded={() => {
            setShowForm(false);
            load();
            flash('Site added to your launchpad.');
          }}
          onError={setError}
        />
      )}
      <div className="tile-grid">
        {custom.map((t) => (
          <TileCard
            key={t.id}
            name={t.name}
            custom
            onOpen={() => launch({ open: t.url })}
            onAsk={() => launch({ open: t.url, param: t.param })}
            onRemove={() => remove(t.id)}
            canAsk={Boolean(question.trim())}
          />
        ))}
      </div>
      {custom.length === 0 && !showForm && <p className="muted">No custom sites yet — add the AI tools you actually use.</p>}
    </section>
  );
}
