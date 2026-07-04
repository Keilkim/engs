import { useState } from 'react';
import { Link, useNavigate, useLocation, Navigate } from 'react-router-dom';
import { signIn, signInWithKakao, signInWithGoogle } from '../../services/auth';
import { supabase } from '../../services/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { TranslatableText } from '../../components/translatable';

export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const { isAuthenticated, loading: authLoading } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [needsConfirm, setNeedsConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  // Default to "on" unless the user explicitly turned it off (persisted as 'false').
  const [autoLogin, setAutoLogin] = useState(() => {
    return localStorage.getItem('autoLogin') !== 'false';
  });

  // Where to return after a successful login (set by ProtectedRoute).
  const from = location.state?.from?.pathname || '/';

  // Already logged in? Don't show the login form (e.g. typo URL / bookmark).
  if (!authLoading && isAuthenticated) {
    return <Navigate to="/" replace />;
  }

  const handleAutoLoginChange = (checked) => {
    setAutoLogin(checked);
    localStorage.setItem('autoLogin', checked.toString());
  };

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setInfo('');
    setNeedsConfirm(false);
    setLoading(true);

    // Ensure the storage preference is recorded before the session is written.
    localStorage.setItem('autoLogin', autoLogin.toString());

    try {
      await signIn(email, password);
      navigate(from, { replace: true });
    } catch (err) {
      const msg = (err?.message || '').toLowerCase();
      if (msg.includes('email not confirmed') || msg.includes('not confirmed') || msg.includes('confirm')) {
        setNeedsConfirm(true);
        setError('Please verify your email before signing in.');
      } else if (msg.includes('invalid login') || msg.includes('invalid credentials') || msg.includes('invalid email or password')) {
        setError('Invalid email or password.');
      } else if (msg.includes('network') || msg.includes('fetch') || msg.includes('failed to fetch')) {
        setError('Network error. Please check your connection and try again.');
      } else if (msg.includes('rate') || msg.includes('too many')) {
        setError('Too many attempts. Please wait a moment and try again.');
      } else {
        setError(err?.message || 'Sign in failed. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleResendConfirmation() {
    setError('');
    setInfo('');
    try {
      const { error: resendError } = await supabase.auth.resend({
        type: 'signup',
        email,
      });
      if (resendError) throw resendError;
      setInfo('Verification email resent. Please check your inbox.');
    } catch (err) {
      setError(err?.message || 'Failed to resend verification email.');
    }
  }

  async function handleKakaoLogin() {
    try {
      await signInWithKakao();
    } catch (err) {
      setError('Kakao sign in failed');
    }
  }

  async function handleGoogleLogin() {
    try {
      await signInWithGoogle();
    } catch (err) {
      setError('Google sign in failed');
    }
  }

  return (
    <div className="login-screen">
      <div className="login-container">
        <div className="app-logo">
          <h1><TranslatableText textKey="login.appName">LangBuddy</TranslatableText></h1>
        </div>

        <form onSubmit={handleSubmit} className="login-form">
          {error && <div className="error-message">{error}</div>}
          {info && <div className="info-message">{info}</div>}
          {needsConfirm && (
            <button
              type="button"
              className="link-button"
              onClick={handleResendConfirmation}
            >
              <TranslatableText textKey="login.resendVerification">Resend verification email</TranslatableText>
            </button>
          )}

          <div className="input-group">
            <label htmlFor="email">
              <TranslatableText textKey="login.email">Email</TranslatableText>
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Enter your email"
              required
            />
          </div>

          <div className="input-group">
            <label htmlFor="password">
              <TranslatableText textKey="login.password">Password</TranslatableText>
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter your password"
              required
            />
          </div>

          <label className="auto-login-checkbox">
            <input
              type="checkbox"
              checked={autoLogin}
              onChange={(e) => handleAutoLoginChange(e.target.checked)}
            />
            <span><TranslatableText textKey="login.autoLogin">자동 로그인</TranslatableText></span>
          </label>

          <button
            type="submit"
            className="login-button"
            disabled={loading}
          >
            {loading ? 'Signing in...' : <TranslatableText textKey="login.signIn">Sign In</TranslatableText>}
          </button>
        </form>

        <div className="social-login">
          <p><TranslatableText textKey="login.signInWithSocial">Sign in with social account</TranslatableText></p>
          <div className="social-buttons">
            <button
              type="button"
              onClick={handleGoogleLogin}
              className="google-button"
            >
              <TranslatableText textKey="login.continueWithGoogle">Continue with Google</TranslatableText>
            </button>
            <button
              type="button"
              onClick={handleKakaoLogin}
              className="kakao-button"
            >
              <TranslatableText textKey="login.continueWithKakao">Continue with Kakao</TranslatableText>
            </button>
          </div>
        </div>

        <div className="login-links">
          <Link to="/register"><TranslatableText textKey="login.signUp">Sign Up</TranslatableText></Link>
          <Link to="/forgot-password"><TranslatableText textKey="login.forgotPassword">Forgot Password</TranslatableText></Link>
        </div>
      </div>
    </div>
  );
}
