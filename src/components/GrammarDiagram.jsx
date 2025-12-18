import { useRef, useEffect, useState } from 'react';

export default function GrammarDiagram({ grammarData, onClose }) {
  const containerRef = useRef(null);
  const [wordPositions, setWordPositions] = useState([]);

  useEffect(() => {
    if (containerRef.current) {
      // 각 단어 요소의 위치 계산
      const wordElements = containerRef.current.querySelectorAll('.grammar-word');
      const positions = Array.from(wordElements).map((el) => {
        const rect = el.getBoundingClientRect();
        const containerRect = containerRef.current.getBoundingClientRect();
        return {
          x: rect.left - containerRect.left + rect.width / 2,
          y: rect.top - containerRect.top,
          width: rect.width,
        };
      });
      setWordPositions(positions);
    }
  }, [grammarData]);

  if (!grammarData || !grammarData.words) {
    return null;
  }

  const { words, connections } = grammarData;

  // SVG 포물선 경로 생성 (Quadratic Bezier)
  function createArcPath(fromX, fromY, toX, toY, arcHeight = 40) {
    const midX = (fromX + toX) / 2;
    const controlY = fromY - arcHeight;
    return `M ${fromX} ${fromY} Q ${midX} ${controlY} ${toX} ${toY}`;
  }

  return (
    <div className="grammar-diagram-overlay" onClick={onClose}>
      <div className="grammar-diagram-modal" onClick={(e) => e.stopPropagation()}>
        <div className="grammar-diagram-header">
          <h3>Grammar Analysis</h3>
          <button className="grammar-close-btn" onClick={onClose}>×</button>
        </div>

        <div className="grammar-diagram-content" ref={containerRef}>
          {/* SVG for connection arcs */}
          <svg className="grammar-arcs" width="100%" height="80">
            {wordPositions.length > 0 && connections.map((conn, idx) => {
              const fromPos = wordPositions[conn.from];
              const toPos = wordPositions[conn.to];

              if (!fromPos || !toPos) return null;

              const arcHeight = 30 + idx * 20; // 여러 연결이 겹치지 않게
              const path = createArcPath(fromPos.x, 70, toPos.x, 70, arcHeight);
              const labelX = (fromPos.x + toPos.x) / 2;
              const labelY = 70 - arcHeight - 5;

              return (
                <g key={idx}>
                  <path
                    d={path}
                    fill="none"
                    stroke={conn.color}
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                  {/* 연결선 끝 화살표/점 */}
                  <circle cx={fromPos.x} cy={70} r="3" fill={conn.color} />
                  <circle cx={toPos.x} cy={70} r="3" fill={conn.color} />
                  {/* 레이블 */}
                  <text
                    x={labelX}
                    y={labelY}
                    textAnchor="middle"
                    fill={conn.color}
                    fontSize="11"
                    fontWeight="500"
                  >
                    {conn.label}
                  </text>
                </g>
              );
            })}
          </svg>

          {/* Words with labels */}
          <div className="grammar-words">
            {words.map((word, idx) => (
              <div key={idx} className="grammar-word-container">
                <span
                  className="grammar-word"
                  style={{
                    color: word.color || '#fff',
                    borderBottomColor: word.color || 'transparent',
                  }}
                >
                  {word.text}
                </span>
                {word.label && (
                  <span
                    className="grammar-label"
                    style={{ color: word.color }}
                  >
                    {word.label}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Legend */}
        <div className="grammar-legend">
          <span className="legend-item">
            <span className="legend-color" style={{ background: '#60a5fa' }}></span>
            Subject (주어)
          </span>
          <span className="legend-item">
            <span className="legend-color" style={{ background: '#f87171' }}></span>
            Verb (동사)
          </span>
          <span className="legend-item">
            <span className="legend-color" style={{ background: '#4ade80' }}></span>
            Object (목적어)
          </span>
          <span className="legend-item">
            <span className="legend-color" style={{ background: '#c084fc' }}></span>
            Adjective (형용사)
          </span>
          <span className="legend-item">
            <span className="legend-color" style={{ background: '#fb923c' }}></span>
            Adverb (부사)
          </span>
          <span className="legend-item">
            <span className="legend-color" style={{ background: '#facc15' }}></span>
            Preposition (전치사)
          </span>
        </div>
      </div>
    </div>
  );
}
