import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { deleteSource } from '../../services/source';
import { TranslatableText } from '../../components/translatable';
import Buddy from '../../components/Buddy';

const SKELETON_ITEMS = Array.from({ length: 6 }, (_, i) => i);

export default function SourceGrid({ sources, loading, columnCount = 2, onSourceDeleted, onSourceUpdated, selectMode = false, selectedIds = [], onSelectToggle, onAdd, emptyKind = 'library' }) {
  const navigate = useNavigate();
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [deleting, setDeleting] = useState(false);

  // 즐겨찾기 토글
  const handlePinToggle = useCallback((e, source) => {
    e.stopPropagation();
    if (onSourceUpdated) {
      onSourceUpdated(source.id, { pinned: !source.pinned });
    }
  }, [onSourceUpdated]);

  // 컬럼 수에 따른 버튼 크기 계산
  const buttonScale = Math.max(0.6, 1 - (columnCount - 2) * 0.1);

  if (loading) {
    return (
      <div className="source-grid" style={{ '--grid-columns': columnCount }}>
        {SKELETON_ITEMS.map((i) => (
          <div key={i} className="source-card source-card-skeleton">
            <div className="source-thumbnail skeleton-shimmer" />
          </div>
        ))}
      </div>
    );
  }

  if (!sources || sources.length === 0) {
    return (
      <div className="source-grid-empty">
        <Buddy className="empty-buddy" animated={false} />
        <h3>{emptyKind === 'search' ? 'Nothing here just yet.' : emptyKind === 'favorites' ? 'Keep your favorites close.' : 'Good things start with a little curiosity.'}</h3>
        <p className="empty-hint">{emptyKind === 'search' ? 'Try another title. Your next discovery is waiting.' : emptyKind === 'favorites' ? 'Tap the star on a source to save it here.' : 'Bring a video, a PDF, or a story you love. We’ll take it from there.'}</p>
        {emptyKind === 'library' && onAdd && <button className="dust-text-button" onClick={onAdd}>Add your first source <span aria-hidden="true">↗</span></button>}
      </div>
    );
  }

  function handleSourceClick(source) {
    if (deleteConfirm) return;
    if (selectMode) {
      onSelectToggle?.(source.id);
      return;
    }
    if (source.type === 'youtube') {
      navigate(`/youtube/${source.id}`);
    } else {
      navigate(`/viewer/${source.id}`);
    }
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
    } catch {
      // ignore
    } finally {
      setDeleting(false);
    }
  }

  function handleCancelDelete(e) {
    e.stopPropagation();
    setDeleteConfirm(null);
  }

  // Get preview image (thumbnail or screenshot)
  function getPreviewImage(source) {
    if (source.screenshot) return source.screenshot;
    if (source.thumbnail) return source.thumbnail;
    return null;
  }

  return (
    <div className="source-grid" style={{ '--grid-columns': columnCount, '--btn-scale': buttonScale }}>
      {sources.map((source) => {
        const previewImage = getPreviewImage(source);
        const isConfirming = deleteConfirm === source.id;
        const isSelected = selectedIds.includes(source.id);

        return (
          <article
            key={source.id}
            className={`source-card ${isConfirming ? 'confirming-delete' : ''} ${selectMode ? 'select-mode' : ''} ${isSelected ? 'selected' : ''}`}
            data-type={source.type}
          >
            <div className="source-thumbnail">
              {previewImage ? (
                <img
                  src={previewImage}
                  alt={source.title}
                  loading="lazy"
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
                {source.type?.toUpperCase().charAt(0) || 'S'}
              </span>

              {/* 선택 모드 체크박스 (가운데) */}
              {selectMode && (
                <div className={`source-select-checkbox ${isSelected ? 'checked' : ''}`}>
                  {isSelected && (
                    <span aria-hidden="true">✓</span>
                  )}
                </div>
              )}

              {/* 즐겨찾기 버튼 (좌상단) - 선택 모드가 아닐 때만 */}
              {!isConfirming && !selectMode && (
                <button
                  className={`source-pin-btn ${source.pinned ? 'active' : ''}`}
                  onClick={(e) => handlePinToggle(e, source)}
                  title={source.pinned ? 'Remove from favorites' : 'Add to favorites'}
                  aria-label={`${source.pinned ? 'Remove from' : 'Add to'} favorites: ${source.title || 'Untitled'}`}
                  aria-pressed={!!source.pinned}
                >
                  <span aria-hidden="true">✦</span>
                </button>
              )}

              {/* Delete button (우상단) - 선택 모드가 아닐 때만 */}
              {!selectMode && (
                <button
                  className="source-delete-btn"
                  onClick={(e) => handleDeleteClick(e, source)}
                  title="Delete"
                  aria-label={`Delete ${source.title || 'source'}`}
                >
                  ×
                </button>
              )}

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
            <div className="source-card-caption">
              <span className="source-card-type">{source.type === 'youtube' ? 'WATCH & LEARN' : source.type === 'pdf' ? 'A GOOD READ' : 'EXPLORE & LEARN'}</span>
              <h3 className="source-card-title" title={source.title}>{source.title || 'Untitled'}</h3>
              <span className="source-card-bottom"><span>{source.type?.toUpperCase()}</span><span aria-hidden="true">↗</span></span>
            </div>
            <button className="source-open-button" onClick={() => handleSourceClick(source)} disabled={isConfirming} aria-label={`${selectMode ? 'Select' : 'Open'} ${source.title || 'source'}`} aria-pressed={selectMode ? isSelected : undefined} />
          </article>
        );
      })}
    </div>
  );
}
