import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { createPracticeStorage, currentPracticeId, isReturning } from '../../services/reviewPractice';

export default function ReviewCard({ count = 0, loading, overview = {} }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const saved = createPracticeStorage({ getItem: key => (localStorage.getItem('autoLogin') === 'false' ? sessionStorage : localStorage).getItem(key) }, user?.id).read();
  const pending = saved && currentPracticeId(saved) ? saved.ids.filter(id => !saved.answers[id]).length : 0;
  const returning = isReturning(overview.lastReviewed);
  const size = Math.min(count, returning ? 3 : 5);
  const firstVisit = overview.total === 0;
  if (loading) return <div className="practice-home" aria-busy="true"><p>오늘의 단어를 가져오는 중이에요.</p></div>;
  return <section className="practice-home" aria-label="오늘의 복습">
    <p className="practice-home-title">{pending ? '하던 곳에서 이어가면 돼요.' : firstVisit ? '단어 3개로 먼저 만나봐요.' : count ? returning ? '오랜만이어도, 3개부터 가볍게.' : '내가 저장한 말, 오늘 조금 더 내 것으로.' : '오늘의 복습을 마쳤어요.'}</p>
    <p className="practice-home-hint">{pending ? `이번 묶음은 ${pending}개 남았어요.` : firstVisit ? '샘플을 체험하거나 내 자료에서 단어를 저장해 보세요.' : count ? `${size}개부터 시작해요. 소리 없이도, 한 손으로도 괜찮아요.` : '읽던 자료에서 새로운 표현을 만나보세요.'}</p>
    {(pending > 0 || count > 0 || firstVisit) && <button className="practice-primary" onClick={() => navigate(firstVisit && !pending ? '/review?sample=1' : '/review')}>
      {pending ? `${pending}개 이어하기` : firstVisit ? '샘플 복습 시작' : `${size}개 복습 시작`} <span>조용히 →</span>
    </button>}
    {count > 0 && <small className="practice-home-total">전체 예정 항목 {count}개 · 한 번에 전부 하지 않아도 돼요.</small>}
    <button className="practice-text-button" onClick={() => navigate('/review?library=1')}>내 단어 · 복습 범위 보기</button>
  </section>;
}
