import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import YouTube from 'react-youtube';
import { getSource, deleteSource } from '../../services/source';
import { getAnnotations, deleteAnnotation } from '../../services/annotation';
import useYouTubePlayer, { PLAYBACK_SPEEDS } from '../../hooks/useYouTubePlayer';
import useCaptionSync from '../../hooks/useCaptionSync';
import useGapExpandedPlayback from '../../hooks/useGapExpandedPlayback';
import { formatTime } from '../../services/ai/youtube';
import { useChat } from '../../hooks';
import { getSetting, setSetting, SETTINGS_KEYS } from '../../services/settings';
import { LANG_CODES } from '../../services/ai';
import CaptionDisplay from '../../components/youtube/CaptionDisplay';
import WordQuickMenu from '../../components/modals/WordQuickMenu';
import ChatPanel from '../../components/ChatPanel';
import WhisperUpgradeBanner from '../../components/youtube/WhisperUpgradeBanner';
import useWhisperUpgrade from '../../hooks/useWhisperUpgrade';
import { getWordTimeline } from '../../utils/captionWords';
import { buildPauseChunks } from '../../utils/pauseChunker';
import '../../styles/pages/youtube-viewer.css';

export default function YouTubeViewer() {
  const { id } = useParams();
  const navigate = useNavigate();

  // Caption-translation preference — read once at mount (settings only change on
  // the Settings page, which remounts this view on return). Persisted in
  // localStorage via the settings service.
  const [showCaptionTranslation] = useState(
    () => getSetting(SETTINGS_KEYS.CAPTION_SHOW_TRANSLATION, 'false') === 'true'
  );
  const [translationLangCode] = useState(() => {
    const lang = getSetting(SETTINGS_KEYS.TRANSLATION_LANGUAGE, 'Korean');
    return LANG_CODES[lang] || 'ko';
  });

  // Master gate for the "또박또박 느리게" feature (pause-chunk captions +
  // virtual-slow playback). Read once at mount; OFF (default) → the viewer
  // behaves exactly as before, and none of the new surfaces render.
  const [featureOn] = useState(
    () => getSetting(SETTINGS_KEYS.VIRTUAL_SLOW_MODE, 'false') === 'true'
  );
  const [upgradeDismissed, setUpgradeDismissed] = useState(false);
  // Caption row granularity (only meaningful when the master feature is ON and
  // the source has word timings): 'chunks' = pause-based breath units, 'cues' =
  // original source segments.
  const [rowMode, setRowMode] = useState(
    () => getSetting(SETTINGS_KEYS.CAPTION_ROW_MODE, 'chunks')
  );

  const [source, setSource] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [annotations, setAnnotations] = useState([]);
  // Always-current mirror of annotations for use inside async reconcile loops.
  const annotationsRef = useRef([]);
  useEffect(() => { annotationsRef.current = annotations; }, [annotations]);

  // Word menu state (separate from Viewer's touch system)
  const [selectedWord, setSelectedWord] = useState(null);
  const [wordPosition, setWordPosition] = useState(null);
  const [selectedSegmentIndex, setSelectedSegmentIndex] = useState(null);
  const [selectedRowIndex, setSelectedRowIndex] = useState(null);
  const [selectedWordIndex, setSelectedWordIndex] = useState(null);
  const [selectedTimestamp, setSelectedTimestamp] = useState(null);
  const [selectedSceneStart, setSelectedSceneStart] = useState(null);
  const [selectedSceneEnd, setSelectedSceneEnd] = useState(null);
  const [existingAnnotationForWord, setExistingAnnotationForWord] = useState(null);
  const [menuPlacement, setMenuPlacement] = useState('below');

  // 탭한 자막 행 기준으로 팝업 위치/방향 결정: 아래 공간이 부족하면 행 '위'로
  // 뒤집어(화살표는 아래를 향함) 하단 자막에서도 어긋나지 않게 한다.
  const computeMenuAnchor = useCallback((rect, estHeight) => {
    const spaceBelow = window.innerHeight - rect.bottom;
    const above = spaceBelow < estHeight && rect.top > spaceBelow;
    return {
      x: rect.left + rect.width / 2,
      y: above ? rect.top - 8 : rect.bottom + 8,
      placement: above ? 'above' : 'below',
    };
  }, []);

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // Script panel position: 'right' = video left + script right (drag a vertical
  // divider to resize), 'bottom' = video top + script below (drag a horizontal
  // divider). Toggled from the speed-control bar. Default to side-by-side on
  // wide screens, stacked on narrow ones. In both cases the video keeps a
  // stable 16:9 ratio and letterboxes (never crops/zooms).
  const [layout, setLayout] = useState(
    () => (typeof window !== 'undefined' && window.innerWidth >= 900 ? 'right' : 'bottom')
  );

  // Resizable split. `playerHeight` drives the bottom (stacked) layout, and
  // `playerWidth` drives the right (side-by-side) layout — kept independent so
  // switching layouts restores each split. Clamped so the script always keeps
  // a usable amount of space.
  const [playerHeight, setPlayerHeight] = useState(55);
  const [playerWidth, setPlayerWidth] = useState(62);
  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef(null);

  const handleDragStart = useCallback((e) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  useEffect(() => {
    if (!isDragging) return;

    const handleMove = (e) => {
      if (!containerRef.current) return;
      const containerRect = containerRef.current.getBoundingClientRect();
      if (layout === 'right') {
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const mouseX = clientX - containerRect.left;
        const newWidth = (mouseX / containerRect.width) * 100;
        // Keep at least ~25% for the script on the right.
        setPlayerWidth(Math.min(Math.max(newWidth, 35), 75));
      } else {
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        const mouseY = clientY - containerRect.top;
        const newHeight = (mouseY / containerRect.height) * 100;
        // Keep at least ~28% for the captions below.
        setPlayerHeight(Math.min(Math.max(newHeight, 30), 72));
      }
    };

    const handleEnd = () => setIsDragging(false);

    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleEnd);
    document.addEventListener('touchmove', handleMove, { passive: false });
    document.addEventListener('touchend', handleEnd);

    return () => {
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleEnd);
      document.removeEventListener('touchmove', handleMove);
      document.removeEventListener('touchend', handleEnd);
    };
  }, [isDragging, layout]);

  const player = useYouTubePlayer();
  const {
    currentTime,
    isPlaying,
    onReady,
    onStateChange,
    onEnd,
    onPlaybackRateChange,
    seekTo,
    pauseVideo,
    playVideo,
    playbackRate,
    subRatesSupported,
  } = player;

  // Track if video was playing before pause (to resume on menu close)
  const wasPlayingRef = useRef(false);
  const [isGrammarMode, setIsGrammarMode] = useState(false);
  const [selectedSentenceText, setSelectedSentenceText] = useState(null);

  useEffect(() => {
    async function loadSource() {
      try {
        setLoading(true);
        const data = await getSource(id);

        if (data.type !== 'youtube') {
          setError('이 소스는 YouTube 영상이 아닙니다');
          return;
        }

        setSource(data);
        const annotationsData = await getAnnotations(id);
        setAnnotations(annotationsData || []);
      } catch (err) {
        console.error('[YouTubeViewer] Load error:', err);
        setError('소스를 불러올 수 없습니다');
      } finally {
        setLoading(false);
      }
    }

    if (id) loadSource();
  }, [id]);

  const savedWordsSet = useMemo(() => {
    const set = new Set();
    annotations.forEach(ann => {
      try {
        const json = JSON.parse(ann.ai_analysis_json || '{}');
        if (json.isVocabulary) set.add(ann.selected_text.toLowerCase());
      } catch { /* ignore */ }
    });
    return set;
  }, [annotations]);

  const findExistingAnnotation = useCallback((word) => {
    const lowerWord = word.toLowerCase();
    return annotations.find(ann => {
      try {
        const json = JSON.parse(ann.ai_analysis_json || '{}');
        return json.isVocabulary && ann.selected_text.toLowerCase() === lowerWord;
      } catch { return false; }
    });
  }, [annotations]);

  const videoId = source?.youtube_data?.video_id;
  const segments = useMemo(() => source?.captions_data?.segments || [], [source]);

  // Word-level timing (Whisper) availability — gates the pause-chunk display and
  // the virtual-slow buttons. null for plain YouTube-caption sources.
  const wordTimeline = useMemo(() => getWordTimeline(source?.captions_data), [source]);
  const hasWordTimeline = !!wordTimeline;
  const upgrade = useWhisperUpgrade({
    source,
    onUpgraded: (row) => setSource(row),
  });

  // Pause chunks (shared by the chunk-row display AND the virtual-slow audio
  // engine, so both agree). Computed whenever word timings exist, independent of
  // the display row-mode toggle. Passed the STORED segments so each chunk carries
  // a sourceSegmentIndex for annotation-index translation.
  const engineChunks = useMemo(
    () => (featureOn && wordTimeline ? buildPauseChunks(wordTimeline.whisperSegments, segments) : []),
    [featureOn, wordTimeline, segments]
  );

  // Display rows: pause chunks in chunk mode (master ON + word timings), else the
  // original stored segments (byte-identical, exactly as before).
  const useChunks = featureOn && rowMode === 'chunks' && !!wordTimeline;
  const rows = useChunks ? engineChunks : segments;

  // Virtual-slow ("또박또박 느리게") playback engine. Gated on the master feature,
  // word timings, and the embed actually honoring sub-1x rates.
  const virtualEnabled = featureOn && hasWordTimeline && subRatesSupported;
  const gap = useGapExpandedPlayback({
    videoId,
    videoDuration: source?.youtube_data?.duration || 0,
    chunks: engineChunks,
    player,
    enabled: virtualEnabled,
  });

  // Transport facade: while virtual-slow is active, playback control routes to the
  // engine (which drives the muted video); otherwise straight to the player.
  const transportIsPlaying = gap.virtualActive ? gap.virtualIsPlaying : isPlaying;
  const transportPause = useCallback(() => {
    if (gap.virtualActive) gap.virtualPause(); else pauseVideo();
  }, [gap.virtualActive, gap.virtualPause, pauseVideo]);
  const transportPlay = useCallback(() => {
    if (gap.virtualActive) gap.virtualPlay(); else playVideo();
  }, [gap.virtualActive, gap.virtualPlay, playVideo]);
  const handleSeek = useCallback((t) => {
    if (gap.virtualActive) gap.virtualSeek(t); else seekTo(t);
  }, [gap.virtualActive, gap.virtualSeek, seekTo]);

  // Clock/flags the captions render from — engine content time only once the
  // engine is actually PLAYING (during 'loading' the video plays via native
  // ARMING and virtualTime hasn't ticked yet, so fall back to the video clock).
  const virtualClockLive = gap.virtualActive && gap.virtualState !== 'loading';
  const displayTime = virtualClockLive ? gap.virtualTime : currentTime;
  const displayIsPlaying = virtualClockLive ? gap.virtualIsPlaying : isPlaying;

  // Press start → pause playback (engine or video) only if playing
  const handlePressStart = useCallback(() => {
    wasPlayingRef.current = transportIsPlaying;
    if (transportIsPlaying) transportPause();
  }, [transportIsPlaying, transportPause]);

  // Short tap or drag cancel (no menu opened) → resume playback
  const handlePressEndNoMenu = useCallback(() => {
    if (wasPlayingRef.current) {
      transportPlay();
      wasPlayingRef.current = false;
    }
  }, [transportPlay]);

  // CaptionLine passes the DISPLAY row index. Translate it to the STORED-segment
  // index (chunk rows carry sourceSegmentIndex; cue rows are 1:1) and capture the
  // row's authoritative scene bounds, so saved annotations stay valid even though
  // the visible rows are derived chunks. See useSceneBounds / annotation save path.
  const rowScene = useCallback((rowIndex) => {
    const row = rows[rowIndex];
    return {
      storedIndex: row?.sourceSegmentIndex ?? rowIndex,
      sceneStart: typeof row?.start === 'number' ? row.start : null,
      sceneEnd: typeof row?.end === 'number' ? row.end : null,
      text: row?.text,
    };
  }, [rows]);

  // Word long-press → vocab search
  const handleWordLongPress = useCallback((word, rect, rowIndex, wordIdx, timestamp) => {
    if (!word) return;
    const existing = findExistingAnnotation(word);
    const scene = rowScene(rowIndex);

    const anchor = computeMenuAnchor(rect, 240);
    setSelectedWord(word);
    setIsGrammarMode(false);
    setWordPosition({ x: anchor.x, y: anchor.y });
    setMenuPlacement(anchor.placement);
    setSelectedSegmentIndex(scene.storedIndex);
    setSelectedRowIndex(rowIndex);
    setSelectedSceneStart(scene.sceneStart);
    setSelectedSceneEnd(scene.sceneEnd);
    setSelectedWordIndex(wordIdx);
    setSelectedTimestamp(timestamp);
    setExistingAnnotationForWord(existing || null);
  }, [findExistingAnnotation, computeMenuAnchor, rowScene]);

  // Line long-press → grammar search
  const handleLineLongPress = useCallback((sentenceText, rect, rowIndex, timestamp) => {
    if (!sentenceText) return;
    const scene = rowScene(rowIndex);

    const anchor = computeMenuAnchor(rect, 340);
    setSelectedWord(sentenceText);
    setIsGrammarMode(true);
    setSelectedSentenceText(sentenceText);
    setWordPosition({ x: anchor.x, y: anchor.y });
    setMenuPlacement(anchor.placement);
    setSelectedSegmentIndex(scene.storedIndex);
    setSelectedRowIndex(rowIndex);
    setSelectedSceneStart(scene.sceneStart);
    setSelectedSceneEnd(scene.sceneEnd);
    setSelectedWordIndex(null);
    setSelectedTimestamp(timestamp);
    setExistingAnnotationForWord(null);
  }, [computeMenuAnchor, rowScene]);

  const closeWordModal = useCallback(() => {
    setSelectedWord(null);
    setWordPosition(null);
    setSelectedSegmentIndex(null);
    setSelectedRowIndex(null);
    setSelectedWordIndex(null);
    setSelectedTimestamp(null);
    setSelectedSceneStart(null);
    setSelectedSceneEnd(null);
    setExistingAnnotationForWord(null);
    setIsGrammarMode(false);
    setSelectedSentenceText(null);

    // Resume playback if it was playing before
    if (wasPlayingRef.current) {
      transportPlay();
      wasPlayingRef.current = false;
    }
  }, [transportPlay]);

  // Reconcile optimistic temp rows with the real DB rows. The actual insert is
  // done by useWordLookup's fire-and-forget createAnnotation(), so we poll
  // getAnnotations() a few times and swap each temp-<ts> row for its real row
  // (with a real UUID) as it lands. Without this the temp id sticks around and
  // deleting the just-saved word fails with a Postgres uuid error.
  const reconcileAnnotations = useCallback(async () => {
    let pendingTemps = [];
    for (let attempt = 0; attempt < 6; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 500));

      let fresh;
      try {
        fresh = await getAnnotations(id);
      } catch {
        continue;
      }

      const serverTexts = new Set(
        (fresh || []).map(a => (a.selected_text || '').toLowerCase())
      );
      pendingTemps = annotationsRef.current.filter(a =>
        typeof a.id === 'string' &&
        a.id.startsWith('temp-') &&
        !serverTexts.has((a.selected_text || '').toLowerCase())
      );
      setAnnotations([...(fresh || []), ...pendingTemps]);
      if (pendingTemps.length === 0) return;
    }

    // Still unresolved after retries → the background save likely failed
    // (createAnnotation swallows its own error). Surface it instead of leaving a
    // phantom "saved" word that can't be deleted.
    if (pendingTemps.length > 0) {
      console.warn('[YouTubeViewer] Saved word did not persist to server');
      alert('단어 저장이 서버에 반영되지 않았을 수 있습니다. 새로고침 후 다시 확인해주세요.');
    }
  }, [id]);

  const handleWordSaved = useCallback((tempAnnotation) => {
    // Optimistic insert for instant "saved" feedback, then reconcile the temp
    // id with the real server row.
    setAnnotations(prev => [...prev, tempAnnotation]);
    reconcileAnnotations();
  }, [reconcileAnnotations]);

  const handleWordDeleted = useCallback(async () => {
    if (!existingAnnotationForWord) return;
    const annId = existingAnnotationForWord.id;

    // Not-yet-persisted temp row: never call the server (a temp-<ts> id would
    // trigger a Postgres "invalid input syntax for type uuid" error). Just drop
    // it locally.
    if (typeof annId === 'string' && annId.startsWith('temp-')) {
      setAnnotations(prev => prev.filter(a => a.id !== annId));
      closeWordModal();
      return;
    }

    try {
      await deleteAnnotation(annId);
      setAnnotations(prev => prev.filter(a => a.id !== annId));
      closeWordModal();
    } catch (err) {
      console.error('[YouTubeViewer] Delete annotation error:', err);
      alert('단어 삭제에 실패했습니다');
      closeWordModal();
    }
  }, [existingAnnotationForWord, closeWordModal]);

  const handleDelete = async () => {
    try {
      await deleteSource(id);
      navigate('/');
    } catch {
      alert('삭제에 실패했습니다');
    }
  };

  const { currentSegmentIndex } = useCaptionSync(segments, currentTime);

  // Chat integration.
  // Instead of shipping the full transcript on every chat turn (thousands of
  // tokens per message for long videos), send a sampled overview of the whole
  // video plus the segments around the current playback position.
  const CONTEXT_CHAR_BUDGET = 1500;

  const captionOverview = useMemo(() => {
    if (segments.length === 0) return '';
    const full = segments.map(s => s.text).join(' ');
    if (full.length <= CONTEXT_CHAR_BUDGET) return full;
    const step = Math.ceil(segments.length / 50);
    return segments
      .filter((_, i) => i % step === 0)
      .map(s => s.text)
      .join(' ')
      .slice(0, CONTEXT_CHAR_BUDGET);
  }, [segments]);

  const captionContext = useMemo(() => {
    if (segments.length === 0) return '';
    const full = segments.map(s => s.text).join(' ');
    // Short transcript: cheap enough to send whole.
    if (full.length <= CONTEXT_CHAR_BUDGET) return full;

    // Long transcript: overview + a window around the current position.
    const idx = currentSegmentIndex >= 0 ? currentSegmentIndex : 0;
    const from = Math.max(0, idx - 6);
    const to = Math.min(segments.length, idx + 10);
    const windowText = segments
      .slice(from, to)
      .map(s => `[${formatTime(s.start)}] ${s.text}`)
      .join('\n');
    return `[영상 전체 개요]\n${captionOverview}\n\n[현재 위치(${formatTime(segments[idx]?.start ?? 0)}) 부근 자막]\n${windowText}`;
  }, [segments, currentSegmentIndex, captionOverview]);

  const chatHook = useChat({ sourceId: id, sourceContext: captionContext, topicTitle: source?.title || '' });

  // Auto-pause video when chat panel opens
  const chatWasPlayingRef = useRef(false);
  useEffect(() => {
    if (chatHook.showPanel) {
      chatWasPlayingRef.current = transportIsPlaying;
      transportPause();
    } else {
      if (chatWasPlayingRef.current) {
        transportPlay();
        chatWasPlayingRef.current = false;
      }
    }
  }, [chatHook.showPanel]);

  const opts = {
    height: '100%',
    width: '100%',
    playerVars: { autoplay: 0, modestbranding: 1, rel: 0, playsinline: 1 },
  };

  if (loading) {
    return (
      <div className="youtube-viewer-loading">
        <div className="spinner" />
        <p>로딩 중...</p>
      </div>
    );
  }

  if (error || !source) {
    return (
      <div className="youtube-viewer-error">
        <p>{error || '소스를 찾을 수 없습니다'}</p>
        <button onClick={() => navigate('/')}>홈으로</button>
      </div>
    );
  }

  return (
    <div className="youtube-viewer">
      <header className="youtube-viewer-header">
        <button className="back-button" onClick={() => navigate('/')}>←</button>
        <h1 className="title">{source.title}</h1>
        <button className="delete-button" onClick={() => setShowDeleteConfirm(true)}>삭제</button>
      </header>

      <div className={`youtube-content layout-${layout}`} ref={containerRef}>
        <div
          className="youtube-player-container"
          style={{ '--player-height': `${playerHeight}%`, '--player-width': `${playerWidth}%` }}
        >
          {videoId && (
            <YouTube
              videoId={videoId}
              opts={opts}
              onReady={onReady}
              onStateChange={onStateChange}
              onEnd={onEnd}
              onPlaybackRateChange={onPlaybackRateChange}
              className="youtube-player"
            />
          )}
          {/* While virtual-slow is active the video is muted and engine-driven.
              A transparent overlay blocks the embed's own controls, whose tap
              would auto-unmute the player (double audio). */}
          {gap.virtualActive && <div className="virtual-slow-overlay" aria-hidden="true" />}
        </div>

        {/* 영상/자막 크기 조절 핸들. 오른쪽 배치=세로 구분선(좌우 드래그),
            하단 배치=가로 구분선(위아래 드래그). */}
        <div
          className={`resize-handle ${isDragging ? 'dragging' : ''}`}
          onMouseDown={handleDragStart}
          onTouchStart={handleDragStart}
        >
          <div className="resize-handle-bar" />
        </div>

        <div className="youtube-side">
        <div className="speed-control">
          <span className="speed-label">속도</span>
          <div className="speed-buttons">
            {PLAYBACK_SPEEDS.map((speed) => {
              const isVirtualLoading = gap.virtualActive && gap.virtualState === 'loading' && playbackRate === speed;
              return (
                <button
                  key={speed}
                  className={`speed-button ${playbackRate === speed ? 'active' : ''} ${isVirtualLoading ? 'loading' : ''}`}
                  onClick={() => gap.requestRate(speed)}
                  title={virtualEnabled && speed < 1 ? '또박또박 느리게 (원속 유지·간격 확장)' : undefined}
                >
                  {speed === 1 ? '1.0x' : `${speed}x`}
                </button>
              );
            })}
          </div>
          <button
            className="layout-toggle"
            onClick={() => setLayout((l) => (l === 'right' ? 'bottom' : 'right'))}
            title={layout === 'right' ? '자막을 하단으로' : '자막을 오른쪽으로'}
            aria-label={layout === 'right' ? '자막을 하단으로 이동' : '자막을 오른쪽으로 이동'}
          >
            {layout === 'right' ? (
              /* 현재: 오른쪽 배치 (영상 좌 · 자막 우) */
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5">
                <rect x="2" y="3.5" width="14" height="11" rx="1.5" />
                <line x1="11" y1="3.5" x2="11" y2="14.5" />
              </svg>
            ) : (
              /* 현재: 하단 배치 (영상 상 · 자막 하) */
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5">
                <rect x="2" y="3.5" width="14" height="11" rx="1.5" />
                <line x1="2" y1="10" x2="16" y2="10" />
              </svg>
            )}
          </button>
          {featureOn && hasWordTimeline && (
            <button
              className={`row-mode-toggle ${rowMode === 'chunks' ? 'active' : ''}`}
              onClick={() => {
                const next = rowMode === 'chunks' ? 'cues' : 'chunks';
                setRowMode(next);
                setSetting(SETTINGS_KEYS.CAPTION_ROW_MODE, next);
              }}
              title={rowMode === 'chunks' ? '원본 자막으로' : '호흡 단위로'}
              aria-label={rowMode === 'chunks' ? '원본 자막으로' : '호흡 단위로'}
            >
              {rowMode === 'chunks' ? '호흡' : '원본'}
            </button>
          )}
        </div>

        {featureOn && source.type === 'youtube' && !hasWordTimeline && !upgradeDismissed && (
          <WhisperUpgradeBanner
            upgrade={upgrade}
            durationSec={source.youtube_data?.duration || 0}
            onDismiss={() => setUpgradeDismissed(true)}
          />
        )}

        <div className="captions-container">
          <CaptionDisplay
            // Remount on source change, row-mode toggle, AND a mid-session
            // upgrade flipping chunks on (useChunks), so the index-keyed
            // caption-translation state starts clean and never serves a wrong row.
            key={`${id}:${rowMode}:${useChunks}`}
            segments={rows}
            currentTime={displayTime}
            isPlaying={displayIsPlaying}
            onSeek={handleSeek}
            onWordLongPress={handleWordLongPress}
            onLineLongPress={handleLineLongPress}
            onPressStart={handlePressStart}
            onPressEndNoMenu={handlePressEndNoMenu}
            savedWords={savedWordsSet}
            showTranslation={showCaptionTranslation}
            translationLang={translationLangCode}
          />
        </div>
        </div>
      </div>

      <WordQuickMenu
        isOpen={!!selectedWord}
        position={wordPosition}
        placement={menuPlacement}
        word={selectedWord}
        isGrammarMode={isGrammarMode}
        sourceId={id}
        sourceType="youtube"
        segmentIndex={selectedSegmentIndex}
        wordIndex={selectedWordIndex}
        timestamp={selectedTimestamp}
        sceneStart={selectedSceneStart}
        sceneEnd={selectedSceneEnd}
        // Sentence = the tapped DISPLAY row's text (the chunk the user studied),
        // not the stored cue — this string is persisted onto the saved card.
        sentence={rows?.[selectedRowIndex]?.text}
        existingAnnotation={existingAnnotationForWord}
        onClose={closeWordModal}
        onSaved={handleWordSaved}
        onDeleted={handleWordDeleted}
      />

      <ChatPanel chat={chatHook} sourceTitle={source?.title} />

      {showDeleteConfirm && (
        <div className="modal-overlay" onClick={() => setShowDeleteConfirm(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h3>삭제 확인</h3>
            <p>이 소스를 삭제하시겠습니까?</p>
            <div className="modal-actions">
              <button onClick={() => setShowDeleteConfirm(false)}>취소</button>
              <button className="danger" onClick={handleDelete}>삭제</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
