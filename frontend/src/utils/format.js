export function formatTime(seconds) {
  if (seconds == null || !Number.isFinite(seconds)) return '–:––'
  const s = Math.max(0, Math.floor(seconds))
  const m = Math.floor(s / 60)
  const h = Math.floor(m / 60)
  const ss = String(s % 60).padStart(2, '0')
  if (h) return `${h}:${String(m % 60).padStart(2, '0')}:${ss}`
  return `${m}:${ss}`
}

export function formatDuration(seconds) {
  if (seconds == null) return '—'
  const s = Math.round(seconds)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  return `${h} h ${m % 60} min`
}

export function formatBytes(bytes) {
  if (!bytes && bytes !== 0) return '—'
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

const dateFmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
const dateTimeFmt = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
})
const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })

export function formatDate(iso) {
  return iso ? dateFmt.format(new Date(iso)) : '—'
}

export function formatDateTime(iso) {
  return iso ? dateTimeFmt.format(new Date(iso)) : '—'
}

export function formatRelative(iso) {
  if (!iso) return '—'
  const diff = (new Date(iso).getTime() - Date.now()) / 1000
  const abs = Math.abs(diff)
  if (abs < 60) return 'just now'
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute')
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour')
  if (abs < 86400 * 7) return rtf.format(Math.round(diff / 86400), 'day')
  return formatDate(iso)
}

export function greeting(date = new Date()) {
  const h = date.getHours()
  if (h < 5) return 'Good evening'
  if (h < 12) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  return 'Good evening'
}

export function nameFromUser(user) {
  if (!user) return ''
  return user.display_name || (user.username ? user.username : user.email.split('@')[0])
}

export const MODE_LABEL = { step: 'Step-by-step', play_along: 'Play-along' }

/** Accuracy (0-100, rounded) from { correct, incorrect, missed }, or null if nothing was judged. */
export function accuracyOf(attempts) {
  const { correct = 0, incorrect = 0, missed = 0 } = attempts || {}
  const total = correct + incorrect + missed
  return total ? Math.round((correct / total) * 100) : null
}
