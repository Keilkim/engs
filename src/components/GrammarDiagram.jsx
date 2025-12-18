export default function GrammarDiagram({ grammarData, aiPatterns, loading, onClose }) {
  const patterns = aiPatterns?.patterns || [];
  const originalText = grammarData?.words?.map(w => w.text).join(' ') || '';

  return (
    <div className="grammar-diagram-overlay" onClick={onClose}>
      <div className="grammar-diagram-modal" onClick={(e) => e.stopPropagation()}>
        <div className="grammar-diagram-header">
          <h3>Grammar Analysis</h3>
          <button className="grammar-close-btn" onClick={onClose}>×</button>
        </div>

        <div className="grammar-diagram-content">
          {/* 원문 표시 */}
          {originalText && (
            <div className="grammar-original-text">
              "{originalText}"
            </div>
          )}

          {/* AI Pattern explanations */}
          {patterns.length > 0 && (
            <div className="grammar-patterns-section">
              <div className="grammar-patterns-list">
                {patterns.map((pattern, idx) => (
                  <div
                    key={idx}
                    className="grammar-pattern-item"
                    style={{ borderLeftColor: pattern.color }}
                  >
                    <div className="pattern-header">
                      <span
                        className="pattern-type"
                        style={{ color: pattern.color }}
                      >
                        {pattern.typeKr || pattern.type}
                      </span>
                      <span className="pattern-words">
                        {pattern.words?.join(' ') || ''}
                      </span>
                    </div>
                    <div className="pattern-explanation">
                      {pattern.explanation}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Loading state for AI analysis */}
          {loading && (
            <div className="grammar-loading">
              <div className="loading-spinner"></div>
              <span>문법 분석 중...</span>
            </div>
          )}

          {/* No patterns message */}
          {patterns.length === 0 && !loading && (
            <div className="grammar-no-connections">
              이 텍스트에서 학습할 문법 패턴을 찾지 못했습니다.
              <br />
              <small>문장 형태의 텍스트를 선택해보세요.</small>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
