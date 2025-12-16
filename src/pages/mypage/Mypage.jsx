import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { signOut } from '../../services/auth';
import StatsDashboard from '../../containers/stats-dashboard/StatsDashboard';

export default function Mypage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [loggingOut, setLoggingOut] = useState(false);

  const nickname = user?.user_metadata?.nickname || '사용자';
  const email = user?.email || '';
  const createdAt = user?.created_at
    ? new Date(user.created_at).toLocaleDateString('ko-KR')
    : '';

  async function handleLogout() {
    if (loggingOut) return;

    const confirmed = window.confirm('로그아웃 하시겠습니까?');
    if (!confirmed) return;

    setLoggingOut(true);
    try {
      await signOut();
      navigate('/login');
    } catch (err) {
      console.error('로그아웃 실패:', err);
    } finally {
      setLoggingOut(false);
    }
  }

  return (
    <div className="mypage-screen">
      <header className="mypage-header">
        <button className="back-button" onClick={() => navigate('/')}>
          ← 뒤로
        </button>
        <h1>마이페이지</h1>
        <button
          className="settings-button"
          onClick={() => navigate('/settings')}
        >
          ⚙️
        </button>
      </header>

      <main className="mypage-content">
        <section className="profile-section">
          <div className="profile-avatar">
            <span className="avatar-icon">👤</span>
          </div>
          <div className="profile-info">
            <h2 className="profile-nickname">{nickname}</h2>
            <p className="profile-email">{email}</p>
            <p className="profile-joined">가입일: {createdAt}</p>
          </div>
        </section>

        <section className="stats-section">
          <h2>학습 통계</h2>
          <StatsDashboard />
        </section>

        <section className="menu-section">
          <button
            className="menu-item"
            onClick={() => navigate('/settings')}
          >
            <span>⚙️</span>
            <span>설정</span>
            <span className="arrow">→</span>
          </button>
          <button
            className="menu-item"
            onClick={handleLogout}
            disabled={loggingOut}
          >
            <span>🚪</span>
            <span>{loggingOut ? '로그아웃 중...' : '로그아웃'}</span>
            <span className="arrow">→</span>
          </button>
        </section>
      </main>
    </div>
  );
}
