import { useState, useRef, useEffect } from 'react';
import { createSource, createYouTubeSource, uploadFile, deleteSource, removeUploadedFile } from '../../services/source';
import { convertPdfToImages } from '../../utils/pdfUtils';
import { generateThumbnailFromPage, ocrAllPages, prepareWebCapture } from './sourceHelpers';
import { parseYouTubeUrl, getYouTubeMetadata, fetchYouTubeCaptions, transcribeYouTubeWithWhisper, isWhisperAvailable, buildWhisperConfirmText, mapWhisperError } from '../../services/ai/youtube';
import { TranslatableText } from '../translatable';
import { apiFetch } from '../../services/apiFetch';
import { readBlobAsDataURL } from '../../utils/abort';
import { createImportTask } from './importTask';
import { captureSessionScope, assertSessionScope } from '../../services/sessionScope';

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
  const taskRef = useRef(null);
  const [cancelling, setCancelling] = useState(false);

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

  // Covers parent-driven closing, navigation, and unmount as well as our buttons.
  useEffect(() => {
    const sequence = linkSeqRef;
    return () => {
      taskRef.current?.cancel();
      taskRef.current = null;
      sequence.current++;
      setLoading(false);
      setCancelling(false);
      setLoadingStatus('');
    };
  }, [isOpen]);

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

  async function runImport(work, closeOnSuccess = true) {
    if (taskRef.current) return;
    const task = createImportTask({
      removeSource: id => {
        assertSessionScope(task.sessionScope);
        return deleteSource(id, task.sessionScope);
      },
      removeUpload: path => {
        assertSessionScope(task.sessionScope);
        return removeUploadedFile(path, undefined, task.sessionScope);
      },
    });
    taskRef.current = task;
    setLoading(true);
    setCancelling(false);
    setError('');
    setWarning('');
    const report = status => {
      if (taskRef.current === task && !task.signal.aborted) setLoadingStatus(status);
    };
    let succeeded = false;
    let failure = null;
    let sessionSignal;
    try {
      task.sessionScope = await captureSessionScope();
      task.signal.throwIfAborted();
      assertSessionScope(task.sessionScope);
      sessionSignal = task.sessionScope.signal;
      sessionSignal.addEventListener('abort', task.cancel, { once: true });
      await work(task, report);
      assertSessionScope(task.sessionScope);
      task.signal.throwIfAborted();
      succeeded = true;
    } catch (err) {
      // A real failure after cancellation (e.g. storage cleanup) still needs to
      // be shown. AbortError alone is the expected, silent cancellation outcome.
      if (err?.name !== 'AbortError') failure = err;
      try {
        await task.rollback();
      } catch (cleanupError) {
        failure = new Error(`저장된 자료를 정리하지 못했어요. 연결을 확인해 주세요. ${cleanupError.message || ''}`);
      }
    } finally {
      sessionSignal?.removeEventListener('abort', task.cancel);
      if (taskRef.current === task) {
        taskRef.current = null;
        setLoading(false);
        setCancelling(false);
        setLoadingStatus('');
        if (failure) setError(failure.message || '자료를 추가하지 못했어요.');
        else if (succeeded && closeOnSuccess) {
          onSuccess();
          handleClose();
        } else if (task.closeWhenDone) handleClose();
      }
    }
  }

  function cancelImport(closeWhenDone = false) {
    const task = taskRef.current;
    if (!task) {
      if (closeWhenDone) handleClose();
      return;
    }
    task.closeWhenDone ||= closeWhenDone;
    task.cancel();
    setCancelling(true);
    setLoadingStatus('취소 중...');
  }

  async function handleFileUpload(e) {
    const input = e.target;
    const file = input.files[0];
    input.value = '';
    if (!file) return;

    await runImport(async (task, report) => {
      const { signal } = task;
      const fileType = file.type.includes('pdf') ? 'pdf' : 'image';
      // Prepare locally first: conversion failures/cancellation leave no upload.
      report('Generating preview...');
      const pages = fileType === 'image'
        ? [await readBlobAsDataURL(file, signal)]
        : await convertPdfToImages(file, report, undefined, signal);
      signal.throwIfAborted();
      if (!pages.length) throw new Error('파일에서 페이지를 읽지 못했어요.');
      if (pages.length > 30) {
        setWarning(`이 PDF는 ${pages.length}페이지로 용량이 커서 저장에 실패할 수 있어요. 실패하면 더 적은 페이지로 나눠서 올려보세요.`);
      }
      report('Generating thumbnail...');
      const screenshot = await generateThumbnailFromPage(pages[0], signal);
      const ocrData = await ocrAllPages(pages, report, signal);
      signal.throwIfAborted();
      report('Uploading file...');
      const uploaded = await uploadFile(file, undefined, signal, task.sessionScope);
      task.trackUpload(uploaded.path);
      signal.throwIfAborted();
      report('Saving source...');
      await task.save(() => createSource({
        title: title || file.name,
        type: fileType,
        file_path: uploaded.url,
        screenshot,
        pages: JSON.stringify(pages),
        ocr_data: ocrData,
      }, task.sessionScope));
    });
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

  async function saveYoutube(task, report) {
    report('Saving YouTube source...');
    await task.save(() => createYouTubeSource({
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
    }, task.sessionScope));
  }

  async function captureWeb(task, report) {
    const capture = await prepareWebCapture(url, report, task.signal);
    report('Saving source...');
    await task.save(() => createSource({
      ...capture,
      title: title || url.trim(),
      file_path: url.trim(),
      to_read: fromShelf,
    }, task.sessionScope));
  }

  // Prepare a remote PDF overview. Only preparation failures can fall back to a
  // screenshot; cancellation or a failed database write must never start another import.
  async function savePdfFromUrl(task, report) {
    const { signal } = task;
    let source;
    try {
      report('Fetching PDF...');
      const res = await apiFetch('/api/pdf-proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
        signal,
        sessionScope: task.sessionScope,
      });
      if (!res.ok) throw new Error(`pdf proxy ${res.status}`);
      const blob = await res.blob();
      signal.throwIfAborted();
      const file = new File([blob], `${title || 'document'}.pdf`, { type: 'application/pdf' });
      const pages = await convertPdfToImages(file, report, OVERVIEW_PAGES, signal);
      signal.throwIfAborted();
      if (!pages.length) throw new Error('PDF에서 페이지를 읽지 못했어요.');
      report('Generating thumbnail...');
      const screenshot = await generateThumbnailFromPage(pages[0], signal);
      const ocrData = await ocrAllPages(pages, report, signal);
      source = {
        title: title || 'PDF',
        type: 'pdf',
        file_path: url,
        screenshot,
        pages: JSON.stringify(pages),
        ocr_data: ocrData,
        to_read: fromShelf,
      };
    } catch (err) {
      signal.throwIfAborted();
      console.warn('PDF-by-URL preparation failed, falling back to screenshot:', err);
      await captureWeb(task, report);
      return;
    }
    report('Saving source...');
    await task.save(() => createSource(source, task.sessionScope));
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
      await runImport(saveYoutube);
    } else if (linkKind === 'pdf') {
      await runImport(savePdfFromUrl);
    } else {
      await runImport(captureWeb);
    }
  }

  async function handleWhisperTranscribe() {
    if (!youtubePreview) return;

    // Cost/time confirmation before kicking off a paid, potentially long transcription.
    // Quote the actual total when the duration is known (captured at preview), else per-minute.
    const confirmed = window.confirm(buildWhisperConfirmText(videoDuration));
    if (!confirmed) return;

    await runImport(async (task, report) => {
      try {
        const result = await transcribeYouTubeWithWhisper(
          youtubePreview.videoId, 'en', report, videoDuration, task.signal
        );
        task.signal.throwIfAborted();
        if (!result?.segments.length) throw new Error('Transcription returned no results');
        setYoutubeCaptions(result);
        setCaptionStatus('found');
      } catch (err) {
        task.signal.throwIfAborted();
        throw new Error(mapWhisperError(err));
      }
    }, false);
  }

  function handleClose() {
    linkSeqRef.current++;
    setLoading(false);
    setCancelling(false);
    setLoadingStatus('');
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

  // Accidental overlay taps keep progress; explicit cancel/close stops the task.
  function handleOverlayClick() {
    if (loading) return;
    handleClose();
  }

  function handleCloseButton() {
    cancelImport(true);
  }

  return (
    <div className="modal-overlay" onClick={handleOverlayClick}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2><TranslatableText textKey="addSource.addNewSource">Add New Source</TranslatableText></h2>
          <button className="modal-close" onClick={handleCloseButton} aria-label={loading ? '작업 취소하고 닫기' : '닫기'}>
            ✕
          </button>
        </div>

        <div className="modal-tabs">
          <button
            className={`tab ${activeTab === 'file' ? 'active' : ''}`}
            disabled={loading}
            onClick={() => setActiveTab('file')}
          >
            <TranslatableText textKey="addSource.uploadFile">Upload File</TranslatableText>
          </button>
          <button
            className={`tab ${activeTab === 'link' ? 'active' : ''}`}
            disabled={loading}
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
              <div className="prepare-progress" role="status" aria-live="polite">
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
                <button type="button" className="prepare-cancel-button" onClick={() => cancelImport()} disabled={cancelling}>
                  {cancelling ? '취소 중...' : '작업 취소'}
                </button>
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
              disabled={loading}
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
                  disabled={loading}
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
                      : '웹페이지로 인식했어요 — 화면을 캡처해 단어와 문장을 학습할 수 있어요.')
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
