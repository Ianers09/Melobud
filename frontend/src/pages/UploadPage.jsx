import { useEffect, useRef, useState } from 'react'
import { Check, FileAudio, Guitar, Play, RotateCcw, Upload, X } from 'lucide-react'
import { Alert, Button, ErrorAlert, Field, PageHeader, ProgressBar, Spinner } from '../components/ui'
import { useDocumentTitle } from '../hooks/useResource'
import { songsApi } from '../services/melobud'
import { formatBytes } from '../utils/format'

const MAX_MB = 25

function validateFile(file) {
  if (!file) return 'Please select a file.'
  if (!file.name.toLowerCase().endsWith('.mp3')) return 'Unsupported file type. Please upload an MP3 file.'
  if (file.size > MAX_MB * 1024 * 1024) return `The file exceeds the ${MAX_MB} MB size limit.`
  if (file.size < 1024) return 'The file is too small to contain a song.'
  return null
}

const STEPS = [
  { key: 'uploading', label: 'Uploading' },
  { key: 'uploaded', label: 'Uploaded' },
  { key: 'analyzing', label: 'Analyzing chords and beats' },
  { key: 'done', label: 'Ready to play' },
]

function stepIndex(phase, song) {
  if (phase === 'uploading') return 0
  if (!song) return 1
  if (song.status === 'pending') return 1
  if (song.status === 'processing') return 2
  return 3
}

function Tracker({ phase, progress, song, error }) {
  const current = stepIndex(phase, song)
  const failed = song?.status === 'failed' || (phase === 'error' && !!error)
  return (
    <ol className="space-y-0">
      {STEPS.map((step, i) => {
        const done = i < current || (i === 3 && song?.status === 'completed')
        const active = i === current && !done
        const isFailed = failed && i === Math.max(current, phase === 'error' ? 0 : current)
        return (
          <li key={step.key} className="flex gap-3">
            <div className="flex flex-col items-center">
              <span
                className={`flex h-6 w-6 items-center justify-center rounded-full border text-[11px] ${
                  isFailed
                    ? 'border-bad bg-bad-soft text-bad'
                    : done
                      ? 'border-good bg-good-soft text-good'
                      : active
                        ? 'border-brass text-brass'
                        : 'border-line-strong text-ink-3'
                }`}
              >
                {isFailed ? <X size={13} /> : done ? <Check size={13} /> : active ? <Spinner size={12} /> : i + 1}
              </span>
              {i < STEPS.length - 1 && <span className={`my-1 w-px flex-1 ${done ? 'bg-good/50' : 'bg-line-strong'}`} />}
            </div>
            <div className="min-w-0 flex-1 pb-5">
              <p className={`text-[14px] font-semibold ${active || done ? 'text-ink' : 'text-ink-3'}`}>
                {isFailed && i === 3 ? 'Analysis failed' : step.label}
              </p>
              {active && step.key === 'uploading' && (
                <div className="mt-2 max-w-xs">
                  <ProgressBar value={progress} label="Upload progress" />
                  <p className="tabular mt-1 text-[12px] text-ink-3">{Math.round(progress * 100)}%</p>
                </div>
              )}
              {active && step.key === 'analyzing' && song && (
                <div className="mt-2 max-w-xs">
                  <ProgressBar value={(song.progress || 0) / 100} label="Analysis progress" />
                  <p className="mt-1 text-[12px] text-ink-3">{song.status_message || 'Working…'}</p>
                </div>
              )}
              {active && step.key === 'uploaded' && <p className="mt-0.5 text-[12.5px] text-ink-3">Queued for analysis…</p>}
            </div>
          </li>
        )
      })}
    </ol>
  )
}

export default function UploadPage() {
  useDocumentTitle('Upload')
  const inputRef = useRef(null)
  const [file, setFile] = useState(null)
  const [title, setTitle] = useState('')
  const [artist, setArtist] = useState('')
  const [fileError, setFileError] = useState(null)
  const [dragging, setDragging] = useState(false)
  const [phase, setPhase] = useState('select') // select | uploading | tracking | error
  const [progress, setProgress] = useState(0)
  const [song, setSong] = useState(null)
  const [error, setError] = useState(null)

  // Poll the real job status until it finishes.
  useEffect(() => {
    if (phase !== 'tracking' || !song || song.status === 'completed' || song.status === 'failed') return undefined
    const t = setTimeout(async () => {
      try {
        setSong(await songsApi.get(song.id))
      } catch (err) {
        setError(err)
      }
    }, 2000)
    return () => clearTimeout(t)
  }, [phase, song])

  const pick = (f) => {
    const err = validateFile(f)
    setFileError(err)
    if (err) return
    setFile(f)
  }

  const submit = async (e) => {
    e.preventDefault()
    const err = validateFile(file)
    if (err) return setFileError(err)
    setPhase('uploading')
    setProgress(0)
    setError(null)
    try {
      const created = await songsApi.upload(file, { title: title.trim(), artist: artist.trim() }, setProgress)
      setSong(created)
      setPhase('tracking')
    } catch (err2) {
      setError(err2)
      setPhase('error')
    }
  }

  const reset = () => {
    setFile(null)
    setTitle('')
    setArtist('')
    setSong(null)
    setError(null)
    setPhase('select')
    setProgress(0)
    if (inputRef.current) inputRef.current.value = ''
  }

  if (phase !== 'select') {
    const finished = song?.status === 'completed'
    const failed = song?.status === 'failed' || phase === 'error'
    return (
      <div className="mx-auto w-full max-w-3xl">
        <PageHeader title="Upload a song" description="Your song is being uploaded and analyzed." />
        <div className="panel p-6">
          <div className="mb-6 flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-[8px] bg-raised text-ink-2">
              <FileAudio size={18} aria-hidden />
            </span>
            <div className="min-w-0">
              <p className="truncate font-semibold">{song?.title || title || file?.name}</p>
              <p className="text-[12.5px] text-ink-3">{formatBytes(file?.size)}</p>
            </div>
          </div>
          <Tracker phase={phase} progress={progress} song={song} error={error} />
          {phase === 'error' && <ErrorAlert error={error} />}
          {song?.status === 'failed' && (
            <Alert title="Analysis failed">{song.status_message || 'The analysis could not be completed. Please try again.'}</Alert>
          )}
          {error && phase === 'tracking' && <Alert tone="warn" title="Connection interrupted">The connection to the server was interrupted while checking progress. Please refresh the page.</Alert>}
          <div className="mt-6 flex flex-wrap gap-2">
            {finished && (
              <>
                <Button to={`/songs/${song.id}/play`} variant="primary" icon={Play}>
                  Play with chords
                </Button>
                <Button to={`/songs/${song.id}/practice`} icon={Guitar}>
                  Practice
                </Button>
              </>
            )}
            {song?.status === 'failed' && (
              <Button
                icon={RotateCcw}
                onClick={async () => {
                  try {
                    setSong(await songsApi.reanalyze(song.id))
                  } catch (err) {
                    setError(err)
                  }
                }}
              >
                Try analysis again
              </Button>
            )}
            {song && !finished && <Button to={`/songs/${song.id}`}>View song</Button>}
            {(finished || failed) && (
              <Button variant="ghost" icon={Upload} onClick={reset}>
                Upload another
              </Button>
            )}
          </div>
          {song && !finished && !failed && (
            <p className="mt-4 text-[12.5px] text-ink-3">You may leave this page. Analysis will continue in the background.</p>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-3xl">
      <PageHeader title="Upload a song" description="Supported format: MP3, up to 25 MB. Analysis typically completes within one minute." />
      <form autoComplete="off" onSubmit={submit} className="grid gap-6">
        <div
          onDragOver={(e) => {
            e.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragging(false)
            pick(e.dataTransfer.files?.[0])
          }}
          className={`rounded-[12px] border border-dashed transition-colors ${
            dragging ? 'border-brass bg-brass-soft' : fileError ? 'border-bad/60' : 'border-line-strong bg-surface'
          }`}
        >
          {file ? (
            <div className="flex items-center gap-4 p-5">
              <span className="flex h-11 w-11 items-center justify-center rounded-[8px] bg-raised text-brass">
                <FileAudio size={20} aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{file.name}</p>
                <p className="text-[12.5px] text-ink-3">{formatBytes(file.size)}</p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => inputRef.current?.click()}>
                Change
              </Button>
            </div>
          ) : (
            <button type="button" onClick={() => inputRef.current?.click()} className="flex w-full flex-col items-center px-6 py-14 text-center">
              <span className="mb-4 flex h-11 w-11 items-center justify-center rounded-[10px] border border-line-strong bg-raised text-ink-2">
                <Upload size={20} aria-hidden />
              </span>
              <span className="text-[15px] font-semibold">Drag and drop an MP3 file, or click to browse</span>
              <span className="mt-1 text-[13px] text-ink-3">Duration between 5 seconds and 20 minutes</span>
            </button>
          )}
          <input
            ref={inputRef}
            type="file"
            accept=".mp3,audio/mpeg"
            className="sr-only"
            aria-label="Choose an MP3 file"
            onChange={(e) => pick(e.target.files?.[0])}
          />
        </div>
        {fileError && <Alert title="File cannot be uploaded">{fileError}</Alert>}

        {file && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} placeholder="Optional" hint="If left blank, the title from the file’s metadata or the file name is used." />
            <Field label="Artist" value={artist} onChange={(e) => setArtist(e.target.value)} maxLength={200} placeholder="Optional" />
          </div>
        )}

        <div className="flex items-center gap-3">
          <Button type="submit" variant="primary" size="lg" icon={Upload} disabled={!file}>
            Upload and analyze
          </Button>
          {file && (
            <Button variant="ghost" onClick={reset}>
              Clear
            </Button>
          )}
        </div>
        <p className="text-[12.5px] text-ink-3">
          Only upload music you have the right to use. Uploaded files are stored privately and are accessible only to you.
        </p>
      </form>
    </div>
  )
}
