import { useState, useRef } from 'react';
import { createSource, uploadFile, captureWebpageScreenshot } from '../../services/source';
import { convertPdfToImages } from '../../utils/pdfUtils';
import { generateImageThumbnail, generateThumbnailFromPage, ocrAllPages } from './sourceHelpers';
import { TranslatableText } from '../translatable';

export default function AddSourceModal({ isOpen, onClose, onSuccess }) {
  const [activeTab, setActiveTab] = useState('file');
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState('');
  const [error, setError] = useState('');
  const fileInputRef = useRef(null);

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

  function handleClose() {
    setUrl('');
    setTitle('');
    setError('');
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
        </div>
      </div>
    </div>
  );
}
