import { useState, useRef } from 'react';
import { createSource, createYouTubeSource, uploadFile, captureWebpageScreenshot } from '../../services/source';
import { convertPdfToImages } from '../../utils/pdfUtils';
import { generateImageThumbnail, generateThumbnailFromPage, ocrAllPages } from './sourceHelpers';
import { parseYouTubeUrl, getYouTubeMetadata, fetchYouTubeCaptions, transcribeYouTubeWithWhisper, calculateWhisperCost, isWhisperAvailable } from '../../services/ai/youtube';
import { TranslatableText } from '../translatable';

export default function AddSourceModal({ isOpen, onClose, onSuccess }) {
  const [activeTab, setActiveTab] = useState('file');
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState('');
  const [error, setError] = useState('');
  const fileInputRef = useRef(null);

  // YouTube state
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [youtubePreview, setYoutubePreview] = useState(null); // { videoId, title, author, thumbnail }
  const [youtubeCaptions, setYoutubeCaptions] = useState(null);
  const [captionStatus, setCaptionStatus] = useState(''); // '' | 'loading' | 'found' | 'not_found'
  const [warning, setWarning] = useState('');
  const [titleTouched, setTitleTouched] = useState(false); // user typed the title manually
  const youtubeSeqRef = useRef(0); // guards against out-of-order YouTube URL responses

  if (!isOpen) return null;

  async function handleFileUpload(e) {
    const input = e.target;
    const file = input.files[0];
    // Reset immediately so re-selecting the same file re-fires onChange (allows retry).
    input.value = '';
    if (!file) return;

    setLoading(true);
    setError('');
    setWarning('');

    try {
      const fileType = file.type.includes('pdf') ? 'pdf' : 'image';
      setLoadingStatus('Uploading file...');
      const { url: fileUrl } = await uploadFile(file);

      let screenshot = null;
      let pages = null;
      let ocrData = null;

      if (fileType === 'image') {
        setLoadingStatus('Generating preview...');
        screenshot = await generateImageThumbnail(file);

        const fullImage = await new Promise((resolve) => {
          const reader = new FileReader();
          reader.onload = (ev) => resolve(ev.target.result);
          reader.readAsDataURL(file);
        });
        pages = [fullImage];
        ocrData = await ocrAllPages(pages, setLoadingStatus);
      } else if (fileType === 'pdf') {
        try {
          pages = await convertPdfToImages(file, setLoadingStatus);
          // Soft warning: large PDFs are stored inline and may exceed the request size limit.
          if (pages.length > 30) {
            setWarning(`이 PDF는 ${pages.length}페이지로 용량이 커서 저장에 실패할 수 있어요. 실패하면 더 적은 페이지로 나눠서 올려보세요.`);
          }
          if (pages.length > 0) {
            setLoadingStatus('Generating thumbnail...');
            screenshot = await generateThumbnailFromPage(pages[0]);
          }
          ocrData = await ocrAllPages(pages, setLoadingStatus);
        } catch (captureErr) {
          console.warn('Could not convert PDF pages:', captureErr);
        }
      }

      setLoadingStatus('Saving source...');
      await createSource({
        title: title || file.name,
        type: fileType,
        file_path: fileUrl,
        screenshot,
        pages: pages ? JSON.stringify(pages) : null,
        ocr_data: ocrData,
      });

      onSuccess();
      handleClose();
    } catch (err) {
      // Surface the real cause (auth expiry, oversized PDF insert, etc.) instead of a generic message.
      setError(err?.message || 'Failed to upload file');
    } finally {
      setLoading(false);
      setLoadingStatus('');
    }
  }

  async function handleScreenshotSubmit(e) {
    e.preventDefault();

    if (!url.trim()) {
      setError('Please enter a URL');
      return;
    }

    setLoading(true);
    setError('');
    setWarning('');

    try {
      setLoadingStatus('Capturing screenshot...');
      const result = await captureWebpageScreenshot(url);
      const pages = [result.image];

      setLoadingStatus('Generating thumbnail...');
      const thumbnail = await generateThumbnailFromPage(result.image);

      const ocrData = await ocrAllPages(pages, setLoadingStatus);

      setLoadingStatus('Saving source...');
      await createSource({
        title: title || result.title,
        type: 'screenshot',
        file_path: url,
        pages: JSON.stringify(pages),
        screenshot: thumbnail,
        ocr_data: ocrData,
      });

      onSuccess();
      handleClose();
    } catch (err) {
      setError(err?.message || 'Failed to capture screenshot');
    } finally {
      setLoading(false);
      setLoadingStatus('');
    }
  }

  // YouTube URL input handler - auto-detect and load metadata
  async function handleYoutubeUrlChange(inputUrl) {
    // Bump the sequence token: only the latest input's async responses are applied.
    const seq = ++youtubeSeqRef.current;

    setYoutubeUrl(inputUrl);
    setError('');
    setYoutubePreview(null);
    setYoutubeCaptions(null);
    setCaptionStatus('');
    // Clear any previously auto-filled title so a new URL doesn't keep the old video's title.
    if (!titleTouched) setTitle('');

    const parsed = parseYouTubeUrl(inputUrl);
    if (!parsed) return;

    try {
      setCaptionStatus('loading');
      const metadata = await getYouTubeMetadata(parsed.video_id);
      if (seq !== youtubeSeqRef.current) return; // a newer URL was entered; ignore stale response
      setYoutubePreview({
        videoId: parsed.video_id,
        title: metadata.title,
        author: metadata.author,
        thumbnail: metadata.thumbnail_url_hq,
      });
      if (!titleTouched) setTitle(metadata.title);

      // Auto-fetch captions
      const captions = await fetchYouTubeCaptions(parsed.video_id);
      if (seq !== youtubeSeqRef.current) return; // stale response, discard
      if (captions && captions.segments.length > 0) {
        setYoutubeCaptions(captions);
        setCaptionStatus('found');
      } else {
        setCaptionStatus('not_found');
      }
    } catch {
      if (seq !== youtubeSeqRef.current) return;
      setCaptionStatus('not_found');
    }
  }

  async function handleYoutubeSubmit(e) {
    e.preventDefault();
    if (!youtubePreview) {
      setError('Please enter a valid YouTube URL');
      return;
    }

    setLoading(true);
    setError('');
    setWarning('');

    try {
      setLoadingStatus('Saving YouTube source...');
      await createYouTubeSource({
        title: title || youtubePreview.title,
        youtubeData: {
          video_id: youtubePreview.videoId,
          channel: youtubePreview.author,
          has_captions: !!youtubeCaptions,
          caption_source: youtubeCaptions?.source || 'manual',
          thumbnail_url: youtubePreview.thumbnail,
        },
        captionsData: youtubeCaptions,
      });

      onSuccess();
      handleClose();
    } catch {
      setError('Failed to save YouTube source');
    } finally {
      setLoading(false);
      setLoadingStatus('');
    }
  }

  async function handleWhisperTranscribe() {
    if (!youtubePreview) return;

    // Cost/time confirmation before kicking off a paid, potentially long transcription.
    const perMinute = calculateWhisperCost(60); // { usd, krw } per minute of audio
    const confirmed = window.confirm(
      '음성 인식(Whisper)은 서버에서 유료 API를 사용합니다.\n\n' +
      `비용: 영상 1분당 약 $${perMinute.usd.toFixed(3)} (약 ${perMinute.krw}원)\n` +
      '소요 시간: 영상 길이에 따라 수 분이 걸릴 수 있어요.\n\n계속하시겠어요?'
    );
    if (!confirmed) return;

    setLoading(true);
    setError('');
    setWarning('');

    try {
      const result = await transcribeYouTubeWithWhisper(
        youtubePreview.videoId,
        'en',
        setLoadingStatus
      );

      if (result && result.segments.length > 0) {
        setYoutubeCaptions(result);
        setCaptionStatus('found');
      } else {
        setError('Transcription returned no results');
      }
    } catch (err) {
      const msg = (err?.message || '').toLowerCase();
      if (msg.includes('extract') || msg.includes('audio') || msg.includes('추출')) {
        // 외부 오디오 추출 서버가 유튜브 음성을 못 가져오는 경우
        // (대개 유튜브 제한 또는 추출 서버(yt-dlp 등) 문제 — 앱이 아닌 서버 이슈)
        setError('이 영상의 음성을 가져오지 못했어요. 유튜브 제한이거나 오디오 추출 서버 문제일 수 있어요. 자막이 있는 다른 영상을 이용하거나 잠시 후 다시 시도해 주세요.');
      } else {
        setError(`음성 인식에 실패했어요: ${err.message}`);
      }
    } finally {
      setLoading(false);
      setLoadingStatus('');
    }
  }

  function handleClose() {
    setUrl('');
    setYoutubeUrl('');
    setTitle('');
    setError('');
    setWarning('');
    setTitleTouched(false);
    setYoutubePreview(null);
    setYoutubeCaptions(null);
    setCaptionStatus('');
    setActiveTab('file');
    onClose();
  }

  // Block closing while an upload/OCR is in flight so the user doesn't lose progress
  // (and re-upload duplicates). Overlay taps are ignored; the ✕ button confirms first.
  function handleOverlayClick() {
    if (loading) return;
    handleClose();
  }

  function handleCloseButton() {
    if (loading && !window.confirm('업로드가 진행 중입니다. 창을 닫으면 진행이 취소돼요. 닫을까요?')) return;
    handleClose();
  }

  return (
    <div className="modal-overlay" onClick={handleOverlayClick}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2><TranslatableText textKey="addSource.addNewSource">Add New Source</TranslatableText></h2>
          <button className="modal-close" onClick={handleCloseButton}>
            ✕
          </button>
        </div>

        <div className="modal-tabs">
          <button
            className={`tab ${activeTab === 'file' ? 'active' : ''}`}
            onClick={() => setActiveTab('file')}
          >
            <TranslatableText textKey="addSource.uploadFile">Upload File</TranslatableText>
          </button>
          <button
            className={`tab ${activeTab === 'screenshot' ? 'active' : ''}`}
            onClick={() => setActiveTab('screenshot')}
          >
            Web URL
          </button>
          <button
            className={`tab ${activeTab === 'youtube' ? 'active' : ''}`}
            onClick={() => setActiveTab('youtube')}
          >
            YouTube
          </button>
        </div>

        {error && <div className="error-message">{error}</div>}
        {warning && (
          <div className="file-hint" style={{ color: '#fb923c', padding: '0 4px' }}>{warning}</div>
        )}

        <div className="modal-body">
          <div className="input-group">
            <label htmlFor="title">
              <TranslatableText textKey="addSource.titleOptional">Title (optional)</TranslatableText>
            </label>
            <input
              id="title"
              type="text"
              value={title}
              onChange={(e) => { setTitle(e.target.value); setTitleTouched(true); }}
              placeholder="Enter a title"
            />
          </div>

          {activeTab === 'file' && (
            <div className="file-upload-area">
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,image/*"
                onChange={handleFileUpload}
                hidden
              />
              <button
                className="file-select-button"
                onClick={() => fileInputRef.current?.click()}
                disabled={loading}
              >
                {loading ? (loadingStatus || 'Uploading...') : <TranslatableText textKey="addSource.selectFile">Select PDF or Image</TranslatableText>}
              </button>
              <p className="file-hint">
                <TranslatableText textKey="addSource.supportedFormats">Supports PDF, PNG, JPG</TranslatableText>
              </p>
            </div>
          )}

          {activeTab === 'screenshot' && (
            <form onSubmit={handleScreenshotSubmit}>
              <div className="input-group">
                <label htmlFor="screenshot-url">URL</label>
                <input
                  id="screenshot-url"
                  type="url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://..."
                  required
                />
              </div>
              <p className="file-hint">
                <TranslatableText textKey="addSource.screenshotHint">Captures main content as image (excludes header/footer)</TranslatableText>
              </p>
              <button
                type="submit"
                className="submit-button"
                disabled={loading}
              >
                {loading ? (loadingStatus || 'Capturing...') : <TranslatableText textKey="addSource.capture">Capture</TranslatableText>}
              </button>
            </form>
          )}

          {activeTab === 'youtube' && (
            <form onSubmit={handleYoutubeSubmit}>
              <div className="input-group">
                <label htmlFor="youtube-url">YouTube URL</label>
                <input
                  id="youtube-url"
                  type="url"
                  value={youtubeUrl}
                  onChange={(e) => handleYoutubeUrlChange(e.target.value)}
                  placeholder="https://youtube.com/watch?v=..."
                  required
                />
              </div>

              {/* Preview */}
              {youtubePreview && (
                <div className="youtube-preview" style={{ display: 'flex', gap: '12px', margin: '12px 0', padding: '12px', background: 'var(--bg-tertiary, #2a2a2a)', borderRadius: '8px' }}>
                  <img
                    src={youtubePreview.thumbnail}
                    alt=""
                    style={{ width: '120px', height: '68px', objectFit: 'cover', borderRadius: '6px' }}
                    onError={(e) => { e.target.style.display = 'none'; }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '14px', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {youtubePreview.title}
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--text-secondary, #888)', marginTop: '4px' }}>
                      {youtubePreview.author}
                    </div>
                    <div style={{ fontSize: '12px', marginTop: '4px' }}>
                      {captionStatus === 'loading' && <span style={{ color: 'var(--text-secondary)' }}>캡션 확인 중...</span>}
                      {captionStatus === 'found' && <span style={{ color: '#4ade80' }}>캡션 {youtubeCaptions?.segments?.length}개 발견</span>}
                      {captionStatus === 'not_found' && <span style={{ color: '#fb923c' }}>캡션 없음</span>}
                    </div>
                  </div>
                </div>
              )}

              {captionStatus === 'not_found' && (
                <p className="file-hint" style={{ color: '#fb923c' }}>
                  이 영상에는 사용할 수 있는 자막이 없어요. 음성 인식으로 자막을 만들거나, 자막 없이 먼저 저장할 수 있어요.
                </p>
              )}

              {captionStatus === 'loading' ? (
                <button
                  type="button"
                  className="submit-button"
                  disabled
                >
                  캡션 확인중...
                </button>
              ) : (
                <>
                  {captionStatus === 'not_found' && isWhisperAvailable() && (
                    <button
                      type="button"
                      className="submit-button"
                      onClick={handleWhisperTranscribe}
                      disabled={loading}
                      style={{ background: '#7c3aed', marginBottom: '8px' }}
                    >
                      {loading ? (loadingStatus || 'Transcribing...') : '음성 인식으로 자막 만들기 (Whisper)'}
                    </button>
                  )}
                  <button
                    type="submit"
                    className="submit-button"
                    disabled={loading || !youtubePreview}
                  >
                    {loading
                      ? (loadingStatus || 'Saving...')
                      : (captionStatus === 'not_found' ? '자막 없이 저장' : 'Save')}
                  </button>
                </>
              )}
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
