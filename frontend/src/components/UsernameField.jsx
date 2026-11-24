import { useEffect, useId, useState } from 'react'
import { Check, X } from 'lucide-react'
import { authApi } from '../services/melobud'
import { localUsernameProblem, normalizeUsername } from '../utils/username'
import { Spinner } from './ui'

/**
 * Username input with a live availability check against the server.
 * `current` is the user's existing username (Profile), which counts as available.
 */
export default function UsernameField({ value, onChange, error, current, label = 'Username', autoFocus }) {
  const id = useId()
  const normalized = normalizeUsername(value)
  const [check, setCheck] = useState({ name: '', state: 'idle', message: null })

  useEffect(() => {
    if (!normalized || normalized === current || localUsernameProblem(normalized)) return undefined
    const controller = new AbortController()
    const timer = setTimeout(() => {
      setCheck({ name: normalized, state: 'checking', message: null })
      authApi
        .usernameAvailable(normalized, { signal: controller.signal })
        .then((res) =>
          setCheck({ name: normalized, state: res.available ? 'available' : 'taken', message: res.detail }),
        )
        .catch((err) => err.name !== 'AbortError' && setCheck({ name: normalized, state: 'idle', message: null }))
    }, 350)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [normalized, current])

  const local = normalized ? localUsernameProblem(normalized) : null
  const status = check.name === normalized ? check : { state: 'idle', message: null }
  const unchanged = normalized && normalized === current
  const message = error || (normalized && local) || (status.state === 'taken' ? status.message : null)
  const ok = !message && (unchanged || status.state === 'available')

  return (
    <div>
      <label htmlFor={id} className="field-label">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          className="input pr-10"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          name="melobud-handle"
          autoComplete="mb-no-suggestions"
          data-lpignore="true"
          data-1p-ignore
          autoCapitalize="none"
          spellCheck={false}
          maxLength={21}
          autoFocus={autoFocus}
          aria-invalid={message ? 'true' : undefined}
          aria-describedby={`${id}-hint`}
        />
        <span className="absolute inset-y-0 right-3 flex items-center" aria-hidden>
          {status.state === 'checking' && !local ? (
            <Spinner size={15} className="text-ink-3" />
          ) : ok ? (
            <Check size={16} className="text-good" />
          ) : message ? (
            <X size={16} className="text-bad" />
          ) : null}
        </span>
      </div>
      <p id={`${id}-hint`} className={`mt-1.5 text-[12.5px] ${message ? 'text-bad' : ok ? 'text-good' : 'text-ink-3'}`} role="status">
        {message || (ok ? (unchanged ? 'This is your current username.' : `${normalized} is available.`) : '3–20 characters: letters, numbers, periods, or underscores.')}
      </p>
    </div>
  )
}
