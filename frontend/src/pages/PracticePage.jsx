import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, ChevronLeft, ChevronRight, Headphones, Mic, MicOff, Square, Volume2 } from 'lucide-react'
import { BeatCounter, ChordStage, PlaybackOptions, Transport } from '../components/player'
import { Alert, Button, ErrorState, Spinner } from '../components/ui'
import { useAuth } from '../contexts/AuthContext'
import { useAudioPlayer } from '../hooks/useAudioPlayer'
import { useMetronome } from '../hooks/useMetronome'
import { judgeStrum } from '../audio/chordDetector'
import { usePlayerKeys } from '../hooks/usePlayerKeys'
import { useMicrophone } from '../hooks/useMicrophone'
import { useDocumentTitle, useResource } from '../hooks/useResource'
import { practiceApi, songsApi } from '../services/melobud'
import { formatDuration } from '../utils/format'
import { alignToBeats, barStarts, buildBars, buildRows, buildTimeline, chordsBetween, extendBeats, findIndexAt, practiceSteps, rowAt } from '../utils/timeline'

const MODES = [
  { value: 'step', label: 'Step-by-step' },
  { value: 'play_along', label: 'Play along' },
]

function LevelMeter({ level, active }) {
  // level is 0..1, already boosted relative to the room's noise floor.
  const pct = active ? level * 100 : 0
  return (
    <div className="flex items-center gap-2" aria-hidden>
      <Mic size={15} className={active ? 'text-ink-2' : 'text-ink-3'} />
      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-line-strong">
        <div className="h-full rounded-full bg-ink-2 transition-[width] duration-75" style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

function FeedbackLine({ feedback }) {
  if (!feedback) return <p className="text-center text-[14px] text-ink-3">Strum the chord.</p>
  const correct = feedback.status === 'correct'
  return (
    <p className={`text-center text-[15px] font-semibold ${correct ? 'text-good' : 'text-bad'}`} role="status">
      {correct ? 'Correct' : `Incorrect — that sounded like ${feedback.detected}`}
    </p>
  )
}

function Summary({ summary, songId }) {
  const { correct, incorrect, missed } = summary.attempts
  const judged = correct + incorrect + missed
  return (
    <div className="mx-auto w-full max-w-xl px-4 py-12 sm:px-6">
      <p className="eyebrow mb-2">Session complete</p>
      <h1 className="text-[28px] font-extrabold">{summary.song_title}</h1>
      <p className="mt-1 text-ink-2">{formatDuration(summary.duration_seconds)} of practice</p>
      <dl className="panel mt-6 grid grid-cols-2 gap-px overflow-hidden bg-line sm:grid-cols-4">
        {[
          ['Correct', correct, 'text-good'],
          ['Incorrect', incorrect, 'text-bad'],
          ['Missed', missed, 'text-ink-2'],
          ['Accuracy', judged ? `${Math.round((correct / judged) * 100)}%` : '—', 'text-ink'],
        ].map(([label, value, color]) => (
          <div key={label} className="bg-surface px-5 py-4">
            <dt className="eyebrow">{label}</dt>
            <dd className={`tabular mt-1 font-display text-[26px] font-extrabold ${color}`}>{value}</dd>
          </div>
        ))}
      </dl>
      {summary.chords.length > 0 && (
        <div className="panel mt-6 overflow-hidden">
          <div className="grid grid-cols-[1fr_80px_80px_80px] gap-2 border-b border-line px-5 py-2.5">
            {['Chord', 'Correct', 'Incorrect', 'Missed'].map((h) => (
              <span key={h} className="eyebrow text-right first:text-left">
                {h}
              </span>
            ))}
          </div>
          <ul className="divide-y divide-line">
            {summary.chords.map((c) => (
              <li key={c.chord} className="tabular grid grid-cols-[1fr_80px_80px_80px] gap-2 px-5 py-2.5 text-right text-[13.5px]">
                <span className="text-left font-display font-extrabold">{c.chord}</span>
                <span className="text-good">{c.correct}</span>
                <span className="text-bad">{c.incorrect}</span>
                <span className="text-ink-2">{c.missed}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="mt-8 flex flex-wrap gap-2">
        <Button variant="primary" onClick={() => window.location.reload()}>
          Practice again
        </Button>
        <Button to={`/history/${summary.id}`}>View in history</Button>
        <Button to={`/songs/${songId}`} variant="ghost">
          Back to song
        </Button>
      </div>
    </div>
  )
}

export default function PracticePage() {
  const { id } = useParams()
  const { preferences } = useAuth()
  const { data: song, error, loading, reload } = useResource(({ signal }) => songsApi.get(id, { signal }), [id])
  useDocumentTitle(song ? `Practice ${song.title}` : 'Practice')

  const [mode, setMode] = useState('step')
  const [session, setSession] = useState(null)
  const [starting, setStarting] = useState(false)
  const [startError, setStartError] = useState(null)
  const [stepIdx, setStepIdx] = useState(0)
  const [feedback, setFeedback] = useState(null)
  const [previewing, setPreviewing] = useState(false)
  const [summary, setSummary] = useState(null)
  const [tally, setTally] = useState({ correct: 0, incorrect: 0, missed: 0 })

  const ready = song?.status === 'completed' && song.analysis
  const timeline = useMemo(() => alignToBeats(buildTimeline(song?.analysis?.segments), song?.analysis?.beats), [song])
  const grid = useMemo(() => extendBeats(song?.analysis?.beats), [song])
  const bars = useMemo(
    () => buildBars(grid, song?.analysis?.downbeats, timeline.map((seg) => seg.start)),
    [grid, song, timeline],
  )
  const rowData = useMemo(() => buildRows(timeline, grid, bars), [timeline, grid, bars])
  const accents = useMemo(() => barStarts(bars), [bars])
  const steps = useMemo(() => practiceSteps(timeline), [timeline])
  const player = useAudioPlayer(ready ? songsApi.audioUrl(id) : null)
  const [metronome, setMetronome] = useState(false)
  useMetronome({ player, beats: grid, accents, enabled: metronome && mode === 'play_along' })

  const sessionRef = useRef(null)
  const stepRef = useRef(0)
  const modeRef = useRef(mode)
  const feedbackTimer = useRef(null)
  // Play-along: timeline segments the player has strummed in. Step mode: steps played correctly.
  const playedRef = useRef(new Set())
  useEffect(() => {
    sessionRef.current = session
    stepRef.current = stepIdx
    modeRef.current = mode
  })

  // End the session if the user navigates away mid-practice.
  useEffect(
    () => () => {
      const s = sessionRef.current
      if (s && !s.ended_at) practiceApi.end(s.id, { keepalive: true }).catch(() => {})
    },
    [],
  )

  // Each strum is judged in the browser the moment it has been heard; the
  // result is saved to the server in the background (never blocks feedback).
  const handleClip = useCallback(
    (samples, sampleRate, onsetAt) => {
      const s = sessionRef.current
      if (!s) return
      let songTime
      let expected
      let accepted
      let range = null
      if (modeRef.current === 'step') {
        const step = steps[stepRef.current]
        songTime = step?.time
        expected = step?.name
        accepted = [expected]
      } else {
        if (!player.playing) return
        // Song position at the moment of the strum, not when the clip finished.
        const elapsed = (performance.now() - onsetAt) / 1000
        songTime = Math.max(0, player.getTime() - elapsed * player.rate)
        // Players strum on (or just before) a change: any chord sounding from
        // 0.25 s before to 0.35 s after the strum counts as the right one.
        range = [songTime - 0.25 * player.rate, songTime + 0.35 * player.rate]
        accepted = chordsBetween(timeline, range[0], range[1])
        const shown = timeline[findIndexAt(timeline, songTime + 0.15 * player.rate)]
        expected = shown && !shown.noChord ? shown.name : accepted[accepted.length - 1]
      }
      if (songTime == null || !expected) return
      let result = null
      for (const name of accepted) {
        const judged = judgeStrum(samples, sampleRate, name)
        if (!judged) return
        if (judged.status === 'correct') {
          result = judged
          expected = name
          break
        }
        result = judged
      }
      if (!result) return
      // Mark the chord as attempted so it is not also counted as missed.
      if (modeRef.current === 'step') {
        if (result.status === 'correct') playedRef.current.add(stepRef.current)
      } else {
        const i = timeline.findIndex((seg) => seg.name === expected && seg.end > range[0] && seg.start < range[1])
        if (i >= 0) playedRef.current.add(i)
      }
      clearTimeout(feedbackTimer.current)
      setFeedback(result)
      setTally((t) => ({ ...t, [result.status]: t[result.status] + 1 }))
      practiceApi
        .recordAttempt(s.id, { song_time: songTime, expected, detected: result.detected, result: result.status })
        .catch(() => {})
      if (modeRef.current === 'step' && result.status === 'correct') {
        feedbackTimer.current = setTimeout(() => {
          setFeedback(null)
          setStepIdx((i) => Math.min(i + 1, steps.length - 1))
        }, 350)
      } else {
        feedbackTimer.current = setTimeout(() => setFeedback(null), modeRef.current === 'step' ? 1200 : 900)
      }
    },
    [steps, player, timeline],
  )

  const recordMissed = useCallback((name, songTime) => {
    const s = sessionRef.current
    if (!s || s.ended_at) return
    setTally((t) => ({ ...t, missed: t.missed + 1 }))
    practiceApi.recordAttempt(s.id, { song_time: songTime, expected: name, result: 'missed' }).catch(() => {})
  }, [])

  // Play-along: when playback runs through a whole chord without a strum, it is missed.
  // Chords entered by seeking (not from their start) are not counted.
  const watchRef = useRef({ index: -1, fromStart: false })
  const liveIndex = findIndexAt(timeline, player.time)
  useEffect(() => {
    const watch = watchRef.current
    if (liveIndex === watch.index) return
    const prev = timeline[watch.index]
    const continuous = player.playing && liveIndex === watch.index + 1
    if (session && mode === 'play_along' && continuous && watch.fromStart && prev && !prev.noChord) {
      if (prev.end - prev.start >= 0.4 && !playedRef.current.has(watch.index)) recordMissed(prev.name, prev.start)
    }
    watchRef.current = { index: liveIndex, fromStart: continuous }
  }, [liveIndex, timeline, player.playing, session, mode, recordMissed])

  const mic = useMicrophone({ onClip: handleClip, enabled: !!session && !previewing, sensitivity: preferences.mic_sensitivity })

  const start = async () => {
    setStarting(true)
    setStartError(null)
    const ok = await mic.start()
    if (!ok) {
      setStarting(false)
      return
    }
    try {
      const created = await practiceApi.start(Number(id), mode)
      setSession(created)
    } catch (err) {
      mic.stop()
      setStartError(err)
    } finally {
      setStarting(false)
    }
  }

  const finish = async () => {
    player.pause()
    mic.stop()
    try {
      const result = await practiceApi.end(session.id)
      setSession({ ...session, ended_at: result.ended_at })
      setSummary(result)
    } catch (err) {
      setStartError(err)
    }
  }

  // Step mode: let the learner hear the target chord in the recording.
  // The mic ignores strums while the preview plays.
  const previewTimer = useRef(null)
  const stopPreview = useCallback(() => {
    clearTimeout(previewTimer.current)
    player.pause()
    setPreviewing(false)
  }, [player])
  const preview = () => {
    const step = steps[stepIdx]
    if (!step) return
    setPreviewing(true)
    player.seek(step.start + 0.02)
    player.play()
    const seconds = Math.min(step.end - step.start, 4) / player.rate
    previewTimer.current = setTimeout(stopPreview, seconds * 1000 + 250)
  }
  useEffect(() => () => clearTimeout(previewTimer.current), [])

  const goStep = (delta) => {
    // Skipping a chord that was not played correctly counts as missed.
    const step = steps[stepIdx]
    if (delta > 0 && step && !playedRef.current.has(stepIdx)) {
      playedRef.current.add(stepIdx)
      recordMissed(step.name, step.time)
    }
    clearTimeout(feedbackTimer.current)
    setFeedback(null)
    if (previewing) stopPreview()
    setStepIdx((i) => Math.max(0, Math.min(steps.length - 1, i + delta)))
  }

  const index = liveIndex
  const row = song?.analysis ? rowAt(rowData, grid, player.time) : null
  const seekChord = (delta) => {
    const i = findIndexAt(timeline, player.getTime())
    const target = timeline[Math.max(0, Math.min(timeline.length - 1, i + delta))]
    if (target) player.seek(target.start + 0.01)
  }
  usePlayerKeys(mode === 'play_along' && session ? player : { toggle() {}, skip() {} }, {
    onPrevChord: () => seekChord(-1),
    onNextChord: () => seekChord(1),
  })

  if (loading) return <div className="mx-auto max-w-5xl px-6 pt-10"><div className="skeleton h-96" /></div>
  if (error) return <ErrorState error={error} onRetry={() => reload()} />
  if (!ready) {
    return (
      <div className="mx-auto max-w-xl px-6 pt-16">
        <Alert tone="info">This song must finish analyzing before it can be used for practice.</Alert>
        <Button to={`/songs/${id}`} className="mt-4">
          Back to song
        </Button>
      </div>
    )
  }
  if (summary) return <Summary summary={summary} songId={id} />

  const header = (
    <header className="flex items-center gap-3 border-b border-line px-4 py-3 sm:px-6">
      <Button to={`/songs/${id}`} variant="ghost" size="sm" icon={ArrowLeft} aria-label="Back to song" />
      <div className="min-w-0 flex-1">
        <p className="eyebrow">Practice</p>
        <p className="truncate text-[14px] font-semibold">{song.title}</p>
      </div>
      {session && (
        <>
          <span className="tabular hidden text-[12.5px] text-ink-3 sm:inline">
            <span className="text-good">{tally.correct} correct</span> · <span className="text-bad">{tally.incorrect} incorrect</span> · {tally.missed} missed
          </span>
          <LevelMeter level={mic.level} active={mic.status === 'listening'} />
          <Button size="sm" icon={Square} onClick={finish}>
            Finish
          </Button>
        </>
      )}
    </header>
  )

  // --- Setup ---------------------------------------------------------------
  if (!session) {
    return (
      <div className="flex min-h-[calc(100dvh-56px)] flex-col md:min-h-dvh">
        {header}
        <div className="mx-auto w-full max-w-2xl px-4 py-10 sm:px-6">
          <h1 className="text-[26px] font-extrabold">Choose a practice mode</h1>
          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            {MODES.map((m) => {
              const active = mode === m.value
              return (
                <button
                  key={m.value}
                  type="button"
                  onClick={() => setMode(m.value)}
                  aria-pressed={active}
                  className={`rounded-[12px] border p-5 text-left transition-colors ${active ? 'border-brass bg-brass-soft' : 'border-line bg-surface hover:border-line-strong'}`}
                >
                  <p className="font-display text-[17px] font-extrabold">{m.label}</p>
                  <p className="mt-1.5 text-[13.5px] text-ink-2">
                    {m.value === 'step'
                      ? `Practice the song's ${steps.length} chord changes at your own pace. Melobud advances after each correct chord.`
                      : 'Play along with the song. Each chord you play is evaluated against the chord at that moment in the recording.'}
                  </p>
                </button>
              )
            })}
          </div>

          {mode === 'play_along' && (
            <div className="mt-4">
              <Alert tone="warn">
                <span className="flex gap-2">
                  <Headphones size={16} className="mt-0.5 shrink-0" aria-hidden />
                  Headphones are required. If the song plays through speakers, the microphone will pick up the recording instead of your guitar.
                </span>
              </Alert>
            </div>
          )}

          <div className="panel mt-6 p-5 text-[13.5px] text-ink-2">
            <p className="mb-2 font-semibold text-ink">Before you start</p>
            <ul className="list-disc space-y-1 pl-5">
              <li>Tune your guitar. There is no need to raise your microphone volume; Melobud adjusts to quiet microphones automatically.</li>
              <li>Strum the full chord once and let it ring for about one second.</li>
              <li>Green indicates a correct chord and red an incorrect chord. Chords you do not play are counted as missed.</li>
            </ul>
          </div>

          {(mic.errorMessage || startError) && (
            <div className="mt-4">
              <Alert>{mic.errorMessage || startError}</Alert>
            </div>
          )}
          <Button variant="primary" size="lg" icon={mic.status === 'denied' ? MicOff : Mic} className="mt-6" onClick={start} loading={starting} disabled={!steps.length}>
            {mic.status === 'denied' ? 'Retry microphone access' : 'Start practice'}
          </Button>
          {!steps.length && <p className="mt-3 text-[13px] text-ink-3">No playable chords were detected in this song.</p>}
          <p className="mt-3 text-[12.5px] text-ink-3">Microphone audio is processed in short segments and is not stored.</p>
        </div>
      </div>
    )
  }

  // --- Step mode --------------------------------------------------------------
  if (mode === 'step') {
    const pseudo = steps.map((s, i) => ({ ...s, index: i, noChord: false, start: i, end: i + 1 }))
    return (
      <div className="flex min-h-[calc(100dvh-56px)] flex-col md:min-h-dvh">
        {header}
        <section className="flex flex-1 flex-col items-center justify-center gap-8 px-4 py-10">
          <p className="tabular text-[13px] text-ink-3">
            Chord {stepIdx + 1} of {steps.length}
          </p>
          <div className="w-full max-w-4xl">
            <ChordStage timeline={pseudo} index={stepIdx} time={stepIdx + 0.5} feedback={feedback?.status} showCountdown={false} />
          </div>
          <div className="h-6">
            <FeedbackLine feedback={feedback} />
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" icon={ChevronLeft} onClick={() => goStep(-1)} disabled={stepIdx === 0}>
              Back
            </Button>
            <Button icon={Volume2} onClick={preview} disabled={previewing}>
              {previewing ? 'Playing…' : 'Hear it'}
            </Button>
            <Button variant="ghost" onClick={() => goStep(1)} disabled={stepIdx >= steps.length - 1}>
              Skip <ChevronRight size={17} aria-hidden />
            </Button>
          </div>
          {stepIdx >= steps.length - 1 && feedback?.status === 'correct' && (
            <Button variant="primary" onClick={finish}>
              End of song reached. Finish session
            </Button>
          )}
        </section>
      </div>
    )
  }

  // --- Play-along mode ------------------------------------------------------------
  return (
    <div className="flex min-h-[calc(100dvh-56px)] flex-col md:min-h-dvh">
      {header}
      <section className="flex flex-1 flex-col items-center justify-center gap-8 px-4 py-10">
        {preferences.show_beat_counter && <BeatCounter row={row} />}
        <div className="w-full max-w-4xl">
          <ChordStage timeline={timeline} index={index} time={player.time} feedback={feedback?.status} row={row} />
        </div>
        <div className="h-6">{player.playing ? <FeedbackLine feedback={feedback} /> : <p className="text-[14px] text-ink-3">Press Play to begin.</p>}</div>
      </section>
      <footer className="border-t border-line bg-surface px-4 pt-4 pb-5 sm:px-8">
        <div className="mx-auto max-w-5xl">
          <PlaybackOptions player={player} metronome={metronome} onMetronomeChange={setMetronome}>
            <Transport player={player} onPrevChord={() => seekChord(-1)} onNextChord={() => seekChord(1)} />
          </PlaybackOptions>
        </div>
      </footer>
      <p className="sr-only">
        <Link to={`/songs/${id}`}>Back to song</Link>
      </p>
    </div>
  )
}
