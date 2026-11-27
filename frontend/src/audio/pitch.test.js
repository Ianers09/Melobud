import { describe, expect, it } from 'vitest'
import { describePitch, detectPitch, midiToFrequency, nearestString, STANDARD_TUNING } from './pitch'

const SR = 48000

// A plucked string: fundamental plus decaying harmonics, optional noise.
function pluck(freq, { n = 4096, noise = 0, seed = 1 } = {}) {
  let s = seed
  const rand = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32) * 2 - 1
  return Float32Array.from({ length: n }, (_, i) => {
    let v = 0
    for (let h = 1; h <= 6; h++) v += (0.6 / h) * Math.sin((2 * Math.PI * freq * h * i) / SR + h)
    return v * 0.3 + rand() * noise
  })
}

describe('tuner pitch detection', () => {
  it('finds every open string within 2 cents', () => {
    for (const string of STANDARD_TUNING) {
      const f = midiToFrequency(string.midi)
      const got = detectPitch(pluck(f, { noise: 0.01 }), SR)
      expect(Math.abs(1200 * Math.log2(got / f))).toBeLessThan(2)
    }
  })

  it('reports how far a detuned string is', () => {
    const f = midiToFrequency(45) * 2 ** (-18 / 1200) // A string, 18 cents flat
    const s = nearestString(detectPitch(pluck(f), SR))
    expect(s.string).toBe(5)
    expect(s.cents).toBeGreaterThanOrEqual(-20)
    expect(s.cents).toBeLessThanOrEqual(-16)
  })

  it('names notes', () => {
    expect(describePitch(440)).toEqual({ name: 'A', octave: 4, midi: 69, cents: 0 })
    expect(describePitch(82.41).name).toBe('E')
  })

  it('returns null for silence and noise', () => {
    expect(detectPitch(new Float32Array(4096), SR)).toBeNull()
    let s = 3
    const noise = Float32Array.from({ length: 4096 }, () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32) * 2 - 1)
    expect(detectPitch(noise, SR)).toBeNull()
  })
})
