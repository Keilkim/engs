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
      onClick={count > 0 ? handleClick : undefined}
    >
      <div className="review-card-header">
        <h2><TranslatableText textKey="reviewCard.title">Today's Review</TranslatableText></h2>
      </div>
      <div className="review-card-body">
        {count > 0 ? (
          <>
            <p className="review-count">
              <strong>{count}</strong> <TranslatableText textKey="reviewCard.itemsToReview">items to review</TranslatableText>
            </p>
            <p className="review-description">
              <TranslatableText textKey="reviewCard.timeToReview">Time to review!</TranslatableText>
            </p>
          </>
        ) : (
          <>
            <p className="review-count">
              <TranslatableText textKey="reviewCard.allDone">All done!</TranslatableText>
            </p>
            <p className="review-description">
              <TranslatableText textKey="reviewCard.completedToday">You've completed today's review</TranslatableText>
            </p>
          </>
        )}
      </div>
      {/* 복습할 카드가 없으면 눌러도 빈 화면만 나오는 'Review Again' 버튼을 숨긴다 */}
      {count > 0 && (
        <button className="review-start-button">
          <TranslatableText textKey="reviewCard.startReview">Start Review</TranslatableText>
        </button>
      )}
    </div>
  );
}
