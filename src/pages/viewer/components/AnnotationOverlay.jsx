import { useMemo } from 'react';

/**
 * Checks if annotation is a vocabulary item
 */
function isVocabularyAnnotation(annotation) {
  if (!annotation.ai_analysis_json) return false;
  try {
    const data = JSON.parse(annotation.ai_analysis_json);
    return data.isVocabulary === true;
  } catch {
    return false;
  }
}

/**
 * Checks if annotation is a grammar pattern
 */
function isGrammarAnnotation(annotation) {
  if (!annotation.ai_analysis_json) return false;
  try {
    const data = JSON.parse(annotation.ai_analysis_json);
    return data.type === 'grammar';
  } catch {
    return false;
  }
}

/**
 * Filters annotations by type and page
 */
function filterAnnotations(annotations, type, pageNum = null) {
  return annotations.filter(a => {
    if (!a.selection_rect) return false;

    const isVocab = isVocabularyAnnotation(a);
    const isGrammar = isGrammarAnnotation(a);

    if (type === 'vocabulary' && !isVocab) return false;
    if (type === 'grammar' && !isGrammar) return false;
    if (type === 'regular' && (isVocab || isGrammar)) return false;

    if (pageNum !== null) {
      try {
        const rect = JSON.parse(a.selection_rect);
        return rect.page === pageNum;
      } catch {
        return false;
      }
    }
    return true;
  });
}

/**
 * Convert path data to SVG d attribute
 */
function pathToSvg(path) {
  if (!path || path.length === 0) return '';
  return path.map((p, i) =>
    i === 0 ? `M ${p.x} ${p.y}` : `L ${p.x} ${p.y}`
  ).join(' ');
}

/**
 * SVG Annotation Overlay Component
 *
 * Renders annotations, vocabulary markers, grammar patterns, and selection highlights
 * on top of content.
 */
export default function AnnotationOverlay({
  annotations,
  currentPage = null,
  highlightedVocabId = null,
  activeModal = { type: null, data: {} },
  containerRef = null,
  onAnnotationClick,
  renderGrammarPattern,
}) {
  // Filter annotations by type
  const regularAnnotations = useMemo(() =>
    filterAnnotations(annotations, 'regular', currentPage),
    [annotations, currentPage]
  );

  const vocabAnnotations = useMemo(() =>
    filterAnnotations(annotations, 'vocabulary', currentPage),
    [annotations, currentPage]
  );

  const grammarAnnotations = useMemo(() =>
    filterAnnotations(annotations, 'grammar', currentPage),
    [annotations, currentPage]
  );

  // Render vocabulary markers
  const renderVocabMarkers = () => {
    return vocabAnnotations.map(annotation => {
      try {
        const selectionData = JSON.parse(annotation.selection_rect);
        const bounds = selectionData.bounds || selectionData;

        const pad = 0.3;
        const x = Math.max(0, bounds.x - pad);
        const y = Math.max(0, bounds.y - pad);
        const w = bounds.width + pad * 2;
        const h = bounds.height + pad * 2;

        const isHighlighted = highlightedVocabId === annotation.id;

        return (
          <g key={`vocab-${annotation.id}`}>
            <rect
              x={`${x}%`}
              y={`${y}%`}
              width={`${w}%`}
              height={`${h}%`}
              rx="0.5"
              ry="0.5"
              className={`vocab-marker-bg${isHighlighted ? ' highlighted' : ''}`}
              style={{ pointerEvents: 'none' }}
            />
          </g>
        );
      } catch {
        return null;
      }
    });
  };

  // Render regular annotations (paths and rects)
  const renderRegularAnnotations = () => {
    return regularAnnotations.map(annotation => {
      try {
        const data = JSON.parse(annotation.selection_rect);

        if (data.path) {
          const bounds = data.bounds || { x: 50, y: 50 };
          return (
            <path
              key={annotation.id}
              d={pathToSvg(data.path)}
              className="highlighter-stroke saved"
              onClick={(e) => {
                e.stopPropagation();
                if (onAnnotationClick && containerRef?.current) {
                  const containerRect = containerRef.current.getBoundingClientRect();
                  onAnnotationClick(annotation, {
                    x: containerRect.left + (bounds.x + (bounds.width || 0) / 2) * containerRect.width / 100,
                    y: containerRect.top + (bounds.y + (bounds.height || 0)) * containerRect.height / 100 + 10,
                  });
                }
              }}
            />
          );
        }

        return (
          <rect
            key={annotation.id}
            x={data.x}
            y={data.y}
            width={data.width}
            height={data.height}
            className="highlighter-rect saved"
            onClick={(e) => {
              e.stopPropagation();
              if (onAnnotationClick && containerRef?.current) {
                const containerRect = containerRef.current.getBoundingClientRect();
                onAnnotationClick(annotation, {
                  x: containerRect.left + (data.x + data.width / 2) * containerRect.width / 100,
                  y: containerRect.top + (data.y + data.height) * containerRect.height / 100 + 10,
                });
              }
            }}
          />
        );
      } catch {
        return null;
      }
    });
  };

  // Render grammar patterns
  const renderGrammarPatterns = () => {
    if (!renderGrammarPattern) return null;

    return grammarAnnotations.map(annotation => {
      try {
        const analysisData = JSON.parse(annotation.ai_analysis_json);
        return analysisData.patterns?.map((pattern, idx) =>
          renderGrammarPattern(annotation, pattern, idx)
        );
      } catch (err) {
        console.error('Grammar parse error:', err);
        return null;
      }
    });
  };

  // Render active selection highlight (word menu open)
  const renderSelectionHighlight = () => {
    if (activeModal.type !== 'wordMenu') return null;

    // Sentence mode: line-by-line highlight
    if (activeModal.data.sentenceWords && activeModal.data.sentenceWords.length > 0) {
      const words = activeModal.data.sentenceWords;
      const lines = [];
      let currentLine = [words[0]];

      for (let i = 1; i < words.length; i++) {
        const prev = currentLine[currentLine.length - 1];
        const curr = words[i];
        const avgHeight = (prev.bbox.height + curr.bbox.height) / 2;

        if (Math.abs(curr.bbox.y - prev.bbox.y) > avgHeight * 0.5) {
          lines.push(currentLine);
          currentLine = [curr];
        } else {
          currentLine.push(curr);
        }
      }
      lines.push(currentLine);

      return lines.map((lineWords, i) => {
        const minX = Math.min(...lineWords.map(w => w.bbox.x));
        const maxX = Math.max(...lineWords.map(w => w.bbox.x + w.bbox.width));
        const minY = Math.min(...lineWords.map(w => w.bbox.y));
        const maxY = Math.max(...lineWords.map(w => w.bbox.y + w.bbox.height));

        return (
          <rect
            key={`sel-line-${i}`}
            x={`${minX}%`}
            y={`${minY}%`}
            width={`${maxX - minX}%`}
            height={`${maxY - minY}%`}
            className="selection-highlight"
          />
        );
      });
    }

    // Word mode: single highlight
    if (activeModal.data.wordBbox) {
      const bbox = activeModal.data.wordBbox;
      return (
        <rect
          x={`${bbox.x}%`}
          y={`${bbox.y}%`}
          width={`${bbox.width}%`}
          height={`${bbox.height}%`}
          className="selection-highlight"
        />
      );
    }

    return null;
  };

  // Render grammar tooltip highlight
  const renderGrammarHighlight = () => {
    if (activeModal.type !== 'grammarTooltip' || !activeModal.data.annotation) return null;

    try {
      const selData = JSON.parse(activeModal.data.annotation.selection_rect);
      const gLines = selData.lines;
      const gBounds = selData.bounds || selData;

      if (gLines && gLines.length > 0) {
        return gLines.map((line, i) => (
          <rect
            key={`grammar-hl-${i}`}
            x={`${line.x}%`}
            y={`${line.y}%`}
            width={`${line.width}%`}
            height={`${line.height}%`}
            className="selection-highlight"
          />
        ));
      } else if (gBounds) {
        return (
          <rect
            x={`${gBounds.x}%`}
            y={`${gBounds.y}%`}
            width={`${gBounds.width}%`}
            height={`${gBounds.height}%`}
            className="selection-highlight"
          />
        );
      }
    } catch {
      return null;
    }

    return null;
  };

  return (
    <svg className="highlighter-svg" viewBox="0 0 100 100" preserveAspectRatio="none">
      {renderRegularAnnotations()}
      {renderVocabMarkers()}
      {renderGrammarPatterns()}
      {renderSelectionHighlight()}
      {renderGrammarHighlight()}
    </svg>
  );
}
