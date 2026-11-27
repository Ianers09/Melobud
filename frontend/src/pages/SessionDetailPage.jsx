import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, ArrowRight, CircleCheck, Guitar, Lightbulb, Trash2, TriangleAlert } from 'lucide-react'
import { Button, ConfirmDialog, ErrorState } from '../components/ui'
import { useToast } from '../contexts/ToastContext'
import { useDocumentTitle, useResource } from '../hooks/useResource'
import { practiceApi } from '../services/melobud'
import { evaluateSession } from '../utils/evaluation'
import { formatDateTime, formatDuration, formatTime, MODE_LABEL } from '../utils/format'

const RESULT_STYLE = { correct: 'text-good', incorrect: 'text-bad', missed: 'text-ink-3' }
const RESULT_LABEL = { correct: 'Correct', incorrect: 'Incorrect', missed: 'Missed' }
const TONE = { good: 'text-good', warn: 'text-brass', bad: 'text-bad' }

function Section({ icon: Icon, iconClass, title, children }) {
  return (
    <section className="panel p-5">
      <h2 className="mb-3 flex items-center gap-2 text-[15px] font-bold">
        <Icon size={17} className={iconClass} aria-hidden />
        {title}
      </h2>
      {children}
    </section>
  )
}

function Score({ session, review }) {
  const { correct, incorrect, missed } = session.attempts
  return (
    <section className="panel mb-6 grid gap-px overflow-hidden bg-line sm:grid-cols-[240px_1fr]">
      <div className="bg-surface px-6 py-5">
        <p className="eyebrow">Accuracy</p>
        <p className="tabular mt-1 font-display text-[44px] leading-none font-extrabold">{Math.round(review.accuracy * 100)}%</p>
        <p className={`mt-2 text-[14px] font-bold ${TONE[review.rating.tone]}`}>{review.rating.label}</p>
      </div>
      <div className="flex flex-col justify-center gap-4 bg-surface px-6 py-5">
        <p className="text-[15px] text-ink">{review.rating.text}</p>
        <dl className="tabular flex flex-wrap gap-x-8 gap-y-2 text-[13.5px]">
          {[
            ['Correct', correct, 'text-good'],
            ['Incorrect', incorrect, 'text-bad'],
            ['Missed', missed, 'text-ink-2'],
            ['Duration', formatDuration(session.duration_seconds), 'text-ink'],
          ].map(([label, value, color]) => (
            <div key={label}>
              <dt className="eyebrow">{label}</dt>
              <dd className={`mt-0.5 font-display text-[18px] font-extrabold ${color}`}>{value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  )
}

function ChordBreakdown({ chords }) {
  return (
    <section className="panel overflow-hidden">
      <h2 className="border-b border-line px-5 py-3.5 text-[15px] font-bold">Chord breakdown</h2>
      <ul className="divide-y divide-line">
        {chords.map((c) => (
          <li key={c.chord} className="grid grid-cols-[64px_1fr_auto] items-center gap-4 px-5 py-3">
            <span className="font-display text-[16px] font-extrabold">{c.chord}</span>
            <span className="h-1.5 overflow-hidden rounded-full bg-line-strong" aria-hidden>
              <span
                className={`block h-full rounded-full ${c.accuracy >= 0.8 ? 'bg-good' : c.accuracy >= 0.5 ? 'bg-brass' : 'bg-bad'}`}
                style={{ width: `${Math.round(c.accuracy * 100)}%` }}
              />
            </span>
            <span className="tabular w-[190px] text-right text-[12.5px] text-ink-2">
              <span className="font-semibold text-ink">{Math.round(c.accuracy * 100)}%</span> · {c.correct}/{c.total} correct
              {c.missed ? ` · ${c.missed} missed` : ''}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}

export default function SessionDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const [confirm, setConfirm] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const { data: s, error, loading, reload } = useResource(({ signal }) => practiceApi.session(id, { signal }), [id])
  useDocumentTitle(s ? `${s.song_title}: session review` : 'Session review')

  if (loading) return <div className="skeleton h-72" />
  if (error) return <ErrorState error={error} onRetry={() => reload()} />

  const review = evaluateSession(s)

  const remove = async () => {
    setDeleting(true)
    try {
      await practiceApi.remove(s.id)
      toast.success('The session has been deleted.')
      navigate('/sessions', { replace: true })
    } catch (err) {
      toast.error(err.message)
      setDeleting(false)
    }
  }

  return (
    <>
      <Link to="/sessions" className="mb-5 inline-flex items-center gap-1.5 text-[13px] font-medium text-ink-2 hover:text-ink">
        <ArrowLeft size={15} aria-hidden /> Sessions
      </Link>
      <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className="eyebrow mb-2">
            Session review · {formatDateTime(s.started_at)} · {MODE_LABEL[s.mode]}
          </p>
          <h1 className="text-[28px] leading-tight font-extrabold break-words">{s.song_title}</h1>
          {!s.ended_at && <p className="mt-1 text-[13px] text-ink-3">This session was not finished.</p>}
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

      {!review ? (
        <div className="panel px-5 py-10 text-center text-[14px] text-ink-2">
          No chords were played in this session, so there is nothing to review yet.
        </div>
      ) : (
        <>
          <Score session={s} review={review} />

          <div className="mb-6 grid gap-6 lg:grid-cols-[1.4fr_1fr]">
            <Section icon={TriangleAlert} iconClass="text-brass" title="Areas to improve">
              {review.improvements.length ? (
                <ul className="space-y-4">
                  {review.improvements.map((item) => (
                    <li key={item.title} className="rounded-[10px] border border-line bg-bg/40 p-4">
                      <p className="font-semibold">{item.title}</p>
                      <p className="mt-1 text-[13.5px] text-ink-2">{item.cause}</p>
                      <p className="mt-2 text-[13.5px]">
                        <span className="font-semibold text-brass">How to fix: </span>
                        {item.tip}
                      </p>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[13.5px] text-ink-2">No recurring problems were found in this session.</p>
              )}
            </Section>

            <div className="flex flex-col gap-6">
              <Section icon={CircleCheck} iconClass="text-good" title="Strengths">
                <ul className="list-disc space-y-1.5 pl-5 text-[13.5px] text-ink-2">
                  {review.strengths.map((t) => (
                    <li key={t}>{t}</li>
                  ))}
                </ul>
              </Section>
              <Section icon={Lightbulb} iconClass="text-ink-2" title="Next steps">
                <ol className="space-y-2 text-[13.5px] text-ink-2">
                  {review.next.map((t) => (
                    <li key={t} className="flex gap-2">
                      <ArrowRight size={15} className="mt-0.5 shrink-0 text-ink-3" aria-hidden />
                      {t}
                    </li>
                  ))}
                </ol>
              </Section>
            </div>
          </div>

          <ChordBreakdown chords={review.chords} />

          <details className="panel group mt-6 overflow-hidden">
            <summary className="cursor-pointer list-none px-5 py-3.5 text-[15px] font-bold hover:bg-raised/40">
              Attempt log <span className="font-normal text-ink-3">({s.timeline.length})</span>
            </summary>
            <ol className="max-h-[420px] divide-y divide-line overflow-y-auto border-t border-line">
              {s.timeline.map((t, i) => (
                <li key={i} className="grid grid-cols-[56px_1fr_auto] items-center gap-3 px-5 py-2 text-[13.5px]">
                  <span className="tabular text-ink-3">{formatTime(t.song_time)}</span>
                  <span>
                    <span className="font-display font-extrabold">{t.expected}</span>
                    {t.detected && t.result === 'incorrect' && <span className="text-ink-3"> · detected {t.detected}</span>}
                  </span>
                  <span className={`font-semibold ${RESULT_STYLE[t.result]}`}>{RESULT_LABEL[t.result]}</span>
                </li>
              ))}
            </ol>
          </details>
        </>
      )}

      <ConfirmDialog open={confirm} title="Delete this session?" confirmLabel="Delete session" busy={deleting} onConfirm={remove} onCancel={() => setConfirm(false)}>
        This session and its results will be permanently deleted. This action cannot be undone.
      </ConfirmDialog>
    </>
  )
}
