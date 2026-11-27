import { useCallback, useEffect, useRef, useState } from 'react'

/** Output delay of the audio device (speakers, Bluetooth), in seconds. */
function outputLatency(ctx) {
  if (!ctx) return 0
  const value = Number.isFinite(ctx.outputLatency) && ctx.outputLatency > 0 ? ctx.outputLatency : ctx.baseLatency || 0
  return Math.min(Math.max(value, 0), 0.5)
}

/**
 * Wraps an <audio> element and exposes a precise, smooth song clock.
 *
 * - The clock follows audio.currentTime (the media clock), so chords stay in
 *   sync after pause, resume, seek and speed changes. No timers are used.
 * - Browsers update currentTime in coarse steps; between updates the clock is
 *   interpolated with performance.now() and re-anchored on every update.
 * - `time` is what the listener *hears*: it subtracts the device's output
 *   latency (measurable through an AudioContext), which matters most with
 *   Bluetooth speakers and headphones.
 * - `audioContext()` returns the shared AudioContext; the metronome schedules
 *   clicks on it so they share the song's output path and latency.
 */
const VOLUME_KEY = 'melobud.volume'

function loadVolume() {
  try {
    const saved = JSON.parse(localStorage.getItem(VOLUME_KEY))
    if (saved && Number.isFinite(saved.volume)) return { volume: Math.min(Math.max(saved.volume, 0), 1), muted: !!saved.muted }
  } catch {
    /* storage unavailable */
  }
  return { volume: 1, muted: false }
}

export function useAudioPlayer(src) {
  const audioRef = useRef(null)
  const ctxRef = useRef(null)
  const anchorRef = useRef({ media: 0, wall: 0 })
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState(null)
  const [playing, setPlaying] = useState(false)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState(null)
  const [buffering, setBuffering] = useState(false)
  const [rate, setRateState] = useState(1)
  const [{ volume, muted }, setVolumeState] = useState(loadVolume)
  const volumeRef = useRef({ volume, muted })

  const audioContext = useCallback(() => {
    if (!ctxRef.current && typeof window !== 'undefined' && window.AudioContext) {
      ctxRef.current = new AudioContext({ latencyHint: 'interactive' })
    }
    if (ctxRef.current?.state === 'suspended') ctxRef.current.resume().catch(() => {})
    return ctxRef.current
  }, [])

  /** Media position now, interpolated between the browser's coarse updates. */
  const getMediaTime = useCallback(() => {
    const audio = audioRef.current
    if (!audio) return 0
    if (audio.paused) return audio.currentTime
    const now = performance.now()
    if (audio.currentTime !== anchorRef.current.media) anchorRef.current = { media: audio.currentTime, wall: now }
    const { media, wall } = anchorRef.current
    const projected = media + ((now - wall) / 1000) * audio.playbackRate
    // Never run far ahead of the media clock (e.g. while buffering).
    return Math.min(projected, audio.currentTime + 0.25)
  }, [])

  /** Song time as the listener hears it (media time minus output latency). */
  const getTime = useCallback(() => {
    const audio = audioRef.current
    if (!audio || audio.paused) return audio?.currentTime ?? 0
    return Math.max(0, getMediaTime() - outputLatency(ctxRef.current) * audio.playbackRate)
  }, [getMediaTime])

  useEffect(() => {
    if (!src) return undefined
    const audio = new Audio()
    audio.preload = 'auto'
    audio.src = src
    audio.preservesPitch = true
    audio.volume = volumeRef.current.volume
    audio.muted = volumeRef.current.muted
    audioRef.current = audio

    const sync = () => {
      anchorRef.current = { media: audio.currentTime, wall: performance.now() }
      setTime(audio.currentTime)
    }
    const handlers = {
      loadedmetadata: () => setDuration(audio.duration),
      canplay: () => {
        setReady(true)
        setBuffering(false)
      },
      play: () => {
        anchorRef.current = { media: audio.currentTime, wall: performance.now() }
        setPlaying(true)
      },
      pause: () => {
        setPlaying(false)
        sync()
      },
      ended: () => {
        setPlaying(false)
        sync()
      },
      seeked: sync,
      waiting: () => setBuffering(true),
      playing: () => {
        anchorRef.current = { media: audio.currentTime, wall: performance.now() }
        setBuffering(false)
      },
      error: () => setError(audio.error?.code === 4 ? 'This audio file could not be played.' : 'The audio could not be loaded. Please try again.'),
    }
    Object.entries(handlers).forEach(([e, fn]) => audio.addEventListener(e, fn))
    return () => {
      Object.entries(handlers).forEach(([e, fn]) => audio.removeEventListener(e, fn))
      audio.pause()
      audio.removeAttribute('src')
      audio.load()
      audioRef.current = null
    }
  }, [src])

  useEffect(
    () => () => {
      ctxRef.current?.close().catch(() => {})
      ctxRef.current = null
    },
    [],
  )

  useEffect(() => {
    if (!playing) return undefined
    let frame
    const tick = () => {
      setTime(getTime())
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [playing, getTime])

  const play = useCallback(async () => {
    audioContext() // created inside the user gesture so it is allowed to run
    try {
      await audioRef.current?.play()
    } catch (err) {
      if (err.name !== 'AbortError') setError('Playback was blocked by your browser. Please press Play again.')
    }
  }, [audioContext])
  const pause = useCallback(() => audioRef.current?.pause(), [])
  const toggle = useCallback(() => (audioRef.current?.paused ? play() : pause()), [play, pause])
  const seek = useCallback((t) => {
    const audio = audioRef.current
    if (!audio) return
    const max = Number.isFinite(audio.duration) ? audio.duration : t
    audio.currentTime = Math.max(0, Math.min(t, max - 0.05))
    anchorRef.current = { media: audio.currentTime, wall: performance.now() }
    setTime(audio.currentTime)
  }, [])
  const skip = useCallback((delta) => audioRef.current && seek(audioRef.current.currentTime + delta), [seek])
  const setRate = useCallback((r) => {
    if (audioRef.current) audioRef.current.playbackRate = r
    anchorRef.current = { media: audioRef.current?.currentTime ?? 0, wall: performance.now() }
    setRateState(r)
  }, [])

  // Volume (0..1) and mute, like a video player. Remembered between visits.
  useEffect(() => {
    volumeRef.current = { volume, muted }
    if (audioRef.current) {
      audioRef.current.volume = volume
      audioRef.current.muted = muted
    }
    try {
      localStorage.setItem(VOLUME_KEY, JSON.stringify({ volume, muted }))
    } catch {
      /* storage unavailable */
    }
  }, [volume, muted])
  const setVolume = useCallback((v) => {
    const value = Math.min(Math.max(v, 0), 1)
    // Dragging the slider up unmutes; dragging it to zero shows as muted.
    setVolumeState({ volume: value, muted: value === 0 })
  }, [])
  const changeVolume = useCallback(
    (delta) => setVolume((volumeRef.current.muted ? 0 : volumeRef.current.volume) + delta),
    [setVolume],
  )
  const toggleMute = useCallback(() => {
    setVolumeState(({ volume: v, muted: m }) => (m || v === 0 ? { volume: v === 0 ? 0.5 : v, muted: false } : { volume: v, muted: true }))
  }, [])

  return {
    time,
    duration,
    playing,
    ready,
    error,
    buffering,
    rate,
    volume,
    muted,
    play,
    pause,
    toggle,
    setVolume,
    changeVolume,
    toggleMute,
    seek,
    skip,
    setRate,
    getTime,
    getMediaTime,
    audioContext,
  }
}
