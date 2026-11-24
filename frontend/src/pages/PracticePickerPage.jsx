import { Link } from 'react-router-dom'
import { Guitar, Upload } from 'lucide-react'
import { Button, ChordChips, EmptyState, ErrorState, PageHeader } from '../components/ui'
import { useDocumentTitle, useResource } from '../hooks/useResource'
import { songsApi } from '../services/melobud'
import { formatRelative, formatTime } from '../utils/format'

export default function PracticePickerPage() {
  useDocumentTitle('Practice')
  const { data, error, loading, reload } = useResource(({ signal }) => songsApi.list({ status: 'completed', sort: 'played' }, { signal }), [])

  return (
    <>
      <PageHeader title="Practice" description="Select a song to practice. Melobud evaluates your playing through your microphone in real time." />
      <div className="panel overflow-hidden">
        {loading ? (
          <div className="space-y-px p-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className="skeleton h-16" />
            ))}
          </div>
        ) : error ? (
          <ErrorState error={error} onRetry={() => reload()} />
        ) : !data.results.length ? (
          <EmptyState
            icon={Guitar}
            title="No songs ready to practice"
            action={
              <Button to="/upload" variant="primary" icon={Upload}>
                Upload a song
              </Button>
            }
          >
            Songs will appear here once their analysis is complete.
          </EmptyState>
        ) : (
          <ul className="divide-y divide-line">
            {data.results.map((song) => (
              <li key={song.id}>
                <Link to={`/songs/${song.id}/practice`} className="flex items-center gap-4 px-5 py-4 transition-colors hover:bg-raised/50">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[15px] font-semibold">{song.title}</p>
                    <p className="truncate text-[12.5px] text-ink-3">
                      {[song.artist, formatTime(song.duration), song.last_played_at ? `played ${formatRelative(song.last_played_at)}` : null]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                  </div>
                  <span className="hidden sm:block">
                    <ChordChips chords={song.chords?.simple} max={5} />
                  </span>
                  <Guitar size={18} className="shrink-0 text-ink-3" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  )
}
