import { Link } from 'react-router-dom'
import { ChevronRight, History } from 'lucide-react'
import ResultCounts from '../components/ResultCounts'
import { Button, EmptyState, ErrorState, PageHeader } from '../components/ui'
import { useDocumentTitle, useResource } from '../hooks/useResource'
import { practiceApi } from '../services/melobud'
import { formatDateTime, formatDuration } from '../utils/format'

const MODE_LABEL = { step: 'Step-by-step', play_along: 'Play along' }

export default function HistoryPage() {
  useDocumentTitle('History')
  const { data, error, loading, reload } = useResource(({ signal }) => practiceApi.sessions({ signal }), [])

  return (
    <>
      <PageHeader title="Practice history" description="A record of your practice sessions, most recent first." />
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
            icon={History}
            title="No practice sessions yet"
            action={
              <Button to="/practice" variant="primary">
                Start practicing
              </Button>
            }
          >
            Completed practice sessions and their results will appear here.
          </EmptyState>
        ) : (
          <ul className="divide-y divide-line">
            {data.results.map((s) => (
              <li key={s.id}>
                <Link
                  to={`/history/${s.id}`}
                  className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-2 px-5 py-4 transition-colors hover:bg-raised/50 md:grid-cols-[minmax(0,1.6fr)_120px_minmax(0,1.6fr)_auto]"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-[14px] font-semibold">
                      {s.song_title}
                      {!s.song_available && <span className="ml-2 text-[12px] font-normal text-ink-3">(song removed)</span>}
                    </span>
                    <span className="block truncate text-[12.5px] text-ink-3">
                      {formatDateTime(s.started_at)} · {MODE_LABEL[s.mode]}
                      <span className="md:hidden"> · {formatDuration(s.duration_seconds)}</span>
                    </span>
                  </span>
                  <span className="tabular hidden text-[13px] text-ink-2 md:block">{formatDuration(s.duration_seconds)}</span>
                  <span className="order-last col-span-2 md:order-none md:col-span-1">
                    <ResultCounts attempts={s.attempts} />
                  </span>
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
