import { describe, expect, it } from 'vitest'
import { alignToBeats, barStarts, beatIndexAt, chordsBetween, extendBeats, buildBars, buildRows, buildTimeline, findIndexAt, neighbours, practiceSteps, rowAt } from './timeline'

const seg = (start, end, raw, label, simple, confidence = 0.8) => ({ start, end, raw, label, simple, confidence, simple_confidence: 0.9 })
const SEGMENTS = [
  seg(0, 2, 'N', 'N.C.', 'N.C.'),
  seg(2, 4, 'G', 'G', 'G'),
  seg(4, 6, 'G:maj7', 'Gmaj7', 'G', 0.4),
  seg(6, 8.5, 'C', 'C', 'C'),
  seg(8.5, 8.7, 'D', 'D', 'D'),
  seg(8.7, 12, 'C', 'C', 'C'),
]

describe('buildTimeline', () => {
  it('merges identical beginner chords but keeps the raw predictions', () => {
    const t = buildTimeline(SEGMENTS, 'simple')
    expect(t.map((s) => s.name)).toEqual(['N.C.', 'G', 'C', 'D', 'C'])
    expect(t[1]).toMatchObject({ start: 2, end: 6, raws: ['G', 'G:maj7'] })
    expect(t[1].confidence).toBeCloseTo(0.6)
  })
  it('keeps every change in full mode', () => {
    expect(buildTimeline(SEGMENTS, 'full').map((s) => s.name)).toEqual(['N.C.', 'G', 'Gmaj7', 'C', 'D', 'C'])
  })
})

describe('lookup', () => {
  const t = buildTimeline(SEGMENTS, 'simple')
  it('finds the segment at a time, including boundaries', () => {
    expect(findIndexAt(t, 0)).toBe(0)
    expect(findIndexAt(t, 2)).toBe(1)
    expect(findIndexAt(t, 5.99)).toBe(1)
    expect(findIndexAt(t, 6)).toBe(2)
    expect(findIndexAt(t, 99)).toBe(-1)
  })
  it('skips N.C. when finding neighbours', () => {
    expect(neighbours(t, 1)).toMatchObject({ prev: null, next: { name: 'C' } })
  })
  it('builds practice steps without blips or repeats', () => {
    expect(practiceSteps(t).map((s) => s.name)).toEqual(['G', 'C'])
  })
})

describe('beats', () => {
  const beats = [1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5]
  it('finds the current beat', () => {
    expect(beatIndexAt(beats, 0.5)).toBe(-1)
    expect(beatIndexAt(beats, 2.2)).toBe(2)
  })
  const grid = Array.from({ length: 20 }, (_, i) => i * 0.5) // 20 beats, bars every 2 s
  it('moves every chord change onto its nearest beat', () => {
    const t = buildTimeline([seg(0, 1.3, 'G', 'G', 'G'), seg(1.3, 2.9, 'C', 'C', 'C'), seg(2.9, 4, 'D', 'D', 'D')])
    const aligned = alignToBeats(t, grid)
    expect(aligned.map((s) => [s.name, s.start, s.end])).toEqual([['G', 0, 1.5], ['C', 1.5, 3], ['D', 3, 4]])
  })
  it('merges chords that collapse onto the same beat', () => {
    const t = buildTimeline([seg(0, 1.1, 'G', 'G', 'G'), seg(1.1, 1.2, 'C', 'C', 'C'), seg(1.2, 3, 'G', 'G', 'G')])
    expect(alignToBeats(t, grid).map((s) => s.name)).toEqual(['G'])
  })
  const bars4 = () => buildBars(grid, [0, 2, 4, 6, 8])
  it('builds the bar grid from downbeats, ignoring spurious ones and filling missed ones', () => {
    const bars = buildBars(grid, [0, 2, 3, 6, 8]) // 3.0 is spurious, 4.0 is missing
    expect(bars.meter).toBe(4)
    expect(bars.pos.slice(0, 12)).toEqual([1, 2, 3, 4, 1, 2, 3, 4, 1, 2, 3, 4])
  })
  it('counts a pickup into the first bar and supports 3-beat bars', () => {
    expect(buildBars(grid, [1, 3, 5, 7]).pos.slice(0, 4)).toEqual([3, 4, 1, 2])
    const waltz = buildBars(grid, [0, 1.5, 3, 4.5, 6])
    expect(waltz.meter).toBe(3)
    expect(waltz.pos.slice(0, 7)).toEqual([1, 2, 3, 1, 2, 3, 1])
  })
  it('counts 6/8 bars in four (12/8), pairing them on the chord changes', () => {
    const bars = buildBars(grid, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 3, 5])
    expect(bars.meter).toBe(4)
    expect(bars.pos.slice(0, 6)).toEqual([3, 4, 1, 2, 3, 4])
  })
  it('makes one row per bar per chord, splitting a bar at a chord change', () => {
    const timeline = [
      { name: 'G', start: 0, end: 4 }, // two bars
      { name: 'C', start: 4, end: 5 }, // half a bar
      { name: 'D', start: 5, end: 6 }, // the other half
    ]
    const { rows } = buildRows(timeline, grid, bars4())
    expect(rows.map((r) => [r.chord, r.positions])).toEqual([
      ['G', [1, 2, 3, 4]],
      ['G', [1, 2, 3, 4]],
      ['C', [1, 2]],
      ['D', [3, 4]],
    ])
  })
  it('gives no beats to N.C. and names the next row, even when it is the same chord', () => {
    const timeline = [
      { name: 'N.C.', noChord: true, start: 0, end: 1 },
      { name: 'G', start: 1, end: 6 },
    ]
    const data = buildRows(timeline, grid, bars4())
    expect(rowAt(data, grid, 0.6)).toBeNull()
    expect(rowAt(data, grid, 1.1)).toMatchObject({ length: 2, current: 1, chord: 'G', next: 'G', prev: null })
    expect(rowAt(data, grid, 2.1)).toMatchObject({ length: 4, current: 1, prev: 'G', next: 'G' })
  })
  it('numbers each row from 1', () => {
    const timeline = [
      { name: 'G', start: 0, end: 3 }, // a bar and a half
      { name: 'C', start: 3, end: 4 },
    ]
    const data = buildRows(timeline, grid, bars4())
    expect(rowAt(data, grid, 0.1)).toMatchObject({ length: 4, current: 1 })
    expect(rowAt(data, grid, 2.6)).toMatchObject({ length: 2, current: 2, chord: 'G', next: 'C' })
    expect(rowAt(data, grid, 3.1)).toMatchObject({ length: 2, current: 1, chord: 'C' })
  })
  it('extends the beat grid back to 0:00 at the song tempo', () => {
    expect(extendBeats([1.5, 2, 2.5, 3, 3.5])).toEqual([0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5])
  })
  it('numbers a long count-in in whole bars ending on the first downbeat', () => {
    const bars = buildBars(grid, [3, 5, 7]) // first downbeat on beat index 6
    expect(bars.pos.slice(0, 8)).toEqual([3, 4, 1, 2, 3, 4, 1, 2])
  })
  it('lists the chords sounding around a strum', () => {
    const timeline = [{ name: 'C#m', start: 0, end: 2 }, { name: 'A', start: 2, end: 4 }, { name: 'N.C.', noChord: true, start: 4, end: 5 }]
    expect(chordsBetween(timeline, 1.8, 2.3)).toEqual(['C#m', 'A'])
    expect(chordsBetween(timeline, 0.5, 1.0)).toEqual(['C#m'])
    expect(chordsBetween(timeline, 3.9, 4.6)).toEqual(['A'])
  })
  it('accents beat 1 of every bar', () => {
    expect([...barStarts(bars4())].slice(0, 3)).toEqual([0, 4, 8])
  })
})
