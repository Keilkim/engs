import { useEffect, useState } from 'react';
import BuddyLoader from '../../components/BuddyLoader';
import { getReviewLibrary, setReviewStatus } from '../../services/review';
import { cardContent } from '../../services/reviewPractice';

export default function ReviewLibrary({ onClose, onPractice }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [pending, setPending] = useState(null);
  const [selected, setSelected] = useState([]);
  useEffect(() => {
    let active = true;
    getReviewLibrary().then(data => { if (active) setItems(data); })
      .catch(() => { if (active) setError('목록을 불러오지 못했어요. 닫았다가 다시 시도해 주세요.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  async function toggle(item) {
    if (pending) return;
    setPending(String(item.id));
    setError('');
    const status = item.status === 'suspended' ? 'active' : 'suspended';
    try {
      await setReviewStatus(item.id, status);
      setItems(previous => previous.map(entry => entry.id === item.id ? { ...entry, status } : entry));
      setSelected(previous => previous.filter(id => id !== item.id));
    } catch { setError('변경하지 못했어요. 다시 시도해 주세요.'); }
    finally { setPending(null); }
  }

  const visible = items.filter(item => {
    const card = cardContent(item);
    return (filter === 'all' || item.status === filter) && `${card.word} ${card.source}`.toLowerCase().includes(query.toLowerCase());
  });

  return <section className="practice-library" aria-label="전체 복습 목록">
    <div className="practice-section-heading"><h2>내 복습 목록</h2><button onClick={onClose} disabled={Boolean(pending)}>닫기</button></div>
    <p>잠시 빼도 저장한 단어는 남아요. 최대 20개를 골라 별도로 연습할 수 있어요.</p>
    <label className="practice-search">단어·자료 찾기<input value={query} onChange={event => setQuery(event.target.value)} placeholder="단어 또는 자료 제목" /></label>
    <div className="practice-mode-bar" aria-label="목록 필터">
      {[['all', '전체'], ['active', '복습 중'], ['suspended', '잠시 뺀 항목']].map(([value, label]) =>
        <button key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}</button>)}
    </div>
    {loading && <BuddyLoader label="내 단어들을 모으고 있어요" />}
    {error && <p role="alert">{error}</p>}
    {!loading && !visible.length && <p>해당하는 항목이 없어요.</p>}
    <ul className="practice-library-list">{visible.map(item => {
      const card = cardContent(item);
      return <li key={item.id}>
        <label><input type="checkbox" checked={selected.includes(item.id)} disabled={item.status !== 'active' || (!selected.includes(item.id) && selected.length >= 20)}
          onChange={() => setSelected(previous => previous.includes(item.id) ? previous.filter(id => id !== item.id) : [...previous, item.id])} />
          <span><strong>{card.word}</strong><small>{card.source || '직접 저장한 표현'} · {item.status === 'suspended' ? '보관 중' : `복습 ${item.next_review_date}`}</small></span></label>
        <button disabled={Boolean(pending)} onClick={() => toggle(item)}>{pending === String(item.id) ? '저장 중…' : item.status === 'suspended' ? '다시 복습' : '잠시 빼기'}</button>
      </li>;
    })}</ul>
    {selected.length > 0 && <button className="practice-primary" disabled={Boolean(pending)} onClick={() => onPractice(items.filter(item => selected.includes(item.id) && item.status === 'active'))}>{selected.length}개 따로 연습</button>}
    <p className="practice-note">따로 연습한 결과는 예정된 복습 간격을 바꾸지 않아요.</p>
  </section>;
}
