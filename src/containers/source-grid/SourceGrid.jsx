import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { deleteSource } from '../../services/source';
import { TranslatableText } from '../../components/translatable';

export default function SourceGrid({ sources, loading, onSourceDeleted }) {
  const navigate = useNavigate();
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [pageIndexes, setPageIndexes] = useState({}); // Track current page for each source

  if (loading) {
    return (
      <div className="source-grid">
        {[...Array(6)].map((_, i) => (
          <div key={i} className="source-card source-card-skeleton">
            <div className="source-thumbnail skeleton-shimmer" />
            <div className="source-info">
              <div className="skeleton-text skeleton-shimmer" />
              <div className="skeleton-text-sm skeleton-shimmer" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (!sources || sources.length === 0) {
    return (
      <div className="source-grid-empty">
        <p><TranslatableText textKey="sourceGrid.noSources">No sources added yet</TranslatableText></p>
        <p className="empty-hint"><TranslatableText textKey="sourceGrid.addFirst">Add your first source!</TranslatableText></p>
      </div>
    );
  }

  function handleSourceClick(source) {
    if (deleteConfirm) return;
    navigate(`/viewer/${source.id}`);
  }

  function handleDeleteClick(e, source) {
    e.stopPropagation();
    setDeleteConfirm(source.id);
  }

  async function handleConfirmDelete(e, sourceId) {
    e.stopPropagation();
    setDeleting(true);
    try {
      await deleteSource(sourceId);
      setDeleteConfirm(null);
      if (onSourceDeleted) {
        onSourceDeleted();
      }
    } catch (err) {
      console.error('Failed to delete source:', err);
    } finally {
      setDeleting(false);
    }
  }

  function handleCancelDelete(e) {
    e.stopPropagation();
    setDeleteConfirm(null);
  }

  // Parse pages JSON
  function getPages(source) {
    if (source.pages) {
      try {
        return JSON.parse(source.pages);
      } catch {
        return null;
      }
    }
    return null;
  }

  // Get current page index for source
  function getCurrentPageIndex(sourceId) {
    return pageIndexes[sourceId] || 0;
  }

  // Navigate to previous page
  function handlePrevPage(e, source, pages) {
    e.stopPropagation();
    const currentIndex = getCurrentPageIndex(source.id);
    if (currentIndex > 0) {
      setPageIndexes(prev => ({ ...prev, [source.id]: currentIndex - 1 }));
    }
  }

  // Navigate to next page
  function handleNextPage(e, source, pages) {
    e.stopPropagation();
    const currentIndex = getCurrentPageIndex(source.id);
    if (currentIndex < pages.length - 1) {
      setPageIndexes(prev => ({ ...prev, [source.id]: currentIndex + 1 }));
    }
  }

  // Get preview image (with page support for PDFs)
  function getPreviewImage(source) {
    const pages = getPages(source);
    if (pages && pages.length > 0) {
      const currentIndex = getCurrentPageIndex(source.id);
      return pages[currentIndex];
    }
    if (source.screenshot) return source.screenshot;
    if (source.thumbnail) return source.thumbnail;
    if (source.type === 'image') return source.file_path;
    return null;
  }

  return (
    <div className="source-grid">
      {sources.map((source) => {
        const pages = getPages(source);
        const previewImage = getPreviewImage(source);
        const isConfirming = deleteConfirm === source.id;
        const currentPageIndex = getCurrentPageIndex(source.id);
        const hasPages = pages && pages.length > 1;

        return (
          <div
            key={source.id}
            className={`source-card ${isConfirming ? 'confirming-delete' : ''}`}
            onClick={() => handleSourceClick(source)}
          >
            <div className="source-thumbnail">
              {previewImage ? (
                <img
                  src={previewImage}
                  alt={source.title}
                  onError={(e) => {
                    e.target.style.display = 'none';
                    e.target.nextSibling.style.display = 'flex';
                  }}
                />
              ) : null}
              <span
                className="source-icon-placeholder"
                style={{ display: previewImage ? 'none' : 'flex' }}
              >
                {source.type.toUpperCase().charAt(0)}
              </span>

              {/* Page navigation for PDFs */}
              {hasPages && !isConfirming && (
                <>
                  <button
                    className="page-nav-btn page-nav-prev"
                    onClick={(e) => handlePrevPage(e, source, pages)}
                    disabled={currentPageIndex === 0}
                  >
                    ‹
                  </button>
                  <button
                    className="page-nav-btn page-nav-next"
                    onClick={(e) => handleNextPage(e, source, pages)}
                    disabled={currentPageIndex === pages.length - 1}
                  >
                    ›
                  </button>
                  <div className="page-indicator">
                    {currentPageIndex + 1} / {pages.length}
                  </div>
                </>
              )}

              {/* Delete button */}
              <button
                className="source-delete-btn"
                onClick={(e) => handleDeleteClick(e, source)}
                title="Delete"
              >
                ×
              </button>

              {/* Delete confirmation overlay */}
              {isConfirming && (
                <div className="delete-confirm-overlay">
                  <p><TranslatableText textKey="source.deleteConfirm">Delete this source?</TranslatableText></p>
                  <div className="delete-confirm-actions">
                    <button
                      className="cancel-btn"
                      onClick={handleCancelDelete}
                      disabled={deleting}
                    >
                      <TranslatableText textKey="common.cancel">Cancel</TranslatableText>
                    </button>
                    <button
                      className="confirm-btn"
                      onClick={(e) => handleConfirmDelete(e, source.id)}
                      disabled={deleting}
                    >
                      {deleting ? '...' : <TranslatableText textKey="common.delete">Delete</TranslatableText>}
                    </button>
                  </div>
                </div>
              )}
            </div>
            <div className="source-info">
              <h3 className="source-title">{source.title}</h3>
              <span className="source-type">
                {source.type.toUpperCase()}
                {hasPages && ` • ${pages.length} pages`}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
