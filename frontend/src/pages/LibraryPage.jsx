import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Guitar, Library, Play, Search, Trash2, Upload } from 'lucide-react'
import { Button, ChordChips, ConfirmDialog, EmptyState, ErrorState, PageHeader, StatusBadge } from '../components/ui'
import { useToast } from '../contexts/ToastContext'
import { useDocumentTitle, useResource } from '../hooks/useResource'
import { songsApi } from '../services/melobud'
import { formatDate, formatTime } from '../utils/format'

const SORTS = [
  { value: 'recent', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'title', label: 'Title A–Z' },
  { value: 'artist', label: 'Artist A–Z' },
  { value: 'duration', label: 'Longest first' },
  { value: 'played', label: 'Recently played' },
]

const FILTERS = [
  { value: '', label: 'All' },
  { value: 'completed', label: 'Ready' },
  { value: 'processing', label: 'Analyzing' },
  { value: 'failed', label: 'Failed' },
]

export default function LibraryPage() {
  useDocumentTitle('Library')
  const toast = useToast()
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  const [sort, setSort] = useState('recent')
  const [status, setStatus] = useState('')
  const [pendingDelete, setPendingDelete] = useState(null)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 250)
    return () => clearTimeout(t)
  }, [query])

  const { data, error, loading, reload, setData } = useResource(
    ({ signal }) => songsApi.list({ q: debounced, sort, status }, { signal }),
    [debounced, sort, status],
    { pollMs: (d) => (d?.results?.some((s) => s.status === 'pending' || s.status === 'processing') ? 3000 : null) },
  )

  const confirmDelete = async () => {
    setDeleting(true)
    try {
      await songsApi.remove(pendingDelete.id)
      setData((d) => ({ ...d, results: d.results.filter((s) => s.id !== pendingDelete.id), count: d.count - 1 }))
      toast.success(`“${pendingDelete.title}” has been deleted.`)
      setPendingDelete(null)
    } catch (err) {
      toast.error(err.message)
    } finally {
      setDeleting(false)
    }
  }

  const filtering = debounced || status
  const songs = data?.results || []

  return (
    <>
      <PageHeader
        title="Library"
        description={data ? `${data.count} ${data.count === 1 ? 'song' : 'songs'}` : 'Your uploaded songs'}
      />

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-3" aria-hidden />
          <input
            type="search"
            autoComplete="mb-no-suggestions"
            className="input pl-9"
            placeholder="Search by title or artist"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search songs"
          />
        </div>
        <div className="flex gap-2">
          <select className="input w-auto" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status">
            {FILTERS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
          <select className="input w-auto" value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort songs">
            {SORTS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="panel overflow-hidden">
        {loading && !data ? (
          <div className="space-y-px p-2">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="skeleton h-14" />
            ))}
          </div>
        ) : error ? (
          <ErrorState error={error} onRetry={() => reload()} />
        ) : !songs.length ? (
          filtering ? (
            <EmptyState icon={Search} title="No matching songs">
              Try adjusting your search or filters.
            </EmptyState>
          ) : (
            <EmptyState
              icon={Library}
              title="Your library is empty"
              action={
                <Button to="/upload" variant="primary" icon={Upload}>
                  Upload your first song
                </Button>
              }
            >
              Upload an MP3 file to analyze its chords and start practicing.
            </EmptyState>
          )
        ) : (
          <>
            <div className="hidden grid-cols-[minmax(0,2.2fr)_minmax(0,1.4fr)_72px_104px_112px_116px] gap-4 border-b border-line px-5 py-2.5 lg:grid">
              {['Song', 'Chords', 'Length', 'Uploaded', 'Status', ''].map((h) => (
                <span key={h} className="eyebrow">
                  {h}
                </span>
              ))}
            </div>
            <ul className="divide-y divide-line">
              {songs.map((song) => {
                const ready = song.status === 'completed'
                return (
                  <li
                    key={song.id}
                    className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 px-5 py-3 transition-colors hover:bg-raised/40 lg:grid-cols-[minmax(0,2.2fr)_minmax(0,1.4fr)_72px_104px_112px_116px]"
                  >
                    <Link to={`/songs/${song.id}`} className="min-w-0 rounded-sm">
                      <span className="block truncate text-[14px] font-semibold hover:text-brass">{song.title}</span>
                      <span className="block truncate text-[12.5px] text-ink-3">
                        {song.artist}
                        <span className="lg:hidden">
                          {song.artist ? ' · ' : ''}
                          {formatTime(song.duration)}
                        </span>
                      </span>
                    </Link>
                    <span className="hidden min-w-0 lg:block">{ready ? <ChordChips chords={song.chords?.simple} max={4} /> : <span className="text-ink-3">—</span>}</span>
                    <span className="tabular hidden text-[13px] text-ink-2 lg:block">{formatTime(song.duration)}</span>
                    <span className="hidden text-[13px] text-ink-2 lg:block">{formatDate(song.created_at)}</span>
                    <span className="hidden lg:block">
                      <StatusBadge status={song.status} progress={song.progress} />
                    </span>
                    <span className="flex items-center justify-end gap-1">
                      <span className="mr-1 lg:hidden">
                        <StatusBadge status={song.status} progress={song.progress} />
                      </span>
                      {ready && (
                        <>
                          <Button to={`/songs/${song.id}/play`} variant="ghost" size="sm" icon={Play} aria-label={`Play ${song.title}`} title="Play with chords" />
                          <Button to={`/songs/${song.id}/practice`} variant="ghost" size="sm" icon={Guitar} aria-label={`Practice ${song.title}`} title="Practice" />
                        </>
                      )}
                      <Button variant="ghost" size="sm" icon={Trash2} onClick={() => setPendingDelete(song)} aria-label={`Delete ${song.title}`} title="Delete" />
                    </span>
                  </li>
                )
              })}
            </ul>
          </>
        )}
      </div>

      <ConfirmDialog
        open={!!pendingDelete}
        title="Delete this song?"
        confirmLabel="Delete song"
        busy={deleting}
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
      >
        “{pendingDelete?.title}” and its chord analysis will be permanently deleted. Your practice history will be retained. This action cannot be undone.
      </ConfirmDialog>
    </>
  )
}
