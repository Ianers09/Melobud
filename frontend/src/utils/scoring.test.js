import { describe, expect, it } from 'vitest'
import { ChordScorer, unitForStrum } from './scoring'

const timeline = [
  { name: 'N.C.', start: 0, end: 1, noChord: true, index: 0 },
  { name: 'F', start: 1, end: 5, index: 1 },
  { name: 'Bb', start: 5, end: 7, index: 2 },
  { name: 'C', start: 7, end: 9, index: 3 },
  { name: 'F', start: 9, end: 12, index: 4 },
]

function play(scorer, from, to, strums = {}) {
  for (let t = from; t <= to + 1e-9; t += 1 / 60) {
    for (const [at, args] of Object.entries(strums)) if (Math.abs(t - Number(at)) < 1 / 120) scorer.strum(...args)
    scorer.tick(t, true)
  }
}

function collect() {
  const results = []
  return { results, onResult: (r) => results.push(`${r.name}:${r.status}${r.detected ? `(${r.detected})` : ''}`) }
}

describe('practice scoring (one result per bar)', () => {
  it('records one result per chord, not per strum', () => {
    const { results, onResult } = collect()
    const s = new ChordScorer(timeline, onResult)
    play(s, 0, 12, {
      1.5: [1, 'F', 1, 'correct'], 2.5: [1, 'F', 1, 'correct'], 3.5: [1, 'F', 1, 'correct'], 4.5: [1, 'F', 1, 'correct'],
      5.5: [2, 'Bb', 5, 'incorrect', 'B'], 6.0: [2, 'Bb', 5, 'incorrect', 'B'], 6.5: [2, 'Bb', 5, 'correct'],
    })
    expect(results).toEqual(['F:correct', 'Bb:incorrect(B)', 'C:missed']) // last F is still playing
    s.flush()
    expect(results).toHaveLength(3)
  })

  it('marks chords played through without a strum as missed', () => {
    const { results, onResult } = collect()
    const s = new ChordScorer(timeline, onResult)
    play(s, 0, 12.5)
    expect(results).toEqual(['F:missed', 'Bb:missed', 'C:missed', 'F:missed'])
  })

  it('a strum on the change (within the grace period) still counts for the chord', () => {
    const { results, onResult } = collect()
    const s = new ChordScorer(timeline, onResult)
    play(s, 0, 9.5, { 5.2: [1, 'F', 1, 'correct'] }) // late strum judged for F after Bb started
    expect(results[0]).toBe('F:correct')
  })

  it('any wrong strum makes the chord incorrect; skip with no strum is missed', () => {
    const { results, onResult } = collect()
    const s = new ChordScorer([], onResult)
    s.strum(0, 'G', 0, 'incorrect', 'Em')
    s.strum(0, 'G', 0, 'correct')
    s.settle(0)
    s.skip(1, 'C', 1)
    s.strum(2, 'D', 2, 'incorrect', 'Dm')
    s.skip(2, 'D', 2)
    expect(results).toEqual(['G:incorrect(Em)', 'C:missed', 'D:incorrect(Dm)'])
  })

  it('step mode: the first strum is the result, retries do not change it', () => {
    const { results, onResult } = collect()
    const s = new ChordScorer([], onResult)
    s.strum(0, 'C', 0, 'incorrect', 'Am')
    s.settle(0) // shown immediately
    s.strum(0, 'C', 0, 'correct') // retry until right
    s.settle(0)
    s.skip(0, 'C', 0)
    s.strum(1, 'G', 1, 'correct')
    s.settle(1)
    s.skip(2, 'D', 2)
    expect(results).toEqual(['C:incorrect(Am)', 'G:correct', 'D:missed'])
  })

  it('counts the bar before a gap (no units) as missed', () => {
    const bars = [
      { name: 'G', start: 1, end: 3 },
      { name: 'D', start: 3, end: 5 },
      { name: 'C', start: 8, end: 10 }, // gap 5-8 (no chord)
    ]
    const { results, onResult } = collect()
    const s = new ChordScorer(bars, onResult)
    play(s, 0, 11, { 1.5: [0, 'G', 1, 'correct'] })
    expect(results).toEqual(['G:correct', 'D:missed', 'C:missed'])
  })

  it('does not count chords reached by seeking as missed', () => {
    const { results, onResult } = collect()
    const s = new ChordScorer(timeline, onResult)
    s.tick(2, true)
    s.tick(8, true) // seek into C
    for (let t = 8; t <= 12.5; t += 1 / 60) s.tick(t, true)
    // F (left by the seek) and C (entered mid-way) are not counted; the last F,
    // played through from its start to its end, is.
    expect(results).toEqual(['F:missed'])
  })
})

// End-to-end: a player strums through a song with human timing, and the
// recorded result of every bar must match what was actually played.
describe('practice scoring accuracy (simulated player)', () => {
  const BEAT = 0.5
  const CHORDS = ['F', 'F', 'Bb', 'C', 'F', 'F', 'Dm', 'Dm', 'Bb', 'C', 'F', 'F', 'Am', 'Bb', 'C', 'C']
  const units = CHORDS.map((name, i) => ({ name, start: 1 + i * 4 * BEAT, end: 1 + (i + 1) * 4 * BEAT }))

  function rng(seed) {
    let s = seed
    return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32)
  }

  function simulate(seed, style) {
    const rand = rng(seed)
    // What the player does in each bar: right chord, wrong chord, nothing, or a mix.
    const plan = units.map(() => ['correct', 'wrong', 'silent', 'mostly-right', 'mostly-wrong'][Math.floor(rand() * 5)])
    const strums = []
    units.forEach((u, b) => {
      if (plan[b] === 'silent') return
      const beats = style === 'once' ? [0] : [0, 1, 2, 3]
      beats.forEach((k, n) => {
        const at = u.start + k * BEAT + (rand() * 2 - 1) * 0.15 // human timing, up to 0.15 s early or late
        const right =
          plan[b] === 'correct' || (plan[b] === 'mostly-right' && (style === 'once' || n !== 1)) || (plan[b] === 'mostly-wrong' && style !== 'once' && n === 0)
        strums.push({ at, deliver: at + 0.3, name: u.name, status: right ? 'correct' : 'incorrect', detected: right ? null : 'E' })
      })
    })
    const results = []
    const scorer = new ChordScorer(units, (r) => (results[r.key] = r.status))
    let next = 0
    strums.sort((a, b) => a.deliver - b.deliver)
    for (let t = 0; t < units[units.length - 1].end + 1; t += 1 / 60) {
      while (next < strums.length && strums[next].deliver <= t) {
        const s = strums[next++]
        const key = unitForStrum(units, s.name, s.at)
        scorer.strum(key, s.name, units[key].start, s.status, s.detected)
      }
      scorer.tick(t, true)
    }
    // Any wrong strum in a bar makes it incorrect (with one strum, 'mostly-right' is all right).
    const want = plan.map((p) => ({ correct: 'correct', 'mostly-right': style === 'once' ? 'correct' : 'incorrect', wrong: 'incorrect', 'mostly-wrong': 'incorrect', silent: 'missed' })[p])
    return { results, want }
  }

  it('records exactly one correct result for every bar strummed on each beat', () => {
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const { results, want } = simulate(seed, 'beats')
      expect(results).toEqual(want)
    }
  })

  it('records the right result when strumming once per bar', () => {
    for (const seed of [11, 12, 13, 14, 15, 16, 17, 18]) {
      const { results, want } = simulate(seed, 'once')
      expect(results).toEqual(want)
    }
  })
})
