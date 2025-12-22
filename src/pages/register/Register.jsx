import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { signUp } from '../../services/auth';
import { TranslatableText } from '../../components/translatable';

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
  const [showVerificationModal, setShowVerificationModal] = useState(false);

  function handleChange(e) {
    const { name, value, type, checked } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value,
    }));
  }

  function validateForm() {
    if (formData.password.length < 8) {
      setError('Password must be at least 8 characters');
      return false;
    }
    if (formData.password !== formData.confirmPassword) {
      setError("Passwords don't match");
      return false;
    }
    if (formData.nickname.length < 2 || formData.nickname.length > 20) {
      setError('Nickname must be 2-20 characters');
      return false;
    }
    if (!formData.agreeTerms) {
      setError('Please agree to the Terms of Service');
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
      setShowVerificationModal(true);
    } catch (err) {
      if (err.message.includes('already registered')) {
        setError('Email already in use');
      } else {
        setError('Sign up failed. Please try again');
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
          <TranslatableText textKey="nav.back">Back</TranslatableText>
        </button>

        <h1><TranslatableText textKey="register.signUp">Sign Up</TranslatableText></h1>

        <form onSubmit={handleSubmit} className="register-form">
          {error && <div className="error-message">{error}</div>}

          <div className="input-group">
            <label htmlFor="email">
              <TranslatableText textKey="register.email">Email</TranslatableText>
            </label>
            <input
              id="email"
              name="email"
              type="email"
              value={formData.email}
              onChange={handleChange}
              placeholder="Enter your email"
              required
            />
          </div>

          <div className="input-group">
            <label htmlFor="password">
              <TranslatableText textKey="register.password">Password</TranslatableText>
            </label>
            <input
              id="password"
              name="password"
              type="password"
              value={formData.password}
              onChange={handleChange}
              placeholder="8+ characters, letters & numbers"
              required
            />
          </div>

          <div className="input-group">
            <label htmlFor="confirmPassword">
              <TranslatableText textKey="register.confirmPassword">Confirm Password</TranslatableText>
            </label>
            <input
              id="confirmPassword"
              name="confirmPassword"
              type="password"
              value={formData.confirmPassword}
              onChange={handleChange}
              placeholder="Re-enter your password"
              required
            />
          </div>

          <div className="input-group">
            <label htmlFor="nickname">
              <TranslatableText textKey="register.nickname">Nickname</TranslatableText>
            </label>
            <input
              id="nickname"
              name="nickname"
              type="text"
              value={formData.nickname}
              onChange={handleChange}
              placeholder="2-20 characters"
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
              <TranslatableText textKey="register.iAgreeTo">I agree to the</TranslatableText>{' '}
              <Link to="/terms" target="_blank">
                <TranslatableText textKey="register.termsOfService">Terms of Service</TranslatableText>
              </Link>{' & '}
              <Link to="/privacy" target="_blank">
                <TranslatableText textKey="register.privacyPolicy">Privacy Policy</TranslatableText>
              </Link>
            </label>
          </div>

          <button
            type="submit"
            className="register-button"
            disabled={loading}
          >
            {loading ? 'Creating account...' : <TranslatableText textKey="register.signUp">Sign Up</TranslatableText>}
          </button>
        </form>
      </div>

      {showVerificationModal && (
        <div className="modal-overlay">
          <div className="modal-content verification-modal">
            <div className="verification-icon">✉️</div>
            <h2>Email Verification Required</h2>
            <p>
              We've sent a verification email to <strong>{formData.email}</strong>.
            </p>
            <p>
              Click the link in the email to complete your registration.
            </p>
            <p className="verification-note">
              If you don't see the email, please check your spam folder.
            </p>
            <button
              type="button"
              className="register-button"
              onClick={() => navigate('/login')}
            >
              Go to Login
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
