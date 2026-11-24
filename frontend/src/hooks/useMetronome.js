import { useEffect } from 'react'
import { firstBeatAtOrAfter } from '../utils/timeline'

const LOOKAHEAD = 0.12 // seconds of song time scheduled ahead
const TICK_MS = 25

function click(ctx, when, accent) {
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.type = 'sine'
  osc.frequency.value = accent ? 1760 : 1180
  gain.gain.setValueAtTime(0.0001, when)
  gain.gain.exponentialRampToValueAtTime(accent ? 0.55 : 0.32, when + 0.002)
  gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.05)
  osc.connect(gain).connect(ctx.destination)
  osc.start(when)
  osc.stop(when + 0.06)
}

/**
 * Metronome locked to the song's detected beats.
 *
 * Clicks are scheduled slightly ahead on the player's AudioContext, at the
 * exact AudioContext time each beat will be played by the media element, so
 * they share the song's output path (and latency) and do not drift. Whenever
 * it starts (play, toggle, seek) it waits for the next bar so the first tick
 * is always the accented downbeat. Beat 1 of
 * every bar is accented.
 */
export function useMetronome({ player, beats, accents, enabled }) {
  const { playing, rate, audioContext, getMediaTime } = player

  useEffect(() => {
    if (!enabled || !playing || !beats?.length) return undefined
    const ctx = audioContext()
    if (!ctx) return undefined
    let next = firstBeatAtOrAfter(beats, getMediaTime())
    let started = false // first tick must be a downbeat
    const timer = setInterval(() => {
      const media = getMediaTime()
      // A seek moved the song: restart from the beat at the new position.
      if ((next > 0 && beats[next - 1] > media + 0.2) || (next < beats.length && beats[next] < media - 0.2)) {
        next = firstBeatAtOrAfter(beats, media)
        started = false
      }
      while (next < beats.length && beats[next] <= media + LOOKAHEAD * rate) {
        const when = ctx.currentTime + (beats[next] - media) / rate
        const accent = Boolean(accents?.has(next))
        if (accent) started = true
        if (started && when >= ctx.currentTime - 0.005) click(ctx, Math.max(when, ctx.currentTime), accent)
        next += 1
      }
    }, TICK_MS)
    return () => clearInterval(timer)
  }, [enabled, playing, rate, beats, accents, audioContext, getMediaTime])
}
