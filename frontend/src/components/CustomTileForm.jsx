import { useState } from 'react';
import { api } from '../api.js';

export default function CustomTileForm({ onAdded, onError }) {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [param, setParam] = useState('q');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.addTile({ name, url, param });
      setName('');
      setUrl('');
      onAdded();
    } catch (err) {
      onError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="tile-form" onSubmit={submit}>
      <input placeholder="Name — e.g. You.com" value={name} onChange={(e) => setName(e.target.value)} />
      <input placeholder="https://…" value={url} onChange={(e) => setUrl(e.target.value)} inputMode="url" />
      <select value={param} onChange={(e) => setParam(e.target.value)} title="How the site receives the question">
        <option value="q">?q=</option>
        <option value="prompt">?prompt=</option>
        <option value="text">?text=</option>
        <option value="none">no prefill</option>
      </select>
      <button className="primary" type="submit" disabled={busy || !name.trim() || !url.trim()}>
        {busy ? 'Adding…' : 'Add'}
      </button>
      <p className="muted small full">
        Only <code>https://</code> URLs are accepted; addresses with embedded credentials are rejected. Tiles are stored on your
        server, so they follow you across devices.
      </p>
    </form>
  );
}
