import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom'
import { Logo } from './components/Logo'
import { Button, Spinner } from './components/ui'
import { useAuth } from './contexts/AuthContext'
import AppLayout from './layouts/AppLayout'
import AuthLayout from './layouts/AuthLayout'
import ForgotPasswordPage from './pages/auth/ForgotPasswordPage'
import LoginPage from './pages/auth/LoginPage'
import RegisterPage from './pages/auth/RegisterPage'
import ResetPasswordPage from './pages/auth/ResetPasswordPage'
import VerifyPage from './pages/auth/VerifyPage'
import DashboardPage from './pages/DashboardPage'
import HistoryPage from './pages/HistoryPage'
import LibraryPage from './pages/LibraryPage'
import NotFoundPage from './pages/NotFoundPage'
import PlayerPage from './pages/PlayerPage'
import PracticePage from './pages/PracticePage'
import PracticePickerPage from './pages/PracticePickerPage'
import SessionDetailPage from './pages/SessionDetailPage'
import SettingsPage from './pages/SettingsPage'
import SongDetailPage from './pages/SongDetailPage'
import UploadPage from './pages/UploadPage'
import AdminPage from './pages/admin/AdminPage'

function Splash({ error, onRetry }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-6 px-6 text-center">
      <Logo size="lg" />
      {error ? (
        <>
          <p className="max-w-sm text-ink-2">Unable to connect to the Melobud server. Please check your connection and try again.</p>
          <Button onClick={onRetry}>Retry</Button>
        </>
      ) : (
        <Spinner size={20} className="text-ink-3" />
      )}
    </div>
  )
}

function RequireAuth() {
  const { user } = useAuth()
  const location = useLocation()
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />
  return <Outlet />
}

function RequireStaff() {
  const { user } = useAuth()
  return user?.is_staff ? <Outlet /> : <NotFoundPage />
}

function GuestOnly() {
  const { user } = useAuth()
  return user ? <Navigate to="/" replace /> : <Outlet />
}

export default function App() {
  const { status, refresh } = useAuth()
  if (status === 'loading') return <Splash />
  if (status === 'error') return <Splash error onRetry={refresh} />

  return (
    <Routes>
      <Route element={<AuthLayout />}>
        <Route element={<GuestOnly />}>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/verify" element={<VerifyPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        </Route>
        <Route path="/reset-password" element={<ResetPasswordPage />} />
      </Route>
      <Route element={<RequireAuth />}>
        <Route element={<AppLayout />}>
          <Route index element={<DashboardPage />} />
          <Route path="/library" element={<LibraryPage />} />
          <Route path="/upload" element={<UploadPage />} />
          <Route path="/songs/:id" element={<SongDetailPage />} />
          <Route path="/songs/:id/play" element={<PlayerPage />} />
          <Route path="/songs/:id/practice" element={<PracticePage />} />
          <Route path="/practice" element={<PracticePickerPage />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route path="/history/:id" element={<SessionDetailPage />} />
          <Route path="/profile" element={<Navigate to="/settings" replace />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route element={<RequireStaff />}>
            <Route path="/admin" element={<AdminPage />} />
          </Route>
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Route>
    </Routes>
  )
}
