import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { signOut } from '../../services/auth';
import StatsDashboard from '../../containers/stats-dashboard/StatsDashboard';
import MyDictionary from '../../components/MyDictionary';
import { TranslatableText } from '../../components/translatable';

export default function Mypage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [loggingOut, setLoggingOut] = useState(false);
  const [statsExpanded, setStatsExpanded] = useState(false);

  const nickname = user?.user_metadata?.nickname || 'User';
  const email = user?.email || '';
  const createdAt = user?.created_at
    ? new Date(user.created_at).toLocaleDateString('en-US')
    : '';

  async function handleLogout() {
    if (loggingOut) return;

    const confirmed = window.confirm('Are you sure you want to sign out?');
    if (!confirmed) return;

    setLoggingOut(true);
    try {
      await signOut();
      navigate('/login');
    } catch (err) {
      console.error('Sign out failed:', err);
    } finally {
      setLoggingOut(false);
    }
  }

  function handleStartChat(selectedItems, type) {
    navigate('/chat', {
      state: {
        vocabContext: selectedItems,
        contextType: type,
      },
    });
  }

  return (
    <div className="mypage-screen">
      <header className="mypage-header">
        <button className="back-button" onClick={() => navigate('/')}>
          <TranslatableText textKey="nav.back">Back</TranslatableText>
        </button>
        <h1><TranslatableText textKey="mypage.myPage">My Page</TranslatableText></h1>
        <button
          className="settings-button"
          onClick={() => navigate('/settings')}
        >
          Settings
        </button>
      </header>

      <main className="mypage-content">
        <section className="profile-section">
          <div className="profile-avatar">
            <span className="avatar-icon">{nickname.charAt(0).toUpperCase()}</span>
          </div>
          <div className="profile-info">
            <h2 className="profile-nickname">{nickname}</h2>
            <p className="profile-email">{email}</p>
            <p className="profile-joined">
              <TranslatableText textKey="mypage.joined">Joined:</TranslatableText> {createdAt}
            </p>
          </div>
        </section>

        <section className={`stats-section ${statsExpanded ? 'expanded' : 'collapsed'}`}>
          <button
            className="stats-toggle"
            onClick={() => setStatsExpanded(!statsExpanded)}
          >
            <h2><TranslatableText textKey="mypage.learningStats">Learning Stats</TranslatableText></h2>
            <span className="toggle-icon">{statsExpanded ? '−' : '+'}</span>
          </button>
          {statsExpanded && <StatsDashboard />}
        </section>

        <section className="dictionary-section">
          <h2><TranslatableText textKey="mypage.myDictionary">My Dictionary</TranslatableText></h2>
          <MyDictionary onSelectForChat={handleStartChat} />
        </section>

        <section className="menu-section">
          <button
            className="menu-item"
            onClick={() => navigate('/settings')}
          >
            <span><TranslatableText textKey="mypage.settings">Settings</TranslatableText></span>
            <span className="arrow">→</span>
          </button>
          <button
            className="menu-item"
            onClick={() => navigate('/onboarding')}
          >
            <span><TranslatableText textKey="settings.viewOnboarding">View Guide</TranslatableText></span>
            <span className="arrow">→</span>
          </button>
          <button
            className="menu-item logout-item"
            onClick={handleLogout}
            disabled={loggingOut}
          >
            <span>
              {loggingOut ? (
                <TranslatableText textKey="mypage.signingOut">Signing out...</TranslatableText>
              ) : (
                <TranslatableText textKey="mypage.signOut">Sign Out</TranslatableText>
              )}
            </span>
            <span className="arrow">→</span>
          </button>
        </section>
      </main>
    </div>
  );
}
