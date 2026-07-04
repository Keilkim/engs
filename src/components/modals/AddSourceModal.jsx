import { useState, useRef, useEffect } from 'react';
import { createSource, createYouTubeSource, uploadFile, captureWebpageScreenshot, captureScreenshot } from '../../services/source';
import { convertPdfToImages } from '../../utils/pdfUtils';
import { generateImageThumbnail, generateThumbnailFromPage, ocrAllPages } from './sourceHelpers';
import { parseYouTubeUrl, getYouTubeMetadata, fetchYouTubeCaptions, transcribeYouTubeWithWhisper, calculateWhisperCost, isWhisperAvailable, buildWhisperConfirmText, mapWhisperError } from '../../services/ai/youtube';
import { TranslatableText } from '../translatable';

// Discovery-added PDFs ingest only an OVERVIEW (keeps the inline `pages` insert small;
// interest-matching needs only the top pages). Manual uploads still ingest every page.
const OVERVIEW_PAGES = 3;

// A remote URL is a PDF if its path ends in .pdf (query string tolerated).
function isPdfUrl(u) {
  try {
    return /\.pdf$/i.test(new URL(u).pathname);
  } catch {
    return false;
  }
}

// 준비 단계 상태 문자열 → 한국어 라벨 + 진행률(% — "x/y"가 있으면 계산).
function formatStep(status) {
  if (!status) return { label: '처리 중...', percent: null };
  const frac = status.match(/(\d+)\s*\/\s*(\d+)/);
  const percent = frac ? Math.min(100, Math.round((Number(frac[1]) / Number(frac[2])) * 100)) : null;
  const s = status.toLowerCase();
  let label = status;
  if (s.startsWith('converting page')) label = `PDF 페이지 변환 중${frac ? ` (${frac[1]}/${frac[2]})` : ''}`;
  else if (s.startsWith('ocr')) label = `글자 인식 중${frac ? ` (${frac[1]}/${frac[2]})` : ''}`;
  else if (s.includes('uploading')) label = '파일 업로드 중...';
  else if (s.includes('generating preview')) label = '미리보기 생성 중...';
  else if (s.includes('generating thumbnail')) label = '썸네일 생성 중...';
  else if (s.includes('capturing')) label = '웹페이지 캡처 중...';
  else if (s.includes('saving youtube')) label = '유튜브 저장 중...';
  else if (s.includes('saving')) label = '저장 중...';
  else if (s.includes('transcrib')) label = '음성 인식 중...';
  return { label, percent };
}

export default function AddSourceModal({ isOpen, onClose, onSuccess, initialUrl = null, initialKind = null, initialTitle = null, fromShelf = false }) {
  const [activeTab, setActiveTab] = useState('file'); // 'file' | 'link'
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState('');
  const [error, setError] = useState('');
  const fileInputRef = useRef(null);

  // Link state (a single link input; YouTube is auto-detected from the URL)
  const [youtubePreview, setYoutubePreview] = useState(null); // { videoId, title, author, thumbnail }
  const [youtubeCaptions, setYoutubeCaptions] = useState(null);
  const [captionStatus, setCaptionStatus] = useState(''); // '' | 'loading' | 'found' | 'not_found' | 'error'
  const [videoDuration, setVideoDuration] = useState(0); // seconds (for Whisper length guard)
  const [warning, setWarning] = useState('');
  const [titleTouched, setTitleTouched] = useState(false); // user typed the title manually
  const linkSeqRef = useRef(0); // guards against out-of-order link responses
  // A discovery card passes an explicit kind + real title; these refs let those hints
  // win over URL sniffing and survive handleLinkChange's title-clear (which reads a
  // stale titleTouched closure). Cleared the moment the user edits the URL manually.
  const kindOverrideRef = useRef(null);
  const forcedTitleRef = useRef(null);

  // Prefill from a shelf (decode or discovery): switch to the link tab and run the
  // same preview flow as a manual paste. Must stay above the early return so hook
  // order is stable; fires once per open.
  useEffect(() => {
    if (isOpen && initialUrl) {
      setActiveTab('link');
      kindOverrideRef.current = initialKind;
      forcedTitleRef.current = initialTitle || null;
      if (initialTitle) setTitle(initialTitle);
      handleLinkChange(initialUrl);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, initialUrl]);

  if (!isOpen) return null;

  // 3-way link kind: an explicit shelf hint wins; otherwise sniff youtube → .pdf → web.
  // Routes both the live preview and the submit action so a link can never be saved as
  // the wrong type (a pasted .pdf no longer becomes an APIFlash screenshot).
  const linkKind =
    kindOverrideRef.current ||
    (parseYouTubeUrl(url) ? 'youtube' : isPdfUrl(url) ? 'pdf' : 'web');
  const isYoutube = linkKind === 'youtube';

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

  // Single link input: detect YouTube vs. web page. YouTube links load a
  // preview + captions; plain web links go straight to the screenshot path.
  async function handleLinkChange(inputUrl) {
    const seq = ++linkSeqRef.current;

    setUrl(inputUrl);
    setError('');
    setYoutubePreview(null);
    setYoutubeCaptions(null);
    setCaptionStatus('');
    setVideoDuration(0);
    // Clear any previously auto-filled title so a new URL doesn't keep the old title.
    // A discovery-forced title (forcedTitleRef) is kept — it's the real content title.
    if (!titleTouched && !forcedTitleRef.current) setTitle('');

    const parsed = parseYouTubeUrl(inputUrl);
    if (!parsed) return; // plain web URL → nothing to preload; handled on capture

    try {
      setCaptionStatus('loading');
      const metadata = await getYouTubeMetadata(parsed.video_id);
      if (seq !== linkSeqRef.current) return; // a newer URL was entered; ignore stale response
      setYoutubePreview({
        videoId: parsed.video_id,
        title: metadata.title,
        author: metadata.author,
        authorUrl: metadata.author_url,
        thumbnail: metadata.thumbnail_url_hq,
        channelId: null, // filled from the captions/InnerTube response below
        duration: 0,
      });
      if (!titleTouched && !forcedTitleRef.current) setTitle(metadata.title);

      try {
        const captions = await fetchYouTubeCaptions(parsed.video_id);
        if (seq !== linkSeqRef.current) return; // stale response, discard
        setVideoDuration(captions.durationSec || 0);
        // Capture channelId + duration whether or not captions exist, so the shelf
        // never has to re-resolve this video and Whisper can quote an exact cost.
        setYoutubePreview((prev) =>
          prev ? { ...prev, channelId: captions.channelId || null, duration: captions.durationSec || 0 } : prev
        );
        if (captions.segments.length > 0) {
          setYoutubeCaptions(captions);
          setCaptionStatus('found');
        } else {
          setCaptionStatus('not_found'); // 진짜로 자막이 없는 영상
        }
      } catch {
        // 자막 '불러오기 실패' — '자막 없음'으로 위장하지 않고 실패로 명확히 표시(반려).
        if (seq !== linkSeqRef.current) return;
        setCaptionStatus('error');
        setError('자막을 불러오지 못했어요. 잠시 후 다시 시도하거나, 자막 없이 저장/음성 인식을 이용해 주세요.');
      }
    } catch {
      if (seq !== linkSeqRef.current) return;
      setCaptionStatus('error');
      setError('유튜브 정보를 불러오지 못했어요. 링크를 확인하고 다시 시도해 주세요.');
    }
  }

  async function saveYoutube() {
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
          channel_id: youtubePreview.channelId || undefined,
          author_url: youtubePreview.authorUrl || undefined,
          duration: youtubePreview.duration || undefined,
          has_captions: !!youtubeCaptions,
          caption_source: youtubeCaptions?.source || 'manual',
          thumbnail_url: youtubePreview.thumbnail,
        },
        captionsData: youtubeCaptions,
        toRead: fromShelf,
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

  async function captureWeb() {
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
        to_read: fromShelf,
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

  // Remote PDF (e.g. a discovery card) → saved as a real type:'pdf' source. The bytes
  // are proxied (arbitrary hosts send no CORS header), turned into a File, then rendered
  // + OCR'd IN THE BROWSER (so the ~10s function budget doesn't apply). Only an OVERVIEW
  // is ingested. On any failure we fall back to the screenshot path so the add still lands.
  async function savePdfFromUrl() {
    setLoading(true);
    setError('');
    setWarning('');
    try {
      setLoadingStatus('Fetching PDF...');
      const res = await fetch('/api/pdf-proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      if (!res.ok) throw new Error(`pdf proxy ${res.status}`);
      const blob = await res.blob();
      const file = new File([blob], `${title || 'document'}.pdf`, { type: 'application/pdf' });

      const pages = await convertPdfToImages(file, setLoadingStatus, OVERVIEW_PAGES);
      let screenshot = null;
      if (pages.length > 0) {
        setLoadingStatus('Generating thumbnail...');
        screenshot = await generateThumbnailFromPage(pages[0]);
      }
      const ocrData = await ocrAllPages(pages, setLoadingStatus);

      setLoadingStatus('Saving source...');
      await createSource({
        title: title || 'PDF',
        type: 'pdf',
        file_path: url, // store the remote URL (matches how url/screenshot/youtube keep external links)
        screenshot,
        pages: pages.length ? JSON.stringify(pages) : null,
        ocr_data: ocrData,
        to_read: fromShelf,
      });
      onSuccess();
      handleClose();
    } catch (err) {
      // Fallback: screenshot the PDF-hosting page so the discovery add still succeeds.
      console.warn('PDF-by-URL ingest failed, falling back to screenshot:', err);
      await captureWeb();
    } finally {
      setLoading(false);
      setLoadingStatus('');
    }
  }

  // Web article (e.g. a discovery card) → saved as type:'url' with Readability content,
  // lighting up the existing article renderer. The edge fn fetches server-side (no client
  // CORS). If there's no extractable article body, fall back to a full-page screenshot.
  async function saveArticle() {
    setLoading(true);
    setError('');
    setWarning('');
    try {
      setLoadingStatus('Capturing...');
      const { screenshot, title: pageTitle, content } = await captureScreenshot(url);
      if (content) {
        setLoadingStatus('Saving source...');
        await createSource({
          title: title || pageTitle || url,
          type: 'url',
          file_path: url,
          content,
          screenshot,
          to_read: fromShelf,
        });
        onSuccess();
        handleClose();
      } else {
        await captureWeb(); // no article body → screenshot fallback
      }
    } catch (err) {
      console.warn('Article ingest failed, falling back to screenshot:', err);
      await captureWeb();
    } finally {
      setLoading(false);
      setLoadingStatus('');
    }
  }

  // Routes by URL type so YouTube ≠ screenshot can never be mixed up.
  async function handleLinkSubmit(e) {
    e.preventDefault();
    if (!url.trim()) {
      setError('링크를 입력해 주세요');
      return;
    }
    if (linkKind === 'youtube') {
      if (!youtubePreview) {
        setError('유튜브 정보를 불러오는 중이거나 유효하지 않은 링크예요. 잠시 후 다시 시도해 주세요.');
        return;
      }
      await saveYoutube();
    } else if (linkKind === 'pdf') {
      await savePdfFromUrl();
    } else {
      await saveArticle();
    }
  }

  async function handleWhisperTranscribe() {
    if (!youtubePreview) return;

    // Cost/time confirmation before kicking off a paid, potentially long transcription.
    // Quote the actual total when the duration is known (captured at preview), else per-minute.
    const confirmed = window.confirm(buildWhisperConfirmText(videoDuration));
    if (!confirmed) return;

    setLoading(true);
    setError('');
    setWarning('');

    try {
      const result = await transcribeYouTubeWithWhisper(
        youtubePreview.videoId,
        'en',
        setLoadingStatus,
        videoDuration
      );

      if (result && result.segments.length > 0) {
        setYoutubeCaptions(result);
        setCaptionStatus('found');
      } else {
        setError('Transcription returned no results');
      }
    } catch (err) {
      setError(mapWhisperError(err));
    } finally {
      setLoading(false);
      setLoadingStatus('');
    }
  }

  function handleClose() {
    setUrl('');
    setTitle('');
    setError('');
    setWarning('');
    setTitleTouched(false);
    setYoutubePreview(null);
    setYoutubeCaptions(null);
    setCaptionStatus('');
    setVideoDuration(0);
    setActiveTab('file');
    kindOverrideRef.current = null;
    forcedTitleRef.current = null;
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
            className={`tab ${activeTab === 'link' ? 'active' : ''}`}
            onClick={() => setActiveTab('link')}
          >
            링크 (YouTube / 웹)
          </button>
        </div>

        {error && <div className="error-message">{error}</div>}
        {warning && (
          <div className="file-hint" style={{ color: 'var(--color-warning)', padding: '0 4px' }}>{warning}</div>
        )}

        <div className="modal-body">
          {loading && (() => {
            const { label, percent } = formatStep(loadingStatus);
            return (
              <div className="prepare-progress">
                <div className="prepare-progress-bar">
                  <div
                    className={`prepare-progress-fill${percent == null ? ' indeterminate' : ''}`}
                    style={percent != null ? { width: `${percent}%` } : undefined}
                  />
                </div>
                <div className="prepare-progress-label">
                  <span>{label}</span>
                  {percent != null && <span>{percent}%</span>}
                </div>
              </div>
            );
          })()}

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

          {activeTab === 'link' && (
            <form onSubmit={handleLinkSubmit}>
              <div className="input-group">
                <label htmlFor="link-url">링크</label>
                <input
                  id="link-url"
                  type="url"
                  value={url}
                  onChange={(e) => {
                    // Manual edit drops the discovery hints so sniffing takes over.
                    kindOverrideRef.current = null;
                    forcedTitleRef.current = null;
                    handleLinkChange(e.target.value);
                  }}
                  placeholder="YouTube 또는 웹페이지 주소 붙여넣기"
                  required
                />
              </div>

              {/* 링크 종류 자동 안내 */}
              <p className="file-hint" style={{ color: isYoutube ? 'var(--color-success)' : 'var(--color-text-sub)' }}>
                {url.trim()
                  ? (linkKind === 'youtube'
                    ? '유튜브 영상으로 인식했어요 — 자막과 함께 저장돼요.'
                    : linkKind === 'pdf'
                      ? 'PDF 자료로 인식했어요 — 문서로 저장돼요.'
                      : '웹 아티클로 인식했어요 — 본문을 읽어 저장돼요.')
                  : '유튜브·PDF·웹 링크를 붙여넣으면 종류에 맞게 저장돼요.'}
              </p>

              {/* YouTube 링크: 미리보기 + 자막 상태 */}
              {isYoutube && youtubePreview && (
                <div className="youtube-preview" style={{ display: 'flex', gap: '12px', margin: '12px 0', padding: '12px', background: 'var(--color-base-sub-light)', borderRadius: '8px' }}>
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
                    <div style={{ fontSize: '12px', color: 'var(--color-text-sub)', marginTop: '4px' }}>
                      {youtubePreview.author}
                    </div>
                    <div style={{ fontSize: '12px', marginTop: '4px' }}>
                      {captionStatus === 'loading' && <span style={{ color: 'var(--color-text-sub)' }}>캡션 확인 중...</span>}
                      {captionStatus === 'found' && <span style={{ color: 'var(--color-success)' }}>캡션 {youtubeCaptions?.segments?.length}개 발견</span>}
                      {captionStatus === 'not_found' && <span style={{ color: 'var(--color-warning)' }}>캡션 없음</span>}
                      {captionStatus === 'error' && <span style={{ color: 'var(--color-error)' }}>자막 불러오기 실패</span>}
                    </div>
                  </div>
                </div>
              )}

              {isYoutube && captionStatus === 'not_found' && (
                <p className="file-hint" style={{ color: 'var(--color-warning)', margin: '4px 0 16px', lineHeight: 1.5 }}>
                  이 영상에는 사용할 수 있는 자막이 없어요. 음성 인식으로 자막을 만들거나, 자막 없이 먼저 저장할 수 있어요.
                </p>
              )}

              {/* 액션 버튼 */}
              {isYoutube ? (
                captionStatus === 'loading' ? (
                  <button type="button" className="submit-button" disabled>캡션 확인중...</button>
                ) : (
                  <>
                    {captionStatus === 'error' && (
                      <button
                        type="button"
                        className="submit-button"
                        onClick={() => handleLinkChange(url)}
                        disabled={loading}
                        style={{ background: 'transparent', border: '1px solid var(--color-accent)', marginBottom: '8px' }}
                      >
                        자막 다시 불러오기
                      </button>
                    )}
                    {(captionStatus === 'not_found' || captionStatus === 'error') && isWhisperAvailable() && (
                      <>
                        {videoDuration > 25 * 60 && (
                          <p className="file-hint" style={{ color: 'var(--color-text-sub)', margin: '4px 0 8px', lineHeight: 1.5 }}>
                            긴 영상({Math.round(videoDuration / 60)}분)은 여러 조각으로 나눠 전사돼요 — 시간이 좀 걸릴 수 있어요.
                          </p>
                        )}
                        <button
                          type="button"
                          className="submit-button"
                          onClick={handleWhisperTranscribe}
                          disabled={loading}
                          style={{ background: 'var(--color-ai)', marginBottom: '8px' }}
                        >
                          {loading ? (loadingStatus || 'Transcribing...') : '음성 인식으로 자막 만들기 (Whisper)'}
                        </button>
                      </>
                    )}
                    <button
                      type="submit"
                      className="submit-button"
                      disabled={loading || !youtubePreview}
                    >
                      {loading
                        ? (loadingStatus || 'Saving...')
                        : ((captionStatus === 'not_found' || captionStatus === 'error') ? '자막 없이 저장' : 'Save')}
                    </button>
                  </>
                )
              ) : (
                <button
                  type="submit"
                  className="submit-button"
                  disabled={loading || !url.trim()}
                >
                  {loading
                    ? (loadingStatus || 'Saving...')
                    : (linkKind === 'pdf'
                      ? 'PDF 저장'
                      : <TranslatableText textKey="addSource.capture">Capture</TranslatableText>)}
                </button>
              )}
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
