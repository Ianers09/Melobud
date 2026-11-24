import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Load data with loading/error state. Re-runs when `deps` change.
 * `pollMs(data)` may return a number of milliseconds to re-fetch silently
 * (used while songs are analyzing), or null to stop polling.
 * State is only ever set from async callbacks, never synchronously in effects.
 */
export function useResource(loader, deps = [], { pollMs } = {}) {
  const [state, setState] = useState({ data: null, error: null, loading: true })
  const loaderRef = useRef(loader)
  const pollRef = useRef(pollMs)
  const depsKey = JSON.stringify(deps)

  useEffect(() => {
    loaderRef.current = loader
    pollRef.current = pollMs
  })

  const fetchData = useCallback((signal, silent) => {
    return loaderRef.current({ signal }).then(
      (data) => {
        if (!signal.aborted) setState({ data, error: null, loading: false })
        return data
      },
      (error) => {
        if (signal.aborted || error.name === 'AbortError') return undefined
        if (!silent) setState((s) => ({ ...s, error, loading: false }))
        return undefined
      },
    )
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    fetchData(controller.signal, false)
    return () => controller.abort()
  }, [depsKey, fetchData])

  useEffect(() => {
    const next = state.data && pollRef.current ? pollRef.current(state.data) : null
    if (!next) return undefined
    const controller = new AbortController()
    const timer = setTimeout(() => fetchData(controller.signal, true), next)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [state.data, fetchData])

  const reload = useCallback(
    ({ silent = false } = {}) => {
      if (!silent) setState((s) => ({ ...s, loading: true, error: null }))
      return fetchData(new AbortController().signal, silent)
    },
    [fetchData],
  )
  const setData = useCallback((update) => {
    setState((s) => ({ ...s, data: typeof update === 'function' ? update(s.data) : update }))
  }, [])

  return { data: state.data, setData, error: state.error, loading: state.loading, reload }
}

export function useDocumentTitle(title) {
  useEffect(() => {
    document.title = title ? `${title} · Melobud` : 'Melobud — Learn songs. Play chords. Grow musically.'
  }, [title])
}
