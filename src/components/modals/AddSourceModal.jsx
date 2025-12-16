import { useState, useRef } from 'react';
import { createSource, uploadFile } from '../../services/source';

export default function AddSourceModal({ isOpen, onClose, onSuccess }) {
  const [activeTab, setActiveTab] = useState('file'); // 'file' | 'url'
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const fileInputRef = useRef(null);

  if (!isOpen) return null;

  async function handleFileUpload(e) {
    const file = e.target.files[0];
    if (!file) return;

    setLoading(true);
    setError('');

    try {
      // 파일 타입 확인
      const fileType = file.type.includes('pdf') ? 'pdf' : 'image';

      // 파일 업로드
      const { url: fileUrl } = await uploadFile(file);

      // 소스 생성
      await createSource({
        title: title || file.name,
        type: fileType,
        file_path: fileUrl,
        content: '', // PDF 파싱은 서버에서 처리
      });

      onSuccess();
      handleClose();
    } catch (err) {
      setError('파일 업로드에 실패했습니다');
    } finally {
      setLoading(false);
    }
  }

  async function handleUrlSubmit(e) {
    e.preventDefault();

    if (!url.trim()) {
      setError('URL을 입력해주세요');
      return;
    }

    setLoading(true);
    setError('');

    try {
      // 소스 생성
      await createSource({
        title: title || url,
        type: 'url',
        file_path: url,
        content: '', // URL 파싱은 서버에서 처리
      });

      onSuccess();
      handleClose();
    } catch (err) {
      setError('URL 추가에 실패했습니다');
    } finally {
      setLoading(false);
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
          <h2>새 소스 추가</h2>
          <button className="modal-close" onClick={handleClose}>
            ✕
          </button>
        </div>

        <div className="modal-tabs">
          <button
            className={`tab ${activeTab === 'file' ? 'active' : ''}`}
            onClick={() => setActiveTab('file')}
          >
            파일 업로드
          </button>
          <button
            className={`tab ${activeTab === 'url' ? 'active' : ''}`}
            onClick={() => setActiveTab('url')}
          >
            URL 추가
          </button>
        </div>

        {error && <div className="error-message">{error}</div>}

        <div className="modal-body">
          <div className="input-group">
            <label htmlFor="title">제목 (선택)</label>
            <input
              id="title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="제목을 입력하세요"
            />
          </div>

          {activeTab === 'file' ? (
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
                {loading ? '업로드 중...' : 'PDF 또는 이미지 선택'}
              </button>
              <p className="file-hint">PDF, PNG, JPG 파일 지원</p>
            </div>
          ) : (
            <form onSubmit={handleUrlSubmit}>
              <div className="input-group">
                <label htmlFor="url">URL</label>
                <input
                  id="url"
                  type="url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://..."
                  required
                />
              </div>
              <button
                type="submit"
                className="submit-button"
                disabled={loading}
              >
                {loading ? '추가 중...' : '추가하기'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
