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

  if (!isOpen) return null;

  async function handleFileUpload(e) {
    const file = e.target.files[0];
    if (!file) return;

    setLoading(true);
    setError('');

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
    } catch {
      setError('Failed to upload file');
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
    } catch {
      setError('Failed to capture screenshot');
    } finally {
      setLoading(false);
      setLoadingStatus('');
    }
  }

  // YouTube URL input handler - auto-detect and load metadata
  async function handleYoutubeUrlChange(inputUrl) {
    setYoutubeUrl(inputUrl);
    setError('');
    setYoutubePreview(null);
    setYoutubeCaptions(null);
    setCaptionStatus('');

    const parsed = parseYouTubeUrl(inputUrl);
    if (!parsed) return;

    try {
      setCaptionStatus('loading');
      const metadata = await getYouTubeMetadata(parsed.video_id);
      setYoutubePreview({
        videoId: parsed.video_id,
        title: metadata.title,
        author: metadata.author,
        thumbnail: metadata.thumbnail_url_hq,
      });
      if (!title) setTitle(metadata.title);

      // Auto-fetch captions
      const captions = await fetchYouTubeCaptions(parsed.video_id);
      if (captions && captions.segments.length > 0) {
        setYoutubeCaptions(captions);
        setCaptionStatus('found');
      } else {
        setCaptionStatus('not_found');
      }
    } catch {
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
    setLoading(true);
    setError('');

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
      setError(`Whisper failed: ${err.message}`);
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
    setYoutubePreview(null);
    setYoutubeCaptions(null);
    setCaptionStatus('');
    setActiveTab('file');
    onClose();
  }

  return (
    <div className="modal-overlay" onClick={handleClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2><TranslatableText textKey="addSource.addNewSource">Add New Source</TranslatableText></h2>
          <button className="modal-close" onClick={handleClose}>
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

        <div className="modal-body">
          <div className="input-group">
            <label htmlFor="title">
              <TranslatableText textKey="addSource.titleOptional">Title (optional)</TranslatableText>
            </label>
            <input
              id="title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
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

              {captionStatus === 'not_found' && !isWhisperAvailable() && (
                <p className="file-hint" style={{ color: '#fb923c' }}>
                  캡션이 없습니다. Whisper 전사를 사용하려면 OPENAI_API_KEY를 서버 환경변수에 설정하세요.
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
              ) : captionStatus === 'not_found' && isWhisperAvailable() ? (
                <button
                  type="button"
                  className="submit-button"
                  onClick={handleWhisperTranscribe}
                  disabled={loading}
                  style={{ background: '#7c3aed' }}
                >
                  {loading ? (loadingStatus || 'Transcribing...') : 'Whisper로 전사하기'}
                </button>
              ) : (
                <button
                  type="submit"
                  className="submit-button"
                  disabled={loading || !youtubePreview || captionStatus !== 'found'}
                >
                  {loading ? (loadingStatus || 'Saving...') : 'Save'}
                </button>
              )}
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
