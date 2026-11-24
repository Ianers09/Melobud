// Thin fetch wrapper around the Django REST API.
// Auth is an HttpOnly session cookie; unsafe requests echo the CSRF cookie.

export const API_BASE = (import.meta.env.VITE_API_BASE_URL || '/api').replace(/\/$/, '')

export class ApiError extends Error {
  constructor(status, body = {}) {
    super(body.detail || defaultMessage(status))
    this.status = status
    this.code = body.code || null
    this.errors = body.errors || null
    this.body = body
  }

  fieldError(name) {
    const value = this.errors?.[name]
    return Array.isArray(value) ? value[0] : value || null
  }
}

function defaultMessage(status) {
  if (status === 0) return 'Unable to connect to the Melobud server. Please check your connection and try again.'
  if (status === 401) return 'Your session has expired. Please sign in again.'
  if (status === 403) return 'You do not have permission to perform this action.'
  if (status === 404) return 'The requested item could not be found.'
  if (status === 429) return 'Too many requests. Please wait a moment and try again.'
  if (status >= 500) return 'An unexpected error occurred. Please try again.'
  return 'The request could not be completed. Please try again.'
}

function readCookie(name) {
  const match = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'))
  return match ? decodeURIComponent(match[1]) : null
}

let csrfPromise = null
export async function ensureCsrf() {
  if (readCookie('csrftoken')) return readCookie('csrftoken')
  if (!csrfPromise) {
    csrfPromise = fetch(`${API_BASE}/auth/csrf/`, { credentials: 'same-origin' }).finally(() => {
      csrfPromise = null
    })
  }
  await csrfPromise
  return readCookie('csrftoken')
}

const listeners = new Set()
export function onUnauthorized(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export async function request(path, { method = 'GET', body, headers = {}, signal, keepalive, quiet401 } = {}) {
  const init = { method, credentials: 'same-origin', headers: { Accept: 'application/json', ...headers }, signal, keepalive }
  if (method !== 'GET' && method !== 'HEAD') {
    init.headers['X-CSRFToken'] = await ensureCsrf()
  }
  if (body instanceof FormData) {
    init.body = body
  } else if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json'
    init.body = JSON.stringify(body)
  }

  let response
  try {
    response = await fetch(`${API_BASE}${path}`, init)
  } catch (err) {
    if (err.name === 'AbortError') throw err
    throw new ApiError(0)
  }
  if (response.status === 204) return null
  const type = response.headers.get('content-type') || ''
  const data = type.includes('application/json') ? await response.json().catch(() => ({})) : {}
  if (!response.ok) {
    if (response.status === 401 && !quiet401) listeners.forEach((fn) => fn())
    // A proxy 502/504 with no JSON body means Django itself is down.
    if ((response.status === 502 || response.status === 504) && !data.detail) throw new ApiError(0)
    throw new ApiError(response.status, data)
  }
  return data
}

export const api = {
  get: (path, opts) => request(path, { ...opts, method: 'GET' }),
  post: (path, body, opts) => request(path, { ...opts, method: 'POST', body }),
  patch: (path, body, opts) => request(path, { ...opts, method: 'PATCH', body }),
  del: (path, body, opts) => request(path, { ...opts, method: 'DELETE', body }),
}

// XHR-based upload so we can report real byte progress.
export async function uploadWithProgress(path, formData, onProgress) {
  const csrf = await ensureCsrf()
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `${API_BASE}${path}`)
    xhr.withCredentials = true
    xhr.setRequestHeader('X-CSRFToken', csrf)
    xhr.setRequestHeader('Accept', 'application/json')
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(e.loaded / e.total)
    }
    xhr.onload = () => {
      let data
      try {
        data = JSON.parse(xhr.responseText || '{}')
      } catch {
        data = {}
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data)
      else {
        if (xhr.status === 401) listeners.forEach((fn) => fn())
        reject(new ApiError(xhr.status === 502 && !data.detail ? 0 : xhr.status, data))
      }
    }
    xhr.onerror = () => reject(new ApiError(0))
    xhr.send(formData)
  })
}
