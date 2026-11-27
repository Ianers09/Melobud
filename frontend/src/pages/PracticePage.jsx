import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, ChevronLeft, ChevronRight, Mic, MicOff, Square, Volume2 } from 'lucide-react'
import { BeatCounter, ChordStage, PlaybackOptions, Transport } from '../components/player'
import Tuner from '../components/Tuner'
import { Alert, Button, ErrorState, Spinner } from '../components/ui'
import { useAuth } from '../contexts/AuthContext'
import { useAudioPlayer } from '../hooks/useAudioPlayer'
import { useMetronome } from '../hooks/useMetronome'
import { judgeStrum } from '../audio/chordDetector'
import { usePlayerKeys } from '../hooks/usePlayerKeys'
import { useMicrophone } from '../hooks/useMicrophone'
import { ChordScorer, EARLY_STRUM_SECONDS, unitForStrum } from '../utils/scoring'
import { useDocumentTitle, useResource } from '../hooks/useResource'
import { practiceApi, songsApi } from '../services/melobud'
import { alignToBeats, barStarts, barUnits, buildBars, buildRows, buildTimeline, chordsBetween, extendBeats, findIndexAt, practiceSteps, rowAt } from '../utils/timeline'

const MODES = [
  { value: 'step', label: 'Step-by-step' },
  { value: 'play_along', label: 'Play-along' },
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
      {correct ? 'Correct' : `Incorrect. Detected: ${feedback.detected}`}
    </p>
  )
}

export default function PracticePage() {
  const { id } = useParams()
  const navigate = useNavigate()
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
  // Play-along is scored per bar: one result for every bar of the song.
  const units = useMemo(() => barUnits(rowData, grid, timeline), [rowData, grid, timeline])
  const player = useAudioPlayer(ready ? songsApi.audioUrl(id) : null)
  const [metronome, setMetronome] = useState(false)
  useMetronome({ player, beats: grid, accents, enabled: metronome && mode === 'play_along' })

  const sessionRef = useRef(null)
  const stepRef = useRef(0)
  const modeRef = useRef(mode)
  const feedbackTimer = useRef(null)
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

  // One result per chord (see utils/scoring.js); each result is saved once.
  const record = useCallback(({ name, songTime, status, detected }) => {
    const s = sessionRef.current
    if (!s || s.ended_at) return
    setTally((t) => ({ ...t, [status]: t[status] + 1 }))
    const attempt = { song_time: songTime, expected: name, result: status }
    if (detected) attempt.detected = detected
    practiceApi.recordAttempt(s.id, attempt).catch(() => {})
  }, [])
  const scorerRef = useRef(null)
  useEffect(() => {
    // A fresh scorer for every session.
    scorerRef.current = session && !session.ended_at ? new ChordScorer(mode === 'step' ? [] : units, record) : null
  }, [session?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Each strum is judged in the browser the moment it has been heard; the
  // result is saved to the server in the background (never blocks feedback).
  const handleClip = useCallback(
    (samples, sampleRate, onsetAt) => {
      const s = sessionRef.current
      if (!s) return
      let songTime
      let expected
      let accepted
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
        accepted = chordsBetween(timeline, songTime - 0.25 * player.rate, songTime + 0.35 * player.rate)
        const shown = timeline[findIndexAt(timeline, songTime + EARLY_STRUM_SECONDS * player.rate)]
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
      // Collect the strum for its bar (step mode: its chord); one result is saved per bar.
      const key = modeRef.current === 'step' ? stepRef.current : unitForStrum(units, expected, songTime, player.rate)
      if (key < 0) return
      const chordStart = modeRef.current === 'step' ? songTime : units[key].start
      scorerRef.current?.strum(key, expected, chordStart, result.status, result.detected)
      // Step mode: the first strum on a chord is its result, shown immediately.
      // Retries after a wrong strum only advance to the next chord.
      if (modeRef.current === 'step') scorerRef.current?.settle(key)
      clearTimeout(feedbackTimer.current)
      setFeedback(result)
      if (modeRef.current === 'step' && result.status === 'correct') {
        feedbackTimer.current = setTimeout(() => {
          setFeedback(null)
          setStepIdx((i) => Math.min(i + 1, steps.length - 1))
        }, 350)
      } else {
        feedbackTimer.current = setTimeout(() => setFeedback(null), modeRef.current === 'step' ? 1200 : 900)
      }
    },
    [steps, player, timeline, units],
  )

  // Play-along: the scorer follows playback to score chords as they end.
  const liveIndex = findIndexAt(timeline, player.time)
  useEffect(() => {
    if (mode === 'play_along') scorerRef.current?.tick(player.time, player.playing, player.rate)
  }, [player.time, player.playing, player.rate, mode])

  const mic = useMicrophone({
    onClip: handleClip,
    enabled: !!session && !previewing,
    sensitivity: preferences.mic_sensitivity,
    echoCancellation: mode === 'play_along',
  })

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
    scorerRef.current?.flush()
    try {
      const result = await practiceApi.end(session.id)
      setSession({ ...session, ended_at: result.ended_at })
      // The session review (strengths, mistakes, how to improve) is on the session page.
      navigate(`/sessions/${session.id}`, { replace: true })
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
    // Leaving a chord settles it; skipping one that was never strummed counts as missed.
    const step = steps[stepIdx]
    if (delta > 0 && step) scorerRef.current?.skip(stepIdx, step.name, step.time)
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
            Finish and review
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
          <h1 className="text-[26px] font-extrabold">Practice setup</h1>
          <p className="mt-1.5 text-[14px] text-ink-2">Choose a mode, tune your guitar, and start. You will get a written review when you finish.</p>
          <h2 className="eyebrow mt-7">1 · Mode</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
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
                      ? `Learn the ${steps.length} chord changes at your own pace. Your first strum on each chord is scored; the next chord appears once you play it correctly.`
                      : 'Play in time with the recording. Every bar is scored as correct, incorrect, or missed.'}
                  </p>
                </button>
              )
            })}
          </div>

          <h2 className="eyebrow mt-7 mb-3">2 · Tune</h2>
          <Tuner />

          <h2 className="eyebrow mt-7 mb-3">3 · Start</h2>
          <ul className="list-disc space-y-1 pl-5 text-[13.5px] text-ink-2">
            <li>Strum the whole chord once and let it ring for about a second.</li>
            <li>Green means correct; red means a different chord was detected. Chords you do not play count as missed.</li>
          </ul>

          {(mic.errorMessage || startError) && (
            <div className="mt-4">
              <Alert>{mic.errorMessage || startError}</Alert>
            </div>
          )}
          <Button variant="primary" size="lg" icon={mic.status === 'denied' ? MicOff : Mic} className="mt-5" onClick={start} loading={starting} disabled={!steps.length}>
            {mic.status === 'denied' ? 'Retry microphone access' : 'Start practice'}
          </Button>
          {!steps.length && <p className="mt-3 text-[13px] text-ink-3">No playable chords were detected in this song.</p>}
          <p className="mt-3 text-[12.5px] text-ink-3">Microphone audio is analyzed on your device and is never recorded or uploaded.</p>
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
              End of song. Finish and review
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
