const DOTS = {
  idle: 'dot idle',
  thinking: 'dot thinking',
  streaming: 'dot streaming',
  done: 'dot done',
  error: 'dot error',
};

const LABELS = {
  idle: 'idle',
  thinking: 'thinking…',
  streaming: 'answering…',
  done: 'done',
  error: 'error',
};

export default function SoldierCard({ name, result }) {
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(result.text || '');
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <div className="soldier-card">
      <div className="soldier-head">
        <span className={DOTS[result.status] || DOTS.idle} />
        <span className="soldier-name" title={name}>
          {name}
        </span>
        <span className="soldier-status">{LABELS[result.status] || result.status}</span>
        <button className="ghost small" onClick={copy} disabled={!result.text}>
          Copy
        </button>
      </div>
      <div className="soldier-body">
        {result.error ? (
          <span className="error-text">{result.error}</span>
        ) : result.text ? (
          result.text
        ) : (
          <span className="muted">{result.status === 'idle' ? 'Awaiting orders.' : '…'}</span>
        )}
      </div>
    </div>
  );
}
