// One result per bar in play-along, and per chord in step mode (scored on the
// first strum, so it shows immediately): correct, incorrect or missed.
//
// Every strum is judged (and shown) immediately, but a bar is scored once:
// correct only when every strum in it was correct; any wrong (red) strum makes
// it incorrect, reported with the chord heard most often. In play-along, a bar is
// scored shortly after it ends, so a strum that lands on the change still
// counts for it; a bar played through from start to end without any strum is
// missed. Bars skipped or entered by seeking are never counted as missed.
import { findIndexAt } from './timeline'

// Time after a bar ends to finish judging a strum played on its last beat.
export const GRACE_SECONDS = 0.4
export const MIN_MISSED_SECONDS = 0.4

// Strums are often played a little before the beat: look this far ahead (in
// song seconds at 1×) when deciding which bar a strum belongs to.
export const EARLY_STRUM_SECONDS = 0.2

/**
 * Index of the unit (bar) a strum at `songTime` belongs to, for a strum judged
 * against chord `name`. Prefers the bar sounding just after the strum (an early
 * strum counts for the bar it anticipates); otherwise the nearby bar with that
 * chord (a strum judged correct for the previous chord near a change).
 */
export function unitForStrum(units, name, songTime, rate = 1) {
  const at = findIndexAt(units, songTime + EARLY_STRUM_SECONDS * rate)
  if (units[at]?.name === name) return at
  const here = findIndexAt(units, songTime)
  if (units[here]?.name === name) return here
  const lo = songTime - 0.25 * rate
  const hi = songTime + 0.35 * rate
  return units.findIndex((u) => u.name === name && u.end > lo && u.start < hi)
}

export class ChordScorer {
  /** units: [{ name, start, end, noChord? }] in time order (bars, or chords).
   *  onResult({ key, name, songTime, status, detected }) is called once per unit. */
  constructor(timeline, onResult) {
    this.timeline = timeline || []
    this.onResult = onResult
    this.pending = new Map() // key -> { name, songTime, correct, incorrect, heard }
    this.scored = new Set()
    this.ended = [] // { index, countMissed }
    this.current = -1
    this.fromStart = false
  }

  /** Record one judged strum for chord `key` (timeline index, or step index in step mode). */
  strum(key, name, songTime, status, detected = null) {
    if (key == null || key < 0 || (status !== 'correct' && status !== 'incorrect')) return
    if (this.scored.has(key)) return // already has its result
    const chord = this.pending.get(key) || { name, songTime, correct: 0, incorrect: 0, heard: {} }
    chord[status] += 1
    if (status === 'incorrect' && detected) chord.heard[detected] = (chord.heard[detected] || 0) + 1
    this.pending.set(key, chord)
  }

  /** Score chord `key` now if it has strums. Returns true when a result was produced. */
  settle(key) {
    const chord = this.pending.get(key)
    if (!chord) return false
    this.pending.delete(key)
    this.scored.add(key)
    if (chord.incorrect === 0) {
      this.onResult({ key, name: chord.name, songTime: chord.songTime, status: 'correct', detected: null })
    } else {
      const detected = Object.entries(chord.heard).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
      this.onResult({ key, name: chord.name, songTime: chord.songTime, status: 'incorrect', detected })
    }
    return true
  }

  /** Score a chord that was never played correctly (step mode skip): its strums, or missed. */
  skip(key, name, songTime) {
    if (this.settle(key) || this.scored.has(key)) return
    this.scored.add(key)
    this.onResult({ key, name, songTime, status: 'missed', detected: null })
  }

  /** Play-along: call on every playback time update. */
  tick(time, playing, rate = 1) {
    const index = findIndexAt(this.timeline, time)
    if (index !== this.current) {
      if (this.current >= 0) {
        // Played through to its end (not left early or skipped by a seek)?
        const seg = this.timeline[this.current]
        const naturalEnd = playing && time >= seg.end - 0.1 * rate && time < seg.end + 0.5 * rate
        this.ended.push({ index: this.current, countMissed: naturalEnd && this.fromStart })
      }
      // A unit counts from its start when playback reached it at (or near) its start.
      this.fromStart = playing && index >= 0 && time - this.timeline[index].start < 0.3 * rate
      this.current = index
    }
    if (!this.ended.length) return
    this.ended = this.ended.filter(({ index: i, countMissed }) => {
      const seg = this.timeline[i]
      if (!seg) return false
      if (time >= seg.start && time < seg.end + GRACE_SECONDS * rate) return true // grace period
      if (this.settle(i)) return false
      if (countMissed && !seg.noChord && seg.end - seg.start >= MIN_MISSED_SECONDS && !this.scored.has(i)) {
        this.scored.add(i)
        this.onResult({ key: i, name: seg.name, songTime: seg.start, status: 'missed', detected: null })
      }
      return false
    })
  }

  /** End of session: score everything that has strums. */
  flush() {
    for (const key of [...this.pending.keys()]) this.settle(key)
    this.ended = []
  }
}
