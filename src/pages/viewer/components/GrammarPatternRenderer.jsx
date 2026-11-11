import { grammarMarkersFor } from '../../../utils/grammarMarkers';

// Viewer owns tap/long-press hit testing, including saved sentences.
export default function GrammarPatternRenderer({ annotation, ocrWords }) {
  const markers = grammarMarkersFor(annotation, ocrWords);
  return (
    <g className="grammar-pattern-group" aria-hidden="true">
      {markers.map((marker, index) => (
        <line key={index} x1={`${marker.x}%`} y1={`${marker.y}%`}
          x2={`${marker.x + marker.width}%`} y2={`${marker.y2 ?? marker.y}%`}
          className={`grammar-underline grammar-underline-${marker.role}`} />
      ))}
    </g>
  );
}

// The placeholder each slot fills (A, B, ~, V-ing …), written small under its
// light underline. HTML rather than SVG text: the SVG overlay stretches to the
// page (preserveAspectRatio="none") and would distort the letters.
export function GrammarSlotLabels({ annotations, ocrWords }) {
  const labels = annotations.flatMap(annotation => grammarMarkersFor(annotation, ocrWords)
    .filter(marker => marker.label)
    .map((marker, index) => ({ key: `${annotation.id}-${index}`, marker })));
  if (!labels.length) return null;
  return (
    <div className="grammar-slot-labels" aria-hidden="true">
      {labels.map(({ key, marker }) => (
        <span key={key} style={{
          left: `${marker.x + marker.width / 2}%`,
          top: `${(marker.y + (marker.y2 ?? marker.y)) / 2}%`,
          '--glyph': marker.size,
        }}>{marker.label}</span>
      ))}
    </div>
  );
}
