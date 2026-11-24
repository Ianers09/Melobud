import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Check } from 'lucide-react'
import { ErrorAlert, Alert, Button, Field, PasswordField } from '../../components/ui'
import UsernameField from '../../components/UsernameField'
import { localUsernameProblem, normalizeUsername } from '../../utils/username'
import { useDocumentTitle } from '../../hooks/useResource'
import { authApi } from '../../services/melobud'
import AuthHeading from './AuthHeading'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const RULES = [
  { test: (p) => p.length >= 8, label: 'Minimum 8 characters' },
  { test: (p) => /\D/.test(p), label: 'Contains a letter or symbol' },
]

export default function RegisterPage() {
  useDocumentTitle('Create account')
  const navigate = useNavigate()
  const [form, setForm] = useState({ email: '', username: '', password: '', confirm: '' })
  const [errors, setErrors] = useState({})
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))

  const validate = () => {
    const errs = {}
    if (!EMAIL_RE.test(form.email.trim())) errs.email = 'Please enter a valid email address.'
    const usernameProblem = localUsernameProblem(normalizeUsername(form.username))
    if (usernameProblem) errs.username = usernameProblem
    if (!RULES.every((r) => r.test(form.password))) errs.password = 'Password does not meet the requirements.'
    if (form.confirm !== form.password) errs.confirm = 'The passwords do not match.'
    return errs
  }

  const submit = async (e) => {
    e.preventDefault()
    const errs = validate()
    setErrors(errs)
    if (Object.keys(errs).length) return
    setBusy(true)
    setError(null)
    try {
      const res = await authApi.register(form.email.trim(), normalizeUsername(form.username), form.password, form.confirm)
      navigate('/verify', { state: { email: res.email, sent: true } })
    } catch (err) {
      if (err.code === 'cooldown' || err.code === 'email_failed') {
        // The account exists but is pending; continue to verification.
        navigate('/verify', { state: { email: err.body.email || form.email.trim(), warning: err.message } })
        return
      }
      setErrors({
        email: err.fieldError('email'),
        username: err.fieldError('username'),
        password: err.fieldError('password'),
        confirm: err.fieldError('password_confirm'),
      })
      setError(err.errors ? null : err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <AuthHeading title="Create your account">Get started with Melobud. It only takes a minute.</AuthHeading>
      <form autoComplete="off" onSubmit={submit} noValidate className="space-y-4">
        <ErrorAlert error={error} />
        <Field label="Email" type="email" inputMode="email" value={form.email} onChange={set('email')} error={errors.email} autoFocus />
        <UsernameField
          value={form.username}
          onChange={(v) => {
            setForm((f) => ({ ...f, username: v }))
            setErrors((e) => ({ ...e, username: null }))
          }}
          error={errors.username}
        />
        <div>
          <PasswordField value={form.password} onChange={set('password')} error={errors.password} />
          <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1" aria-label="Password requirements">
            {RULES.map((r) => {
              const ok = r.test(form.password)
              return (
                <li key={r.label} className={`flex items-center gap-1.5 text-[12.5px] ${ok ? 'text-good' : 'text-ink-3'}`}>
                  <Check size={13} className={ok ? '' : 'opacity-40'} aria-hidden />
                  {r.label}
                </li>
              )
            })}
          </ul>
        </div>
        <PasswordField label="Confirm password" value={form.confirm} onChange={set('confirm')} error={errors.confirm} />
        <Button type="submit" variant="primary" size="lg" className="w-full" loading={busy}>
          Create account
        </Button>
        <p className="text-[12.5px] text-ink-3">A 6-digit verification code will be sent to your email address.</p>
      </form>
      <p className="mt-8 text-center text-[13.5px] text-ink-2">
        Already have an account?{' '}
        <Link to="/login" className="font-semibold text-ink hover:text-brass">
          Sign in
        </Link>
      </p>
    </>
  )
}
