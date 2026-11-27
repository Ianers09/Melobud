import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Guitar, Pencil, Play, RotateCcw, Trash2 } from 'lucide-react'
import { Alert, Button, ChordChips, ConfirmDialog, ErrorAlert, ErrorState, Field, ProgressBar, StatusBadge } from '../components/ui'
import { useToast } from '../contexts/ToastContext'
import { useDocumentTitle, useResource } from '../hooks/useResource'
import { songsApi } from '../services/melobud'
import { formatDate, formatTime } from '../utils/format'

function Meta({ label, children }) {
  return (
    <div className="px-5 py-3.5">
      <dt className="eyebrow">{label}</dt>
      <dd className="mt-1 text-[14px] font-medium">{children}</dd>
    </div>
  )
}

export default function SongDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState({ title: '', artist: '' })
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [actionError, setActionError] = useState(null)

  const { data: song, setData, error, loading, reload } = useResource(({ signal }) => songsApi.get(id, { signal }), [id], {
    pollMs: (s) => (s && (s.status === 'pending' || s.status === 'processing') ? 2500 : null),
  })
  useDocumentTitle(song?.title || 'Song')

  if (loading) return <div className="skeleton h-72" />
  if (error) return <ErrorState error={error} onRetry={() => reload()} />

  const a = song.analysis
  const ready = song.status === 'completed' && a

  const save = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      const updated = await songsApi.update(song.id, { title: draft.title, artist: draft.artist })
      setData((s) => ({ ...s, ...updated }))
      setEditing(false)
    } catch (err) {
      toast.error(err.fieldError?.('title') || err.message)
    } finally {
      setSaving(false)
    }
  }

  const reanalyze = async () => {
    setActionError(null)
    try {
      const updated = await songsApi.reanalyze(song.id)
      setData((s) => ({ ...s, ...updated, analysis: null }))
    } catch (err) {
      setActionError(err)
    }
  }

  const remove = async () => {
    setDeleting(true)
    try {
      await songsApi.remove(song.id)
      toast.success(`“${song.title}” has been deleted.`)
      navigate('/songs', { replace: true })
    } catch (err) {
      toast.error(err.message)
      setDeleting(false)
    }
  }

  return (
    <>
      <Link to="/songs" className="mb-5 inline-flex items-center gap-1.5 text-[13px] font-medium text-ink-2 hover:text-ink">
        <ArrowLeft size={15} aria-hidden /> Songs
      </Link>

      {editing ? (
        <form autoComplete="off" onSubmit={save} className="panel mb-7 grid gap-4 p-5 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <Field label="Title" value={draft.title} onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))} maxLength={200} required autoFocus />
          <Field label="Artist" value={draft.artist} onChange={(e) => setDraft((d) => ({ ...d, artist: e.target.value }))} maxLength={200} />
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={saving}>
              Save
            </Button>
          </div>
        </form>
      ) : (
        <header className="mb-7 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <div className="mb-2 flex items-center gap-2">
              <StatusBadge status={song.status} progress={song.progress} />
            </div>
            <h1 className="text-[28px] leading-tight font-extrabold break-words">{song.title}</h1>
            {song.artist && <p className="mt-1 text-[14px] text-ink-2">{song.artist}</p>}
          </div>
          <div className="flex flex-wrap gap-2">
            {ready && (
              <>
                <Button to={`/songs/${song.id}/play`} variant="primary" icon={Play}>
                  Play
                </Button>
                <Button to={`/songs/${song.id}/practice`} icon={Guitar}>
                  Practice
                </Button>
              </>
            )}
            <Button
              variant="ghost"
              icon={Pencil}
              aria-label="Rename"
              title="Rename"
              onClick={() => {
                setDraft({ title: song.title, artist: song.artist })
                setEditing(true)
              }}
            />
            {(song.status === 'completed' || song.status === 'failed') && (
              <Button variant="ghost" icon={RotateCcw} aria-label="Re-analyze" title="Re-analyze" onClick={reanalyze} />
            )}
            <Button variant="ghost" icon={Trash2} aria-label="Delete song" title="Delete" onClick={() => setConfirmDelete(true)} />
          </div>
        </header>
      )}

      {actionError && (
        <div className="mb-5">
          <ErrorAlert error={actionError} />
        </div>
      )}

      {(song.status === 'pending' || song.status === 'processing') && (
        <div className="panel mb-6 p-5">
          <p className="mb-3 text-[14px] font-semibold">{song.status === 'pending' ? 'Queued for analysis…' : song.status_message || 'Analyzing…'}</p>
          <ProgressBar value={(song.progress || 0) / 100} label="Analysis progress" />
        </div>
      )}
      {song.status === 'failed' && (
        <div className="mb-6">
          <Alert
            title="Analysis failed"
            action={
              <button type="button" onClick={reanalyze} className="font-semibold text-ink underline underline-offset-2 hover:text-brass">
                Retry analysis
              </button>
            }
          >
            {song.status_message || 'The analysis could not be completed. Re-analyze to try again.'}
          </Alert>
        </div>
      )}

      <dl className="panel mb-6 grid grid-cols-2 sm:grid-cols-4">
        <Meta label="Length">
          <span className="tabular">{formatTime(song.duration)}</span>
        </Meta>
        <Meta label="Key">{a?.key || '—'}</Meta>
        <Meta label="Tempo">{a?.tempo_bpm ? <span className="tabular">{Math.round(a.tempo_bpm)} BPM</span> : '—'}</Meta>
        <Meta label="Added">{formatDate(song.created_at)}</Meta>
      </dl>

      {ready && (
        <section className="panel p-5">
          <h2 className="mb-3 text-[15px] font-bold">Chords used</h2>
          <ChordChips chords={a.summary?.simple} max={30} />
        </section>
      )}

      <ConfirmDialog open={confirmDelete} title="Delete this song?" confirmLabel="Delete song" busy={deleting} onConfirm={remove} onCancel={() => setConfirmDelete(false)}>
        “{song.title}” and its chord analysis will be permanently deleted. Your sessions for this song are kept. This action cannot be undone.
      </ConfirmDialog>
    </>
  )
}
