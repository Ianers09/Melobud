import { describe, expect, it } from 'vitest'
import { evaluateSession } from './evaluation'

const attempt = (expected, result, detected = null, song_time = 0) => ({ expected, result, detected, song_time })

function session(mode, timeline) {
  const attempts = { correct: 0, incorrect: 0, missed: 0 }
  const per = {}
  for (const t of timeline) {
    attempts[t.result] += 1
    per[t.expected] ??= { chord: t.expected, correct: 0, incorrect: 0, missed: 0 }
    per[t.expected][t.result] += 1
  }
  return { mode, attempts, chords: Object.values(per), timeline }
}

describe('session evaluation', () => {
  it('returns null when nothing was judged', () => {
    expect(evaluateSession(session('step', []))).toBeNull()
  })

  it('names strengths and explains a major/minor confusion', () => {
    const s = session('step', [
      attempt('G', 'correct'), attempt('G', 'correct'), attempt('G', 'correct'),
      attempt('Am', 'incorrect', 'A'), attempt('Am', 'incorrect', 'A'), attempt('Am', 'correct'),
    ])
    const r = evaluateSession(s)
    expect(r.rating.label).toBe('Developing')
    expect(r.strengths[0]).toContain('G was played cleanly')
    expect(r.improvements[0].chord).toBe('Am')
    expect(r.improvements[0].cause).toContain('major or minor')
    expect(r.chords[0].chord).toBe('Am') // weakest first
  })

  it('detects a late change in play-along', () => {
    const s = session('play_along', [
      attempt('C', 'correct', null, 1), attempt('G', 'incorrect', 'C', 3), attempt('G', 'incorrect', 'C', 3.5),
      attempt('C', 'correct', null, 5), attempt('G', 'correct', null, 7),
    ])
    const r = evaluateSession(s)
    expect(r.improvements[0].cause).toContain('still playing C')
  })

  it('flags a semitone error as tuning or fret position', () => {
    const s = session('step', [attempt('Ab', 'incorrect', 'G'), attempt('Ab', 'incorrect', 'G'), attempt('Ab', 'correct')])
    const r = evaluateSession(s)
    expect(r.improvements[0].tip).toContain('tuning')
    expect(r.next.some((n) => n.includes('Tune your guitar'))).toBe(true)
  })

  it('recommends the next mode from accuracy', () => {
    const good = session('step', Array.from({ length: 10 }, () => attempt('C', 'correct')))
    expect(evaluateSession(good).next[0]).toContain('Play-along')
    const many = session('play_along', [
      ...Array.from({ length: 4 }, (_, i) => attempt('D', 'missed', null, i)),
      attempt('D', 'correct', null, 9),
    ])
    const r = evaluateSession(many)
    expect(r.improvements.some((i) => i.title.includes('missed'))).toBe(true)
    expect(r.next[0]).toContain('Step-by-step')
  })
})
