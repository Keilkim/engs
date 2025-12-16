import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { updateProfile, updatePassword, signOut } from '../../services/auth';
import { TranslatableText } from '../../components/translatable';

export default function Settings() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [activeSection, setActiveSection] = useState(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState({ type: '', text: '' });

  const [nickname, setNickname] = useState(
    user?.user_metadata?.nickname || ''
  );

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
      setMessage({ type: 'success', text: 'Profile updated' });
      setActiveSection(null);
    } catch (err) {
      setMessage({ type: 'error', text: 'Failed to update profile' });
    } finally {
      setLoading(false);
    }
  }

  async function handleChangePassword(e) {
    e.preventDefault();

    if (passwords.new !== passwords.confirm) {
      setMessage({ type: 'error', text: "New passwords don't match" });
      return;
    }

    if (passwords.new.length < 8) {
      setMessage({ type: 'error', text: 'Password must be at least 8 characters' });
      return;
    }

    setLoading(true);
    setMessage({ type: '', text: '' });

    try {
      await updatePassword(passwords.new);
      setMessage({ type: 'success', text: 'Password changed' });
      setPasswords({ current: '', new: '', confirm: '' });
      setActiveSection(null);
    } catch (err) {
      setMessage({ type: 'error', text: 'Failed to change password' });
    } finally {
      setLoading(false);
    }
  }

  async function handleDeleteAccount() {
    const confirmed = window.confirm(
      'Are you sure you want to delete your account?\nAll data will be permanently deleted.'
    );
    if (!confirmed) return;

    const doubleConfirm = window.confirm(
      'Final confirmation. Delete your account?'
    );
    if (!doubleConfirm) return;

    setLoading(true);
    try {
      await signOut();
      navigate('/login');
    } catch (err) {
      setMessage({ type: 'error', text: 'Failed to delete account' });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="settings-screen">
      <header className="settings-header">
        <button className="back-button" onClick={() => navigate('/mypage')}>
          <TranslatableText textKey="nav.back">Back</TranslatableText>
        </button>
        <h1><TranslatableText textKey="settings.settings">Settings</TranslatableText></h1>
      </header>

      <main className="settings-content">
        {message.text && (
          <div className={`message ${message.type}`}>
            {message.text}
          </div>
        )}

        <section className="settings-section">
          <button
            className="section-header"
            onClick={() => setActiveSection(
              activeSection === 'profile' ? null : 'profile'
            )}
          >
            <span><TranslatableText textKey="settings.editProfile">Edit Profile</TranslatableText></span>
            <span>{activeSection === 'profile' ? '▲' : '▼'}</span>
          </button>
          {activeSection === 'profile' && (
            <form className="section-content" onSubmit={handleUpdateProfile}>
              <div className="input-group">
                <label><TranslatableText textKey="settings.nickname">Nickname</TranslatableText></label>
                <input
                  type="text"
                  value={nickname}
                  onChange={(e) => setNickname(e.target.value)}
                  placeholder="Nickname"
                />
              </div>
              <button type="submit" disabled={loading}>
                {loading ? 'Saving...' : <TranslatableText textKey="settings.save">Save</TranslatableText>}
              </button>
            </form>
          )}
        </section>

        <section className="settings-section">
          <button
            className="section-header"
            onClick={() => setActiveSection(
              activeSection === 'password' ? null : 'password'
            )}
          >
            <span><TranslatableText textKey="settings.changePassword">Change Password</TranslatableText></span>
            <span>{activeSection === 'password' ? '▲' : '▼'}</span>
          </button>
          {activeSection === 'password' && (
            <form className="section-content" onSubmit={handleChangePassword}>
              <div className="input-group">
                <label><TranslatableText textKey="settings.newPassword">New Password</TranslatableText></label>
                <input
                  type="password"
                  value={passwords.new}
                  onChange={(e) => setPasswords({
                    ...passwords,
                    new: e.target.value,
                  })}
                  placeholder="8+ characters"
                />
              </div>
              <div className="input-group">
                <label><TranslatableText textKey="settings.confirmNewPassword">Confirm New Password</TranslatableText></label>
                <input
                  type="password"
                  value={passwords.confirm}
                  onChange={(e) => setPasswords({
                    ...passwords,
                    confirm: e.target.value,
                  })}
                  placeholder="Confirm password"
                />
              </div>
              <button type="submit" disabled={loading}>
                {loading ? 'Changing...' : <TranslatableText textKey="settings.change">Change</TranslatableText>}
              </button>
            </form>
          )}
        </section>

        <section className="settings-section">
          <button
            className="section-header"
            onClick={() => setActiveSection(
              activeSection === 'info' ? null : 'info'
            )}
          >
            <span><TranslatableText textKey="settings.appInfo">App Info</TranslatableText></span>
            <span>{activeSection === 'info' ? '▲' : '▼'}</span>
          </button>
          {activeSection === 'info' && (
            <div className="section-content info-content">
              <p><strong><TranslatableText textKey="settings.version">Version:</TranslatableText></strong> 1.0.0</p>
              <p><strong><TranslatableText textKey="settings.developedBy">Developed by:</TranslatableText></strong> ENGS Team</p>
              <a href="/terms" target="_blank">
                <TranslatableText textKey="settings.termsOfService">Terms of Service</TranslatableText>
              </a>
              <a href="/privacy" target="_blank">
                <TranslatableText textKey="settings.privacyPolicy">Privacy Policy</TranslatableText>
              </a>
            </div>
          )}
        </section>

        <section className="settings-section danger">
          <button
            className="section-header"
            onClick={handleDeleteAccount}
            disabled={loading}
          >
            <span><TranslatableText textKey="settings.deleteAccount">Delete Account</TranslatableText></span>
          </button>
        </section>
      </main>
    </div>
  );
}
