import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { deleteSource } from '../../services/source';
import { TranslatableText } from '../../components/translatable';

export default function SourceGrid({ sources, loading, columnCount = 2, onSourceDeleted, onSourceUpdated, selectMode = false, selectedIds = [], onSelectToggle }) {
  const navigate = useNavigate();
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [deleting, setDeleting] = useState(false);

  // 즐겨찾기 토글
  function handlePinToggle(e, source) {
    e.stopPropagation();
    if (onSourceUpdated) {
      onSourceUpdated(source.id, { pinned: !source.pinned });
    }
  }

  // 컬럼 수에 따른 버튼 크기 계산
  const buttonScale = Math.max(0.6, 1 - (columnCount - 2) * 0.1);

  if (loading) {
    return (
      <div className="source-grid" style={{ '--grid-columns': columnCount }}>
        {[...Array(6)].map((_, i) => (
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
        <p><TranslatableText textKey="sourceGrid.noSources">No sources added yet</TranslatableText></p>
        <p className="empty-hint"><TranslatableText textKey="sourceGrid.addFirst">Add your first source!</TranslatableText></p>
      </div>
    );
  }

  function handleSourceClick(source) {
    if (deleteConfirm) return;
    if (selectMode) {
      onSelectToggle?.(source.id);
      return;
    }
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
          <div
            key={source.id}
            className={`source-card ${isConfirming ? 'confirming-delete' : ''} ${selectMode ? 'select-mode' : ''} ${isSelected ? 'selected' : ''}`}
            onClick={() => handleSourceClick(source)}
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
                {source.type.toUpperCase().charAt(0)}
              </span>

              {/* 선택 모드 체크박스 (가운데) */}
              {selectMode && (
                <div className={`source-select-checkbox ${isSelected ? 'checked' : ''}`}>
                  {isSelected && (
                    <svg viewBox="0 0 24 24" fill="currentColor">
                      <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/>
                    </svg>
                  )}
                </div>
              )}

              {/* 즐겨찾기 버튼 (좌상단) - 선택 모드가 아닐 때만 */}
              {!isConfirming && !selectMode && (
                <button
                  className={`source-pin-btn ${source.pinned ? 'active' : ''}`}
                  onClick={(e) => handlePinToggle(e, source)}
                  title={source.pinned ? 'Remove from favorites' : 'Add to favorites'}
                >
                  <svg viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z"/>
                  </svg>
                </button>
              )}

              {/* Delete button (우상단) - 선택 모드가 아닐 때만 */}
              {!selectMode && (
                <button
                  className="source-delete-btn"
                  onClick={(e) => handleDeleteClick(e, source)}
                  title="Delete"
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
          </div>
        );
      })}
    </div>
  );
}
