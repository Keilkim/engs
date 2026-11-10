import { useMemo } from 'react';
import { buildGrammarMarkers } from '../../../utils/grammarMarkers';

// Viewer owns tap/long-press hit testing, including saved sentences.
export default function GrammarPatternRenderer({ annotation, ocrWords }) {
  const markers = useMemo(() => buildGrammarMarkers(annotation, ocrWords), [annotation, ocrWords]);
  return (
    <g className="grammar-pattern-group" aria-hidden="true">
      {markers.map((marker, index) => (
        <line key={index} x1={`${marker.x}%`} y1={`${marker.y + marker.height}%`}
          x2={`${marker.x + marker.width}%`} y2={`${marker.y + marker.height}%`}
          className={`grammar-underline grammar-underline-${marker.role}`} />
      ))}
    </g>
  );
}
