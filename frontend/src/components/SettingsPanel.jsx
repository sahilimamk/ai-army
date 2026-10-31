import { useEffect, useState } from 'react';
import { api } from '../api.js';

export default function SettingsPanel() {
  const [info, setInfo] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([api.health().catch(() => null), api.config().catch(() => null)]).then(([health, config]) => {
      if (!health || !config) {
        setError('Could not reach the backend.');
        return;
      }
      setInfo({ health, config });
    });
  }, []);

  return (
    <section className="settings">
      <h3>Server</h3>
      {error && <div className="error">{error}</div>}
      {info && (
        <dl className="kv">
          <dt>Backend</dt>
          <dd className="ok">online{info.health.time ? ` — ${new Date(info.health.time).toLocaleString()}` : ''}</dd>
          <dt>OpenRouter key</dt>
          <dd className={info.config.hasOpenRouterKey ? 'ok' : 'bad'}>
            {info.config.hasOpenRouterKey ? 'configured on server (never sent to browser)' : 'missing — set OPENROUTER_API_KEY in .env'}
          </dd>
        </dl>
      )}
      <h3>Remote access</h3>
      <p className="muted">
        See <code>DEPLOY.md</code> in the project for the options: Cloudflare Tunnel (easiest from a home machine), a VPS with
        Caddy, or Railway / Render / Fly. Note: this build has no login gate — anyone with the link can use the dashboard and
        spend your OpenRouter key, so only share the tunnel URL with people you trust, and keep the key in <code>.env</code>.
      </p>
    </section>
  );
}
