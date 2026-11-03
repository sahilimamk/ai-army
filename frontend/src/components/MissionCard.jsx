const DOTS = {
  queued: 'dot idle',
  running: 'dot thinking',
  awaiting_approval: 'dot streaming',
  done: 'dot done',
  failed: 'dot error',
  cancelled: 'dot error',
};

const LABELS = {
  queued: 'queued…',
  running: 'on mission…',
  awaiting_approval: 'needs approval',
  done: 'done',
  failed: 'failed',
  cancelled: 'cancelled',
};

const ACTIVE = new Set(['queued', 'running', 'awaiting_approval']);

function fmtArgs(args) {
  try {
    const s = JSON.stringify(args || {});
    return s.length > 220 ? s.slice(0, 220) + '…' : s;
  } catch {
    return '';
  }
}

function LogLine({ ev }) {
  switch (ev.type) {
    case 'step':
      return <div className="log-line">— step {ev.step}: thinking…</div>;
    case 'tool_call':
      return (
        <div className="log-line log-tool">
          ⚙ <code>{ev.tool}</code> <span className="muted">{fmtArgs(ev.args)}</span>
        </div>
      );
    case 'tool_result':
      return <div className="log-line log-result">{String(ev.result).slice(0, 300)}</div>;
    case 'backoff':
      return <div className="log-line muted">⏳ rate-limited, retrying in {Math.round(ev.waitMs / 1000)}s…</div>;
    case 'needs_approval':
      return <div className="log-line log-warn">⚠ risky command — waiting for your approval</div>;
    case 'approval':
      return (
        <div className="log-line muted">
          {ev.approved ? '✓ approved by operator' : '✕ denied by operator'}
        </div>
      );
    case 'mission_end':
      return null;
    case 'status':
      return null;
    default:
      return null;
  }
}

export default function MissionCard({ mission, onApprove, onCancel }) {
  const active = ACTIVE.has(mission.status);
  const pa = mission.pendingApproval;

  const copyResult = async () => {
    try {
      await navigator.clipboard.writeText(mission.result || '');
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <div className="mission-card">
      <div className="soldier-head">
        <span className={DOTS[mission.status] || DOTS.queued} />
        <span className="soldier-name" title={`${mission.agentName} · ${mission.model}`}>
          {mission.agentName}
        </span>
        <span className="soldier-status">{LABELS[mission.status] || mission.status}</span>
        {active && (
          <button className="ghost small" onClick={() => onCancel(mission.id)}>
            Cancel
          </button>
        )}
        {!active && mission.result && (
          <button className="ghost small" onClick={copyResult}>
            Copy
          </button>
        )}
      </div>

      <div className="mission-prompt small muted">{mission.prompt}</div>

      {pa && (
        <div className="approval-box">
          <div>
            <strong>{mission.agentName}</strong> wants to run{' '}
            <code>{pa.tool}</code>
            <div className="small muted">{pa.reason}</div>
            <pre className="approval-cmd">{fmtArgs(pa.args)}</pre>
          </div>
          <div className="approval-actions">
            <button className="primary" onClick={() => onApprove(mission.id, pa.callId, true)}>
              Approve
            </button>
            <button className="danger" onClick={() => onApprove(mission.id, pa.callId, false)}>
              Deny
            </button>
          </div>
        </div>
      )}

      <div className="mission-log">
        {(mission.log || []).map((ev, i) => (
          <LogLine key={`${ev.t}-${i}`} ev={ev} />
        ))}
        {mission.status === 'queued' && <div className="log-line muted">Waiting for a free slot…</div>}
      </div>

      {mission.status === 'done' && mission.result && (
        <div className="mission-result">{mission.result}</div>
      )}
      {(mission.status === 'failed' || mission.status === 'cancelled') && mission.error && (
        <div className="error-text">{mission.error}</div>
      )}
    </div>
  );
}
