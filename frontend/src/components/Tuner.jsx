import { useCallback, useEffect, useRef, useState } from 'react'
import { Mic, Square } from 'lucide-react'
import { detectPitch, nearestString, STANDARD_TUNING } from '../audio/pitch'
import { Alert, Button } from './ui'

const IN_TUNE_CENTS = 5
const HOLD_MS = 1500 // keep the last reading visible briefly after the string fades

/** Chromatic guitar tuner (standard tuning) using the microphone. */
export default function Tuner() {
  const [active, setActive] = useState(false)
  const [error, setError] = useState(null)
  const [reading, setReading] = useState(null) // { string, name, octave, cents }
  const audio = useRef(null)

  const stop = useCallback(() => {
    const a = audio.current
    if (!a) return
    cancelAnimationFrame(a.frame)
    a.stream.getTracks().forEach((t) => t.stop())
    a.ctx.close().catch(() => {})
    audio.current = null
    setActive(false)
    setReading(null)
  }, [])

  useEffect(() => stop, [stop])

  const start = async () => {
    setError(null)
    let stream
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      })
    } catch (err) {
      setError(
        err.name === 'NotAllowedError' || err.name === 'SecurityError'
          ? 'Microphone access is blocked. Allow access in your browser settings to use the tuner.'
          : 'The microphone could not be started.',
      )
      return
    }
    const ctx = new AudioContext()
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 4096
    ctx.createMediaStreamSource(stream).connect(analyser)
    const buffer = new Float32Array(analyser.fftSize)
    const history = []
    let lastHeard = 0
    let lastRun = 0
    const tick = (now) => {
      audio.current.frame = requestAnimationFrame(tick)
      if (now - lastRun < 50) return
      lastRun = now
      analyser.getFloatTimeDomainData(buffer)
      const f = detectPitch(buffer, ctx.sampleRate)
      if (f) {
        // Median of the last few readings keeps the needle steady.
        history.push(f)
        if (history.length > 5) history.shift()
        const median = [...history].sort((x, y) => x - y)[Math.floor(history.length / 2)]
        setReading(nearestString(median))
        lastHeard = now
      } else if (now - lastHeard > HOLD_MS) {
        history.length = 0
        setReading(null)
      }
    }
    audio.current = { ctx, stream, frame: requestAnimationFrame(tick) }
    setActive(true)
  }

  const cents = reading?.cents ?? 0
  const inTune = reading && Math.abs(cents) <= IN_TUNE_CENTS
  const position = 50 + Math.max(-50, Math.min(50, cents)) // 0..100 %
  const instruction = !reading
    ? 'Play one open string and let it ring.'
    : inTune
      ? 'In tune'
      : cents < 0
        ? 'Too low: tighten the string'
        : 'Too high: loosen the string'

  return (
    <section className="panel p-5" aria-labelledby="tuner-title">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 id="tuner-title" className="text-[15px] font-bold">
            Tuner
          </h2>
          <p className="text-[12.5px] text-ink-3">Standard tuning (E A D G B E)</p>
        </div>
        {active ? (
          <Button size="sm" icon={Square} onClick={stop}>
            Stop tuner
          </Button>
        ) : (
          <Button size="sm" icon={Mic} onClick={start}>
            Start tuner
          </Button>
        )}
      </div>

      {error && (
        <div className="mt-4">
          <Alert>{error}</Alert>
        </div>
      )}

      {active && (
        <div className="mt-5">
          <div className="mb-4 grid grid-cols-6 gap-1.5" aria-label="Strings">
            {STANDARD_TUNING.map((s) => {
              const current = reading?.string === s.string
              return (
                <div
                  key={s.string}
                  className={`flex flex-col items-center rounded-[8px] border py-1.5 transition-colors ${
                    current ? (inTune ? 'border-good bg-good-soft text-good' : 'border-brass bg-brass-soft text-brass') : 'border-line text-ink-3'
                  }`}
                >
                  <span className="font-display text-[16px] font-extrabold">{s.name}</span>
                  <span className="text-[10.5px]">String {s.string}</span>
                </div>
              )
            })}
          </div>

          <div className="relative h-10" aria-hidden>
            <div className="absolute top-1/2 right-0 left-0 h-1 -translate-y-1/2 rounded-full bg-line-strong" />
            <div className="absolute top-1/2 left-[45%] h-3 w-[10%] -translate-y-1/2 rounded-full bg-good/30" />
            {[-50, -25, 0, 25, 50].map((c) => (
              <span key={c} className="absolute top-0 h-2 w-px bg-ink-3" style={{ left: `${50 + c}%` }} />
            ))}
            {reading && (
              <span
                className={`absolute top-1/2 h-7 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full transition-[left] duration-100 ${inTune ? 'bg-good' : 'bg-brass'}`}
                style={{ left: `${position}%` }}
              />
            )}
          </div>
          <div className="tabular mt-1 flex justify-between text-[11px] text-ink-3">
            <span>−50¢ (flat)</span>
            <span>(sharp) +50¢</span>
          </div>

          <p className="mt-3 text-center" aria-live="polite">
            {reading && (
              <span className="tabular mr-2 font-display text-[18px] font-extrabold">
                {reading.name}
                {reading.octave} {cents > 0 ? '+' : ''}
                {cents}¢
              </span>
            )}
            <span className={`text-[14px] font-semibold ${inTune ? 'text-good' : reading ? 'text-brass' : 'text-ink-3'}`}>{instruction}</span>
          </p>
        </div>
      )}
    </section>
  )
}
