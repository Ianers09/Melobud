import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Guitar } from 'lucide-react'
import { BeatCounter, ChordStage, PlaybackOptions, TimelineStrip, Transport } from '../components/player'
import { Alert, Button, ErrorState } from '../components/ui'
import { useAuth } from '../contexts/AuthContext'
import { useAudioPlayer } from '../hooks/useAudioPlayer'
import { useMetronome } from '../hooks/useMetronome'
import { usePlayerKeys } from '../hooks/usePlayerKeys'
import { useDocumentTitle, useResource } from '../hooks/useResource'
import { songsApi } from '../services/melobud'
import { alignToBeats, barStarts, extendBeats, buildBars, buildRows, buildTimeline, findIndexAt, rowAt } from '../utils/timeline'

export default function PlayerPage() {
  const { id } = useParams()
  const [params] = useSearchParams()
  const { preferences } = useAuth()
  const { data: song, error, loading, reload } = useResource(({ signal }) => songsApi.get(id, { signal }), [id])
  useDocumentTitle(song ? `${song.title} — Player` : 'Player')

  const ready = song?.status === 'completed' && song.analysis
  const player = useAudioPlayer(ready ? songsApi.audioUrl(id) : null)
  const timeline = useMemo(() => alignToBeats(buildTimeline(song?.analysis?.segments), song?.analysis?.beats), [song])
  const grid = useMemo(() => extendBeats(song?.analysis?.beats), [song])
  const bars = useMemo(
    () => buildBars(grid, song?.analysis?.downbeats, timeline.map((seg) => seg.start)),
    [grid, song, timeline],
  )
  const rowData = useMemo(() => buildRows(timeline, grid, bars), [timeline, grid, bars])
  const accents = useMemo(() => barStarts(bars), [bars])
  const index = findIndexAt(timeline, player.time)
  const row = song?.analysis ? rowAt(rowData, grid, player.time) : null
  const [metronome, setMetronome] = useState(false)
  useMetronome({ player, beats: grid, accents, enabled: metronome })

  // Start at ?t= (from the analysis page) once audio is ready.
  const startedAt = useRef(false)
  useEffect(() => {
    if (player.ready && !startedAt.current) {
      startedAt.current = true
      const t = Number(params.get('t'))
      if (t > 0) player.seek(t)
    }
  }, [player, params])

  // Record that the song was played (once per visit).
  const marked = useRef(false)
  useEffect(() => {
    if (player.playing && !marked.current) {
      marked.current = true
      songsApi.markPlayed(id).catch(() => {})
    }
  }, [player.playing, id])

  const prevChord = useCallback(() => {
    const i = findIndexAt(timeline, player.getTime())
    const seg = timeline[i]
    // Like a CD player: restart the chord if we're >1s in, otherwise go back one.
    if (seg && player.getTime() - seg.start > 1) return player.seek(seg.start + 0.01)
    const target = timeline[Math.max(0, i - 1)]
    if (target) player.seek(target.start + 0.01)
  }, [timeline, player])
  const nextChord = useCallback(() => {
    const i = findIndexAt(timeline, player.getTime())
    const target = timeline[i + 1]
    if (target) player.seek(target.start + 0.01)
  }, [timeline, player])
  usePlayerKeys(player, { onPrevChord: prevChord, onNextChord: nextChord })

  if (loading) return <div className="mx-auto max-w-5xl px-6 pt-10"><div className="skeleton h-96" /></div>
  if (error) return <ErrorState error={error} onRetry={() => reload()} />
  if (!ready) {
    return (
      <div className="mx-auto max-w-xl px-6 pt-16">
        <Alert tone="info">This song is not ready for playback. Analysis must be completed first.</Alert>
        <Button to={`/songs/${id}`} className="mt-4">
          Back to song
        </Button>
      </div>
    )
  }

  const a = song.analysis
  return (
    <div className="flex min-h-[calc(100dvh-56px)] flex-col md:min-h-dvh">
      <header className="flex items-center gap-3 border-b border-line px-4 py-3 sm:px-6">
        <Button to={`/songs/${id}`} variant="ghost" size="sm" icon={ArrowLeft} aria-label="Back to song" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-semibold">{song.title}</p>
          <p className="truncate text-[12px] text-ink-3">
            {[song.artist, a.key, a.tempo_bpm ? `${Math.round(a.tempo_bpm)} BPM` : null].filter(Boolean).join(' · ')}
          </p>
        </div>
        <Button to={`/songs/${id}/practice`} size="sm" icon={Guitar} className="hidden sm:inline-flex">
          Practice
        </Button>
      </header>

      {player.error && (
        <div className="px-6 pt-4">
          <Alert>{player.error}</Alert>
        </div>
      )}

      <section className="flex flex-1 flex-col items-center justify-center gap-8 px-4 py-10 sm:px-8">
        {preferences.show_beat_counter && <BeatCounter row={row} />}
        <div className="w-full max-w-4xl">
          <ChordStage timeline={timeline} index={index} time={player.time} row={row} />
        </div>
      </section>

      <footer className="border-t border-line bg-surface px-4 pt-4 pb-5 sm:px-8">
        <div className="mx-auto max-w-5xl">
          <TimelineStrip timeline={timeline} time={player.time} duration={player.duration || song.duration} onSeek={player.seek} />
          <PlaybackOptions player={player} metronome={metronome} onMetronomeChange={setMetronome}>
            <Transport player={player} onPrevChord={prevChord} onNextChord={nextChord} />
          </PlaybackOptions>
        </div>
      </footer>
    </div>
  )
}
