import { safeJsonParse } from '../../../utils/errors';
import { TranslatableText } from '../../../components/translatable';

export default function VocabPanel({
  getVocabularyAnnotations,
  showVocabPanel, setShowVocabPanel,
  currentPage, setCurrentPage,
  closeModal, highlightVocab,
  scrollContainerRef,
}) {
  const allVocab = getVocabularyAnnotations();

  if (allVocab.length === 0) return null;

  return (
    <>
      <button
        className="vocab-float-btn"
        onClick={() => setShowVocabPanel(!showVocabPanel)}
      >
        {allVocab.length}
      </button>

      {showVocabPanel && (
        <div className="vocab-panel-overlay" onClick={() => setShowVocabPanel(false)}>
          <div className="vocab-panel" onClick={(e) => e.stopPropagation()}>
            <div className="vocab-panel-header">
              <h3>
                <TranslatableText textKey="viewer.savedWords">Saved Words</TranslatableText>
                {' '}({allVocab.length})
              </h3>
              <button onClick={() => setShowVocabPanel(false)}>×</button>
            </div>
            <div className="vocab-panel-list">
              {allVocab.map((item) => {
                const selData = safeJsonParse(item.selection_rect, {});
                const pageNum = selData.page || 0;

                return (
                  <div
                    key={item.id}
                    className="vocab-item"
                    onClick={() => {
                      const targetPage = selData.page || 0;
                      if (targetPage !== currentPage) {
                        setCurrentPage(targetPage);
                      }
                      closeModal();
                      highlightVocab(item.id, 5000);

                      setTimeout(() => {
                        const bounds = selData.bounds || selData;
                        if (scrollContainerRef.current && bounds) {
                          const scrollY = (bounds.y / 100) * scrollContainerRef.current.scrollHeight - 100;
                          scrollContainerRef.current.scrollTo({ top: Math.max(0, scrollY), behavior: 'smooth' });
                        }
                      }, targetPage !== currentPage ? 100 : 0);

                      setShowVocabPanel(false);
                    }}
                  >
                    <span className="vocab-word">{item.selected_text}</span>
                    <span className="vocab-page">p.{pageNum + 1}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
