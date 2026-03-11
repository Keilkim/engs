import { TranslatableText } from '../../../components/translatable';
import { PenCanvas } from '../../../components/pen-mode';
import { GrammarPatternRenderer } from './index';

// Convert path points to SVG path string
function pathToSvg(points) {
  if (!points || points.length < 2) return '';
  return points.map((p, i) =>
    `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`
  ).join(' ');
}

// Render vocabulary markers (green shadow + rounded)
function renderVocabMarkers(vocabAnnotations, highlightedVocabId) {
  return vocabAnnotations.map(annotation => {
    const selectionData = JSON.parse(annotation.selection_rect);
    const bounds = selectionData.bounds || selectionData;

    const padX = 0.3;
    const heightScale = 0.7;
    const x = Math.max(0, bounds.x - padX);
    const y = bounds.y + bounds.height * (1 - heightScale) / 2;
    const w = bounds.width + padX * 2;
    const h = bounds.height * heightScale;

    const isHighlighted = highlightedVocabId === annotation.id;
    return (
      <g key={`vocab-${annotation.id}`}>
        <rect
          x={`${x}%`} y={`${y}%`}
          width={`${w}%`} height={`${h}%`}
          rx="0.5" ry="0.5"
          className={`vocab-marker-bg${isHighlighted ? ' highlighted' : ''}`}
          style={{ pointerEvents: 'none' }}
        />
      </g>
    );
  });
}

// Render selection highlight - line-by-line highlight
function renderSelectionHighlight(activeModal) {
  if (activeModal.type !== 'wordMenu') return null;

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

  if (activeModal.data.wordBbox) {
    return (
      <rect
        x={`${activeModal.data.wordBbox.x}%`}
        y={`${activeModal.data.wordBbox.y}%`}
        width={`${activeModal.data.wordBbox.width}%`}
        height={`${activeModal.data.wordBbox.height}%`}
        className="selection-highlight"
      />
    );
  }

  return null;
}

// Render grammar tooltip highlight (flashing blue background)
function renderGrammarTooltipHighlight(activeModal) {
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
}

// Render regular annotations (non-vocabulary, non-grammar)
function renderRegularAnnotations(annotations, isVocabularyAnnotation, isGrammarAnnotation, currentPage) {
  return annotations
    .filter(a => {
      if (!a.selection_rect) return false;
      const isVocab = isVocabularyAnnotation(a);
      const isGrammar = isGrammarAnnotation(a);
      if (isVocab || isGrammar) return false;
      if (currentPage !== null) {
        const data = JSON.parse(a.selection_rect);
        return data.page === currentPage;
      }
      return true;
    })
    .map(annotation => {
      const data = JSON.parse(annotation.selection_rect);
      if (data.path) {
        return (
          <path
            key={annotation.id}
            d={pathToSvg(data.path)}
            className="highlighter-stroke saved"
          />
        );
      }
      return (
        <rect
          key={annotation.id}
          x={data.x} y={data.y} width={data.width} height={data.height}
          className="highlighter-rect saved"
        />
      );
    });
}

// Render grammar pattern arcs
function renderGrammarPatterns(grammarAnnotations, imageContainerRef, openModal) {
  return grammarAnnotations.map(annotation => {
    try {
      const analysisData = JSON.parse(annotation.ai_analysis_json);
      return analysisData.patterns?.map((_, idx) =>
        <GrammarPatternRenderer
          key={`${annotation.id}-${idx}`}
          annotation={annotation}
          patternIdx={idx}
          imageContainerRef={imageContainerRef}
          openModal={openModal}
        />
      );
    } catch {
      return null;
    }
  });
}

// Shared SVG overlay for all image variants
function SvgOverlay({
  annotations, currentPage, highlightedVocabId, activeModal, openModal,
  isVocabularyAnnotation, isGrammarAnnotation, getVocabularyAnnotations, getGrammarAnnotations,
  imageContainerRef,
}) {
  return (
    <svg className="highlighter-svg" viewBox="0 0 100 100" preserveAspectRatio="none">
      {renderRegularAnnotations(annotations, isVocabularyAnnotation, isGrammarAnnotation, currentPage)}
      {renderVocabMarkers(getVocabularyAnnotations(currentPage), highlightedVocabId)}
      {renderGrammarPatterns(getGrammarAnnotations(currentPage), imageContainerRef, openModal)}
      {renderSelectionHighlight(activeModal)}
      {renderGrammarTooltipHighlight(activeModal)}
    </svg>
  );
}

// Shared pen canvas props
function PenCanvasSection({
  zoomWrapperRef, penModeActive, penColor, penStrokeWidth,
  currentPage, zoomScale, panOffset, penStrokes,
  onStrokeComplete, onStrokesDelete,
}) {
  return (
    <PenCanvas
      containerRef={zoomWrapperRef}
      penModeActive={penModeActive}
      penColor={penColor}
      strokeWidth={penStrokeWidth}
      currentPage={currentPage}
      zoomScale={zoomScale}
      panOffset={panOffset}
      strokes={penStrokes}
      onStrokeComplete={onStrokeComplete}
      onStrokesDelete={onStrokesDelete}
    />
  );
}

/**
 * ImageContentView - renders the main content area of the Viewer
 * Handles 4 layout variants: article, multi-page, single image, URL screenshot
 */
export default function ImageContentView({
  source, annotations, currentPage, setCurrentPage,
  // Refs
  imageContainerRef, zoomWrapperRef, scrollContainerRef, contentRef, mobileNavRef,
  // Zoom/Pan
  zoomScale, zoomOrigin, panOffset, isShaking,
  // Mouse handlers
  handleImagePointerDown, handleImagePointerMove, handleImagePointerUp,
  // Pen mode
  penModeActive, penColor, penStrokeWidth, penStrokes,
  onStrokeComplete, onStrokesDelete,
  // Modal
  activeModal, openModal, highlightedVocabId,
  // Annotation helpers
  isVocabularyAnnotation, isGrammarAnnotation, getVocabularyAnnotations, getGrammarAnnotations,
  highlightVocabularyWords,
  // Minimap
  viewportPosition, minimapRef,
  handleMinimapMouseDown, handleMinimapMouseMove, handleMinimapMouseUp,
  handleMinimapTouchStart, handleMinimapTouchMove, handleMinimapTouchEnd,
  // Pages
  pages, hasPages, displayImage,
  // Sidebar toggle
  sidebarCollapsed, setSidebarCollapsed,
}) {
  const svgProps = {
    annotations, currentPage, highlightedVocabId, activeModal, openModal,
    isVocabularyAnnotation, isGrammarAnnotation, getVocabularyAnnotations, getGrammarAnnotations,
    imageContainerRef,
  };

  const penProps = {
    zoomWrapperRef, penModeActive, penColor, penStrokeWidth,
    currentPage, zoomScale, panOffset, penStrokes,
    onStrokeComplete, onStrokesDelete,
  };

  const containerClass = (extra = '') =>
    `screenshot-container${extra}${isShaking ? ' shake' : ''}${zoomScale > 1 ? ' zoomed' : ''}`;

  const mouseHandlers = {
    onMouseDown: handleImagePointerDown,
    onMouseMove: handleImagePointerMove,
    onMouseUp: handleImagePointerUp,
    onAuxClick: (e) => e.preventDefault(),
  };

  const zoomStyle = {
    transform: `translate(${panOffset.x}px, ${panOffset.y}px) scale(${zoomScale})`,
    transformOrigin: `${zoomOrigin.x}% ${zoomOrigin.y}%`,
  };

  // For URL type with content, show article view
  if (source.type === 'url' && source.content) {
    return (
      <div className="article-viewer" ref={contentRef}>
        {source.screenshot && (
          <div className="article-header-image">
            <img src={source.screenshot} alt={source.title} />
          </div>
        )}
        <div
          className="article-content"
          dangerouslySetInnerHTML={{ __html: highlightVocabularyWords(source.content) }}
        />
        <a
          href={source.file_path}
          target="_blank"
          rel="noopener noreferrer"
          className="open-original-btn"
        >
          <TranslatableText textKey="viewer.openOriginal">Open Original</TranslatableText>
        </a>
      </div>
    );
  }

  if (!displayImage) {
    return (
      <div className="no-screenshot">
        <div className="no-screenshot-placeholder">
          <span className="placeholder-letter">{source.type.charAt(0).toUpperCase()}</span>
        </div>
        <p className="no-screenshot-text">
          <TranslatableText textKey="viewer.noScreenshot">Screenshot not available</TranslatableText>
        </p>
        {source.file_path && (
          <a href={source.file_path} target="_blank" rel="noopener noreferrer" className="open-original-btn">
            <TranslatableText textKey="viewer.openOriginal">Open Original</TranslatableText>
          </a>
        )}
      </div>
    );
  }

  // Shared image + overlay + pen canvas core
  const renderImageCore = () => (
    <div ref={zoomWrapperRef} className="zoom-wrapper" style={zoomStyle}>
      <img src={displayImage} alt={source.title} className="screenshot-image" draggable={false} />
      <SvgOverlay {...svgProps} />
      <PenCanvasSection {...penProps} />
    </div>
  );

  // PDF/Image with multiple pages
  if (hasPages) {
    return (
      <div className={`screenshot-viewer with-sidebar${sidebarCollapsed ? ' sidebar-collapsed' : ''}`}>
        <div className="sidebar-wrapper">
          <button className="sidebar-toggle-btn" onClick={() => setSidebarCollapsed(!sidebarCollapsed)}>
            {sidebarCollapsed ? '▶' : '◀'}
          </button>
          <div className="page-sidebar">
            <div className="page-sidebar-scroll">
            {pages.map((pageImg, index) => (
              <div
                key={index}
                className={`page-thumbnail ${currentPage === index ? 'active' : ''}`}
                onClick={() => setCurrentPage(index)}
              >
                <img src={pageImg} alt={`Page ${index + 1}`} />
                <span className="page-number">{index + 1}</span>
              </div>
            ))}
            </div>
          </div>
        </div>

        <div className="screenshot-main">
          <div ref={imageContainerRef} className={containerClass(' multi-page')} {...mouseHandlers}>
            {renderImageCore()}
          </div>

          <div className="page-indicator-bottom">
            {currentPage + 1} / {pages.length}
          </div>

          <div className="page-nav-mobile">
            <div className="page-nav-mobile-scroll" ref={mobileNavRef}>
              {pages.map((pageImg, index) => (
                <div
                  key={index}
                  className={`page-nav-mobile-thumb ${currentPage === index ? 'active' : ''}`}
                  onClick={() => setCurrentPage(index)}
                >
                  <img src={pageImg} alt={`Page ${index + 1}`} />
                  <span className="page-nav-number">{index + 1}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {source.type === 'pdf' && (
          <a href={source.file_path} target="_blank" rel="noopener noreferrer" className="open-original-btn floating">
            <TranslatableText textKey="viewer.openPdf">Open PDF</TranslatableText>
          </a>
        )}
      </div>
    );
  }

  // Regular image (from gallery)
  if (source.type === 'image') {
    return (
      <div className="screenshot-viewer single-image">
        <div className="screenshot-main">
          <div ref={imageContainerRef} className={containerClass()} {...mouseHandlers}>
            {renderImageCore()}
          </div>
        </div>
      </div>
    );
  }

  // URL screenshot (single long image) with minimap
  return (
    <div className={`screenshot-viewer with-minimap${sidebarCollapsed ? ' sidebar-collapsed' : ''}`}>
      <div className="sidebar-wrapper">
        <button className="sidebar-toggle-btn" onClick={(e) => { e.stopPropagation(); setSidebarCollapsed(!sidebarCollapsed); }}>
          {sidebarCollapsed ? '▶' : '◀'}
        </button>
        <div
          className="minimap-sidebar"
          ref={minimapRef}
          onMouseDown={handleMinimapMouseDown}
          onMouseMove={handleMinimapMouseMove}
          onMouseUp={handleMinimapMouseUp}
          onMouseLeave={handleMinimapMouseUp}
          onTouchStart={handleMinimapTouchStart}
          onTouchMove={handleMinimapTouchMove}
          onTouchEnd={handleMinimapTouchEnd}
        >
          <div className="minimap-content">
            <div className="minimap-image-wrapper">
              <img src={displayImage} alt="Minimap" className="minimap-image" draggable={false} />
              <div
                className="minimap-viewport"
                style={{
                  top: `${viewportPosition.top}%`,
                  height: `${viewportPosition.height}%`,
                }}
              />
            </div>
          </div>
        </div>
      </div>

      <div className="screenshot-main">
        <div ref={scrollContainerRef} className="screenshot-scroll-container">
          <div ref={imageContainerRef} className={containerClass()} {...mouseHandlers}>
            {renderImageCore()}
          </div>
        </div>
      </div>

      <a href={source.file_path} target="_blank" rel="noopener noreferrer" className="open-original-btn floating">
        <TranslatableText textKey="viewer.openOriginal">Open Original</TranslatableText>
      </a>
    </div>
  );
}
