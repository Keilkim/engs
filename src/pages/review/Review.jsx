import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { getTodayReviewItems, updateReviewResult } from '../../services/review';
import Flashcard from '../../containers/flashcard/Flashcard';

export default function Review() {
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [showAnswer, setShowAnswer] = useState(false);
  const [stats, setStats] = useState({ correct: 0, incorrect: 0 });

  useEffect(() => {
    loadItems();
  }, []);

  async function loadItems() {
    setLoading(true);
    try {
      const data = await getTodayReviewItems();
      setItems(data || []);
    } catch (err) {
      console.error('복습 아이템 로드 실패:', err);
    } finally {
      setLoading(false);
    }
  }

  async function handleEvaluation(isCorrect) {
    const currentItem = items[currentIndex];

    try {
      await updateReviewResult(currentItem.id, isCorrect);

      setStats((prev) => ({
        correct: prev.correct + (isCorrect ? 1 : 0),
        incorrect: prev.incorrect + (isCorrect ? 0 : 1),
      }));

      // 다음 카드로 이동
      if (currentIndex < items.length - 1) {
        setCurrentIndex((prev) => prev + 1);
        setShowAnswer(false);
      } else {
        // 모든 복습 완료
        setCurrentIndex(-1);
      }
    } catch (err) {
      console.error('평가 저장 실패:', err);
    }
  }

  function handleViewSource() {
    const currentItem = items[currentIndex];
    const sourceId = currentItem.annotation?.source_id;
    if (sourceId) {
      navigate(`/viewer/${sourceId}`);
    }
  }

  if (loading) {
    return (
      <div className="review-screen">
        <div className="review-loading">
          <div className="spinner" />
          <p>복습 항목 불러오는 중...</p>
        </div>
      </div>
    );
  }

  // 복습 완료 화면
  if (currentIndex === -1 || items.length === 0) {
    const total = stats.correct + stats.incorrect;
    const percentage = total > 0 ? Math.round((stats.correct / total) * 100) : 0;

    return (
      <div className="review-screen">
        <header className="review-header">
          <button className="back-button" onClick={() => navigate('/')}>
            ← 뒤로
          </button>
          <h1>복습 완료!</h1>
        </header>

        <main className="review-complete">
          <div className="complete-icon">🎉</div>
          <h2>오늘의 복습을 마쳤습니다</h2>

          {total > 0 && (
            <div className="review-stats">
              <div className="stat-item">
                <span className="stat-label">정답률</span>
                <span className="stat-value">{percentage}%</span>
              </div>
              <div className="stat-item">
                <span className="stat-label correct">✓ 알아요</span>
                <span className="stat-value">{stats.correct}</span>
              </div>
              <div className="stat-item">
                <span className="stat-label incorrect">✗ 몰라요</span>
                <span className="stat-value">{stats.incorrect}</span>
              </div>
            </div>
          )}

          <button className="home-button" onClick={() => navigate('/')}>
            홈으로 돌아가기
          </button>
        </main>
      </div>
    );
  }

  const currentItem = items[currentIndex];
  const progress = ((currentIndex + 1) / items.length) * 100;

  return (
    <div className="review-screen">
      <header className="review-header">
        <button className="back-button" onClick={() => navigate('/')}>
          ← 뒤로
        </button>
        <h1>복습 센터</h1>
        <span className="progress-text">
          {currentIndex + 1} / {items.length}
        </span>
      </header>

      <div className="progress-bar">
        <div
          className="progress-fill"
          style={{ width: `${progress}%` }}
        />
      </div>

      <main className="review-content">
        <Flashcard
          item={currentItem}
          onShowAnswer={() => setShowAnswer(true)}
        />

        <button
          className="view-source-button"
          onClick={handleViewSource}
        >
          📖 원문 문맥 보기
        </button>

        {showAnswer && (
          <div className="evaluation-buttons">
            <button
              className="eval-button incorrect"
              onClick={() => handleEvaluation(false)}
            >
              😕 몰라요
            </button>
            <button
              className="eval-button correct"
              onClick={() => handleEvaluation(true)}
            >
              😊 알아요
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
