import { useState, useEffect } from 'react';
import {
  getVocabularyWithSource,
  getGrammarPatterns,
  deleteAnnotation,
  addManualVocabulary,
} from '../services/annotation';

export default function MyDictionary({ onSelectForChat }) {
  const [tab, setTab] = useState('words'); // 'words' | 'grammar'
  const [vocabulary, setVocabulary] = useState([]);
  const [grammarPatterns, setGrammarPatterns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [showAddModal, setShowAddModal] = useState(false);
  const [newWord, setNewWord] = useState('');
  const [newDefinition, setNewDefinition] = useState('');
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    try {
      const [vocabData, grammarData] = await Promise.all([
        getVocabularyWithSource(),
        getGrammarPatterns(),
      ]);
      setVocabulary(vocabData);
      setGrammarPatterns(grammarData);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }

  function toggleSelect(id) {
    setSelectedIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
  }

  async function handleDelete(id) {
    if (!window.confirm('Delete this item?')) return;
    try {
      await deleteAnnotation(id);
      setVocabulary(prev => prev.filter(v => v.id !== id));
      setGrammarPatterns(prev => prev.filter(g => g.id !== id));
      setSelectedIds(prev => {
        const newSet = new Set(prev);
        newSet.delete(id);
        return newSet;
      });
    } catch {
      // ignore
    }
  }

  async function handleAddWord() {
    if (!newWord.trim() || adding) return;
    setAdding(true);
    try {
      await addManualVocabulary(newWord.trim(), newDefinition.trim());
      setShowAddModal(false);
      setNewWord('');
      setNewDefinition('');
      await loadData();
    } catch {
      // ignore
    } finally {
      setAdding(false);
    }
  }

  function handleChatWithSelected() {
    if (selectedIds.size === 0) return;

    const items = tab === 'words'
      ? vocabulary.filter(v => selectedIds.has(v.id))
      : grammarPatterns.filter(g => selectedIds.has(g.id));

    onSelectForChat?.(items, tab);
  }

  function formatDate(dateStr) {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    return date.toLocaleDateString('ko-KR', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  }

  function getDefinition(item) {
    try {
      const json = JSON.parse(item.ai_analysis_json || '{}');
      return json.definition || '';
    } catch {
      return '';
    }
  }

  function getGrammarInfo(item) {
    try {
      const json = JSON.parse(item.ai_analysis_json || '{}');
      return {
        originalText: json.originalText || '',
        patterns: json.patterns || [],
      };
    } catch {
      return { originalText: '', patterns: [] };
    }
  }

  const currentItems = tab === 'words' ? vocabulary : grammarPatterns;

  return (
    <div className="my-dictionary">
      <div className="dictionary-header">
        <div className="dictionary-tabs">
          <button
            className={`tab-btn ${tab === 'words' ? 'active' : ''}`}
            onClick={() => { setTab('words'); setSelectedIds(new Set()); }}
          >
            Words ({vocabulary.length})
          </button>
          <button
            className={`tab-btn ${tab === 'grammar' ? 'active' : ''}`}
            onClick={() => { setTab('grammar'); setSelectedIds(new Set()); }}
          >
            Grammar ({grammarPatterns.length})
          </button>
        </div>
        {tab === 'words' && (
          <button
            className="add-word-btn"
            onClick={() => setShowAddModal(true)}
          >
            + Add
          </button>
        )}
      </div>

      <div className="dictionary-list">
        {loading ? (
          <div className="dictionary-loading">Loading...</div>
        ) : currentItems.length === 0 ? (
          <div className="dictionary-empty">
            {tab === 'words'
              ? 'No saved words yet'
              : 'No saved grammar patterns yet'}
          </div>
        ) : (
          currentItems.map(item => (
            <div
              key={item.id}
              className={`dictionary-item ${selectedIds.has(item.id) ? 'selected' : ''}`}
              onClick={() => toggleSelect(item.id)}
            >
              <input
                type="checkbox"
                className="item-checkbox"
                checked={selectedIds.has(item.id)}
                onChange={() => toggleSelect(item.id)}
                onClick={e => e.stopPropagation()}
              />
              <div className="item-content">
                {tab === 'words' ? (
                  <>
                    <div className="item-word">{item.selected_text}</div>
                    <div className="item-definition">{getDefinition(item)}</div>
                  </>
                ) : (
                  <>
                    <div className="item-sentence">"{getGrammarInfo(item).originalText}"</div>
                    <div className="item-patterns">
                      {getGrammarInfo(item).patterns.map((p, idx) => (
                        <span
                          key={idx}
                          className="pattern-tag"
                          style={{ backgroundColor: p.color || '#666' }}
                        >
                          {p.typeKr || p.type}
                        </span>
                      ))}
                    </div>
                  </>
                )}
                <div className="item-meta">
                  <span className="meta-date">{formatDate(item.created_at)}</span>
                  <span className="meta-source">
                    {item.sources?.title || (item.source_id ? 'Unknown source' : 'Manual')}
                  </span>
                </div>
              </div>
              <button
                className="delete-btn"
                onClick={e => {
                  e.stopPropagation();
                  handleDelete(item.id);
                }}
              >
                x
              </button>
            </div>
          ))
        )}
      </div>

      {selectedIds.size > 0 && onSelectForChat && (
        <button
          className="chat-with-selected-btn"
          onClick={handleChatWithSelected}
        >
          Chat ({selectedIds.size})
        </button>
      )}

      {showAddModal && (
        <div className="add-word-modal-overlay" onClick={() => setShowAddModal(false)}>
          <div className="add-word-modal" onClick={e => e.stopPropagation()}>
            <h3>Add Word</h3>
            <input
              type="text"
              placeholder="Word"
              value={newWord}
              onChange={e => setNewWord(e.target.value)}
              autoFocus
            />
            <textarea
              placeholder="Definition (optional)"
              value={newDefinition}
              onChange={e => setNewDefinition(e.target.value)}
            />
            <div className="modal-buttons">
              <button onClick={() => setShowAddModal(false)}>Cancel</button>
              <button
                onClick={handleAddWord}
                disabled={!newWord.trim() || adding}
              >
                {adding ? '...' : 'Add'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
