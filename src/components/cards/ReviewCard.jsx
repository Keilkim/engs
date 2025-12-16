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
    <div className="review-card" onClick={handleClick}>
      <div className="review-card-header">
        <span className="review-icon">📚</span>
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
      <button className="review-start-button">
        {count > 0 ? (
          <TranslatableText textKey="reviewCard.startReview">Start Review</TranslatableText>
        ) : (
          <TranslatableText textKey="reviewCard.reviewAgain">Review Again</TranslatableText>
        )}
      </button>
    </div>
  );
}
