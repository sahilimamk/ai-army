export default function TileCard({ name, onOpen, onAsk, onRemove, canAsk, custom }) {
  return (
    <div className="tile-card">
      <div className="tile-name" title={name}>
        {name}
        {custom && <span className="custom-badge">yours</span>}
      </div>
      <div className="tile-actions">
        <button className="ghost small" onClick={onOpen}>
          Open
        </button>
        <button className="ghost small" onClick={onAsk} disabled={!canAsk} title={canAsk ? 'Open with your question' : 'Type a question above first'}>
          Ask
        </button>
        {onRemove && (
          <button className="danger-text small" onClick={onRemove} title="Remove this tile">
            ✕
          </button>
        )}
      </div>
    </div>
  );
}
