import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { signIn, signInWithGoogle, signInWithKakao } from '../../services/auth';

export default function Login() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await signIn(email, password);
      navigate('/');
    } catch (err) {
      setError('이메일 또는 비밀번호가 올바르지 않습니다');
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogleLogin() {
    try {
      await signInWithGoogle();
    } catch (err) {
      setError('Google 로그인에 실패했습니다');
    }
  }

  async function handleKakaoLogin() {
    try {
      await signInWithKakao();
    } catch (err) {
      setError('Kakao 로그인에 실패했습니다');
    }
  }

  return (
    <div className="login-screen">
      <div className="login-container">
        <div className="app-logo">
          <h1>ENGS</h1>
        </div>

        <form onSubmit={handleSubmit} className="login-form">
          {error && <div className="error-message">{error}</div>}

          <div className="input-group">
            <label htmlFor="email">이메일</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="이메일을 입력하세요"
              required
            />
          </div>

          <div className="input-group">
            <label htmlFor="password">비밀번호</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="비밀번호를 입력하세요"
              required
            />
          </div>

          <button
            type="submit"
            className="login-button"
            disabled={loading}
          >
            {loading ? '로그인 중...' : '로그인'}
          </button>
        </form>

        <div className="social-login">
          <p>소셜 계정으로 로그인</p>
          <div className="social-buttons">
            <button
              type="button"
              onClick={handleGoogleLogin}
              className="google-button"
            >
              Google로 계속하기
            </button>
            <button
              type="button"
              onClick={handleKakaoLogin}
              className="kakao-button"
            >
              Kakao로 계속하기
            </button>
          </div>
        </div>

        <div className="login-links">
          <Link to="/register">회원가입</Link>
          <Link to="/forgot-password">비밀번호 찾기</Link>
        </div>
      </div>
    </div>
  );
}
