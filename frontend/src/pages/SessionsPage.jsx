import { Link } from 'react-router-dom'
import { ChevronRight, ClipboardList } from 'lucide-react'
import { Button, EmptyState, ErrorState, PageHeader } from '../components/ui'
import { useDocumentTitle, useResource } from '../hooks/useResource'
import { practiceApi } from '../services/melobud'
import { accuracyOf, formatDateTime, formatDuration, MODE_LABEL } from '../utils/format'

export default function SessionsPage() {
  useDocumentTitle('Sessions')
  const { data, error, loading, reload } = useResource(({ signal }) => practiceApi.sessions({ signal }), [])

  return (
    <>
      <PageHeader title="Sessions" description="Every practice session, with a review of your strengths, mistakes, and how to improve." />
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
            icon={ClipboardList}
            title="No sessions yet"
            action={
              <Button to="/songs" variant="primary">
                Choose a song
              </Button>
            }
          >
            Practice a song and your session will appear here with a review.
          </EmptyState>
        ) : (
          <ul className="divide-y divide-line">
            {data.results.map((s) => (
              <li key={s.id}>
                <Link to={`/sessions/${s.id}`} className="flex items-center gap-4 px-5 py-4 transition-colors hover:bg-raised/50">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-semibold">
                      {s.song_title}
                      {!s.song_available && <span className="ml-2 text-[12px] font-normal text-ink-3">(song deleted)</span>}
                    </span>
                    <span className="block truncate text-[12.5px] text-ink-3">
                      {formatDateTime(s.started_at)} · {MODE_LABEL[s.mode]} · {formatDuration(s.duration_seconds)}
                    </span>
                  </span>
                  <span className="tabular hidden text-right text-[12.5px] text-ink-3 sm:block">
                    <span className="text-good">{s.attempts.correct}</span> correct · <span className="text-bad">{s.attempts.incorrect}</span> incorrect · {s.attempts.missed} missed
                  </span>
                  <span className="tabular w-20 text-right text-[15px] font-bold">{accuracyOf(s.attempts) == null ? <span className="text-[12.5px] font-normal text-ink-3">Not scored</span> : `${accuracyOf(s.attempts)}%`}</span>
                  <ChevronRight size={16} className="text-ink-3" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  )
}
