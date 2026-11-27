import { useEffect, useRef, useState } from 'react'
import { FileAudio, Upload } from 'lucide-react'
import { songsApi } from '../services/melobud'
import { formatBytes } from '../utils/format'
import { Alert, Button, ErrorAlert, Field, ProgressBar } from './ui'

const MAX_MB = 25

function validateFile(file) {
  if (!file) return 'Select an MP3 file.'
  if (!file.name.toLowerCase().endsWith('.mp3')) return 'Unsupported file type. Upload an MP3 file.'
  if (file.size > MAX_MB * 1024 * 1024) return `The file exceeds the ${MAX_MB} MB limit.`
  if (file.size < 1024) return 'The file is too small to contain a song.'
  return null
}

/** Upload an MP3. Analysis then runs in the background; progress shows in the song list. */
export default function AddSongDialog({ open, onClose, onAdded }) {
  const ref = useRef(null)
  const inputRef = useRef(null)
  const [file, setFile] = useState(null)
  const [title, setTitle] = useState('')
  const [artist, setArtist] = useState('')
  const [fileError, setFileError] = useState(null)
  const [dragging, setDragging] = useState(false)
  const [progress, setProgress] = useState(null) // null = not uploading
  const [error, setError] = useState(null)
  const uploading = progress !== null

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  const reset = () => {
    setFile(null)
    setTitle('')
    setArtist('')
    setFileError(null)
    setError(null)
    setProgress(null)
    if (inputRef.current) inputRef.current.value = ''
  }
  const close = () => {
    if (uploading) return
    reset()
    onClose()
  }
  const pick = (f) => {
    const err = validateFile(f)
    setFileError(err)
    if (!err) setFile(f)
  }
  const submit = async (e) => {
    e.preventDefault()
    const err = validateFile(file)
    if (err) return setFileError(err)
    setError(null)
    setProgress(0)
    try {
      const song = await songsApi.upload(file, { title: title.trim(), artist: artist.trim() }, setProgress)
      reset()
      onAdded(song)
    } catch (err2) {
      setError(err2)
      setProgress(null)
    }
  }

  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault()
        close()
      }}
      className="m-auto w-[calc(100%-32px)] max-w-lg rounded-[12px] border border-line-strong bg-surface p-0 text-ink shadow-[0_24px_64px_-16px_rgb(0_0_0/0.7)]"
    >
      <form noValidate autoComplete="off" onSubmit={submit}>
        <div className="border-b border-line px-6 py-4">
          <h2 className="text-[18px] font-bold">Add a song</h2>
          <p className="mt-1 text-[13px] text-ink-3">MP3, up to {MAX_MB} MB. Chords and beats are analyzed automatically, usually within a minute.</p>
        </div>
        <div className="space-y-4 px-6 py-5">
          <div
            onDragOver={(e) => {
              e.preventDefault()
              setDragging(true)
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault()
              setDragging(false)
              if (!uploading) pick(e.dataTransfer.files?.[0])
            }}
            className={`rounded-[10px] border border-dashed transition-colors ${dragging ? 'border-brass bg-brass-soft' : fileError ? 'border-bad/60' : 'border-line-strong bg-bg/40'}`}
          >
            {file ? (
              <div className="flex items-center gap-3 p-4">
                <span className="flex h-10 w-10 items-center justify-center rounded-[8px] bg-raised text-brass">
                  <FileAudio size={18} aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-semibold">{file.name}</p>
                  <p className="text-[12.5px] text-ink-3">{formatBytes(file.size)}</p>
                </div>
                {!uploading && (
                  <Button variant="ghost" size="sm" onClick={() => inputRef.current?.click()}>
                    Change
                  </Button>
                )}
              </div>
            ) : (
              <button type="button" onClick={() => inputRef.current?.click()} className="flex w-full flex-col items-center px-6 py-10 text-center">
                <Upload size={20} className="mb-3 text-ink-2" aria-hidden />
                <span className="text-[14px] font-semibold">Drop an MP3 file here, or click to browse</span>
              </button>
            )}
            <input ref={inputRef} type="file" accept=".mp3,audio/mpeg" className="sr-only" aria-label="Choose an MP3 file" onChange={(e) => pick(e.target.files?.[0])} />
          </div>
          {fileError && <Alert>{fileError}</Alert>}
          {file && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} placeholder="From file if blank" disabled={uploading} />
              <Field label="Artist" value={artist} onChange={(e) => setArtist(e.target.value)} maxLength={200} placeholder="Optional" disabled={uploading} />
            </div>
          )}
          {uploading && (
            <div>
              <ProgressBar value={progress} label="Upload progress" />
              <p className="tabular mt-1 text-[12px] text-ink-3">Uploading… {Math.round(progress * 100)}%</p>
            </div>
          )}
          {error && <ErrorAlert error={error} />}
          <p className="text-[12px] text-ink-3">Only upload music you have the right to use. Files are private to your account.</p>
        </div>
        <div className="flex justify-end gap-2 border-t border-line px-6 py-4">
          <Button variant="ghost" onClick={close} disabled={uploading}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" icon={Upload} loading={uploading} disabled={!file}>
            Upload
          </Button>
        </div>
      </form>
    </dialog>
  )
}
