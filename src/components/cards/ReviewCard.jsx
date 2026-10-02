import { useNavigate } from 'react-router-dom';
import { TranslatableText } from '../translatable';

export default function ReviewCard({ count, loading }) {
  const navigate = useNavigate();

  function handleClick() {
    navigate('/review');
  }

  if (loading) {
    return (
      <div className="review-card review-card-skeleton">
        <div className="skeleton-text" />
        <div className="skeleton-text" />
      </div>
    );
  }

  return (
    <div
      className={`review-card ${count > 0 ? '' : 'review-card-done'}`}
    >
      <div className="review-card-header">
        <span className="overview-symbol" aria-hidden="true">✦</span>
        <h2><TranslatableText textKey="reviewCard.title">Today's Review</TranslatableText></h2>
        <span className="overview-label">LITTLE BY LITTLE</span>
      </div>
      <div className="review-card-body">
        {count > 0 ? (
          <>
            <p className="review-count">
              <strong>{count}</strong> <TranslatableText textKey="reviewCard.itemsToReview">items to review</TranslatableText>
            </p>
            <p className="review-description">
              <TranslatableText textKey="reviewCard.timeToReview">A few familiar words. A little more confidence.</TranslatableText>
            </p>
          </>
        ) : (
          <>
            <p className="review-count">
              <TranslatableText textKey="reviewCard.allDone">All caught up.</TranslatableText>
            </p>
            <p className="review-description">
              <TranslatableText textKey="reviewCard.completedToday">Keep exploring. Your next words are out there.</TranslatableText>
            </p>
          </>
        )}
      </div>
      {/* 복습할 카드가 없으면 눌러도 빈 화면만 나오는 'Review Again' 버튼을 숨긴다 */}
      {count > 0 && (
        <button className="review-start-button" onClick={handleClick}>
          <TranslatableText textKey="reviewCard.startReview">A little practice</TranslatableText><span aria-hidden="true">↗</span>
        </button>
      )}
    </div>
  );
}
