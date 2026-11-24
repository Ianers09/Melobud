import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, ConfirmDialog, ErrorAlert, Field, PageHeader, PasswordField, Segmented, Spinner } from '../components/ui'
import UsernameField from '../components/UsernameField'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../contexts/ToastContext'
import { useDocumentTitle } from '../hooks/useResource'
import { authApi } from '../services/melobud'
import { formatDate, nameFromUser } from '../utils/format'
import { localUsernameProblem, normalizeUsername } from '../utils/username'

/** A settings card: title + description header, body, and a footer for actions. */
function Card({ title, description, children, footer, danger = false }) {
  return (
    <section className={`overflow-hidden rounded-[12px] border bg-surface ${danger ? 'border-[rgb(239_109_97/0.35)]' : 'border-line'}`}>
      <header className="border-b border-line px-6 py-4">
        <h2 className={`text-[15px] font-bold ${danger ? 'text-bad' : ''}`}>{title}</h2>
        {description && <p className="mt-1 text-[13px] text-ink-3">{description}</p>}
      </header>
      <div className="space-y-4 px-6 py-5">{children}</div>
      {footer && <footer className="flex items-center justify-end gap-3 border-t border-line bg-bg/40 px-6 py-3">{footer}</footer>}
    </section>
  )
}

function PreferenceRow({ title, description, busy, children }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-8">
      <div>
        <p className="text-[14px] font-semibold">{title}</p>
        <p className="mt-0.5 text-[13px] text-ink-3">{description}</p>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        {busy && <Spinner size={14} className="text-ink-3" />}
        {children}
      </div>
    </div>
  )
}

export default function SettingsPage() {
  useDocumentTitle('Settings')
  const { user, setUser, preferences } = useAuth()
  const [savingPref, setSavingPref] = useState(null)
  const toast = useToast()
  const navigate = useNavigate()

  const [profile, setProfile] = useState({ username: user.username || '', display_name: user.display_name || '' })
  const [profileErrors, setProfileErrors] = useState({})
  const [profileError, setProfileError] = useState(null)
  const [savingProfile, setSavingProfile] = useState(false)

  const [pw, setPw] = useState({ current: '', next: '', confirm: '' })
  const [pwErrors, setPwErrors] = useState({})
  const [pwError, setPwError] = useState(null)
  const [savingPw, setSavingPw] = useState(false)

  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deletePw, setDeletePw] = useState('')
  const [deleteError, setDeleteError] = useState(null)
  const [deleting, setDeleting] = useState(false)

  const profileChanged =
    normalizeUsername(profile.username) !== (user.username || '') || profile.display_name.trim() !== (user.display_name || '')

  const saveProfile = async (e) => {
    e.preventDefault()
    const username = normalizeUsername(profile.username)
    const problem = localUsernameProblem(username)
    if (problem) return setProfileErrors({ username: problem })
    setSavingProfile(true)
    setProfileErrors({})
    setProfileError(null)
    try {
      const res = await authApi.updateProfile({ username, display_name: profile.display_name.trim() })
      setUser(res.user)
      setProfile({ username: res.user.username || '', display_name: res.user.display_name || '' })
      toast.success('Your profile has been updated.')
    } catch (err) {
      setProfileErrors({ username: err.fieldError?.('username'), display_name: err.fieldError?.('display_name') })
      setProfileError(err.errors ? null : err)
    } finally {
      setSavingProfile(false)
    }
  }

  const changePassword = async (e) => {
    e.preventDefault()
    const errs = {}
    if (!pw.current) errs.current = 'Current password is required.'
    if (pw.next.length < 8) errs.next = 'Password must be at least 8 characters.'
    if (pw.confirm !== pw.next) errs.confirm = 'The passwords do not match.'
    setPwErrors(errs)
    if (Object.keys(errs).length) return
    setSavingPw(true)
    setPwError(null)
    try {
      await authApi.changePassword(pw.current, pw.next, pw.confirm)
      setPw({ current: '', next: '', confirm: '' })
      toast.success('Your password has been updated.')
    } catch (err) {
      setPwErrors({ next: err.fieldError('new_password'), confirm: err.fieldError('password_confirm') })
      setPwError(err.errors ? null : err)
    } finally {
      setSavingPw(false)
    }
  }

  const updatePreference = async (key, value) => {
    setSavingPref(key)
    try {
      const res = await authApi.updateProfile({ preferences: { [key]: value } })
      setUser(res.user)
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSavingPref(null)
    }
  }

  const deleteAccount = async () => {
    setDeleting(true)
    setDeleteError(null)
    try {
      await authApi.deleteAccount(deletePw)
      setUser(null)
      navigate('/login', { replace: true, state: { notice: 'Your account and all associated data have been deleted.' } })
    } catch (err) {
      setDeleteError(err)
      setDeleting(false)
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl">
      <PageHeader
        title="Settings"
        description="Manage your account, preferences, and security."
      />

      <div className="space-y-6">
        <section className="flex items-center gap-4 rounded-[12px] border border-line bg-surface px-6 py-5">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-hover font-display text-[18px] font-bold uppercase">
            {nameFromUser(user).slice(0, 1)}
          </span>
          <div className="min-w-0">
            <p className="truncate text-[15px] font-semibold">{nameFromUser(user)}</p>
            <p className="truncate text-[13px] text-ink-2">{user.email}</p>
          </div>
          <p className="ml-auto hidden shrink-0 text-right text-[12.5px] text-ink-3 sm:block">
            Member since
            <span className="block text-[13px] font-medium text-ink-2">{formatDate(user.date_joined)}</span>
          </p>
        </section>

        <form autoComplete="off" onSubmit={saveProfile} noValidate>
          <Card
            title="Public profile"
            description="Your username can be used to sign in. Your display name appears on your dashboard."
            footer={
              <Button type="submit" variant="primary" loading={savingProfile} disabled={!profileChanged}>
                Save changes
              </Button>
            }
          >
            <ErrorAlert error={profileError} />
            <UsernameField
              value={profile.username}
              current={user.username}
              onChange={(v) => {
                setProfile((p) => ({ ...p, username: v }))
                setProfileErrors((e) => ({ ...e, username: null }))
              }}
              error={profileErrors.username}
            />
            <Field
              label="Display name"
              value={profile.display_name}
              maxLength={60}
              onChange={(e) => setProfile((p) => ({ ...p, display_name: e.target.value }))}
              error={profileErrors.display_name}
              hint="Optional. If left blank, your username is used."
            />
          </Card>
        </form>

        <Card title="Preferences" description="Changes are saved automatically.">
          <PreferenceRow
            title="Beat counter"
            description="Count the beats of each chord so you know when to change."
            busy={savingPref === 'show_beat_counter'}
          >
            <Segmented
              label="Beat counter"
              value={preferences.show_beat_counter}
              onChange={(v) => updatePreference('show_beat_counter', v)}
              options={[
                { value: true, label: 'Show' },
                { value: false, label: 'Hide' },
              ]}
            />
          </PreferenceRow>
          <PreferenceRow
            title="Microphone sensitivity"
            description="Melobud adapts to your microphone automatically. Use Low in noisy rooms and High if soft strums are missed."
            busy={savingPref === 'mic_sensitivity'}
          >
            <Segmented
              label="Microphone sensitivity"
              value={preferences.mic_sensitivity}
              onChange={(v) => updatePreference('mic_sensitivity', v)}
              options={[
                { value: 'low', label: 'Low' },
                { value: 'normal', label: 'Normal' },
                { value: 'high', label: 'High' },
              ]}
            />
          </PreferenceRow>
        </Card>

        <form autoComplete="off" onSubmit={changePassword} noValidate>
          <Card
            title="Password"
            description="Use at least 8 characters, including a letter or symbol."
            footer={
              <Button type="submit" variant="primary" loading={savingPw}>
                Update password
              </Button>
            }
          >
            <ErrorAlert error={pwError} />
            <PasswordField label="Current password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} error={pwErrors.current} />
            <div className="grid gap-4 sm:grid-cols-2">
              <PasswordField label="New password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} error={pwErrors.next} />
              <PasswordField label="Confirm new password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} error={pwErrors.confirm} />
            </div>
          </Card>
        </form>

        <Card
          danger
          title="Delete account"
          description="Permanently delete your account, songs, analyses, and practice history. This action cannot be undone."
          footer={
            <Button variant="danger" onClick={() => setDeleteOpen(true)}>
              Delete account
            </Button>
          }
        >
          <p className="text-[13.5px] text-ink-2">
            Once your account is deleted, all of your data is removed immediately and cannot be recovered.
          </p>
        </Card>
      </div>

      <ConfirmDialog
        open={deleteOpen}
        title="Delete your account?"
        confirmLabel="Delete account"
        busy={deleting}
        onConfirm={deleteAccount}
        onCancel={() => {
          setDeleteOpen(false)
          setDeletePw('')
          setDeleteError(null)
        }}
      >
        <p className="mb-4">This action cannot be undone. Enter your password to confirm.</p>
        {deleteError && (
          <div className="mb-3">
            <ErrorAlert error={deleteError} />
          </div>
        )}
        <PasswordField label="Password" value={deletePw} onChange={(e) => setDeletePw(e.target.value)} />
      </ConfirmDialog>
    </div>
  )
}
