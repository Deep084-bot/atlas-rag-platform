import { Routes, Route } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';

import { LandingPage } from './pages/LandingPage.jsx';
import { LoginPage } from './pages/LoginPage.jsx';
import { SignupPage } from './pages/SignupPage.jsx';
import { WorkspacePage } from './pages/WorkspacePage.jsx';
import { ProtectedRoute } from './components/ProtectedRoute.jsx';

export default function App() {
  return (
    <>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<SignupPage />} />
        <Route
          path="/app"
          element={
            <ProtectedRoute>
              <WorkspacePage />
            </ProtectedRoute>
          }
        />
      </Routes>
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
