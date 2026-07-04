import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { getTodayReviewItems, getTotalReviewCount, updateReviewResult } from '../../services/review';
import { updateTodayStats } from '../../services/stats';
import Flashcard from '../../containers/flashcard/Flashcard';
import ScenePlayer from '../../containers/flashcard/ScenePlayer';
import { TranslatableText } from '../../components/translatable';
import { safeJsonParse } from '../../utils/errors';

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
  const [exiting, setExiting] = useState(false);
  const processingRef = useRef(false);

  useEffect(() => {
    loadItems();
  }, []);

  // 카드 탭 = "몰라요": 답을 공개만 한다. 다음 카드로 넘어가는 건 수동('다음' 버튼)으로만
  // — 자동 넘김 없음(사용자가 답/장면을 볼 시간을 스스로 조절).
  function handleReveal() {
    if (showAnswer || processingRef.current) return;
    setShowAnswer(true);
  }

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

      // 다음 카드로: 역방향 회전(뒤집기 원복)은 어색하므로, 카드를 왼쪽으로
      // 슬라이드시켜 내보낸 뒤 새 카드로 교체(key 변경 → 앞면부터 새로 등장).
      setExiting(true);
      setTimeout(() => {
        setCurrentIndex((prev) => prev + 1); // 마지막이면 == length → 완료 화면
        setShowAnswer(false);
        setExiting(false);
        processingRef.current = false;
        setProcessing(false);
      }, 260);
    } catch {
      // 저장 실패 시 피드백을 주고 같은 카드에서 재시도 가능하게 유지
      setSaveError(true);
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

  // 이 카드가 YouTube 장면에서 저장된 단어라면, 원본 오디오를 다시 들을 수 있게
  // Whisper 타임스탬프로 그 장면을 재생 연결한다.
  const annotation = currentItem?.annotation;
  const sceneRect = safeJsonParse(annotation?.selection_rect, null);
  const youtubeData = annotation?.source?.type === 'youtube' ? annotation.source.youtube_data : null;
  const sceneVideoId = youtubeData?.video_id;
  // Prefer the authoritative scene bounds saved with the annotation (pause-chunk
  // era); fall back to the word timestamp for legacy cards. Scene playback stays
  // gated to youtube_word cards, exactly as before.
  const isYoutubeWord = sceneRect?.type === 'youtube_word';
  const sceneStart = isYoutubeWord
    ? (typeof sceneRect.sceneStart === 'number'
        ? sceneRect.sceneStart
        : (typeof sceneRect.timestamp === 'number' ? sceneRect.timestamp : null))
    : null;
  const canPlayScene = Boolean(sceneVideoId) && sceneStart != null;

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
          key={currentIndex}
          item={currentItem}
          showAnswer={showAnswer}
          exiting={exiting}
          onReveal={handleReveal}
        />

        {canPlayScene && (
          <ScenePlayer
            key={`scene-${currentIndex}`}
            videoId={sceneVideoId}
            sourceId={annotation.source.id}
            segmentIndex={sceneRect.segmentIndex}
            fallbackStart={sceneStart}
            sceneStart={sceneRect.sceneStart}
            sceneEnd={sceneRect.sceneEnd}
          />
        )}

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

        {/*
          인출 정직성: 답을 여는 행위 자체가 "몰라요"(오답)다. 사후확신 편향으로
          "알았는데"를 누르는 걸 막는다. 넘어가는 건 오직 수동('다음' 버튼) —
          자동 넘김 없음(답/장면을 볼 시간을 사용자가 스스로 정함).
          - 앞면: 카드 탭 = 답 공개(=몰라요), '알아요' 버튼 = 정답 후 즉시 다음
          - 뒷면: 직접 '다음'을 눌러 넘어감(오답 처리)
        */}
        {showAnswer ? (
          <div className="advance-row">
            <button
              className="eval-button next"
              onClick={() => handleEvaluation(false)}
              disabled={processing}
            >
              <TranslatableText textKey="review.next">Next</TranslatableText>
            </button>
          </div>
        ) : (
          <div className="front-actions">
            <p className="reveal-hint">
              <TranslatableText textKey="review.tapIfUnsure">Don't know it? Tap the card to see the answer.</TranslatableText>
            </p>
            <button
              className="eval-button correct know-button"
              onClick={() => handleEvaluation(true)}
              disabled={processing}
            >
              <TranslatableText textKey="review.iKnow">I know</TranslatableText>
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
