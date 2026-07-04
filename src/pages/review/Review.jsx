import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { getTodayReviewItems, getTotalReviewCount, updateReviewResult } from '../../services/review';
import { updateTodayStats } from '../../services/stats';
import Flashcard from '../../containers/flashcard/Flashcard';
import { TranslatableText } from '../../components/translatable';

export default function Review() {
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [showAnswer, setShowAnswer] = useState(false);
  const [stats, setStats] = useState({ correct: 0, incorrect: 0 });
  const [totalItems, setTotalItems] = useState(0);
  const [processing, setProcessing] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const processingRef = useRef(false);

  useEffect(() => {
    loadItems();
  }, []);

  async function loadItems() {
    setLoading(true);
    setError(false);
    try {
      const [data, total] = await Promise.all([
        getTodayReviewItems(),
        getTotalReviewCount(),
      ]);
      setItems(data || []);
      setTotalItems(total || 0);
      setCurrentIndex(0);
      setStats({ correct: 0, incorrect: 0 });
    } catch {
      // 로드 실패를 '복습 완료'로 위장하지 않고 별도 에러 상태로 표시
      setError(true);
    } finally {
      setLoading(false);
    }
  }

  async function handleEvaluation(isCorrect) {
    // 연타 재진입 차단 (이중 처리 / index 범위 초과 크래시 방지)
    if (processingRef.current) return;
    const currentItem = items[currentIndex];
    if (!currentItem) return;

    processingRef.current = true;
    setProcessing(true);
    setSaveError(false);

    try {
      await updateReviewResult(currentItem.id, isCorrect);

      // 통계 기록 (실패해도 복습 흐름은 계속 진행)
      try {
        await updateTodayStats('cards_reviewed');
        if (isCorrect) await updateTodayStats('cards_correct');
      } catch {
        // 통계 기록 실패는 복습을 막지 않는다
      }

      setStats((prev) => ({
        correct: prev.correct + (isCorrect ? 1 : 0),
        incorrect: prev.incorrect + (isCorrect ? 0 : 1),
      }));

      // 다음 카드로 이동 (마지막이면 currentIndex === items.length → 완료 화면)
      setCurrentIndex((prev) => prev + 1);
      setShowAnswer(false);
    } catch {
      // 저장 실패 시 피드백을 주고 같은 카드에서 재시도 가능하게 유지
      setSaveError(true);
    } finally {
      processingRef.current = false;
      setProcessing(false);
    }
  }

  if (loading) {
    return (
      <div className="review-screen">
        <div className="review-loading">
          <div className="spinner" />
          <p><TranslatableText textKey="review.loadingItems">Loading review items...</TranslatableText></p>
        </div>
      </div>
    );
  }

  // 로드 오류: 완료 화면으로 위장하지 않고 재시도 제공
  if (error) {
    return (
      <div className="review-screen">
        <header className="review-header">
          <button className="back-button" onClick={() => navigate('/')}>
            <TranslatableText textKey="nav.back">Back</TranslatableText>
          </button>
          <h1><TranslatableText textKey="review.errorTitle">Couldn't load review</TranslatableText></h1>
        </header>
        <main className="review-complete">
          <p><TranslatableText textKey="review.errorMessage">Something went wrong loading your review. Please try again.</TranslatableText></p>
          <button className="home-button" onClick={loadItems}>
            <TranslatableText textKey="review.retry">Retry</TranslatableText>
          </button>
        </main>
      </div>
    );
  }

  // 세션 완료: 카드를 모두 평가했거나(방어적으로 index가 범위를 벗어나면) 완료 화면
  if (items.length > 0 && currentIndex >= items.length) {
    const total = stats.correct + stats.incorrect;
    const percentage = total > 0 ? Math.round((stats.correct / total) * 100) : 0;

    return (
      <div className="review-screen">
        <header className="review-header">
          <button className="back-button" onClick={() => navigate('/')}>
            <TranslatableText textKey="nav.back">Back</TranslatableText>
          </button>
          <h1><TranslatableText textKey="review.reviewComplete">Review Complete!</TranslatableText></h1>
        </header>

        <main className="review-complete">
          <div className="complete-icon">Done</div>
          <h2><TranslatableText textKey="review.completedMessage">You've completed today's review</TranslatableText></h2>

          {total > 0 && (
            <div className="review-stats">
              <div className="stat-item">
                <span className="stat-label">
                  <TranslatableText textKey="review.accuracy">Accuracy</TranslatableText>
                </span>
                <span className="stat-value">{percentage}%</span>
              </div>
              <div className="stat-item">
                <span className="stat-label correct">
                  <TranslatableText textKey="review.iKnow">I know</TranslatableText>
                </span>
                <span className="stat-value">{stats.correct}</span>
              </div>
              <div className="stat-item">
                <span className="stat-label incorrect">
                  <TranslatableText textKey="review.dontKnow">Don't know</TranslatableText>
                </span>
                <span className="stat-value">{stats.incorrect}</span>
              </div>
            </div>
          )}

          <button className="home-button" onClick={() => navigate('/')}>
            <TranslatableText textKey="review.returnHome">Return Home</TranslatableText>
          </button>
        </main>
      </div>
    );
  }

  // 복습할 카드가 없음: 신규 사용자(저장된 카드 0)와 '오늘 복습 완료'를 구분
  if (items.length === 0) {
    const isNewUser = totalItems === 0;

    return (
      <div className="review-screen">
        <header className="review-header">
          <button className="back-button" onClick={() => navigate('/')}>
            <TranslatableText textKey="nav.back">Back</TranslatableText>
          </button>
          <h1>
            {isNewUser ? (
              <TranslatableText textKey="review.noCardsTitle">No cards to review yet</TranslatableText>
            ) : (
              <TranslatableText textKey="review.reviewComplete">Review Complete!</TranslatableText>
            )}
          </h1>
        </header>

        <main className="review-complete">
          {isNewUser ? (
            <>
              <h2><TranslatableText textKey="review.noCardsHeading">Nothing to review yet</TranslatableText></h2>
              <p><TranslatableText textKey="review.noCardsCta">Tap a word in your sources to save it, and it'll show up here for review.</TranslatableText></p>
            </>
          ) : (
            <>
              <div className="complete-icon">Done</div>
              <h2><TranslatableText textKey="review.allDoneToday">You're all caught up for today</TranslatableText></h2>
            </>
          )}
          <button className="home-button" onClick={() => navigate('/')}>
            <TranslatableText textKey="review.returnHome">Return Home</TranslatableText>
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
          <TranslatableText textKey="nav.back">Back</TranslatableText>
        </button>
        <h1><TranslatableText textKey="review.reviewCenter">Review Center</TranslatableText></h1>
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
          showAnswer={showAnswer}
          onReveal={() => setShowAnswer(true)}
        />

        {currentItem?.annotation?.source?.title && (
          <p className="review-source-label">
            <TranslatableText textKey="review.from">From</TranslatableText>
            {': '}{currentItem.annotation.source.title}
          </p>
        )}

        {saveError && (
          <p className="review-save-error">
            <TranslatableText textKey="review.saveFailed">Couldn't save. Tap to try again.</TranslatableText>
          </p>
        )}

        {/* 능동 회상 강제: 답을 공개한 뒤에만 평가 버튼 노출 */}
        {showAnswer ? (
          <div className="evaluation-buttons">
            <button
              className="eval-button incorrect"
              onClick={() => handleEvaluation(false)}
              disabled={processing}
            >
              <TranslatableText textKey="review.dontKnow">I don't know</TranslatableText>
            </button>
            <button
              className="eval-button correct"
              onClick={() => handleEvaluation(true)}
              disabled={processing}
            >
              <TranslatableText textKey="review.iKnow">I know</TranslatableText>
            </button>
          </div>
        ) : (
          <div className="reveal-hint">
            <TranslatableText textKey="review.tapToReveal">Tap the card to reveal the answer</TranslatableText>
          </div>
        )}
      </main>
    </div>
  );
}
