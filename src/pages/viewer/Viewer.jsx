import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getSource } from '../../services/source';
import { getAnnotations } from '../../services/annotation';
import ContextMenu from '../../components/modals/ContextMenu';

export default function Viewer() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [source, setSource] = useState(null);
  const [annotations, setAnnotations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // 컨텍스트 메뉴 상태
  const [contextMenu, setContextMenu] = useState({
    isOpen: false,
    position: { x: 0, y: 0 },
    selectedText: '',
  });

  useEffect(() => {
    loadData();
  }, [id]);

  async function loadData() {
    setLoading(true);
    try {
      const [sourceData, annotationsData] = await Promise.all([
        getSource(id),
        getAnnotations(id),
      ]);
      setSource(sourceData);
      setAnnotations(annotationsData || []);
    } catch (err) {
      setError('소스를 불러올 수 없습니다');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  const handleTextSelection = useCallback(() => {
    const selection = window.getSelection();
    const selectedText = selection?.toString().trim();

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
    });
    window.getSelection()?.removeAllRanges();
  }

  function handleAnnotationCreated() {
    loadData();
  }

  function renderHighlights(content) {
    if (!annotations.length) return content;

    let result = content;
    const highlights = annotations.filter((a) => a.type === 'highlight');

    highlights.forEach((highlight) => {
      const text = highlight.selected_text;
      if (text && result.includes(text)) {
        result = result.replace(
          text,
          `<mark class="highlight" data-id="${highlight.id}">${text}</mark>`
        );
      }
    });

    return result;
  }

  if (loading) {
    return (
      <div className="viewer-screen">
        <div className="viewer-loading">
          <div className="spinner" />
          <p>불러오는 중...</p>
        </div>
      </div>
    );
  }

  if (error || !source) {
    return (
      <div className="viewer-screen">
        <div className="viewer-error">
          <p>{error || '소스를 찾을 수 없습니다'}</p>
          <button onClick={() => navigate('/')}>홈으로</button>
        </div>
      </div>
    );
  }

  return (
    <div className="viewer-screen">
      <header className="viewer-header">
        <button
          className="back-button"
          onClick={() => navigate('/')}
        >
          ← 뒤로
        </button>
        <h1 className="viewer-title">{source.title}</h1>
        <div className="viewer-actions">
          <span className="source-type">{source.type.toUpperCase()}</span>
        </div>
      </header>

      <main
        className="viewer-content"
        onMouseUp={handleTextSelection}
        onTouchEnd={handleTextSelection}
      >
        {source.type === 'pdf' ? (
          <div className="pdf-viewer">
            <iframe
              src={source.file_path}
              title={source.title}
              className="pdf-frame"
            />
          </div>
        ) : source.type === 'url' ? (
          <div
            className="url-content"
            dangerouslySetInnerHTML={{
              __html: renderHighlights(source.content || ''),
            }}
          />
        ) : (
          <div className="image-viewer">
            <img src={source.file_path} alt={source.title} />
          </div>
        )}

        {/* 어노테이션 오버레이 */}
        {annotations
          .filter((a) => a.type === 'memo')
          .map((memo) => (
            <div
              key={memo.id}
              className="memo-marker"
              title={memo.memo_content}
            >
              📝
            </div>
          ))}
      </main>

      <ContextMenu
        isOpen={contextMenu.isOpen}
        position={contextMenu.position}
        selectedText={contextMenu.selectedText}
        sourceId={id}
        onClose={closeContextMenu}
        onAnnotationCreated={handleAnnotationCreated}
      />
    </div>
  );
}
