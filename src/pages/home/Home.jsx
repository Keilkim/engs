import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { getSources } from '../../services/source';
import { getTodayReviewCount } from '../../services/review';
import SourceGrid from '../../containers/source-grid/SourceGrid';
import ReviewCard from '../../components/cards/ReviewCard';
import AddSourceModal from '../../components/modals/AddSourceModal';
import { TranslatableText } from '../../components/translatable';

export default function Home() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [sources, setSources] = useState([]);
  const [reviewCount, setReviewCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);

  useEffect(() => {
    loadData();
    checkOnboarding();
  }, []);

  function checkOnboarding() {
    const hasSeenOnboarding = localStorage.getItem('onboarding_completed');
    if (!hasSeenOnboarding) {
      navigate('/onboarding');
    }
  }

  async function loadData() {
    setLoading(true);
    try {
      const [sourcesData, count] = await Promise.all([
        getSources(),
        getTodayReviewCount(),
      ]);
      setSources(sourcesData || []);
      setReviewCount(count || 0);
    } catch (err) {
      console.error('Failed to load data:', err);
    } finally {
      setLoading(false);
    }
  }

  function handleAddSuccess() {
    loadData();
  }

  return (
    <div className="home-screen">
      <header className="home-header">
        <h1><TranslatableText textKey="home.myLibrary">My Library</TranslatableText></h1>
        <button
          className="mypage-button"
          onClick={() => navigate('/mypage')}
        >
          <span className="profile-icon">👤</span>
        </button>
      </header>

      <main className="home-content">
        <section className="review-section">
          <ReviewCard count={reviewCount} loading={loading} />
        </section>

        <section className="source-section">
          <div className="section-header">
            <h2><TranslatableText textKey="home.learningSources">Learning Sources</TranslatableText></h2>
            <span className="source-count">{sources.length} <TranslatableText textKey="home.items">items</TranslatableText></span>
          </div>
          <SourceGrid sources={sources} loading={loading} />
        </section>
      </main>

      <nav className="bottom-nav">
        <button className="nav-button active">
          <span>🏠</span>
          <span><TranslatableText textKey="nav.home">Home</TranslatableText></span>
        </button>
        <button
          className="nav-button add-button"
          onClick={() => setShowAddModal(true)}
        >
          <span>➕</span>
        </button>
        <button
          className="nav-button"
          onClick={() => navigate('/chat')}
        >
          <span>💬</span>
          <span><TranslatableText textKey="nav.chat">Chat</TranslatableText></span>
        </button>
      </nav>

      <AddSourceModal
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        onSuccess={handleAddSuccess}
      />
    </div>
  );
}
