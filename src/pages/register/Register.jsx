import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { signUp } from '../../services/auth';

export default function Register() {
  const navigate = useNavigate();
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    confirmPassword: '',
    nickname: '',
    agreeTerms: false,
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  function handleChange(e) {
    const { name, value, type, checked } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value,
    }));
  }

  function validateForm() {
    if (formData.password.length < 8) {
      setError('비밀번호는 8자 이상이어야 합니다');
      return false;
    }
    if (formData.password !== formData.confirmPassword) {
      setError('비밀번호가 일치하지 않습니다');
      return false;
    }
    if (formData.nickname.length < 2 || formData.nickname.length > 20) {
      setError('닉네임은 2~20자 사이여야 합니다');
      return false;
    }
    if (!formData.agreeTerms) {
      setError('이용약관에 동의해주세요');
      return false;
    }
    return true;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');

    if (!validateForm()) return;

    setLoading(true);

    try {
      await signUp(formData.email, formData.password, formData.nickname);
      navigate('/');
    } catch (err) {
      if (err.message.includes('already registered')) {
        setError('이미 사용 중인 이메일입니다');
      } else {
        setError('회원가입에 실패했습니다. 다시 시도해주세요');
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="register-screen">
      <div className="register-container">
        <button
          type="button"
          className="back-button"
          onClick={() => navigate('/login')}
        >
          ← 뒤로가기
        </button>

        <h1>회원가입</h1>

        <form onSubmit={handleSubmit} className="register-form">
          {error && <div className="error-message">{error}</div>}

          <div className="input-group">
            <label htmlFor="email">이메일</label>
            <input
              id="email"
              name="email"
              type="email"
              value={formData.email}
              onChange={handleChange}
              placeholder="이메일을 입력하세요"
              required
            />
          </div>

          <div className="input-group">
            <label htmlFor="password">비밀번호</label>
            <input
              id="password"
              name="password"
              type="password"
              value={formData.password}
              onChange={handleChange}
              placeholder="8자 이상, 영문+숫자 조합"
              required
            />
          </div>

          <div className="input-group">
            <label htmlFor="confirmPassword">비밀번호 확인</label>
            <input
              id="confirmPassword"
              name="confirmPassword"
              type="password"
              value={formData.confirmPassword}
              onChange={handleChange}
              placeholder="비밀번호를 다시 입력하세요"
              required
            />
          </div>

          <div className="input-group">
            <label htmlFor="nickname">닉네임</label>
            <input
              id="nickname"
              name="nickname"
              type="text"
              value={formData.nickname}
              onChange={handleChange}
              placeholder="2~20자"
              required
            />
          </div>

          <div className="checkbox-group">
            <input
              id="agreeTerms"
              name="agreeTerms"
              type="checkbox"
              checked={formData.agreeTerms}
              onChange={handleChange}
            />
            <label htmlFor="agreeTerms">
              <Link to="/terms" target="_blank">이용약관</Link> 및{' '}
              <Link to="/privacy" target="_blank">개인정보처리방침</Link>에 동의합니다
            </label>
          </div>

          <button
            type="submit"
            className="register-button"
            disabled={loading}
          >
            {loading ? '가입 중...' : '회원가입'}
          </button>
        </form>
      </div>
    </div>
  );
}
