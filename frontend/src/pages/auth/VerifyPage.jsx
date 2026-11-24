import { useEffect, useRef, useState } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { ErrorAlert, Alert, Button } from '../../components/ui'
import { useAuth } from '../../contexts/AuthContext'
import { useDocumentTitle } from '../../hooks/useResource'
import { authApi } from '../../services/melobud'
import AuthHeading from './AuthHeading'

const LENGTH = 6

function CodeInput({ value, onChange, disabled, invalid }) {
  const refs = useRef([])
  const digits = value.padEnd(LENGTH, ' ').slice(0, LENGTH).split('')

  const setAt = (i, d) => {
    const next = digits.slice()
    next[i] = d
    onChange(next.join('').replace(/\s+$/, '').replace(/\s/g, ''))
  }
  return (
    <div className="flex gap-2" role="group" aria-label="Verification code">
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => (refs.current[i] = el)}
          value={d.trim()}
          disabled={disabled}
          inputMode="numeric"
          autoComplete="mb-no-suggestions"
          aria-label={`Digit ${i + 1}`}
          aria-invalid={invalid ? 'true' : undefined}
          maxLength={1}
          className="input h-14 w-full px-0 text-center font-display text-[22px] font-bold"
          onFocus={(e) => e.target.select()}
          onPaste={(e) => {
            const text = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, LENGTH)
            if (text) {
              e.preventDefault()
              onChange(text)
              refs.current[Math.min(text.length, LENGTH - 1)]?.focus()
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Backspace' && !d.trim() && i > 0) refs.current[i - 1]?.focus()
            if (e.key === 'ArrowLeft' && i > 0) refs.current[i - 1]?.focus()
            if (e.key === 'ArrowRight' && i < LENGTH - 1) refs.current[i + 1]?.focus()
          }}
          onChange={(e) => {
            const ch = e.target.value.replace(/\D/g, '').slice(-1)
            setAt(i, ch || ' ')
            if (ch && i < LENGTH - 1) refs.current[i + 1]?.focus()
          }}
        />
      ))}
    </div>
  )
}

export default function VerifyPage() {
  useDocumentTitle('Verify email')
  const location = useLocation()
  const navigate = useNavigate()
  const { setUser } = useAuth()
  const email = location.state?.email
  const [code, setCode] = useState('')
  const [error, setError] = useState(null)
  // Only a wrong/expired code should turn the digit boxes red.
  const [codeInvalid, setCodeInvalid] = useState(false)
  const [notice, setNotice] = useState(
    location.state?.warning
      ? { tone: 'warn', text: location.state.warning }
      : location.state?.fromLogin
        ? { tone: 'info', text: 'Your email address has not been verified. Request a verification code to complete your registration.' }
        : null,
  )
  const [busy, setBusy] = useState(false)
  const [resending, setResending] = useState(false)
  const [cooldown, setCooldown] = useState(location.state?.sent ? 60 : 0)
  // Only claim a code was sent when the server actually sent one.
  const [sent, setSent] = useState(Boolean(location.state?.sent))

  useEffect(() => {
    if (cooldown <= 0) return undefined
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000)
    return () => clearTimeout(t)
  }, [cooldown])

  if (!email) return <Navigate to="/register" replace />

  const submit = async (e) => {
    e?.preventDefault()
    if (code.length !== LENGTH) {
      setError('Please enter the complete 6-digit code.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res = await authApi.verify(email, code)
      setUser(res.user)
      navigate('/', { replace: true })
    } catch (err) {
      if (err.code === 'already_verified') {
        navigate('/login', { state: { email, notice: 'Your email address has already been verified. Please sign in.' } })
        return
      }
      setError(err)
      setCodeInvalid(['invalid_code', 'too_many_attempts'].includes(err.code) || Boolean(err.fieldError?.('code')))
      setCode('')
    } finally {
      setBusy(false)
    }
  }

  const resend = async () => {
    setResending(true)
    setError(null)
    try {
      await authApi.resendCode(email)
      setNotice({ tone: 'success', text: `A verification code has been sent to ${email}.` })
      setSent(true)
      setCooldown(60)
    } catch (err) {
      if (err.body?.retry_after) setCooldown(err.body.retry_after)
      setError(err)
    } finally {
      setResending(false)
    }
  }

  return (
    <>
      <AuthHeading title={sent ? 'Check your email' : 'Verify your email'}>
        {sent ? (
          <>
            A 6-digit verification code has been sent to <span className="font-semibold text-ink">{email}</span>. The code expires in 15 minutes.
          </>
        ) : (
          <>
            To complete your registration, send a verification code to <span className="font-semibold text-ink">{email}</span>.
          </>
        )}
      </AuthHeading>
      <form autoComplete="mb-no-suggestions" onSubmit={submit} className="space-y-5">
        {notice && !error && <Alert tone={notice.tone}>{notice.text}</Alert>}
        <ErrorAlert error={error} />
        <CodeInput value={code} onChange={(v) => {
          setCode(v)
          setCodeInvalid(false)
        }} disabled={busy} invalid={codeInvalid} />
        <Button type="submit" variant="primary" size="lg" className="w-full" loading={busy} disabled={code.length !== LENGTH}>
          Verify email
        </Button>
      </form>
      <div className="mt-6 flex items-center justify-between text-[13.5px]">
        <span className="text-ink-3">{sent ? 'Did not receive the code? Check your spam folder.' : 'No code has been sent yet.'}</span>
        <button
          type="button"
          onClick={resend}
          disabled={resending || cooldown > 0}
          className="font-semibold text-ink hover:text-brass disabled:text-ink-3"
        >
          {cooldown > 0 ? <span className="tabular">Resend in {cooldown}s</span> : resending ? 'Sending…' : sent ? 'Resend code' : 'Send code'}
        </button>
      </div>
      <p className="mt-8 text-center text-[13.5px] text-ink-2">
        Wrong email address?{' '}
        <Link to="/register" className="font-semibold text-ink hover:text-brass">
          Register again
        </Link>
      </p>
    </>
  )
}
