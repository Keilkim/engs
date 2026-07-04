import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useTranslation } from '../i18n';

export default function ProtectedRoute({ children }) {
  const { isAuthenticated, loading } = useAuth();
  const { ko } = useTranslation();
  const location = useLocation();

  if (loading) {
    return <div className="loading-screen">{ko('common.loading')}</div>;
  }

  if (!isAuthenticated) {
    // Preserve the intended destination so login can return the user there.
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return children;
}
