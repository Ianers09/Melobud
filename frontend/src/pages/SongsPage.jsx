import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Guitar, Music, Play, Plus, Search } from 'lucide-react'
import AddSongDialog from '../components/AddSongDialog'
import { Button, ChordChips, EmptyState, ErrorState, PageHeader, StatusBadge } from '../components/ui'
import { useToast } from '../contexts/ToastContext'
import { useDocumentTitle, useResource } from '../hooks/useResource'
import { songsApi } from '../services/melobud'
import { formatRelative, formatTime } from '../utils/format'

const SORTS = [
  { value: 'played', label: 'Recently played' },
  { value: 'recent', label: 'Recently added' },
  { value: 'title', label: 'Title (A–Z)' },
  { value: 'artist', label: 'Artist (A–Z)' },
]

export default function SongsPage() {
  useDocumentTitle('Songs')
  const toast = useToast()
  const [params, setParams] = useSearchParams()
  const adding = params.get('add') === '1'
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  const [sort, setSort] = useState('played')

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 250)
    return () => clearTimeout(t)
  }, [query])

  const { data, error, loading, reload } = useResource(
    ({ signal }) => songsApi.list({ q: debounced, sort }, { signal }),
    [debounced, sort],
    { pollMs: (d) => (d?.results?.some((s) => s.status === 'pending' || s.status === 'processing') ? 3000 : null) },
  )

  const setAdding = (on) => setParams(on ? { add: '1' } : {}, { replace: true })
  const songs = data?.results || []
  const addButton = (
    <Button variant="primary" icon={Plus} onClick={() => setAdding(true)}>
      Add song
    </Button>
  )

  return (
    <>
      <PageHeader title="Songs" description="Add a song, then play it with chords or practice it with feedback." actions={addButton} />

      {(songs.length > 0 || debounced) && (
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
          <select className="input w-auto" value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort songs">
            {SORTS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="panel overflow-hidden">
        {loading && !data ? (
          <div className="space-y-px p-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className="skeleton h-16" />
            ))}
          </div>
        ) : error ? (
          <ErrorState error={error} onRetry={() => reload()} />
        ) : !songs.length ? (
          debounced ? (
            <EmptyState icon={Search} title="No matching songs">
              Try a different title or artist.
            </EmptyState>
          ) : (
            <EmptyState icon={Music} title="No songs yet" action={addButton}>
              Add an MP3 file. Melobud identifies its chords and beats so you can follow along and practice.
            </EmptyState>
          )
        ) : (
          <ul className="divide-y divide-line">
            {songs.map((song) => {
              const ready = song.status === 'completed'
              return (
                <li key={song.id} className="flex flex-col gap-3 px-5 py-4 transition-colors hover:bg-raised/40 sm:flex-row sm:items-center sm:gap-5">
                  <Link to={`/songs/${song.id}`} className="min-w-0 flex-1 rounded-sm">
                    <span className="block truncate text-[15px] font-semibold hover:text-brass">{song.title}</span>
                    <span className="block truncate text-[12.5px] text-ink-3">
                      {[song.artist, formatTime(song.duration), song.last_played_at ? `played ${formatRelative(song.last_played_at)}` : null]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </Link>
                  {ready ? (
                    <>
                      <span className="hidden lg:block">
                        <ChordChips chords={song.chords?.simple} max={4} />
                      </span>
                      <span className="flex shrink-0 gap-2">
                        <Button to={`/songs/${song.id}/play`} size="sm" icon={Play}>
                          Play
                        </Button>
                        <Button to={`/songs/${song.id}/practice`} size="sm" variant="primary" icon={Guitar}>
                          Practice
                        </Button>
                      </span>
                    </>
                  ) : (
                    <StatusBadge status={song.status} progress={song.progress} />
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>

      <AddSongDialog
        open={adding}
        onClose={() => setAdding(false)}
        onAdded={(song) => {
          setAdding(false)
          toast.success(`“${song.title}” was uploaded. Chord analysis has started.`)
          reload()
        }}
      />
    </>
  )
}
