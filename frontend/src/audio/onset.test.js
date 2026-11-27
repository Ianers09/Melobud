import { describe, expect, it } from 'vitest'
import { createOnsetDetector } from './onset'

const SR = 48000
const BLOCK = 1024
const OPEN = [40, 45, 50, 55, 59, 64]
const SHAPES = [[0, 2, 2, 1, 0, 0], [null, 2, 4, 4, 4, 2], [null, 4, 6, 6, 5, 4], [null, 0, 2, 2, 2, 0]]

function rng(seed) {
  let s = seed
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32)
}

// Continuous strumming: a strum every 0.45-1.0 s over the still-ringing previous chord.
function strumming(levelDb, seed) {
  const rand = rng(seed)
  const out = new Float32Array(SR * 12)
  const onsets = []
  for (let t = 0.8, k = 0; t < 11; t += 0.45 + rand() * 0.55, k++) {
    const t0 = Math.round(t * SR)
    onsets.push(t0)
    const amp = 10 ** ((levelDb - rand() * 8) / 20)
    SHAPES[Math.floor(k / 4) % 4].forEach((fret, s) => {
      if (fret === null) return
      const f = 440 * 2 ** ((OPEN[s] + fret - 69) / 12)
      const start = t0 + Math.round(s * 0.012 * SR)
      for (let n = 1; n <= 6; n++) {
        const w = (2 * Math.PI * n * f) / SR
        const d = (1 + n * 0.5) / SR
        for (let i = 0; start + i < out.length && i < SR * 2.5; i++) out[start + i] += ((amp * 0.15) / n) * Math.exp(-d * i) * Math.sin(w * i) * Math.min(1, i / 48)
      }
    })
  }
  for (let i = 0; i < out.length; i++) out[i] += (rand() * 2 - 1) * 0.0008
  return { out, onsets }
}

function run(out) {
  const detect = createOnsetDetector(SR)
  const hits = []
  for (let o = 0; o + BLOCK <= out.length; o += BLOCK) {
    const block = out.subarray(o, o + BLOCK).map((v) => v * 16) // the +24 dB analysis boost
    if (detect(block, (o / SR) * 1000)) hits.push(o)
  }
  return hits
}

describe('strum onset detection', () => {
  it('catches strums played over a ringing chord, normal and light', () => {
    for (const level of [-10, -28]) {
      const { out, onsets } = strumming(level, 3)
      const hits = run(out)
      const found = onsets.filter((on) => hits.some((h) => h >= on - BLOCK && h <= on + 0.12 * SR)).length
      expect(found / onsets.length).toBeGreaterThanOrEqual(0.85)
    }
  })

  it('stays quiet on silence, room noise and a fading chord', () => {
    const rand = rng(7)
    const noise = Float32Array.from({ length: SR * 4 }, () => (rand() * 2 - 1) * 0.001)
    expect(run(noise)).toEqual([])
    const fading = Float32Array.from({ length: SR * 4 }, (_, i) => 0.2 * Math.exp(-i / SR) * (Math.sin((2 * Math.PI * 196 * i) / SR) + 0.5 * Math.sin((2 * Math.PI * 247 * i) / SR)))
    expect(run(fading).length).toBeLessThanOrEqual(1) // at most the very start
  })
})
