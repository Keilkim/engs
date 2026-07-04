import { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { getSources, updateSource } from '../../services/source';
import { getTodayReviewCount } from '../../services/review';
import SourceGrid from '../../containers/source-grid/SourceGrid';
import ReviewCard from '../../components/cards/ReviewCard';
import AddSourceModal from '../../components/modals/AddSourceModal';
import { TranslatableText } from '../../components/translatable';
import useDecodeShelf from '../../hooks/useDecodeShelf';
import { shelfRelativeTime } from '../../services/shelf';

export default function Home() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [sources, setSources] = useState([]);
  const [reviewCount, setReviewCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  // 추천 줄에서 카드를 누르면 이 URL로 추가 모달을 프리필한다(동의 흐름 보존).
  const [addInitialUrl, setAddInitialUrl] = useState(null);
  const [addFromShelf, setAddFromShelf] = useState(false);
  const shelf = useDecodeShelf();

  // 검색 및 필터 상태
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState('all'); // 'all' | 'pinned'
  const [columnCount, setColumnCount] = useState(() => {
    const saved = localStorage.getItem('grid_column_count');
    return saved ? Math.min(6, Math.max(2, parseInt(saved, 10))) : 2;
  });


  // 컬럼 수 변경 핸들러
  function handleColumnChange(delta) {
    setColumnCount(prev => {
      const next = Math.min(6, Math.max(2, prev + delta));
      localStorage.setItem('grid_column_count', next);
      return next;
    });
  }

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

  // 소스 상태 업데이트 핸들러 (낙관적 업데이트 + 실패 시 스냅샷 복원)
  const handleSourceUpdated = useCallback(async (sourceId, updates) => {
    let snapshot = null;
    setSources(prev => {
      snapshot = prev.find(source => source.id === sourceId) || null;
      return prev.map(source =>
        source.id === sourceId ? { ...source, ...updates } : source
      );
    });

    try {
      await updateSource(sourceId, updates);
    } catch {
      // 이전 값의 부정(negation)이 아니라 실제 스냅샷으로 복원
      if (snapshot) {
        setSources(prev => prev.map(source =>
          source.id === sourceId ? snapshot : source
        ));
      }
    }
  }, []);

  // 가장 최근에 학습한 소스 (이어서 학습하기 카드용)
  const recentSource = useMemo(() => {
    const accessed = sources.filter(s => s.last_accessed);
    if (accessed.length === 0) return null;
    return [...accessed].sort(
      (a, b) => new Date(b.last_accessed) - new Date(a.last_accessed)
    )[0];
  }, [sources]);

  function openSource(source) {
    if (source.type === 'youtube') {
      navigate(`/youtube/${source.id}`);
    } else {
      navigate(`/viewer/${source.id}`);
    }
  }

  // 추천 카드 탭 → 기존 추가 모달을 해당 영상 URL로 프리필해 연다.
  function openShelfCard(item) {
    setAddInitialUrl(`https://www.youtube.com/watch?v=${item.videoId}`);
    setAddFromShelf(true);
    setShowAddModal(true);
  }

  function closeAddModal() {
    setShowAddModal(false);
    setAddInitialUrl(null);
    setAddFromShelf(false);
  }

  useEffect(() => {
    // 페이지 진입 시 스크롤 상단으로 이동
    window.scrollTo(0, 0);
    loadData();
    checkOnboarding();
  }, []);

  function checkOnboarding() {
    // 계정에 저장된 플래그(user_metadata)를 우선 사용하고, 없으면 로컬 캐시로 폴백.
    const seenOnAccount = user?.user_metadata?.onboarding_completed === true;
    const seenLocally = localStorage.getItem('onboarding_completed') === 'true';
    if (!seenOnAccount && !seenLocally) {
      navigate('/onboarding');
    }
  }

  async function loadData() {
    setLoading(true);
    setLoadError(false);
    try {
      const [sourcesData, count] = await Promise.all([
        getSources(),
        getTodayReviewCount(),
      ]);
      setSources(sourcesData || []);
      setReviewCount(count || 0);
    } catch {
      // 네트워크/서버 오류를 '소스 없음'으로 위장하지 않고 명시적 오류 상태로 표시
      setLoadError(true);
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

        {loadError ? (
          <section className="load-error-state">
            <p className="load-error-title">
              <TranslatableText textKey="home.loadErrorTitle">Couldn't load your library</TranslatableText>
            </p>
            <p className="load-error-hint">
              <TranslatableText textKey="home.loadErrorHint">
                Your data is safe. This looks like a temporary connection problem.
              </TranslatableText>
            </p>
            <button className="retry-button" onClick={loadData}>
              <TranslatableText textKey="home.retry">Try Again</TranslatableText>
            </button>
          </section>
        ) : (
        <>
        {!loading && recentSource && statusFilter === 'all' && !searchQuery.trim() && (
          <section className="continue-section">
            <div className="section-header">
              <h2><TranslatableText textKey="home.continueLearning">Continue Learning</TranslatableText></h2>
            </div>
            <button className="continue-card" onClick={() => openSource(recentSource)}>
              <span className="continue-type">{recentSource.type?.toUpperCase()}</span>
              <span className="continue-title">{recentSource.title || 'Untitled'}</span>
            </button>
          </section>
        )}

        {/* 다음 해독거리 추천 줄 — 이미 추가한 유튜브 채널의 새 업로드. 보여줄 게
            없으면 섹션 자체가 사라진다(빈 상태 문구도, 추가 유도도 없음). */}
        {!loading && statusFilter === 'all' && !searchQuery.trim() && shelf.items.length > 0 && (
          <section className="shelf-section">
            <div className="section-header">
              <h2><TranslatableText textKey="home.shelfTitle">Next to Decode</TranslatableText></h2>
              <button className="shelf-refresh" onClick={shelf.refresh}>
                <TranslatableText textKey="home.shelfRefresh">Refresh</TranslatableText>
              </button>
            </div>
            <div className="shelf-row">
              {shelf.items.map((item) => (
                <div
                  key={item.videoId}
                  className="shelf-card"
                  onClick={() => openShelfCard(item)}
                >
                  <div className="shelf-thumb">
                    <img
                      src={item.thumbnail}
                      alt=""
                      loading="lazy"
                      onError={(e) => { e.currentTarget.style.display = 'none'; }}
                    />
                    <button
                      className="shelf-dismiss"
                      aria-label="Skip this video"
                      onClick={(e) => { e.stopPropagation(); shelf.dismiss(item.videoId); }}
                    >
                      ✕
                    </button>
                  </div>
                  <div className="shelf-title">{item.title}</div>
                  <div className="shelf-meta">
                    {item.channelName}
                    {item.published ? ` · ${shelfRelativeTime(item.published)}` : ''}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

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

            {/* 컬럼 조절 */}
            <div className="column-control">
              <button
                className="column-btn"
                onClick={() => handleColumnChange(-1)}
                disabled={columnCount <= 2}
              >
                −
              </button>
              <span className="column-count">{columnCount}</span>
              <button
                className="column-btn"
                onClick={() => handleColumnChange(1)}
                disabled={columnCount >= 6}
              >
                +
              </button>
            </div>
          </div>

          <div className="section-header">
            <h2><TranslatableText textKey="home.learningSources">Learning Sources</TranslatableText></h2>
            <span className="source-count">{filteredSources.length} <TranslatableText textKey="home.items">items</TranslatableText></span>
          </div>
          <SourceGrid
            sources={filteredSources}
            loading={loading}
            columnCount={columnCount}
            onSourceDeleted={loadData}
            onSourceUpdated={handleSourceUpdated}
          />
        </section>
        </>
        )}
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
        onClose={closeAddModal}
        onSuccess={handleAddSuccess}
        initialUrl={addInitialUrl}
        fromShelf={addFromShelf}
      />
    </div>
  );
}
