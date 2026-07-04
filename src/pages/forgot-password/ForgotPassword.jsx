import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { resetPassword, updatePassword } from '../../services/auth';
import { supabase } from '../../services/supabase';
import { TranslatableText } from '../../components/translatable';

export default function ForgotPassword() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  // When the user arrives via the recovery email link, Supabase establishes a
  // PASSWORD_RECOVERY session — switch this page into "set new password" mode.
  const [recoveryMode, setRecoveryMode] = useState(false);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        setRecoveryMode(true);
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  async function handleRequest(e) {
    e.preventDefault();
    setError('');
    setInfo('');
    setLoading(true);
    try {
      await resetPassword(email);
      setSent(true);
      setInfo(
        "If an account exists for this email, we've sent a password reset link. Please check your inbox (and spam folder)."
      );
    } catch (err) {
      // Avoid leaking which emails exist; only surface network-type failures.
      if (err?.message?.toLowerCase().includes('network') || err?.message?.toLowerCase().includes('fetch')) {
        setError('Network error. Please check your connection and try again.');
      } else {
        setSent(true);
        setInfo(
          "If an account exists for this email, we've sent a password reset link. Please check your inbox (and spam folder)."
        );
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleUpdate(e) {
    e.preventDefault();
    setError('');
    setInfo('');

    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match");
      return;
    }

    setLoading(true);
    try {
      await updatePassword(password);
      setInfo('Password updated. Redirecting to login...');
      setTimeout(() => navigate('/login'), 1500);
    } catch (err) {
      setError(err?.message || 'Failed to update password. Please try the reset link again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-screen">
      <div className="login-container">
        <div className="app-logo">
          <h1>
            {recoveryMode ? (
              <TranslatableText textKey="forgotPassword.setNewTitle">Set New Password</TranslatableText>
            ) : (
              <TranslatableText textKey="forgotPassword.title">Reset Password</TranslatableText>
            )}
          </h1>
        </div>

        {recoveryMode ? (
          <form onSubmit={handleUpdate} className="login-form">
            {error && <div className="error-message">{error}</div>}
            {info && <div className="info-message">{info}</div>}

            <div className="input-group">
              <label htmlFor="new-password">
                <TranslatableText textKey="forgotPassword.newPassword">New Password</TranslatableText>
              </label>
              <input
                id="new-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="8+ characters"
                required
              />
            </div>

            <div className="input-group">
              <label htmlFor="confirm-password">
                <TranslatableText textKey="forgotPassword.confirmPassword">Confirm Password</TranslatableText>
              </label>
              <input
                id="confirm-password"
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="Re-enter your password"
                required
              />
            </div>

            <button type="submit" className="login-button" disabled={loading}>
              {loading ? 'Updating...' : <TranslatableText textKey="forgotPassword.updateButton">Update Password</TranslatableText>}
            </button>
          </form>
        ) : (
          <form onSubmit={handleRequest} className="login-form">
            {error && <div className="error-message">{error}</div>}
            {info && <div className="info-message">{info}</div>}

            <p className="form-hint">
              <TranslatableText textKey="forgotPassword.instructions">
                Enter the email associated with your account and we'll send you a link to reset your password.
              </TranslatableText>
            </p>

            <div className="input-group">
              <label htmlFor="reset-email">
                <TranslatableText textKey="forgotPassword.email">Email</TranslatableText>
              </label>
              <input
                id="reset-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Enter your email"
                required
              />
            </div>

            <button type="submit" className="login-button" disabled={loading || sent}>
              {loading ? 'Sending...' : <TranslatableText textKey="forgotPassword.sendButton">Send Reset Link</TranslatableText>}
            </button>
          </form>
        )}

        <div className="login-links">
          <Link to="/login"><TranslatableText textKey="forgotPassword.backToLogin">Back to Login</TranslatableText></Link>
        </div>
      </div>
    </div>
  );
}
