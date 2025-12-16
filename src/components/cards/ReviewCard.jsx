import { useNavigate } from 'react-router-dom';

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
        <h2>오늘의 복습</h2>
      </div>
      <div className="review-card-body">
        {count > 0 ? (
          <>
            <p className="review-count">
              <strong>{count}</strong>개의 항목
            </p>
            <p className="review-description">복습할 시간이에요!</p>
          </>
        ) : (
          <>
            <p className="review-count">모두 완료!</p>
            <p className="review-description">오늘 복습을 마쳤습니다</p>
          </>
        )}
      </div>
      <button className="review-start-button">
        {count > 0 ? '복습 시작하기' : '다시 보기'}
      </button>
    </div>
  );
}
