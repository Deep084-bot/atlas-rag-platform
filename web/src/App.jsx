import { Routes, Route } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';

import { LandingPage } from './pages/LandingPage.jsx';
import { DocsPage } from './pages/DocsPage.jsx';
import { LoginPage } from './pages/LoginPage.jsx';
import { SignupPage } from './pages/SignupPage.jsx';
import { WorkspacePage } from './pages/WorkspacePage.jsx';
import { ErrorBoundary } from './components/ErrorBoundary.jsx';
import { ProtectedRoute } from './components/ProtectedRoute.jsx';
import { GuestRoute } from './components/GuestRoute.jsx';

export default function App() {
  return (
    <>
      <ErrorBoundary>
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/docs" element={<DocsPage />} />
          <Route path="/login" element={<GuestRoute><LoginPage /></GuestRoute>} />
          <Route path="/signup" element={<GuestRoute><SignupPage /></GuestRoute>} />
          <Route
            path="/app"
            element={
              <ProtectedRoute>
                <WorkspacePage />
              </ProtectedRoute>
            }
          />
        </Routes>
      </ErrorBoundary>
      <Toaster
        position="top-right"
        toastOptions={{
          style: {
            background: '#0f1a2e',
            color: '#e7eef9',
            border: '1px solid rgba(255,255,255,0.1)',
          },
        }}
      />
    </>
  );
}
