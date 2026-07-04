import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useTranslation } from '../i18n';

export default function ProtectedRoute({ children }) {
  const { isAuthenticated, loading } = useAuth();
  const { ko } = useTranslation();
  const location = useLocation();

  // DEV-only: preview protected screens without a Supabase session.
  // Toggled by the floating ThemeSwitcher's lock button (localStorage devBypassAuth).
  if (import.meta.env.DEV && localStorage.getItem('devBypassAuth') === '1') {
    return children;
  }

  if (loading) {
    return <div className="loading-screen">{ko('common.loading')}</div>;
  }

  if (!isAuthenticated) {
    // Preserve the intended destination so login can return the user there.
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return children;
}
