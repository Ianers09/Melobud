// Mirrors the backend rules in accounts/serializers.py.
const PATTERN = /^[a-z0-9](?:[a-z0-9_.]{1,18})[a-z0-9]$/

export function normalizeUsername(value) {
  return value.trim().replace(/^@/, '').toLowerCase()
}

export function localUsernameProblem(value) {
  if (value.length < 3 || value.length > 20) return 'Username must be between 3 and 20 characters.'
  if (!PATTERN.test(value) || value.includes('..'))
    return 'Username may contain only letters, numbers, periods, and underscores, and must start and end with a letter or number.'
  return null
}
