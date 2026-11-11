import { useLayoutEffect, useRef, useState } from 'react';
import { grammarMarkersFor } from '../../../utils/grammarMarkers';

// The expression's own words: a solid dark blue line in the SVG overlay.
// Viewer owns tap/long-press hit testing, including saved sentences.
export default function GrammarPatternRenderer({ annotation, ocrWords }) {
  const markers = grammarMarkersFor(annotation, ocrWords).filter(marker => marker.role === 'fixed');
  return (
    <g className="grammar-pattern-group" aria-hidden="true">
      {markers.map((marker, index) => (
        <line key={index} x1={`${marker.x}%`} y1={`${marker.y}%`}
          x2={`${marker.x + marker.width}%`} y2={`${marker.y2 ?? marker.y}%`}
          className="grammar-underline" />
      ))}
    </g>
  );
}

// Words filling a replaceable part: a light blue wave, with the placeholder
// they fill (A, B, ~, V-ing …) written small underneath. HTML rather than SVG:
// the SVG overlay stretches to the page (preserveAspectRatio="none") and
// would distort both the wave and the letters. The wave's tilt and length are
// worked out from the measured page size (CSS atan2() over cqw/cqh units is
// mis-computed by Safari before 18), so it follows a tilted scan's baseline.
export function GrammarSlotMarks({ annotations, ocrWords }) {
  const layerRef = useRef(null);
  const [size, setSize] = useState(null);
  const marks = annotations.flatMap(annotation => grammarMarkersFor(annotation, ocrWords)
    .filter(marker => marker.role === 'variable')
    .map((marker, index) => ({ key: `${annotation.id}-${index}`, marker })));
  const hasMarks = marks.length > 0;

  useLayoutEffect(() => {
    const layer = layerRef.current;
    if (!layer) return undefined;
    // Layout size, not the zoomed on-screen size: the zoom transform scales the marks with the page.
    const measure = () => setSize(prev => (prev?.width === layer.offsetWidth && prev?.height === layer.offsetHeight
      ? prev : { width: layer.offsetWidth, height: layer.offsetHeight }));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(layer);
    return () => observer.disconnect();
  }, [hasMarks]);

  if (!hasMarks) return null;
  return (
    <div ref={layerRef} className="grammar-slot-marks" aria-hidden="true">
      {marks.map(({ key, marker }) => {
        const y2 = marker.y2 ?? marker.y;
        const dx = size ? marker.width / 100 * size.width : 0;
        const dy = size ? (y2 - marker.y) / 100 * size.height : 0;
        return [
          <span key={`${key}-wave`} className="grammar-slot-wave" style={{
            left: `${marker.x}%`, top: `${marker.y}%`,
            width: size ? `${Math.hypot(dx, dy)}px` : `${marker.width}%`,
            rotate: `${size && dx ? Math.atan2(dy, dx) : 0}rad`,
          }} />,
          marker.label && <span key={`${key}-label`} className="grammar-slot-label" style={{
            left: `${marker.x + marker.width / 2}%`, top: `${(marker.y + y2) / 2}%`, '--glyph': marker.size,
          }}>{marker.label}</span>,
        ];
      })}
    </div>
  );
}
