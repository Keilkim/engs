import { Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useTranslation } from '../i18n';

export default function ProtectedRoute({ children }) {
  const { isAuthenticated, loading } = useAuth();
  const { ko } = useTranslation();

  if (loading) {
    return <div className="loading-screen">{ko('common.loading')}</div>;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return children;
}
