import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getSource, deleteSource } from '../../services/source';
import { getAnnotations } from '../../services/annotation';
import ContextMenu from '../../components/modals/ContextMenu';
import AnnotationPopover from '../../components/modals/AnnotationPopover';
import { TranslatableText } from '../../components/translatable';

export default function Viewer() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [source, setSource] = useState(null);
  const [annotations, setAnnotations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [currentPage, setCurrentPage] = useState(0);
  const contentRef = useRef(null);
  const imageContainerRef = useRef(null);
  const mouseDownPos = useRef(null);

  // Image selection state
  const [isSelecting, setIsSelecting] = useState(false);
  const [selectionStart, setSelectionStart] = useState(null);
  const [selectionEnd, setSelectionEnd] = useState(null);

  const [contextMenu, setContextMenu] = useState({
    isOpen: false,
    position: { x: 0, y: 0 },
    selectedText: '',
    selectionRect: null,
  });

  const [annotationPopover, setAnnotationPopover] = useState({
    isOpen: false,
    position: { x: 0, y: 0 },
    annotation: null,
  });

  useEffect(() => {
    loadData();
  }, [id]);

  // Add click listeners to highlights after render
  useEffect(() => {
    if (contentRef.current) {
      const highlights = contentRef.current.querySelectorAll('mark.highlight');
      highlights.forEach((mark) => {
        mark.addEventListener('click', handleHighlightClick);
      });

      return () => {
        highlights.forEach((mark) => {
          mark.removeEventListener('click', handleHighlightClick);
        });
      };
    }
  }, [source, annotations]);

  // Parse pages from source
  function getPages() {
    if (source?.pages) {
      try {
        return JSON.parse(source.pages);
      } catch {
        return null;
      }
    }
    return null;
  }

  async function loadData() {
    setLoading(true);
    try {
      const [sourceData, annotationsData] = await Promise.all([
        getSource(id),
        getAnnotations(id),
      ]);
      setSource(sourceData);
      setAnnotations(annotationsData || []);
      setCurrentPage(0); // Reset to first page
    } catch (err) {
      setError('Unable to load source');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  function handleHighlightClick(e) {
    e.stopPropagation();
    const annotationId = e.target.getAttribute('data-id');
    const annotation = annotations.find((a) => a.id === annotationId);

    if (annotation) {
      const rect = e.target.getBoundingClientRect();
      setAnnotationPopover({
        isOpen: true,
        position: {
          x: rect.left + rect.width / 2,
          y: rect.bottom + 10,
        },
        annotation,
      });
    }
  }

  const handleMouseDown = useCallback((e) => {
    mouseDownPos.current = { x: e.clientX, y: e.clientY };
  }, []);

  // Get coordinates from mouse or touch event
  const getEventCoords = useCallback((e) => {
    if (e.touches && e.touches.length > 0) {
      return { clientX: e.touches[0].clientX, clientY: e.touches[0].clientY };
    }
    if (e.changedTouches && e.changedTouches.length > 0) {
      return { clientX: e.changedTouches[0].clientX, clientY: e.changedTouches[0].clientY };
    }
    return { clientX: e.clientX, clientY: e.clientY };
  }, []);

  // Image selection handlers (mouse + touch)
  const handleImagePointerDown = useCallback((e) => {
    if (!imageContainerRef.current) return;

    // Prevent scrolling on touch
    if (e.type === 'touchstart') {
      e.preventDefault();
    }

    const { clientX, clientY } = getEventCoords(e);
    const rect = imageContainerRef.current.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * 100;
    const y = ((clientY - rect.top) / rect.height) * 100;

    setIsSelecting(true);
    setSelectionStart({ x, y });
    setSelectionEnd({ x, y });
    setContextMenu(prev => ({ ...prev, isOpen: false }));
  }, [getEventCoords]);

  const handleImagePointerMove = useCallback((e) => {
    if (!isSelecting || !imageContainerRef.current) return;

    // Prevent scrolling on touch
    if (e.type === 'touchmove') {
      e.preventDefault();
    }

    const { clientX, clientY } = getEventCoords(e);
    const rect = imageContainerRef.current.getBoundingClientRect();
    const x = Math.min(100, Math.max(0, ((clientX - rect.left) / rect.width) * 100));
    const y = Math.min(100, Math.max(0, ((clientY - rect.top) / rect.height) * 100));

    setSelectionEnd({ x, y });
  }, [isSelecting, getEventCoords]);

  const handleImagePointerUp = useCallback(() => {
    if (!isSelecting || !selectionStart || !selectionEnd) {
      setIsSelecting(false);
      return;
    }

    const width = Math.abs(selectionEnd.x - selectionStart.x);
    const height = Math.abs(selectionEnd.y - selectionStart.y);

    // Minimum selection size (2% of image)
    if (width < 2 && height < 2) {
      setIsSelecting(false);
      setSelectionStart(null);
      setSelectionEnd(null);
      return;
    }

    // Calculate selection rect for saving
    const selectionRect = {
      x: Math.min(selectionStart.x, selectionEnd.x),
      y: Math.min(selectionStart.y, selectionEnd.y),
      width,
      height,
    };

    // Show context menu at selection position
    const rect = imageContainerRef.current.getBoundingClientRect();
    const menuX = rect.left + (selectionRect.x + selectionRect.width / 2) * rect.width / 100;
    const menuY = rect.top + (selectionRect.y + selectionRect.height) * rect.height / 100 + 10;

    setContextMenu({
      isOpen: true,
      position: { x: menuX, y: menuY },
      selectedText: `[Image Selection: Page ${currentPage + 1}]`,
      selectionRect: { ...selectionRect, page: currentPage },
    });

    setIsSelecting(false);
  }, [isSelecting, selectionStart, selectionEnd, currentPage]);

  // Get selection box style
  function getSelectionStyle() {
    if (!selectionStart || !selectionEnd) return null;

    const left = Math.min(selectionStart.x, selectionEnd.x);
    const top = Math.min(selectionStart.y, selectionEnd.y);
    const width = Math.abs(selectionEnd.x - selectionStart.x);
    const height = Math.abs(selectionEnd.y - selectionStart.y);

    return {
      left: `${left}%`,
      top: `${top}%`,
      width: `${width}%`,
      height: `${height}%`,
    };
  }

  const handleTextSelection = useCallback((e) => {
    // Don't show context menu if clicking on a highlight
    if (e.target.classList?.contains('highlight')) {
      return;
    }

    // Check if mouse actually moved (dragged) - minimum 10px
    if (mouseDownPos.current) {
      const dx = Math.abs(e.clientX - mouseDownPos.current.x);
      const dy = Math.abs(e.clientY - mouseDownPos.current.y);
      if (dx < 10 && dy < 10) {
        mouseDownPos.current = null;
        return; // Just a click, not a drag
      }
    }
    mouseDownPos.current = null;

    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) {
      return;
    }

    const selectedText = selection.toString().trim();

    if (selectedText && selectedText.length > 0) {
      const range = selection.getRangeAt(0);
      const rect = range.getBoundingClientRect();

      setContextMenu({
        isOpen: true,
        position: {
          x: rect.left + window.scrollX,
          y: rect.bottom + window.scrollY + 10,
        },
        selectedText,
      });
    }
  }, []);

  function closeContextMenu() {
    setContextMenu({
      isOpen: false,
      position: { x: 0, y: 0 },
      selectedText: '',
      selectionRect: null,
    });
    setSelectionStart(null);
    setSelectionEnd(null);
    window.getSelection()?.removeAllRanges();
  }

  function closeAnnotationPopover() {
    setAnnotationPopover({
      isOpen: false,
      position: { x: 0, y: 0 },
      annotation: null,
    });
  }

  function handleAnnotationCreated() {
    loadData();
  }

  function handleAnnotationDeleted() {
    closeAnnotationPopover();
    loadData();
  }

  // Get the display image (screenshot or original)
  function getDisplayImage() {
    const pages = getPages();
    if (pages && pages.length > 0) {
      return pages[currentPage];
    }
    if (source.screenshot) return source.screenshot;
    if (source.thumbnail) return source.thumbnail;
    if (source.type === 'image') return source.file_path;
    return null;
  }

  // Page navigation
  function handlePrevPage() {
    if (currentPage > 0) {
      setCurrentPage(currentPage - 1);
    }
  }

  function handleNextPage() {
    const pages = getPages();
    if (pages && currentPage < pages.length - 1) {
      setCurrentPage(currentPage + 1);
    }
  }

  // Keyboard navigation
  useEffect(() => {
    function handleKeyDown(e) {
      const pages = getPages();
      if (!pages || pages.length <= 1) return;

      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault();
        handlePrevPage();
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault();
        handleNextPage();
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentPage, source]);

  // Render captured screenshot viewer
  function renderContent() {
    const displayImage = getDisplayImage();
    const pages = getPages();
    const hasPages = pages && pages.length > 1;

    // For URL type with content, show article view
    if (source.type === 'url' && source.content) {
      return (
        <div className="article-viewer" ref={contentRef}>
          {/* OG Image as header */}
          {source.screenshot && (
            <div className="article-header-image">
              <img src={source.screenshot} alt={source.title} />
            </div>
          )}

          {/* Article content */}
          <div
            className="article-content"
            dangerouslySetInnerHTML={{ __html: source.content }}
          />

          {/* Open original link */}
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

    // If we have a captured screenshot, show it
    if (displayImage) {
      const selectionStyle = getSelectionStyle();

      return (
        <div className={`screenshot-viewer ${hasPages ? 'with-sidebar' : ''}`}>
          {/* Page thumbnail sidebar */}
          {hasPages && (
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
          )}

          {/* Main image area */}
          <div className="screenshot-main">
            <div
              ref={imageContainerRef}
              className="screenshot-container"
              onMouseDown={handleImagePointerDown}
              onMouseMove={handleImagePointerMove}
              onMouseUp={handleImagePointerUp}
              onMouseLeave={() => isSelecting && setIsSelecting(false)}
              onTouchStart={handleImagePointerDown}
              onTouchMove={handleImagePointerMove}
              onTouchEnd={handleImagePointerUp}
            >
              <img
                src={displayImage}
                alt={source.title}
                className="screenshot-image"
                draggable={false}
              />

              {/* Selection overlay while dragging */}
              {isSelecting && selectionStyle && (
                <div
                  className="image-selection-overlay"
                  style={selectionStyle}
                />
              )}

              {/* Active selection (after drag, before context menu closes) */}
              {!isSelecting && contextMenu.isOpen && contextMenu.selectionRect && (
                <div
                  className="image-selection-highlight"
                  style={{
                    left: `${contextMenu.selectionRect.x}%`,
                    top: `${contextMenu.selectionRect.y}%`,
                    width: `${contextMenu.selectionRect.width}%`,
                    height: `${contextMenu.selectionRect.height}%`,
                  }}
                />
              )}

              {/* Saved annotation highlights */}
              {annotations
                .filter(a => a.selection_rect && JSON.parse(a.selection_rect).page === currentPage)
                .map(annotation => {
                  const rect = JSON.parse(annotation.selection_rect);
                  return (
                    <div
                      key={annotation.id}
                      className="image-annotation-highlight"
                      style={{
                        left: `${rect.x}%`,
                        top: `${rect.y}%`,
                        width: `${rect.width}%`,
                        height: `${rect.height}%`,
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        const containerRect = imageContainerRef.current.getBoundingClientRect();
                        setAnnotationPopover({
                          isOpen: true,
                          position: {
                            x: containerRect.left + (rect.x + rect.width / 2) * containerRect.width / 100,
                            y: containerRect.top + (rect.y + rect.height) * containerRect.height / 100 + 10,
                          },
                          annotation,
                        });
                      }}
                    />
                  );
                })}
            </div>

            {/* Page indicator */}
            {hasPages && (
              <div className="page-indicator-bottom">
                {currentPage + 1} / {pages.length}
              </div>
            )}
          </div>

          {/* Open original link for URL type */}
          {source.type === 'url' && (
            <a
              href={source.file_path}
              target="_blank"
              rel="noopener noreferrer"
              className="open-original-btn"
            >
              <TranslatableText textKey="viewer.openOriginal">Open Original</TranslatableText>
            </a>
          )}
          {/* Open PDF for PDF type */}
          {source.type === 'pdf' && (
            <a
              href={source.file_path}
              target="_blank"
              rel="noopener noreferrer"
              className="open-original-btn"
            >
              <TranslatableText textKey="viewer.openPdf">Open PDF</TranslatableText>
            </a>
          )}
        </div>
      );
    }

    // Fallback: no screenshot available yet
    return (
      <div className="no-screenshot">
        <div className="no-screenshot-placeholder">
          <span className="placeholder-letter">{source.type.charAt(0).toUpperCase()}</span>
        </div>
        <p className="no-screenshot-text">
          <TranslatableText textKey="viewer.noScreenshot">Screenshot not available</TranslatableText>
        </p>
        {source.file_path && (
          <a
            href={source.file_path}
            target="_blank"
            rel="noopener noreferrer"
            className="open-original-btn"
          >
            <TranslatableText textKey="viewer.openOriginal">Open Original</TranslatableText>
          </a>
        )}
      </div>
    );
  }

  if (loading) {
    return (
      <div className="viewer-screen">
        <div className="viewer-loading">
          <div className="spinner" />
          <p><TranslatableText textKey="viewer.loading">Loading...</TranslatableText></p>
        </div>
      </div>
    );
  }

  if (error || !source) {
    return (
      <div className="viewer-screen">
        <div className="viewer-error">
          <p>{error || <TranslatableText textKey="viewer.sourceNotFound">Source not found</TranslatableText>}</p>
          <button onClick={() => navigate('/')}>
            <TranslatableText textKey="viewer.goHome">Go Home</TranslatableText>
          </button>
        </div>
      </div>
    );
  }

  async function handleDeleteSource() {
    setDeleting(true);
    try {
      await deleteSource(id);
      navigate('/');
    } catch (err) {
      console.error('Failed to delete source:', err);
      setDeleting(false);
      setShowDeleteConfirm(false);
    }
  }

  const pages = getPages();
  const hasPages = pages && pages.length > 1;

  return (
    <div className="viewer-screen">
      <header className="viewer-header">
        <button
          className="back-button"
          onClick={() => navigate('/')}
        >
          <TranslatableText textKey="nav.back">Back</TranslatableText>
        </button>
        <h1 className="viewer-title">{source.title}</h1>
        <div className="viewer-actions">
          <span className="source-type-badge">
            {source.type.toUpperCase()}
            {hasPages && ` • ${pages.length}p`}
          </span>
          <button
            className="viewer-delete-btn"
            onClick={() => setShowDeleteConfirm(true)}
          >
            <TranslatableText textKey="common.delete">Delete</TranslatableText>
          </button>
        </div>
      </header>

      <main
        className="viewer-content"
        onMouseDown={handleMouseDown}
        onMouseUp={handleTextSelection}
        onTouchEnd={handleTextSelection}
        onClick={() => annotationPopover.isOpen && closeAnnotationPopover()}
      >
        {renderContent()}

        {/* Memo markers displayed as floating indicators */}
        {annotations
          .filter((a) => a.type === 'memo')
          .map((memo, index) => (
            <div
              key={memo.id}
              className="memo-marker"
              style={{ top: `${100 + index * 40}px` }}
              onClick={(e) => {
                e.stopPropagation();
                setAnnotationPopover({
                  isOpen: true,
                  position: {
                    x: window.innerWidth - 60,
                    y: 100 + index * 40,
                  },
                  annotation: memo,
                });
              }}
              title={memo.memo_content}
            >
              M
            </div>
          ))}
      </main>

      <ContextMenu
        isOpen={contextMenu.isOpen}
        position={contextMenu.position}
        selectedText={contextMenu.selectedText}
        selectionRect={contextMenu.selectionRect}
        sourceId={id}
        pages={getPages()}
        onClose={closeContextMenu}
        onAnnotationCreated={handleAnnotationCreated}
      />

      <AnnotationPopover
        isOpen={annotationPopover.isOpen}
        position={annotationPopover.position}
        annotation={annotationPopover.annotation}
        onClose={closeAnnotationPopover}
        onDelete={handleAnnotationDeleted}
      />

      {/* Delete confirmation modal */}
      {showDeleteConfirm && (
        <div className="modal-overlay" onClick={() => setShowDeleteConfirm(false)}>
          <div className="delete-modal" onClick={(e) => e.stopPropagation()}>
            <h3><TranslatableText textKey="source.deleteTitle">Delete Source</TranslatableText></h3>
            <p><TranslatableText textKey="source.deleteMessage">Are you sure you want to delete this source? This action cannot be undone.</TranslatableText></p>
            <div className="delete-modal-actions">
              <button
                className="cancel-btn"
                onClick={() => setShowDeleteConfirm(false)}
                disabled={deleting}
              >
                <TranslatableText textKey="common.cancel">Cancel</TranslatableText>
              </button>
              <button
                className="confirm-delete-btn"
                onClick={handleDeleteSource}
                disabled={deleting}
              >
                {deleting ? '...' : <TranslatableText textKey="common.delete">Delete</TranslatableText>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
