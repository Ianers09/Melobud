import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Guitar, Trash2 } from 'lucide-react'
import ResultCounts from '../components/ResultCounts'
import { Button, ConfirmDialog, ErrorState } from '../components/ui'
import { useToast } from '../contexts/ToastContext'
import { useDocumentTitle, useResource } from '../hooks/useResource'
import { practiceApi } from '../services/melobud'
import { formatDateTime, formatDuration, formatTime } from '../utils/format'

const RESULT_STYLE = { correct: 'text-good', incorrect: 'text-bad', missed: 'text-ink-3' }
const RESULT_LABEL = { correct: 'Correct', incorrect: 'Incorrect', missed: 'Missed' }

export default function SessionDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const [confirm, setConfirm] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const { data: s, error, loading, reload } = useResource(({ signal }) => practiceApi.session(id, { signal }), [id])
  useDocumentTitle(s ? `${s.song_title} session` : 'Session')

  if (loading) return <div className="skeleton h-72" />
  if (error) return <ErrorState error={error} onRetry={() => reload()} />

  const remove = async () => {
    setDeleting(true)
    try {
      await practiceApi.remove(s.id)
      toast.success('The session has been deleted.')
      navigate('/history', { replace: true })
    } catch (err) {
      toast.error(err.message)
      setDeleting(false)
    }
  }

  return (
    <>
      <Link to="/history" className="mb-5 inline-flex items-center gap-1.5 text-[13px] font-medium text-ink-2 hover:text-ink">
        <ArrowLeft size={15} aria-hidden /> History
      </Link>
      <header className="mb-7 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className="eyebrow mb-2">{formatDateTime(s.started_at)}</p>
          <h1 className="text-[28px] leading-tight font-extrabold break-words">{s.song_title}</h1>
          <p className="mt-1 text-ink-2">
            {s.mode === 'step' ? 'Step-by-step' : 'Play along'} · {formatDuration(s.duration_seconds)}
            {!s.ended_at && ' · not finished'}
          </p>
        </div>
        <div className="flex gap-2">
          {s.song_available && (
            <Button to={`/songs/${s.song_id}/practice`} variant="primary" icon={Guitar}>
              Practice again
            </Button>
          )}
          <Button variant="ghost" icon={Trash2} aria-label="Delete session" title="Delete session" onClick={() => setConfirm(true)} />
        </div>
      </header>

      <div className="panel mb-6 p-5">
        <ResultCounts attempts={s.attempts} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="panel overflow-hidden">
          <h2 className="border-b border-line px-5 py-3.5 text-[15px] font-bold">By chord</h2>
          {s.chords.length ? (
            <>
            <div className="grid grid-cols-[1fr_72px_72px_72px] gap-2 border-b border-line px-5 py-2.5">
              {['Chord', 'Correct', 'Incorrect', 'Missed'].map((h) => (
                <span key={h} className="eyebrow text-right first:text-left">
                  {h}
                </span>
              ))}
            </div>
            <ul className="divide-y divide-line">
              {s.chords.map((c) => (
                <li key={c.chord} className="tabular grid grid-cols-[1fr_72px_72px_72px] gap-2 px-5 py-2.5 text-right text-[13.5px]">
                  <span className="text-left font-display font-extrabold">{c.chord}</span>
                  <span className="text-good">{c.correct}</span>
                  <span className="text-bad">{c.incorrect}</span>
                  <span className="text-ink-2">{c.missed}</span>
                </li>
              ))}
            </ul>
            </>
          ) : (
            <p className="px-5 py-8 text-[13.5px] text-ink-3">No attempts were recorded in this session.</p>
          )}
        </section>
        <section className="panel overflow-hidden">
          <h2 className="border-b border-line px-5 py-3.5 text-[15px] font-bold">All attempts</h2>
          {s.timeline.length ? (
            <ol className="max-h-[420px] divide-y divide-line overflow-y-auto">
              {s.timeline.map((t, i) => (
                <li key={i} className="grid grid-cols-[56px_1fr_auto] items-center gap-3 px-5 py-2 text-[13.5px]">
                  <span className="tabular text-ink-3">{formatTime(t.song_time)}</span>
                  <span>
                    Expected <span className="font-display font-extrabold">{t.expected}</span>
                    {t.detected && t.result === 'incorrect' && <span className="text-ink-3"> · detected {t.detected}</span>}
                  </span>
                  <span className={`font-semibold ${RESULT_STYLE[t.result]}`}>{RESULT_LABEL[t.result]}</span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="px-5 py-8 text-[13.5px] text-ink-3">No attempts to display.</p>
          )}
        </section>
      </div>

      <ConfirmDialog open={confirm} title="Delete this session?" confirmLabel="Delete session" busy={deleting} onConfirm={remove} onCancel={() => setConfirm(false)}>
        This practice session and its results will be permanently removed from your history. This action cannot be undone.
      </ConfirmDialog>
    </>
  )
}
