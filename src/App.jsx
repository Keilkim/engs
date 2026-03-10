import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { TranslationProvider } from './i18n';
import ProtectedRoute from './components/ProtectedRoute';
import ErrorBoundary from './components/ErrorBoundary';

// Lazy-loaded pages
const Login = lazy(() => import('./pages/login/Login'));
const Register = lazy(() => import('./pages/register/Register'));
const Home = lazy(() => import('./pages/home/Home'));
const Viewer = lazy(() => import('./pages/viewer/Viewer'));
const Review = lazy(() => import('./pages/review/Review'));
const Chat = lazy(() => import('./pages/chat/Chat'));
const LiveChat = lazy(() => import('./pages/live-chat/LiveChat'));
const Mypage = lazy(() => import('./pages/mypage/Mypage'));
const Settings = lazy(() => import('./pages/settings/Settings'));
const Onboarding = lazy(() => import('./pages/onboarding/Onboarding'));

function App() {
  return (
    <ErrorBoundary>
      <TranslationProvider>
        <AuthProvider>
          <BrowserRouter>
          <Suspense fallback={<div className="loading-screen">Loading...</div>}>
          <Routes>
          {/* Public Routes */}
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />

          {/* Protected Routes */}
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <Home />
              </ProtectedRoute>
            }
          />
          <Route
            path="/viewer/:id"
            element={
              <ProtectedRoute>
                <Viewer />
              </ProtectedRoute>
            }
          />
          <Route
            path="/review"
            element={
              <ProtectedRoute>
                <Review />
              </ProtectedRoute>
            }
          />
          <Route
            path="/chat"
            element={
              <ProtectedRoute>
                <Chat />
              </ProtectedRoute>
            }
          />
          <Route
            path="/live-chat"
            element={
              <ProtectedRoute>
                <LiveChat />
              </ProtectedRoute>
            }
          />
          <Route
            path="/mypage"
            element={
              <ProtectedRoute>
                <Mypage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/settings"
            element={
              <ProtectedRoute>
                <Settings />
              </ProtectedRoute>
            }
          />
          <Route
            path="/onboarding"
            element={
              <ProtectedRoute>
                <Onboarding />
              </ProtectedRoute>
            }
          />

          {/* Catch-all route */}
          <Route path="*" element={<Navigate to="/login" replace />} />
          </Routes>
          </Suspense>
          </BrowserRouter>
        </AuthProvider>
      </TranslationProvider>
    </ErrorBoundary>
  );
}

export default App;
