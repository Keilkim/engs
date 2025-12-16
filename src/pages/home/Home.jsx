import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { getSources } from '../../services/source';
import { getTodayReviewCount } from '../../services/review';
import SourceGrid from '../../containers/source-grid/SourceGrid';
import ReviewCard from '../../components/cards/ReviewCard';
import AddSourceModal from '../../components/modals/AddSourceModal';

export default function Home() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [sources, setSources] = useState([]);
  const [reviewCount, setReviewCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

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
      console.error('데이터 로드 실패:', err);
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
        <h1>내 서재</h1>
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
            <h2>학습 소스</h2>
            <span className="source-count">{sources.length}개</span>
          </div>
          <SourceGrid sources={sources} loading={loading} />
        </section>
      </main>

      <nav className="bottom-nav">
        <button className="nav-button active">
          <span>🏠</span>
          <span>홈</span>
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
          <span>대화</span>
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
