import { useEffect, useState } from 'react'
import { useResource } from '../../hooks/useResource'

/** List state for an admin table: search (debounced), filters and page, loaded from the API. */
export function useAdminList(load, initialFilters = {}) {
  const [search, setSearch] = useState('')
  const [q, setQ] = useState('')
  const [filters, setFilters] = useState(initialFilters)
  const [page, setPage] = useState(1)

  useEffect(() => {
    const timer = setTimeout(() => {
      setQ(search.trim())
      setPage(1)
    }, 300)
    return () => clearTimeout(timer)
  }, [search])

  const resource = useResource(({ signal }) => load({ q, page, ...filters }, { signal }), [q, page, filters])
  const setFilter = (name, value) => {
    setFilters((f) => ({ ...f, [name]: value }))
    setPage(1)
  }
  return { ...resource, search, setSearch, filters, setFilter, page, setPage }
}
