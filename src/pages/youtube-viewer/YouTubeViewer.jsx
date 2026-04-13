import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import YouTube from 'react-youtube';
import { getSource, deleteSource } from '../../services/source';
import { getAnnotations, deleteAnnotation } from '../../services/annotation';
import useYouTubePlayer, { PLAYBACK_SPEEDS } from '../../hooks/useYouTubePlayer';
import { useChat } from '../../hooks';
import CaptionDisplay from '../../components/youtube/CaptionDisplay';
import WordQuickMenu from '../../components/modals/WordQuickMenu';
import ChatPanel from '../../components/ChatPanel';
import '../../styles/pages/youtube-viewer.css';

export default function YouTubeViewer() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [source, setSource] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [annotations, setAnnotations] = useState([]);

  // Word menu state (separate from Viewer's touch system)
  const [selectedWord, setSelectedWord] = useState(null);
  const [wordPosition, setWordPosition] = useState(null);
  const [selectedSegmentIndex, setSelectedSegmentIndex] = useState(null);
  const [selectedWordIndex, setSelectedWordIndex] = useState(null);
  const [selectedTimestamp, setSelectedTimestamp] = useState(null);
  const [existingAnnotationForWord, setExistingAnnotationForWord] = useState(null);

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // Resizable panel (default 70% video)
  const [playerHeight, setPlayerHeight] = useState(70);
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
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      const containerRect = containerRef.current.getBoundingClientRect();
      const mouseY = clientY - containerRect.top;
      const newHeight = (mouseY / containerRect.height) * 100;
      setPlayerHeight(Math.min(Math.max(newHeight, 20), 80));
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
  }, [isDragging]);

  const {
    currentTime,
    isPlaying,
    onReady,
    onStateChange,
    onEnd,
    seekTo,
    pauseVideo,
    playVideo,
    playbackRate,
    setPlaybackRate,
  } = useYouTubePlayer();

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

  // Press start → pause video only if playing
  const handlePressStart = useCallback(() => {
    wasPlayingRef.current = isPlaying;
    if (isPlaying) pauseVideo();
  }, [isPlaying, pauseVideo]);

  // Short tap or drag cancel (no menu opened) → resume video
  const handlePressEndNoMenu = useCallback(() => {
    if (wasPlayingRef.current) {
      playVideo();
      wasPlayingRef.current = false;
    }
  }, [playVideo]);

  // Word long-press → vocab search
  const handleWordLongPress = useCallback((word, rect, segmentIndex, wordIdx, timestamp) => {
    if (!word) return;
    const existing = findExistingAnnotation(word);

    setSelectedWord(word);
    setIsGrammarMode(false);
    setWordPosition({ x: rect.left + rect.width / 2, y: rect.bottom + 8 });
    setSelectedSegmentIndex(segmentIndex);
    setSelectedWordIndex(wordIdx);
    setSelectedTimestamp(timestamp);
    setExistingAnnotationForWord(existing || null);
  }, [findExistingAnnotation]);

  // Line long-press → grammar search
  const handleLineLongPress = useCallback((sentenceText, rect, segmentIndex, timestamp) => {
    if (!sentenceText) return;

    setSelectedWord(sentenceText);
    setIsGrammarMode(true);
    setSelectedSentenceText(sentenceText);
    setWordPosition({ x: rect.left + rect.width / 2, y: rect.bottom + 8 });
    setSelectedSegmentIndex(segmentIndex);
    setSelectedWordIndex(null);
    setSelectedTimestamp(timestamp);
    setExistingAnnotationForWord(null);
  }, []);

  const closeWordModal = useCallback(() => {
    setSelectedWord(null);
    setWordPosition(null);
    setSelectedSegmentIndex(null);
    setSelectedWordIndex(null);
    setSelectedTimestamp(null);
    setExistingAnnotationForWord(null);
    setIsGrammarMode(false);
    setSelectedSentenceText(null);

    // Resume video if it was playing before
    if (wasPlayingRef.current) {
      playVideo();
      wasPlayingRef.current = false;
    }
  }, [playVideo]);

  const handleWordSaved = useCallback((tempAnnotation) => {
    setAnnotations(prev => [...prev, tempAnnotation]);
  }, []);

  const handleWordDeleted = useCallback(async () => {
    if (!existingAnnotationForWord) return;
    try {
      await deleteAnnotation(existingAnnotationForWord.id);
      setAnnotations(prev => prev.filter(a => a.id !== existingAnnotationForWord.id));
      closeWordModal();
    } catch (err) {
      console.error('[YouTubeViewer] Delete annotation error:', err);
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

  const videoId = source?.youtube_data?.video_id;
  const segments = source?.captions_data?.segments || [];

  // Chat integration
  const captionContext = useMemo(() =>
    segments.map(s => s.text).join(' '),
    [segments]
  );
  const chatHook = useChat({ sourceId: id, sourceContext: captionContext, topicTitle: source?.title || '' });

  // Auto-pause video when chat panel opens
  const chatWasPlayingRef = useRef(false);
  useEffect(() => {
    if (chatHook.showPanel) {
      chatWasPlayingRef.current = isPlaying;
      pauseVideo();
    } else {
      if (chatWasPlayingRef.current) {
        playVideo();
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

      <div className="youtube-content" ref={containerRef}>
        <div className="youtube-player-container" style={{ height: `${playerHeight}%` }}>
          {videoId && (
            <YouTube
              videoId={videoId}
              opts={opts}
              onReady={onReady}
              onStateChange={onStateChange}
              onEnd={onEnd}
              className="youtube-player"
            />
          )}
          {isDragging && <div className="drag-overlay" />}
        </div>

        <div
          className={`resize-handle ${isDragging ? 'dragging' : ''}`}
          onMouseDown={handleDragStart}
          onTouchStart={handleDragStart}
        >
          <div className="resize-handle-bar" />
        </div>

        <div className="speed-control">
          <span className="speed-label">속도</span>
          <div className="speed-buttons">
            {PLAYBACK_SPEEDS.map((speed) => (
              <button
                key={speed}
                className={`speed-button ${playbackRate === speed ? 'active' : ''}`}
                onClick={() => setPlaybackRate(speed)}
              >
                {speed === 1 ? '1.0x' : `${speed}x`}
              </button>
            ))}
          </div>
        </div>

        <div className="captions-container">
          <CaptionDisplay
            segments={segments}
            currentTime={currentTime}
            isPlaying={isPlaying}
            onSeek={seekTo}
            onWordLongPress={handleWordLongPress}
            onLineLongPress={handleLineLongPress}
            onPressStart={handlePressStart}
            onPressEndNoMenu={handlePressEndNoMenu}
            savedWords={savedWordsSet}
          />
        </div>
      </div>

      <WordQuickMenu
        isOpen={!!selectedWord}
        position={wordPosition}
        placement="below"
        word={selectedWord}
        isGrammarMode={isGrammarMode}
        sourceId={id}
        sourceType="youtube"
        segmentIndex={selectedSegmentIndex}
        wordIndex={selectedWordIndex}
        timestamp={selectedTimestamp}
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
