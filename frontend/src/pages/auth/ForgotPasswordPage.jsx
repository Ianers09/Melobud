import { useState } from 'react'
import { Link } from 'react-router-dom'
import { MailCheck } from 'lucide-react'
import { ErrorAlert, Alert, Button, Field } from '../../components/ui'
import { useDocumentTitle } from '../../hooks/useResource'
import { authApi } from '../../services/melobud'
import AuthHeading from './AuthHeading'

export default function ForgotPasswordPage() {
  useDocumentTitle('Reset password')
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState(null)
  const [fieldError, setFieldError] = useState(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setFieldError('Please enter a valid email address.')
      return
    }
    setFieldError(null)
    setBusy(true)
    setError(null)
    try {
      await authApi.forgotPassword(email.trim())
      setSent(true)
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }

  if (sent) {
    return (
      <>
        <div className="mb-6 flex h-11 w-11 items-center justify-center rounded-[10px] border border-line-strong bg-raised text-brass">
          <MailCheck size={20} aria-hidden />
        </div>
        <AuthHeading title="Check your email">
          If an account exists for <span className="font-semibold text-ink">{email.trim()}</span>, a password reset link has been sent. The link is valid for 60 minutes and can be used only once.
        </AuthHeading>
        <Button to="/login" variant="secondary" size="lg" className="w-full">
          Back to sign in
        </Button>
      </>
    )
  }

  return (
    <>
      <AuthHeading title="Reset your password">Enter the email address associated with your account and we will send you a link to reset your password.</AuthHeading>
      <form autoComplete="off" onSubmit={submit} noValidate className="space-y-4">
        <ErrorAlert error={error} />
        <Field label="Email" type="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} error={fieldError} autoFocus />
        <Button type="submit" variant="primary" size="lg" className="w-full" loading={busy}>
          Send reset link
        </Button>
      </form>
      <p className="mt-8 text-center text-[13.5px] text-ink-2">
        Remember your password?{' '}
        <Link to="/login" className="font-semibold text-ink hover:text-brass">
          Sign in
        </Link>
      </p>
    </>
  )
}
