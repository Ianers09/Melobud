import { Link } from 'react-router-dom'
import { ArrowRight, Guitar, Music, Play, Upload } from 'lucide-react'
import { Button, ChordChips, EmptyState, ErrorState, StatusBadge } from '../components/ui'
import { useAuth } from '../contexts/AuthContext'
import { useDocumentTitle, useResource } from '../hooks/useResource'
import { practiceApi } from '../services/melobud'
import { formatDuration, formatRelative, formatTime, greeting, nameFromUser } from '../utils/format'

function Stat({ label, value, hint }) {
  return (
    <div className="px-5 py-4">
      <p className="eyebrow">{label}</p>
      <p className="tabular mt-1.5 font-display text-[24px] font-extrabold tracking-[-0.02em]">{value}</p>
      {hint && <p className="mt-0.5 text-[12.5px] text-ink-3">{hint}</p>}
    </div>
  )
}

function Activity({ days }) {
  const max = Math.max(...days.map((d) => d.minutes), 1)
  const any = days.some((d) => d.minutes > 0)
  return (
    <section className="panel p-5">
      <div className="mb-4 flex items-baseline justify-between">
        <h2 className="text-[15px] font-bold">Practice activity</h2>
        <span className="text-[12.5px] text-ink-3">Minutes per day, last 14 days</span>
      </div>
      {any ? (
        <div className="flex h-28 items-end gap-1.5" role="img" aria-label="Minutes practiced per day over the last 14 days">
          {days.map((d) => {
            const date = new Date(d.date + 'T00:00:00')
            return (
              <div key={d.date} className="group flex h-full flex-1 flex-col items-center justify-end gap-1.5">
                <div
                  className={`w-full rounded-[3px] ${d.minutes ? 'bg-brass/80 group-hover:bg-brass' : 'bg-line'}`}
                  style={{ height: d.minutes ? `${Math.max(6, (d.minutes / max) * 100)}%` : '3px' }}
                  title={`${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}: ${d.minutes} min`}
                />
                <span className="text-[10.5px] text-ink-3">{date.toLocaleDateString(undefined, { weekday: 'narrow' })}</span>
              </div>
            )
          })}
        </div>
      ) : (
        <p className="py-8 text-center text-[13.5px] text-ink-3">No practice sessions in the last 14 days.</p>
      )}
    </section>
  )
}

function SongRow({ song, meta }) {
  return (
    <li>
      <Link to={`/songs/${song.id}`} className="flex items-center gap-4 px-5 py-3 transition-colors hover:bg-raised/60">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] bg-raised text-ink-3">
          <Music size={16} aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px] font-semibold">{song.title}</span>
          <span className="block truncate text-[12.5px] text-ink-3">{meta}</span>
        </span>
        {song.status === 'completed' ? (
          <span className="hidden sm:block">
            <ChordChips chords={song.chords?.simple} max={4} />
          </span>
        ) : (
          <StatusBadge status={song.status} progress={song.progress} />
        )}
      </Link>
    </li>
  )
}

export default function DashboardPage() {
  useDocumentTitle('Home')
  const { user } = useAuth()
  const { data, error, loading, reload } = useResource(({ signal }) => practiceApi.dashboard({ signal }), [], {
    pollMs: (d) => (d?.songs?.processing ? 4000 : null),
  })

  const header = (
    <header className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <p className="eyebrow mb-2">{new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</p>
        <h1 className="text-[28px] leading-tight font-extrabold">
          {greeting()}, {nameFromUser(user)}.
        </h1>
      </div>
    </header>
  )

  if (loading) {
    return (
      <>
        {header}
        <div className="skeleton mb-6 h-24" />
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="skeleton h-64" />
          <div className="skeleton h-64" />
        </div>
      </>
    )
  }
  if (error) {
    return (
      <>
        {header}
        <ErrorState error={error} onRetry={() => reload()} />
      </>
    )
  }

  const { songs, recent_uploads: uploads, recently_practiced: practiced, activity, totals } = data
  const resume = practiced.find((p) => p.song?.status === 'completed')

  if (!songs.total) {
    return (
      <>
        {header}
        <div className="panel">
          <EmptyState
            icon={Music}
            title="Upload your first song"
            action={
              <Button to="/upload" variant="primary" icon={Upload}>
                Upload an MP3
              </Button>
            }
          >
            Melobud analyzes the recording, identifies its chords and beats, and synchronizes them with playback so you can play along.
          </EmptyState>
        </div>
      </>
    )
  }

  return (
    <>
      {header}

      {resume && (
        <section className="panel mb-6 flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
          <div className="min-w-0 flex-1">
            <p className="eyebrow mb-1.5">Continue practice</p>
            <p className="truncate font-display text-[20px] font-extrabold tracking-[-0.02em]">{resume.song.title}</p>
            <p className="mt-0.5 truncate text-[13px] text-ink-3">
              {resume.song.artist ? `${resume.song.artist} · ` : ''}last practiced {formatRelative(resume.session.started_at)}
            </p>
          </div>
          <div className="flex gap-2">
            <Button to={`/songs/${resume.song.id}/play`} icon={Play}>
              Play
            </Button>
            <Button to={`/songs/${resume.song.id}/practice`} variant="primary" icon={Guitar}>
              Practice
            </Button>
          </div>
        </section>
      )}

      <section className="panel mb-6 grid grid-cols-3 divide-x divide-line">
        <Stat label="Songs" value={songs.total} hint={songs.processing ? `${songs.processing} in analysis` : null} />
        <Stat label="Practice sessions" value={totals.sessions} />
        <Stat label="Time practiced" value={totals.practice_seconds ? formatDuration(totals.practice_seconds) : '0 min'} />
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="panel overflow-hidden">
          <div className="flex items-center justify-between px-5 pt-4 pb-2">
            <h2 className="text-[15px] font-bold">Recently uploaded</h2>
            <Link to="/library" className="flex items-center gap-1 text-[13px] font-medium text-ink-2 hover:text-ink">
              Library <ArrowRight size={14} aria-hidden />
            </Link>
          </div>
          <ul className="pb-2">
            {uploads.map((s) => (
              <SongRow key={s.id} song={s} meta={[s.artist, formatTime(s.duration), formatRelative(s.created_at)].filter(Boolean).join(' · ')} />
            ))}
          </ul>
        </section>

        <Activity days={activity} />
      </div>
    </>
  )
}
