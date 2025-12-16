import { useState, useRef } from 'react';
import { createSource, uploadFile } from '../../services/source';
import { TranslatableText } from '../translatable';

export default function AddSourceModal({ isOpen, onClose, onSuccess }) {
  const [activeTab, setActiveTab] = useState('file');
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
      const fileType = file.type.includes('pdf') ? 'pdf' : 'image';
      const { url: fileUrl } = await uploadFile(file);

      await createSource({
        title: title || file.name,
        type: fileType,
        file_path: fileUrl,
        content: '',
      });

      onSuccess();
      handleClose();
    } catch (err) {
      setError('Failed to upload file');
    } finally {
      setLoading(false);
    }
  }

  async function handleUrlSubmit(e) {
    e.preventDefault();

    if (!url.trim()) {
      setError('Please enter a URL');
      return;
    }

    setLoading(true);
    setError('');

    try {
      await createSource({
        title: title || url,
        type: 'url',
        file_path: url,
        content: '',
      });

      onSuccess();
      handleClose();
    } catch (err) {
      setError('Failed to add URL');
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
            className={`tab ${activeTab === 'url' ? 'active' : ''}`}
            onClick={() => setActiveTab('url')}
          >
            <TranslatableText textKey="addSource.addUrl">Add URL</TranslatableText>
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
                {loading ? 'Uploading...' : <TranslatableText textKey="addSource.selectFile">Select PDF or Image</TranslatableText>}
              </button>
              <p className="file-hint">
                <TranslatableText textKey="addSource.supportedFormats">Supports PDF, PNG, JPG</TranslatableText>
              </p>
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
                {loading ? 'Adding...' : <TranslatableText textKey="addSource.add">Add</TranslatableText>}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
