import { API_BASE, api, request, uploadWithProgress } from './api'

export const authApi = {
  me: () => api.get('/auth/me/', { quiet401: true }),
  login: (login, password) => api.post('/auth/login/', { login, password }),
  usernameAvailable: (username, opts) =>
    api.get(`/auth/username-available/?username=${encodeURIComponent(username)}`, { ...opts, quiet401: true }),
  logout: () => api.post('/auth/logout/'),
  register: (email, username, password, password_confirm) =>
    api.post('/auth/register/', { email, username, password, password_confirm }),
  verify: (email, code) => api.post('/auth/verify/', { email, code }),
  resendCode: (email) => api.post('/auth/resend-code/', { email }),
  forgotPassword: (email) => api.post('/auth/password/forgot/', { email }),
  resetPassword: (uid, token, password, password_confirm) =>
    api.post('/auth/password/reset/', { uid, token, password, password_confirm }),
  changePassword: (current_password, new_password, password_confirm) =>
    api.post('/auth/password/change/', { current_password, new_password, password_confirm }),
  updateProfile: (data) => api.patch('/auth/me/', data),
  deleteAccount: (password) => api.del('/auth/me/', { password }),
}

export const songsApi = {
  list: ({ q = '', sort = 'recent', status = '' } = {}, opts) => {
    const params = new URLSearchParams()
    if (q) params.set('q', q)
    if (sort) params.set('sort', sort)
    if (status) params.set('status', status)
    return api.get(`/songs/?${params}`, opts)
  },
  get: (id, opts) => api.get(`/songs/${id}/`, opts),
  update: (id, data) => api.patch(`/songs/${id}/`, data),
  remove: (id) => api.del(`/songs/${id}/`),
  reanalyze: (id) => api.post(`/songs/${id}/reanalyze/`),
  markPlayed: (id) => api.post(`/songs/${id}/played/`),
  upload: (file, { title, artist } = {}, onProgress) => {
    const form = new FormData()
    form.append('file', file)
    if (title) form.append('title', title)
    if (artist) form.append('artist', artist)
    return uploadWithProgress('/songs/', form, onProgress)
  },
  audioUrl: (id) => `${API_BASE}/songs/${id}/audio/`,
}

export const practiceApi = {
  dashboard: (opts) => api.get('/practice/dashboard/', opts),
  sessions: (opts) => api.get('/practice/sessions/', opts),
  session: (id, opts) => api.get(`/practice/sessions/${id}/`, opts),
  start: (song, mode) => api.post('/practice/sessions/', { song, mode }),
  end: (id, { keepalive = false } = {}) => request(`/practice/sessions/${id}/`, { method: 'PATCH', body: {}, keepalive }),
  remove: (id) => api.del(`/practice/sessions/${id}/`),
  recordAttempt: (id, attempt) => api.post(`/practice/sessions/${id}/attempts/`, attempt),
}

export const healthApi = { get: () => api.get('/health/', { quiet401: true }) }

function query(params) {
  const search = new URLSearchParams()
  Object.entries(params || {}).forEach(([k, v]) => {
    if (v !== '' && v != null) search.set(k, v)
  })
  const text = search.toString()
  return text ? `?${text}` : ''
}

export const adminApi = {
  users: (params, opts) => api.get(`/admin/users/${query(params)}`, opts),
  createUser: (data) => api.post('/admin/users/', data),
  updateUser: (id, data) => api.patch(`/admin/users/${id}/`, data),
  deleteUser: (id) => api.del(`/admin/users/${id}/`),
}
