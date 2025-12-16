import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { getTodayReviewItems, updateReviewResult } from '../../services/review';
import Flashcard from '../../containers/flashcard/Flashcard';
import { TranslatableText } from '../../components/translatable';

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
      console.error('Failed to load review items:', err);
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

      if (currentIndex < items.length - 1) {
        setCurrentIndex((prev) => prev + 1);
        setShowAnswer(false);
      } else {
        setCurrentIndex(-1);
      }
    } catch (err) {
      console.error('Failed to save evaluation:', err);
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
          <p><TranslatableText textKey="review.loadingItems">Loading review items...</TranslatableText></p>
        </div>
      </div>
    );
  }

  if (currentIndex === -1 || items.length === 0) {
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
          onShowAnswer={() => setShowAnswer(true)}
        />

        <button
          className="view-source-button"
          onClick={handleViewSource}
        >
          <TranslatableText textKey="review.viewContext">View original context</TranslatableText>
        </button>

        {showAnswer && (
          <div className="evaluation-buttons">
            <button
              className="eval-button incorrect"
              onClick={() => handleEvaluation(false)}
            >
              <TranslatableText textKey="review.dontKnow">Don't know</TranslatableText>
            </button>
            <button
              className="eval-button correct"
              onClick={() => handleEvaluation(true)}
            >
              <TranslatableText textKey="review.iKnow">I know</TranslatableText>
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
