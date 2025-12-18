export default function GrammarTooltip({ pattern, position, onClose }) {
  if (!pattern) return null;

  return (
    <div
      className="grammar-tooltip"
      style={{
        top: position.y,
        left: position.x,
        transform: 'translate(-50%, -100%)',
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="grammar-tooltip-header" style={{ color: pattern.color }}>
        {pattern.typeKr || pattern.type}
      </div>
      <div className="grammar-tooltip-words">
        {pattern.words?.join(' ') || ''}
      </div>
      <div className="grammar-tooltip-explanation">
        {pattern.explanation}
      </div>
      <button className="grammar-tooltip-close" onClick={onClose}>
        ×
      </button>
    </div>
  );
}
