import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { ErrorAlert, Alert, Button, Field, PasswordField } from '../../components/ui'
import { useAuth } from '../../contexts/AuthContext'
import { useDocumentTitle } from '../../hooks/useResource'
import AuthHeading from './AuthHeading'

export default function LoginPage() {
  useDocumentTitle('Sign in')
  const { login, sessionExpired, clearSessionExpired } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [email, setEmail] = useState(location.state?.email || '')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [fieldErrors, setFieldErrors] = useState({})
  const [busy, setBusy] = useState(false)
  const notice = location.state?.notice

  const submit = async (e) => {
    e.preventDefault()
    const errs = {}
    if (!email.trim()) errs.email = 'Email or username is required.'
    if (!password) errs.password = 'Password is required.'
    setFieldErrors(errs)
    if (Object.keys(errs).length) return
    setBusy(true)
    setError(null)
    try {
      await login(email.trim(), password)
      clearSessionExpired()
      navigate(location.state?.from || '/', { replace: true })
    } catch (err) {
      if (err.code === 'unverified') {
        navigate('/verify', { state: { email: err.body.email || email.trim(), fromLogin: true } })
        return
      }
      setError(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <AuthHeading title="Sign in to Melobud">Enter your account details to continue.</AuthHeading>
      <form autoComplete="off" onSubmit={submit} noValidate className="space-y-4">
        {sessionExpired && !error && <Alert tone="info" title="Session expired">Your session has expired. Please sign in again.</Alert>}
        {notice && !error && <Alert tone="success">{notice}</Alert>}
        <ErrorAlert error={error} />
        <Field
          label="Email or username"
          type="text"
          autoCapitalize="none"
          spellCheck={false}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={fieldErrors.email}
          autoFocus
        />
        <PasswordField
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={fieldErrors.password}
          aside={
            <Link to="/forgot-password" className="text-[12.5px] font-medium text-ink-2 hover:text-brass">
              Forgot password?
            </Link>
          }
        />
        <Button type="submit" variant="primary" size="lg" className="w-full" loading={busy}>
          Sign in
        </Button>
      </form>
      <p className="mt-8 text-center text-[13.5px] text-ink-2">
        Don&apos;t have an account?{' '}
        <Link to="/register" className="font-semibold text-ink hover:text-brass">
          Create account
        </Link>
      </p>
    </>
  )
}
