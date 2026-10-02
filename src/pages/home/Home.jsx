import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { getSources, updateSource } from '../../services/source';
import { getTodayReviewCount } from '../../services/review';
import SourceGrid from '../../containers/source-grid/SourceGrid';
import ReviewCard from '../../components/cards/ReviewCard';
import AddSourceModal from '../../components/modals/AddSourceModal';
import { TranslatableText } from '../../components/translatable';
import useDecodeShelf from '../../hooks/useDecodeShelf';
import { shelfRelativeTime } from '../../services/shelf';
import useDiscoveryShelf from '../../hooks/useDiscoveryShelf';
import DiscoverShelf from '../../components/discover/DiscoverShelf';
import Brand from '../../components/Brand';
import Buddy from '../../components/Buddy';

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
  const [addInitialKind, setAddInitialKind] = useState(null); // 'youtube' | 'pdf' | 'web'
  const [addInitialTitle, setAddInitialTitle] = useState(null);
  const [addFromShelf, setAddFromShelf] = useState(false);
  const shelf = useDecodeShelf();
  const discover = useDiscoveryShelf();
  // 발견 카드로 추가를 시작하면 그 후보 id를 기억했다가, 저장 성공 시 선호도(+)를 학습.
  const pendingDiscoverIdRef = useRef(null);

  // 검색 및 필터 상태
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all'); // 'all' | 'pinned'
  const [columnCount, setColumnCount] = useState(() => {
    const saved = localStorage.getItem('grid_column_count');
    const value = Number.parseInt(saved, 10);
    return Number.isFinite(value) ? Math.min(6, Math.max(2, value)) : 3;
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

  // 해독 선반(유튜브) 카드 탭 → 기존 추가 모달을 해당 영상 URL로 프리필해 연다.
  function openShelfCard(item) {
    pendingDiscoverIdRef.current = null;
    setAddInitialUrl(`https://www.youtube.com/watch?v=${item.videoId}`);
    setAddInitialKind('youtube');
    setAddInitialTitle(null);
    setAddFromShelf(true);
    setShowAddModal(true);
  }

  // 발견 피드 카드 탭 → 타입(youtube/pdf/web)에 맞게 모달 프리필. 자동 추가는 절대 없음.
  function openDiscoverCard(item) {
    pendingDiscoverIdRef.current = item.id;
    setAddInitialUrl(item.url);
    setAddInitialKind(item.kind);
    setAddInitialTitle(item.title || null);
    setAddFromShelf(true);
    setShowAddModal(true);
  }

  function closeAddModal() {
    setShowAddModal(false);
    setAddInitialUrl(null);
    setAddInitialKind(null);
    setAddInitialTitle(null);
    setAddFromShelf(false);
    pendingDiscoverIdRef.current = null;
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
    // 발견 피드에서 시작한 추가면 그 후보에 긍정 선호도를 학습하고 카드를 뺀다.
    if (pendingDiscoverIdRef.current) {
      discover.choose(pendingDiscoverIdRef.current);
      pendingDiscoverIdRef.current = null;
    }
    loadData();
  }


  return (
    <div className="home-screen">
      <header className="home-header">
        <Brand />
        <nav className="header-nav" aria-label="Main navigation">
          <Link to="/" className="header-nav-link active" aria-current="page"><TranslatableText textKey="home.myLibrary">My Library</TranslatableText></Link>
          <Link to="/review" className="header-nav-link"><TranslatableText textKey="nav.review">Review</TranslatableText>{!loading && reviewCount > 0 && <span className="nav-review-count">{reviewCount}</span>}</Link>
        </nav>
        <div className="header-buttons">
          <button
            className="mypage-button"
            onClick={() => navigate('/mypage')}
            aria-label="My profile"
          >
            <span className="profile-initial">{(user?.user_metadata?.nickname || 'My').slice(0, 2)}</span>
          </button>
        </div>
      </header>

      <main className="home-content">
        <section className="home-hero" aria-labelledby="home-title">
          <div className="hero-copy">
            <span className="eyebrow"><span className="orange-dot" aria-hidden="true" /><TranslatableText textKey="home.heroEyebrow">A LITTLE CURIOSITY GOES A LONG WAY</TranslatableText></span>
            <h1 id="home-title">Your world,<br /><span>a little wider.</span></h1>
            <p><TranslatableText textKey="home.heroHint">Your favorite videos, stories, and ideas.<br />A new way to make English your own.</TranslatableText></p>
            <button className="dust-primary-button" onClick={() => setShowAddModal(true)}>
              <span aria-hidden="true">+</span><TranslatableText textKey="home.addSource">Add a source</TranslatableText><span className="button-arrow" aria-hidden="true">↗</span>
            </button>
            <span className="hero-small-note"><TranslatableText textKey="home.yourPace">A little every day. At your own pace.</TranslatableText></span>
          </div>
          <div className="hero-art">
            <span className="hero-hello" aria-hidden="true">hello, you<span>!</span></span>
            <Buddy className="hero-buddy" />
            <span className="hero-sticker"><span aria-hidden="true">✳</span> stay curious</span>
            <span className="art-spark hero-spark" aria-hidden="true">✳</span>
          </div>
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
        <div className="learning-overview">
          <section className="review-section">
            <ReviewCard count={reviewCount} loading={loading} />
          </section>
        {!loading && recentSource && statusFilter === 'all' && !searchQuery.trim() && (
          <section className="continue-section">
            <div className="section-header">
              <span className="overview-symbol" aria-hidden="true">↗</span>
              <h2><TranslatableText textKey="home.continueLearning">Continue Learning</TranslatableText></h2>
            </div>
            <button className="continue-card" onClick={() => openSource(recentSource)}>
              <span className="continue-type">{recentSource.type?.toUpperCase()}</span>
              <span className="continue-title">{recentSource.title || 'Untitled'}</span>
              <span className="continue-cta"><TranslatableText textKey="home.pickUp">Pick up where you left off</TranslatableText><span aria-hidden="true">→</span></span>
            </button>
          </section>
        )}
          {(!recentSource || statusFilter !== 'all' || searchQuery.trim()) && (
            <section className="curiosity-card">
              <span className="overview-symbol" aria-hidden="true">✳</span>
              <div><h2><TranslatableText textKey="home.curiosityTitle">Follow your curiosity.</TranslatableText></h2><p><TranslatableText textKey="home.curiosityHint">A video you love. A story that stays.<br />Good English starts with good interests.</TranslatableText></p></div>
            </section>
          )}
        </div>

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

        {/* 관심사 발견 피드 — 유튜브/PDF/웹 타입별 한 장씩. 보여줄 게 없으면 섹션 자체가 사라진다. */}
        {!loading && statusFilter === 'all' && !searchQuery.trim() && discover.items.length > 0 && (
          <DiscoverShelf
            items={discover.items}
            onOpen={openDiscoverCard}
            onDismiss={discover.dismiss}
            onRefresh={discover.refresh}
          />
        )}

        <section className="source-section">
          <div className="section-header library-heading">
            <div><span className="eyebrow">COLLECT. EXPLORE. MAKE IT YOURS.</span><h2><TranslatableText textKey="home.learningSources">Your little library</TranslatableText><span className="source-count">{filteredSources.length}</span></h2></div>
            <button className="dust-text-button" onClick={() => setShowAddModal(true)}><TranslatableText textKey="home.addSource">Add a source</TranslatableText> <span aria-hidden="true">↗</span></button>
          </div>
          <div className="library-toolbar">
          {/* 필터 탭 */}
          <div className="filter-tabs" role="group" aria-label="Filter sources">
            <button
              className={`filter-tab ${statusFilter === 'all' ? 'active' : ''}`}
              onClick={() => setStatusFilter('all')}
              aria-pressed={statusFilter === 'all'}
            >
              All
            </button>
            <button
              className={`filter-tab ${statusFilter === 'pinned' ? 'active' : ''}`}
              onClick={() => setStatusFilter('pinned')}
              aria-pressed={statusFilter === 'pinned'}
            >
              <span aria-hidden="true">✦</span> Favorites
            </button>

          </div>
          <div className="library-tools">
            <div className="search-bar">
              <span className="search-glyph" aria-hidden="true">⌕</span>
              <input type="search" className="search-input" aria-label="Search your library" placeholder="Find something good..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
              {searchQuery && <button className="search-clear-btn" aria-label="Clear search" onClick={() => setSearchQuery('')}>×</button>}
            </div>
            <div className="column-control">
              <button
                className="column-btn"
                onClick={() => handleColumnChange(-1)}
                disabled={columnCount <= 2}
                aria-label="Fewer columns"
              >
                −
              </button>
              <span className="column-count">{columnCount}</span>
              <button
                className="column-btn"
                onClick={() => handleColumnChange(1)}
                disabled={columnCount >= 6}
                aria-label="More columns"
              >
                +
              </button>
            </div>
          </div>
          </div>
          <SourceGrid
            sources={filteredSources}
            loading={loading}
            columnCount={columnCount}
            onSourceDeleted={loadData}
            onSourceUpdated={handleSourceUpdated}
            onAdd={() => setShowAddModal(true)}
            emptyKind={searchQuery.trim() ? 'search' : statusFilter === 'pinned' ? 'favorites' : 'library'}
          />
        </section>
        </>
        )}
        <footer className="home-footer"><span>little by little, a world opens up.</span><span>orange dust <span aria-hidden="true">✳</span></span></footer>
      </main>

      <nav className="bottom-nav" aria-label="Quick add">
        <button
          className="nav-button add-button"
          onClick={() => setShowAddModal(true)}
          aria-label="Add a source"
        >
          <span aria-hidden="true">+</span><span className="floating-add-label">Add a source</span>
        </button>
      </nav>

      <AddSourceModal
        isOpen={showAddModal}
        onClose={closeAddModal}
        onSuccess={handleAddSuccess}
        initialUrl={addInitialUrl}
        initialKind={addInitialKind}
        initialTitle={addInitialTitle}
        fromShelf={addFromShelf}
      />
    </div>
  );
}
