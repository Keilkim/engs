import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { getSources, updateSource } from '../../services/source';
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

  // 검색 및 필터 상태
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState('all'); // 'all' | 'pinned'

  // 필터링된 소스 계산
  const filteredSources = useMemo(() => {
    let result = sources;

    // 상태 필터
    if (statusFilter === 'pinned') {
      result = result.filter(s => s.pinned);
    }

    // 제목 검색 필터
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter(source =>
        source.title?.toLowerCase().includes(query)
      );
    }

    return result;
  }, [sources, searchQuery, statusFilter]);

  // 소스 상태 업데이트 핸들러
  async function handleSourceUpdated(sourceId, updates) {
    // 1. 즉시 UI 업데이트 (optimistic)
    setSources(prev => prev.map(source =>
      source.id === sourceId ? { ...source, ...updates } : source
    ));

    // 2. API 호출 (백그라운드)
    try {
      await updateSource(sourceId, updates);
    } catch (err) {
      // 실패시 롤백
      setSources(prev => prev.map(source =>
        source.id === sourceId
          ? { ...source, ...Object.fromEntries(Object.keys(updates).map(k => [k, !updates[k]])) }
          : source
      ));
      console.error('Failed to update source:', err);
    }
  }

  useEffect(() => {
    // 페이지 진입 시 스크롤 상단으로 이동
    window.scrollTo(0, 0);
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
        <div className="header-buttons">
          <button
            className={`mypage-button search-button ${isSearchOpen ? 'active' : ''}`}
            onClick={() => setIsSearchOpen(!isSearchOpen)}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8"/>
              <path d="m21 21-4.35-4.35"/>
            </svg>
          </button>
          <button
            className="mypage-button"
            onClick={() => navigate('/chat')}
          >
            Chat
          </button>
          <button
            className="mypage-button"
            onClick={() => navigate('/mypage')}
          >
            My
          </button>
        </div>
      </header>

      {/* 검색창 */}
      {isSearchOpen && (
        <div className="search-bar">
          <input
            type="text"
            className="search-input"
            placeholder="Search by title..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            autoFocus
          />
          {searchQuery && (
            <button
              className="search-clear-btn"
              onClick={() => setSearchQuery('')}
            >
              ×
            </button>
          )}
        </div>
      )}

      <main className="home-content">
        <section className="review-section">
          <ReviewCard count={reviewCount} loading={loading} />
        </section>

        <section className="source-section">
          {/* 필터 탭 */}
          <div className="filter-tabs">
            <button
              className={`filter-tab ${statusFilter === 'all' ? 'active' : ''}`}
              onClick={() => setStatusFilter('all')}
            >
              All
            </button>
            <button
              className={`filter-tab ${statusFilter === 'pinned' ? 'active' : ''}`}
              onClick={() => setStatusFilter('pinned')}
            >
              Favorites
            </button>
          </div>

          <div className="section-header">
            <h2><TranslatableText textKey="home.learningSources">Learning Sources</TranslatableText></h2>
            <span className="source-count">{filteredSources.length} <TranslatableText textKey="home.items">items</TranslatableText></span>
          </div>
          <SourceGrid
            sources={filteredSources}
            loading={loading}
            onSourceDeleted={loadData}
            onSourceUpdated={handleSourceUpdated}
          />
        </section>
      </main>

      <nav className="bottom-nav">
        <button
          className="nav-button add-button"
          onClick={() => setShowAddModal(true)}
        >
          <span>+</span>
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
