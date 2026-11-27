import { describe, expect, it } from 'vitest'
import { chromaOf, isChordLike, judgeStrum, parseChord } from './chordDetector'

// Karplus–Strong plucked strings playing real guitar voicings (test fixture).
const OPEN = [40, 45, 50, 55, 59, 64]
const SHAPES = {
  C: [null, 3, 2, 0, 1, 0], D: [null, null, 0, 2, 3, 2], E: [0, 2, 2, 1, 0, 0], F: [1, 3, 3, 2, 1, 1],
  G: [3, 2, 0, 0, 0, 3], A: [null, 0, 2, 2, 2, 0], Am: [null, 0, 2, 2, 1, 0], Dm: [null, null, 0, 2, 3, 1],
  Em: [0, 2, 2, 0, 0, 0], G7: [3, 2, 0, 0, 0, 1], Bm: [null, 2, 4, 4, 3, 2], Bb: [null, 1, 3, 3, 3, 1],
}

function rng(seed) {
  let s = seed >>> 0 || 1
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32)
}

function strum(name, { sr = 48000, seconds = 0.5, cents = 0, noise = 0, seed = 1 } = {}) {
  const rand = rng(seed)
  const out = new Float32Array(Math.round(sr * seconds))
  SHAPES[name].forEach((fret, s) => {
    if (fret === null) return
    const f = 440 * 2 ** ((OPEN[s] + fret - 69 + cents / 100) / 12)
    const period = Math.max(2, Math.round(sr / f))
    const buf = Float64Array.from({ length: period }, () => rand() * 2 - 1)
    const start = Math.round(s * 0.012 * sr)
    const gain = 0.7 + 0.3 * rand()
    for (let i = 0; i + start < out.length; i++) {
      const j = i % period
      out[i + start] += buf[j] * gain * 0.2
      buf[j] = 0.996 * 0.5 * (buf[j] + buf[(j + 1) % period])
    }
  })
  if (noise) for (let i = 0; i < out.length; i++) out[i] += (rand() * 2 - 1) * noise
  return out
}

const RIGHT = ['A', 'Am', 'C', 'D', 'Dm', 'E', 'Em', 'F', 'G', 'G7', 'Bm', 'Bb']
const WRONG = [['G', 'C'], ['Am', 'C'], ['Em', 'G'], ['C', 'Am'], ['Dm', 'F'], ['D', 'Dm'], ['E', 'Em'], ['A', 'Am'], ['Am', 'A'], ['Bm', 'D'], ['F', 'Dm'], ['C', 'Em']]

describe('chord detector', () => {
  it('parses display names', () => {
    expect(parseChord('Bb')).toEqual({ root: 'A#', quality: '' })
    expect(parseChord('F#m')).toEqual({ root: 'F#', quality: 'm' })
    expect(parseChord('N.C.')).toBeNull()
  })

  it('marks the right chord green (open and barre shapes, detuned, noisy)', () => {
    let ok = 0
    let total = 0
    for (const name of RIGHT) {
      for (const [cents, noise, seed] of [[0, 0, 1], [15, 0.005, 2], [-25, 0.01, 3], [30, 0.003, 4]]) {
        total += 1
        if (judgeStrum(strum(name, { cents, noise, seed }), 48000, name)?.status === 'correct') ok += 1
      }
    }
    expect(ok / total).toBeGreaterThanOrEqual(0.95)
  })

  it('marks a wrong chord red', () => {
    let red = 0
    let total = 0
    for (const [played, expected] of WRONG) {
      for (const [cents, noise, seed] of [[0, 0, 5], [-15, 0.005, 6], [20, 0.01, 7]]) {
        total += 1
        if (judgeStrum(strum(played, { cents, noise, seed }), 48000, expected)?.status === 'incorrect') red += 1
      }
    }
    expect(red / total).toBeGreaterThanOrEqual(0.95)
  })

  it('spells the detected chord like the expected one', () => {
    // Bb played, Bbm expected: same root, shown with the song's spelling.
    expect(judgeStrum(strum('Bb', { seed: 3 }), 48000, 'Bbm')).toEqual({ status: 'incorrect', detected: 'Bb' })
    expect(judgeStrum(strum('Bb', { seed: 3 }), 48000, 'A#m')).toEqual({ status: 'incorrect', detected: 'A#' })
    expect(judgeStrum(strum('Bb', { seed: 3 }), 48000, 'A#')).toEqual({ status: 'correct', detected: 'A#' })
  })

  it('treats a 7th chord as its beginner triad', () => {
    expect(judgeStrum(strum('G7'), 48000, 'G').status).toBe('correct')
  })

  it('works on very quiet input (no volume needed)', () => {
    for (const name of RIGHT) {
      const quiet = strum(name, { seed: 4 }).map((v) => v * 0.002) // about -60 dB quieter
      expect(judgeStrum(quiet.subarray(1920, 1920 + 10560), 48000, name)?.status).toBe('correct')
    }
  })

  it('ignores noise and single tones instead of marking them wrong', () => {
    const rand = rng(11)
    const clip = (f) => Float32Array.from({ length: 10560 }, (_, i) => f(i))
    let b = 0
    const sounds = [
      clip(() => rand() * 2 - 1), // hiss
      clip((i) => (rand() * 2 - 1) * Math.exp(-i / 800)), // clap
      clip(() => (b = 0.98 * b + (rand() * 2 - 1) * 0.1)), // rumble
      clip((i) => Math.sin((2 * Math.PI * 120 * i) / 48000) * Math.exp(-i / 2000)), // knock
    ]
    for (const sound of sounds) expect(judgeStrum(sound, 48000, 'C')).toBeNull()
    for (const name of RIGHT) expect(isChordLike(chromaOf(strum(name, { noise: 0.05, seed: 9 }).subarray(1920, 12480), 48000))).toBe(true)
  })
})
