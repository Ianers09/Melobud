// Pure helpers for chord timelines and beats. All times are seconds.

const NO_CHORD = new Set(['N', 'X'])

export function chordName(segment, mode) {
  return mode === 'full' ? segment.label : segment.simple
}

export function isNoChord(segment) {
  return NO_CHORD.has(segment.raw)
}

/**
 * Build the timeline shown to the user. In "simple" mode, consecutive segments
 * whose beginner name is identical (e.g. G then Gmaj7 -> G, G) are merged so
 * the display doesn't flash a "change" to the same chord.
 */
export function buildTimeline(segments, mode = 'simple') {
  const out = []
  for (const seg of segments || []) {
    const name = isNoChord(seg) ? seg.label : chordName(seg, mode)
    const last = out[out.length - 1]
    if (last && last.name === name && Math.abs(last.end - seg.start) < 1e-3) {
      const total = last.end - last.start + (seg.end - seg.start)
      const conf = (key) =>
        last[key] == null || seg[key] == null
          ? null
          : (last[key] * (last.end - last.start) + seg[key] * (seg.end - seg.start)) / total
      last.confidence = conf('confidence')
      last.simple_confidence = conf('simple_confidence')
      last.end = seg.end
      last.raws.push(seg.raw)
      last.labels.push(seg.label)
    } else {
      out.push({
        name,
        start: seg.start,
        end: seg.end,
        noChord: isNoChord(seg),
        raws: [seg.raw],
        labels: [seg.label],
        confidence: seg.confidence,
        simple_confidence: seg.simple_confidence,
      })
    }
  }
  return out.map((s, index) => ({ ...s, index }))
}

/**
 * Put every chord change on its nearest beat, so the chord display, the bar
 * counter and the metronome always switch at the same moment. Chords that
 * collapse onto the same beat are merged (the longer one is kept).
 */
export function alignToBeats(timeline, beats) {
  if (!beats?.length || !timeline?.length) return timeline || []
  const nearest = (t) => {
    const i = firstBeatAtOrAfter(beats, t)
    const after = i < beats.length ? beats[i] : Infinity
    const before = i > 0 ? beats[i - 1] : -Infinity
    return t - before <= after - t ? before : after
  }
  const out = []
  for (const seg of timeline) {
    const start = out.length ? nearest(seg.start) : seg.start
    const prev = out[out.length - 1]
    if (prev && start <= prev.start + 1e-6) {
      if (seg.end - seg.start > prev.end - prev.start) Object.assign(prev, { ...seg, start: prev.start })
      else prev.end = seg.end
      continue
    }
    if (prev) prev.end = start
    out.push({ ...seg, start })
  }
  // Same chord on both sides of a removed segment: join them.
  const joined = []
  for (const seg of out) {
    const last = joined[joined.length - 1]
    if (last && last.name === seg.name) last.end = seg.end
    else joined.push({ ...seg })
  }
  return joined.map((seg, index) => ({ ...seg, index }))
}

/** Names of the chords (not N.C.) sounding at any point between t0 and t1, in order. */
export function chordsBetween(timeline, t0, t1) {
  const names = []
  for (const seg of timeline || []) {
    if (seg.noChord || seg.end <= t0 || seg.start >= t1) continue
    if (!names.includes(seg.name)) names.push(seg.name)
  }
  return names
}

/** Index of the segment containing time t (binary search), or -1. */
export function findIndexAt(timeline, t) {
  let lo = 0
  let hi = timeline.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const seg = timeline[mid]
    if (t < seg.start) hi = mid - 1
    else if (t >= seg.end) lo = mid + 1
    else return mid
  }
  return -1
}

/** Previous/next *playable* chords around index i (skipping N.C.). */
export function neighbours(timeline, i) {
  let prev = null
  let next = null
  for (let j = i - 1; j >= 0; j--) {
    if (!timeline[j].noChord) {
      prev = timeline[j]
      break
    }
  }
  for (let j = i + 1; j < timeline.length; j++) {
    if (!timeline[j].noChord) {
      next = timeline[j]
      break
    }
  }
  return { prev, next }
}

/** Index of the last beat at or before t, or -1. */
export function beatIndexAt(beats, t) {
  let lo = 0
  let hi = (beats?.length || 0) - 1
  let found = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (beats[mid] <= t) {
      found = mid
      lo = mid + 1
    } else hi = mid - 1
  }
  return found
}

export function firstBeatAtOrAfter(beats, t) {
  let lo = 0
  let hi = beats.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (beats[mid] < t) lo = mid + 1
    else hi = mid
  }
  return lo
}

/**
 * Extend the beat grid back to the start of the song at the song's tempo, so
 * the metronome and bar count run from 0:00 (through a quiet or no-chord
 * intro) instead of starting at the first detected beat.
 */
export function extendBeats(beats) {
  if (!beats || beats.length < 4) return beats || []
  const gaps = []
  for (let i = 1; i < Math.min(beats.length, 9); i++) gaps.push(beats[i] - beats[i - 1])
  gaps.sort((x, y) => x - y)
  const interval = gaps[gaps.length >> 1]
  const before = []
  for (let t = beats[0] - interval; t >= -0.02; t -= interval) before.unshift(Math.max(0, Number(t.toFixed(3))))
  return before.concat(beats)
}

/**
 * The song's bar grid: a 1-based position for every beat, from the detected
 * downbeats.
 * - Bar length is the most common number of beats between downbeats.
 * - Two-beat bars (6/8 felt in two) are counted in four (12/8): every other
 *   downbeat is kept, choosing the pairing on which more chord changes fall.
 * - A downbeat that arrives too early to be real (fewer than length−1 beats
 *   into the bar) is ignored; a missed downbeat is filled in.
 * - Beats before the first downbeat count up into it in whole bars.
 */
export function buildBars(beats, downbeats, changes = [], tolerance = 0.07) {
  const n = beats?.length || 0
  if (!n) return { pos: [], meter: 4 }
  const isDown = new Array(n).fill(false)
  const downs = downbeats || []
  let d = 0
  for (let i = 0; i < n; i++) {
    while (d < downs.length && downs[d] < beats[i] - tolerance) d++
    if (d < downs.length && Math.abs(downs[d] - beats[i]) <= tolerance) isDown[i] = true
  }
  let downIdx = isDown.flatMap((v, i) => (v ? [i] : []))
  const counts = {}
  for (let k = 1; k < downIdx.length; k++) {
    const len = downIdx[k] - downIdx[k - 1]
    if (len >= 2 && len <= 8) counts[len] = (counts[len] || 0) + 1
  }
  let meter = Number(Object.keys(counts).sort((x, y) => counts[y] - counts[x])[0]) || 4
  if (meter === 2 && downIdx.length > 2) {
    const onChange = (i) => changes.some((c) => Math.abs(c - beats[i]) <= tolerance)
    const even = downIdx.filter((_, k) => k % 2 === 0)
    const odd = downIdx.filter((_, k) => k % 2 === 1)
    downIdx = even.filter(onChange).length >= odd.filter(onChange).length ? even : odd
    isDown.fill(false)
    downIdx.forEach((i) => (isDown[i] = true))
    meter = 4
  }
  const start = downIdx.length ? downIdx[0] : 0
  const pos = new Array(n)
  let p = 0
  for (let i = start; i < n; i++) {
    p = i === start || (isDown[i] && p >= meter - 1) || p >= meter ? 1 : p + 1
    pos[i] = p
  }
  for (let i = 0; i < start; i++) pos[i] = ((((i - start) % meter) + meter) % meter) + 1
  return { pos, meter }
}

/**
 * Counter rows: the song's bars, split wherever the chord changes, so a row
 * never contains two chords (a bar of G then C becomes "1 2" G and "3 4" C).
 * Beats with no chord (N.C.) belong to no row.
 * Each row: { chord, first, last (beat indices), positions (bar beat numbers) }.
 */
export function buildRows(timeline, beats, bars, tolerance = 0.05) {
  const n = beats?.length || 0
  const chordOf = new Array(n).fill(null)
  for (const seg of timeline || []) {
    if (seg.noChord) continue
    const a = firstBeatAtOrAfter(beats, seg.start - tolerance)
    const b = firstBeatAtOrAfter(beats, seg.end - tolerance)
    for (let i = a; i < b; i++) chordOf[i] = seg.name
  }
  const rows = []
  const rowOf = new Array(n).fill(-1)
  for (let i = 0; i < n; i++) {
    if (!chordOf[i]) continue
    const last = rows[rows.length - 1]
    const continues = last && last.last === i - 1 && last.chord === chordOf[i] && bars.pos[i] !== 1
    if (continues) {
      last.last = i
      last.positions.push(bars.pos[i])
    } else {
      rows.push({ chord: chordOf[i], first: i, last: i, positions: [bars.pos[i]] })
    }
    rowOf[i] = rows.length - 1
  }
  return { rows, rowOf }
}

/** The counter row sounding at `time`. Beats are numbered from 1 within the row. */
export function rowAt(rowData, beats, time) {
  const i = beatIndexAt(beats, time)
  if (i < 0 || rowData.rowOf[i] < 0) return null
  const r = rowData.rowOf[i]
  const row = rowData.rows[r]
  return {
    length: row.last - row.first + 1,
    current: i - row.first + 1,
    chord: row.chord,
    prev: rowData.rows[r - 1]?.chord ?? null,
    next: rowData.rows[r + 1]?.chord ?? null,
  }
}

/** Beat indices where a new bar starts (accented by the metronome). */
export function barStarts(bars) {
  return new Set(bars.pos.flatMap((p, i) => (p === 1 ? [i] : [])))
}

/**
 * Chord-by-chord practice steps: playable chord changes, skipping N.C. and
 * blips shorter than `minSeconds`, with repeated neighbours collapsed.
 */
export function practiceSteps(timeline, minSeconds = 0.6) {
  const steps = []
  for (const seg of timeline) {
    if (seg.noChord || seg.end - seg.start < minSeconds) continue
    if (steps.length && steps[steps.length - 1].name === seg.name) continue
    steps.push({ name: seg.name, time: (seg.start + seg.end) / 2, start: seg.start, end: seg.end })
  }
  return steps
}
