import { useState, useRef } from 'react';
import { createSource, uploadFile, captureWebpageScreenshot } from '../../services/source';
import { extractTextWithWordPositions } from '../../services/ai';
import { TranslatableText } from '../translatable';
import * as pdfjsLib from 'pdfjs-dist';

// PDF.js worker 설정 - use unpkg for better ESM compatibility
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

export default function AddSourceModal({ isOpen, onClose, onSuccess }) {
  const [activeTab, setActiveTab] = useState('file');
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState('');
  const [error, setError] = useState('');
  const fileInputRef = useRef(null);

  if (!isOpen) return null;

  // Generate thumbnail from image file
  async function generateImageThumbnail(file) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const maxSize = 800;
          let width = img.width;
          let height = img.height;

          if (width > height) {
            if (width > maxSize) {
              height = (height * maxSize) / width;
              width = maxSize;
            }
          } else {
            if (height > maxSize) {
              width = (width * maxSize) / height;
              height = maxSize;
            }
          }

          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL('image/jpeg', 0.7));
        };
        img.src = e.target.result;
      };
      reader.readAsDataURL(file);
    });
  }

  // Convert all PDF pages to high-quality images
  async function convertPdfToImages(file, onProgress) {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const numPages = pdf.numPages;
    const pages = [];

    for (let i = 1; i <= numPages; i++) {
      onProgress?.(`Converting page ${i}/${numPages}...`);

      const page = await pdf.getPage(i);
      const scale = 2.0; // 고화질
      const viewport = page.getViewport({ scale });

      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      canvas.height = viewport.height;
      canvas.width = viewport.width;

      await page.render({
        canvasContext: context,
        viewport: viewport,
      }).promise;

      // 고화질 JPEG로 저장
      const imageData = canvas.toDataURL('image/jpeg', 0.9);
      pages.push(imageData);
    }

    return pages;
  }

  // OCR all pages and extract word positions
  async function ocrAllPages(pages, onProgress) {
    const ocrData = { pages: [] };

    for (let i = 0; i < pages.length; i++) {
      onProgress?.(`OCR 처리 중 (${i + 1}/${pages.length})...`);

      try {
        const result = await extractTextWithWordPositions(pages[i]);
        console.log(`[Upload-OCR] Page ${i + 1} result:`, result?.words?.length || 0, 'words');
        if (result && result.words) {
          ocrData.pages.push({
            pageIndex: i,
            words: result.words.map(w => ({
              text: w.text,
              bbox: {
                x: w.bbox.x,
                y: w.bbox.y,
                width: w.bbox.width,
                height: w.bbox.height,
              },
            })),
          });
          console.log(`[Upload-OCR] Page ${i + 1} saved:`, ocrData.pages[i].words.length, 'words');
        } else {
          console.log(`[Upload-OCR] Page ${i + 1} no result, saving empty`);
          ocrData.pages.push({ pageIndex: i, words: [] });
        }
      } catch (err) {
        console.error(`Page ${i + 1} OCR failed:`, err);
        ocrData.pages.push({ pageIndex: i, words: [] });
      }
    }

    console.log('[Upload-OCR] Final ocrData:', ocrData.pages.map(p => ({ page: p.pageIndex, words: p.words.length })));
    return ocrData;
  }

  // Generate thumbnail from first page
  function generateThumbnailFromPage(pageImage) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const maxSize = 800;
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > maxSize) {
            height = (height * maxSize) / width;
            width = maxSize;
          }
        } else {
          if (height > maxSize) {
            width = (width * maxSize) / height;
            height = maxSize;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.7));
      };
      img.src = pageImage;
    });
  }

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
        // For images, generate thumbnail and read as base64 for OCR
        setLoadingStatus('Generating preview...');
        screenshot = await generateImageThumbnail(file);

        // Read full image for OCR
        const fullImage = await new Promise((resolve) => {
          const reader = new FileReader();
          reader.onload = (e) => resolve(e.target.result);
          reader.readAsDataURL(file);
        });
        pages = [fullImage];

        // OCR the image
        ocrData = await ocrAllPages(pages, setLoadingStatus);
      } else if (fileType === 'pdf') {
        // For PDFs, convert all pages to images
        try {
          pages = await convertPdfToImages(file, setLoadingStatus);
          // Use first page as thumbnail
          if (pages.length > 0) {
            setLoadingStatus('Generating thumbnail...');
            screenshot = await generateThumbnailFromPage(pages[0]);
          }

          // OCR all pages
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
      console.error(err);
      setError('Failed to upload file');
    } finally {
      setLoading(false);
      setLoadingStatus('');
    }
  }

  // 웹페이지 스크린샷 캡처 (메인 콘텐츠만)
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

      // Microlink API로 Full Page 스크린샷 캡처 후 메인 콘텐츠 크롭
      const result = await captureWebpageScreenshot(url);
      const pages = [result.image];

      // 썸네일 생성
      setLoadingStatus('Generating thumbnail...');
      const thumbnail = await generateThumbnailFromPage(result.image);

      // OCR
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
      console.error(err);
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
