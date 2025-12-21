import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { signIn, signInWithKakao, signInWithGoogle } from '../../services/auth';
import { TranslatableText } from '../../components/translatable';

export default function Login() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [autoLogin, setAutoLogin] = useState(() => {
    return localStorage.getItem('autoLogin') === 'true';
  });

  const handleAutoLoginChange = (checked) => {
    setAutoLogin(checked);
    localStorage.setItem('autoLogin', checked.toString());
  };

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await signIn(email, password);
      navigate('/');
    } catch (err) {
      setError('Invalid email or password');
    } finally {
      setLoading(false);
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
          <h1>랭버디</h1>
        </div>

        <form onSubmit={handleSubmit} className="login-form">
          {error && <div className="error-message">{error}</div>}

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
