import { forwardRef, useEffect, useId, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { CircleAlert, CircleCheck, Eye, EyeOff, Info, LoaderCircle, RotateCw, TriangleAlert } from 'lucide-react'
import { describeError } from '../utils/errors'

// Melobud never lets the browser (or a password manager) suggest or fill values.
// Chrome/Edge ignore autocomplete="off" on fields they recognise as email or
// password, so we also: use an unrecognised autocomplete token, give each field
// a random name, and keep it read-only until the user focuses it (browsers do
// not autofill read-only inputs).
function useNoSuggestions(onFocus) {
  const [armed, setArmed] = useState(false)
  const [name] = useState(() => `mb-${Math.random().toString(36).slice(2, 10)}`)
  return {
    name,
    autoComplete: 'mb-no-suggestions',
    readOnly: !armed,
    'data-lpignore': 'true',
    'data-1p-ignore': true,
    'data-bwignore': true,
    'data-form-type': 'other',
    onFocus: (e) => {
      if (!armed) setArmed(true)
      onFocus?.(e)
    },
  }
}

export function Spinner({ size = 16, className = '' }) {
  return <LoaderCircle size={size} className={`spin ${className}`} aria-hidden />
}

export function Button({ variant = 'secondary', size, icon: Icon, loading, children, className = '', to, ...props }) {
  const classes = ['btn', `btn-${variant}`, size && `btn-${size}`, !children && 'btn-icon', className]
    .filter(Boolean)
    .join(' ')
  const content = (
    <>
      {loading ? <Spinner size={size === 'sm' ? 14 : 16} /> : Icon ? <Icon size={size === 'sm' ? 15 : 17} aria-hidden /> : null}
      {children}
    </>
  )
  if (to) {
    return (
      <Link to={to} className={classes} {...props}>
        {content}
      </Link>
    )
  }
  return (
    <button type="button" className={classes} disabled={loading || props.disabled} {...props}>
      {content}
    </button>
  )
}

export const Field = forwardRef(function Field({ label, error, hint, className = '', id: idProp, type = 'text', onFocus, ...props }, ref) {
  const noSuggestions = useNoSuggestions(onFocus)
  // type="email" triggers the browser's saved-address dropdown; use text + email keyboard instead.
  const inputType = type === 'email' ? 'text' : type
  const extra = type === 'email' ? { inputMode: 'email', autoCapitalize: 'none', spellCheck: false } : {}
  const autoId = useId()
  const id = idProp || autoId
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined
  return (
    <div className={className}>
      {label && (
        <label htmlFor={id} className="field-label">
          {label}
        </label>
      )}
      <input
        ref={ref}
        id={id}
        className="input"
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={describedBy}
        type={inputType}
        {...extra}
        {...props}
        {...noSuggestions}
      />
      {error ? (
        <p id={`${id}-error`} className="mt-1.5 text-[12.5px] text-bad">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="mt-1.5 text-[12.5px] text-ink-3">
          {hint}
        </p>
      ) : null}
    </div>
  )
})

export function PasswordField({ label = 'Password', error, hint, aside, onFocus, ...props }) {
  const [visible, setVisible] = useState(false)
  const noSuggestions = useNoSuggestions(onFocus)
  const id = useId()
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between">
        <label htmlFor={id} className="field-label mb-0">
          {label}
        </label>
        {aside}
      </div>
      <div className="relative">
        <input
          id={id}
          type={visible ? 'text' : 'password'}
          className="input pr-11"
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
          {...props}
          {...noSuggestions}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-ink-3 hover:text-ink"
          aria-label={visible ? 'Hide password' : 'Show password'}
          aria-pressed={visible}
        >
          {visible ? <EyeOff size={17} /> : <Eye size={17} />}
        </button>
      </div>
      {error ? (
        <p id={`${id}-error`} className="mt-1.5 text-[12.5px] text-bad">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="mt-1.5 text-[12.5px] text-ink-3">
          {hint}
        </p>
      ) : null}
    </div>
  )
}

const ALERT_TONES = {
  error: { box: 'border-[rgb(239_109_97/0.35)] bg-bad-soft', icon: CircleAlert, iconColor: 'text-bad', title: 'text-[#f6b3ab]' },
  success: { box: 'border-[rgb(92_203_143/0.35)] bg-good-soft', icon: CircleCheck, iconColor: 'text-good', title: 'text-[#a8e6c2]' },
  info: { box: 'border-line-strong bg-raised', icon: Info, iconColor: 'text-ink-2', title: 'text-ink' },
  warn: { box: 'border-[rgb(238_177_80/0.35)] bg-brass-soft', icon: TriangleAlert, iconColor: 'text-brass', title: 'text-[#f5d49a]' },
}

/** Inline alert panel: icon, optional title, message, optional action. */
export function Alert({ tone = 'error', title, children, action }) {
  const t = ALERT_TONES[tone] || ALERT_TONES.info
  const Icon = t.icon
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={`page-enter flex items-start gap-3 rounded-[10px] border px-4 py-3 text-left ${t.box}`}
    >
      <Icon size={18} className={`mt-[1px] shrink-0 ${t.iconColor}`} aria-hidden />
      <div className="min-w-0 flex-1">
        {title && <p className={`text-[13.5px] font-semibold leading-snug ${t.title}`}>{title}</p>}
        <div className={`text-[13px] leading-snug text-ink-2 ${title ? 'mt-0.5' : ''}`}>{children}</div>
        {action && <div className="mt-2 text-[13px]">{action}</div>}
      </div>
    </div>
  )
}

/** Renders an ApiError (or string) as an alert with a consistent title. */
export function ErrorAlert({ error, action }) {
  const info = describeError(error)
  if (!info) return null
  return (
    <Alert tone="error" title={info.title} action={action}>
      {info.message}
    </Alert>
  )
}

export function Segmented({ value, onChange, options, label, size = 'md' }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-[8px] border border-line-strong bg-surface p-0.5">
      {options.map((opt) => {
        const active = opt.value === value
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(opt.value)}
            className={`rounded-[6px] px-3 font-medium transition-colors ${size === 'sm' ? 'h-7 text-[12.5px]' : 'h-8 text-[13px]'} ${
              active ? 'bg-hover text-ink shadow-[inset_0_0_0_1px_var(--color-line-strong)]' : 'text-ink-3 hover:text-ink-2'
            }`}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}

const STATUS = {
  pending: { label: 'Queued', className: 'text-ink-2' },
  processing: { label: 'Analyzing', className: 'text-brass' },
  completed: { label: 'Ready', className: 'text-good' },
  failed: { label: 'Failed', className: 'text-bad' },
}

export function StatusBadge({ status, progress }) {
  const s = STATUS[status] || STATUS.pending
  return (
    <span className={`badge ${s.className}`}>
      {status === 'processing' ? <Spinner size={11} /> : <span className="badge-dot" />}
      {s.label}
      {status === 'processing' && progress ? <span className="tabular text-ink-3">{progress}%</span> : null}
    </span>
  )
}

export function EmptyState({ icon: Icon, title, children, action }) {
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center">
      {Icon && (
        <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-[10px] border border-line-strong bg-raised text-ink-2">
          <Icon size={20} aria-hidden />
        </div>
      )}
      <h3 className="text-[16px] font-bold">{title}</h3>
      {children && <p className="mt-1.5 max-w-sm text-[13.5px] text-ink-2">{children}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}

export function ErrorState({ error, onRetry }) {
  const info = describeError(error) || { title: null, message: 'An unexpected error occurred.' }
  return (
    <div className="flex flex-col items-center px-6 py-16 text-center">
      <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-full bg-bad-soft text-bad">
        <CircleAlert size={20} aria-hidden />
      </div>
      <h3 className="text-[16px] font-bold">{info.title || 'Unable to load content'}</h3>
      <p className="mt-1.5 max-w-sm text-[13.5px] text-ink-2">{info.message}</p>
      {onRetry && (
        <Button className="mt-5" icon={RotateCw} onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  )
}

export function PageHeader({ eyebrow, title, description, actions }) {
  return (
    <header className="mb-7 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow && <p className="eyebrow mb-2">{eyebrow}</p>}
        <h1 className="truncate text-[26px] leading-tight font-extrabold sm:text-[28px]">{title}</h1>
        {description && <p className="mt-1.5 text-[14px] text-ink-2">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
    </header>
  )
}

export function ConfirmDialog({ open, title, children, confirmLabel = 'Confirm', tone = 'danger', busy, onConfirm, onCancel }) {
  const ref = useRef(null)
  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])
  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault()
        if (!busy) onCancel()
      }}
      className="m-auto w-[calc(100%-32px)] max-w-md rounded-[12px] border border-line-strong bg-surface p-0 text-ink shadow-[0_24px_64px_-16px_rgb(0_0_0/0.7)]"
    >
      <div className="p-6">
        <h2 className="text-[18px] font-bold">{title}</h2>
        <div className="mt-2 text-[14px] text-ink-2">{children}</div>
      </div>
      <div className="flex justify-end gap-2 border-t border-line px-6 py-4">
        <Button variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button variant={tone === 'danger' ? 'danger' : 'primary'} onClick={onConfirm} loading={busy}>
          {confirmLabel}
        </Button>
      </div>
    </dialog>
  )
}

export function ProgressBar({ value, tone = 'brass', label }) {
  const pct = Math.max(0, Math.min(100, Math.round((value || 0) * 100)))
  const color = tone === 'bad' ? 'bg-bad' : tone === 'good' ? 'bg-good' : 'bg-brass'
  return (
    <div role="progressbar" aria-label={label} aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} className="h-1.5 w-full overflow-hidden rounded-full bg-line-strong">
      <div className={`h-full rounded-full ${color} transition-[width] duration-300`} style={{ width: `${pct}%` }} />
    </div>
  )
}

export function ChordChips({ chords, max = 5 }) {
  if (!chords?.length) return null
  const shown = chords.slice(0, max)
  return (
    <span className="flex flex-wrap gap-1">
      {shown.map((c) => (
        <span key={c} className="chord-chip">
          {c}
        </span>
      ))}
      {chords.length > max && <span className="chord-chip text-ink-3">+{chords.length - max}</span>}
    </span>
  )
}

/** Accessible on/off switch with a label and optional description. */
export function Switch({ checked, onChange, label, description, disabled }) {
  const id = useId()
  return (
    <div className={`flex items-start justify-between gap-6 ${disabled ? 'opacity-50' : ''}`}>
      <label htmlFor={id} className="min-w-0 cursor-pointer">
        <span className="block text-[14px] font-semibold">{label}</span>
        {description && <span className="mt-0.5 block text-[12.5px] text-ink-3">{description}</span>}
      </label>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative mt-0.5 h-[22px] w-[38px] shrink-0 rounded-full transition-colors ${checked ? 'bg-brass' : 'bg-line-strong'} disabled:cursor-not-allowed`}
      >
        <span className={`absolute top-[3px] left-[3px] h-4 w-4 rounded-full bg-ink transition-transform ${checked ? 'translate-x-4 bg-brass-ink' : ''}`} />
      </button>
    </div>
  )
}

/** Modal dialog with a form body and Cancel / submit footer. */
export function FormDialog({ open, title, description, children, submitLabel = 'Save', busy, onSubmit, onCancel }) {
  const ref = useRef(null)
  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])
  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault()
        if (!busy) onCancel()
      }}
      className="m-auto w-[calc(100%-32px)] max-w-lg rounded-[12px] border border-line-strong bg-surface p-0 text-ink shadow-[0_24px_64px_-16px_rgb(0_0_0/0.7)]"
    >
      <form
        noValidate
        autoComplete="off"
        onSubmit={(e) => {
          e.preventDefault()
          onSubmit()
        }}
      >
        <div className="border-b border-line px-6 py-4">
          <h2 className="text-[18px] font-bold">{title}</h2>
          {description && <p className="mt-1 text-[13px] text-ink-3">{description}</p>}
        </div>
        <div className="max-h-[65dvh] space-y-4 overflow-y-auto px-6 py-5">{open && children}</div>
        <div className="flex justify-end gap-2 border-t border-line px-6 py-4">
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={busy}>
            {submitLabel}
          </Button>
        </div>
      </form>
    </dialog>
  )
}
