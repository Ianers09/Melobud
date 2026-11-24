// Maps API errors to a consistent title + message pair, following the common
// "what happened / what to do next" pattern used in professional products.

const TITLES = {
  network: 'Connection error',
  invalid_credentials: 'Sign-in failed',
  unverified: 'Email verification required',
  email_taken: 'Account already exists',
  email_not_configured: 'Email service unavailable',
  email_failed: 'Email not sent',
  cooldown: 'Please wait',
  invalid_code: 'Verification failed',
  too_many_attempts: 'Verification failed',
  already_verified: 'Email already verified',
  invalid_token: 'Link expired',
  invalid_password: 'Incorrect password',
  unsupported_type: 'Unsupported file',
  file_too_large: 'File too large',
  file_too_small: 'Invalid file',
  corrupt_file: 'Invalid file',
  too_short: 'Song too short',
  too_long: 'Song too long',
  in_progress: 'Analysis in progress',
  missing_audio: 'Audio file unavailable',
  not_ready: 'Song not ready',
  database_error: 'Service unavailable',
  server_error: 'Unexpected error',
}

export function describeError(error) {
  if (!error) return null
  if (typeof error === 'string') return { title: null, message: error }
  if (error.status === 0) {
    return {
      title: TITLES.network,
      message: 'Unable to connect to the Melobud server. Please check your connection and try again.',
    }
  }
  const title =
    TITLES[error.code] ||
    (error.status === 429 ? 'Too many requests' : error.status >= 500 ? 'Unexpected error' : 'Request failed')
  return { title, message: error.message }
}
