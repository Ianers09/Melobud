import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { onUnauthorized } from '../services/api'
import { authApi } from '../services/melobud'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [status, setStatus] = useState('loading') // loading | ready | error
  const [sessionExpired, setSessionExpired] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const data = await authApi.me()
      setUser(data.user)
      setStatus('ready')
    } catch {
      setStatus('error')
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    authApi
      .me()
      .then((data) => {
        if (cancelled) return
        setUser(data.user)
        setStatus('ready')
      })
      .catch(() => !cancelled && setStatus('error'))
    return () => {
      cancelled = true
    }
  }, [])

  // Any 401 from the API means the session ended (expired or signed out elsewhere).
  const userRef = useRef(null)
  useEffect(() => {
    userRef.current = user
  }, [user])
  useEffect(
    () =>
      onUnauthorized(() => {
        if (userRef.current) setSessionExpired(true)
        setUser(null)
      }),
    [],
  )

  const login = useCallback(async (email, password) => {
    const data = await authApi.login(email, password)
    setSessionExpired(false)
    setUser(data.user)
    return data.user
  }, [])

  const logout = useCallback(async () => {
    try {
      await authApi.logout()
    } finally {
      setUser(null)
    }
  }, [])

  const value = useMemo(
    () => ({
      user,
      status,
      sessionExpired,
      setUser,
      refresh,
      login,
      logout,
      clearSessionExpired: () => setSessionExpired(false),
      preferences: user?.preferences || { chord_display: 'simple', show_beat_counter: true, mic_sensitivity: 'normal' },
    }),
    [user, status, sessionExpired, refresh, login, logout],
  )
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  return useContext(AuthContext)
}
