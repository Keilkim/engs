import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { updateProfile, updatePassword, signOut } from '../../services/auth';
import { supabase } from '../../services/supabase';

export default function Settings() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [activeSection, setActiveSection] = useState(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState({ type: '', text: '' });

  // 프로필 수정
  const [nickname, setNickname] = useState(
    user?.user_metadata?.nickname || ''
  );

  // 비밀번호 변경
  const [passwords, setPasswords] = useState({
    current: '',
    new: '',
    confirm: '',
  });

  async function handleUpdateProfile(e) {
    e.preventDefault();
    setLoading(true);
    setMessage({ type: '', text: '' });

    try {
      await updateProfile({ nickname });
      setMessage({ type: 'success', text: '프로필이 수정되었습니다' });
      setActiveSection(null);
    } catch (err) {
      setMessage({ type: 'error', text: '프로필 수정에 실패했습니다' });
    } finally {
      setLoading(false);
    }
  }

  async function handleChangePassword(e) {
    e.preventDefault();

    if (passwords.new !== passwords.confirm) {
      setMessage({ type: 'error', text: '새 비밀번호가 일치하지 않습니다' });
      return;
    }

    if (passwords.new.length < 8) {
      setMessage({ type: 'error', text: '비밀번호는 8자 이상이어야 합니다' });
      return;
    }

    setLoading(true);
    setMessage({ type: '', text: '' });

    try {
      await updatePassword(passwords.new);
      setMessage({ type: 'success', text: '비밀번호가 변경되었습니다' });
      setPasswords({ current: '', new: '', confirm: '' });
      setActiveSection(null);
    } catch (err) {
      setMessage({ type: 'error', text: '비밀번호 변경에 실패했습니다' });
    } finally {
      setLoading(false);
    }
  }

  async function handleDeleteAccount() {
    const confirmed = window.confirm(
      '정말 탈퇴하시겠습니까?\n모든 데이터가 삭제되며 복구할 수 없습니다.'
    );
    if (!confirmed) return;

    const doubleConfirm = window.confirm(
      '마지막 확인입니다. 정말 탈퇴하시겠습니까?'
    );
    if (!doubleConfirm) return;

    setLoading(true);
    try {
      // Supabase에서 사용자 삭제는 서버 사이드에서 처리해야 함
      // 여기서는 로그아웃만 처리
      await signOut();
      navigate('/login');
    } catch (err) {
      setMessage({ type: 'error', text: '탈퇴 처리에 실패했습니다' });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="settings-screen">
      <header className="settings-header">
        <button className="back-button" onClick={() => navigate('/mypage')}>
          ← 뒤로
        </button>
        <h1>설정</h1>
      </header>

      <main className="settings-content">
        {message.text && (
          <div className={`message ${message.type}`}>
            {message.text}
          </div>
        )}

        {/* 프로필 수정 */}
        <section className="settings-section">
          <button
            className="section-header"
            onClick={() => setActiveSection(
              activeSection === 'profile' ? null : 'profile'
            )}
          >
            <span>👤 프로필 수정</span>
            <span>{activeSection === 'profile' ? '▲' : '▼'}</span>
          </button>
          {activeSection === 'profile' && (
            <form className="section-content" onSubmit={handleUpdateProfile}>
              <div className="input-group">
                <label>닉네임</label>
                <input
                  type="text"
                  value={nickname}
                  onChange={(e) => setNickname(e.target.value)}
                  placeholder="닉네임"
                />
              </div>
              <button type="submit" disabled={loading}>
                {loading ? '저장 중...' : '저장'}
              </button>
            </form>
          )}
        </section>

        {/* 비밀번호 변경 */}
        <section className="settings-section">
          <button
            className="section-header"
            onClick={() => setActiveSection(
              activeSection === 'password' ? null : 'password'
            )}
          >
            <span>🔒 비밀번호 변경</span>
            <span>{activeSection === 'password' ? '▲' : '▼'}</span>
          </button>
          {activeSection === 'password' && (
            <form className="section-content" onSubmit={handleChangePassword}>
              <div className="input-group">
                <label>새 비밀번호</label>
                <input
                  type="password"
                  value={passwords.new}
                  onChange={(e) => setPasswords({
                    ...passwords,
                    new: e.target.value,
                  })}
                  placeholder="8자 이상"
                />
              </div>
              <div className="input-group">
                <label>새 비밀번호 확인</label>
                <input
                  type="password"
                  value={passwords.confirm}
                  onChange={(e) => setPasswords({
                    ...passwords,
                    confirm: e.target.value,
                  })}
                  placeholder="비밀번호 확인"
                />
              </div>
              <button type="submit" disabled={loading}>
                {loading ? '변경 중...' : '변경'}
              </button>
            </form>
          )}
        </section>

        {/* 앱 정보 */}
        <section className="settings-section">
          <button
            className="section-header"
            onClick={() => setActiveSection(
              activeSection === 'info' ? null : 'info'
            )}
          >
            <span>ℹ️ 앱 정보</span>
            <span>{activeSection === 'info' ? '▲' : '▼'}</span>
          </button>
          {activeSection === 'info' && (
            <div className="section-content info-content">
              <p><strong>버전:</strong> 1.0.0</p>
              <p><strong>개발:</strong> ENGS Team</p>
              <a href="/terms" target="_blank">이용약관</a>
              <a href="/privacy" target="_blank">개인정보처리방침</a>
            </div>
          )}
        </section>

        {/* 계정 삭제 */}
        <section className="settings-section danger">
          <button
            className="section-header"
            onClick={handleDeleteAccount}
            disabled={loading}
          >
            <span>⚠️ 회원 탈퇴</span>
          </button>
        </section>
      </main>
    </div>
  );
}
