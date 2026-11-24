import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Button, ErrorAlert, PasswordField } from '../../components/ui'
import { useDocumentTitle } from '../../hooks/useResource'
import { authApi } from '../../services/melobud'
import AuthHeading from './AuthHeading'

export default function ResetPasswordPage() {
  useDocumentTitle('Choose a new password')
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const uid = params.get('uid')
  const token = params.get('token')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [errors, setErrors] = useState({})
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  if (!uid || !token) {
    return (
      <>
        <AuthHeading title="Invalid reset link">This password reset link is incomplete or invalid. Please use the link from your email or request a new one.</AuthHeading>
        <Button to="/forgot-password" variant="primary" size="lg" className="w-full">
          Request a new link
        </Button>
      </>
    )
  }

  const submit = async (e) => {
    e.preventDefault()
    const errs = {}
    if (password.length < 8) errs.password = 'Password must be at least 8 characters.'
    if (confirm !== password) errs.confirm = 'The passwords do not match.'
    setErrors(errs)
    if (Object.keys(errs).length) return
    setBusy(true)
    setError(null)
    try {
      const res = await authApi.resetPassword(uid, token, password, confirm)
      navigate('/login', { replace: true, state: { notice: res.detail } })
    } catch (err) {
      setErrors({ password: err.fieldError('password'), confirm: err.fieldError('password_confirm') })
      setError(err.errors ? null : err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <AuthHeading title="Choose a new password">Choose a strong password that you have not used before.</AuthHeading>
      <form autoComplete="off" onSubmit={submit} noValidate className="space-y-4">
        <ErrorAlert
          error={error}
          action={
            error?.code === 'invalid_token' && (
              <Link to="/forgot-password" className="font-semibold text-ink underline underline-offset-2 hover:text-brass">
                Request a new link
              </Link>
            )
          }
        />
        <PasswordField label="New password" value={password} onChange={(e) => setPassword(e.target.value)} error={errors.password} autoFocus />
        <PasswordField label="Confirm new password" value={confirm} onChange={(e) => setConfirm(e.target.value)} error={errors.confirm} />
        <Button type="submit" variant="primary" size="lg" className="w-full" loading={busy}>
          Update password
        </Button>
      </form>
    </>
  )
}
