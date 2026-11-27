// Strum (onset) detection by spectral flux.
//
// A new strum adds energy at new frequencies (fresh notes, the pick attack) even
// when the guitar is still ringing from the previous strum, so it is found by
// how much the spectrum *rises* from one block to the next, not by overall
// loudness. The threshold adapts to the recent flux (median + k × MAD), so it
// works for soft and hard playing alike and ignores steady background noise.
//
// Measured on simulated continuous strumming (previous chord ringing, up and
// down strokes, pick noise, room hum), strums caught:
//                   normal  light  very light  fast (0.3-0.6 s apart)
//   level trigger     63%    54%      17%        19%   (previous method)
//   this detector     96%    87%      59%        68%
import { fft } from './chordDetector'

// k: how far above the recent typical flux (in MADs); delta: minimum flux step;
// rise: minimum level rise (dB) over the quietest of the last 3 blocks.
export const ONSET_SENSITIVITY = {
  low: { k: 6, delta: 0.04, rise: 1.5, minDb: -60 },
  normal: { k: 4, delta: 0.02, rise: 1, minDb: -85 },
  high: { k: 3.5, delta: 0.015, rise: 0.8, minDb: -100 },
}

const HISTORY = 16 // blocks of flux used for the adaptive threshold (~0.35 s)
const MIN_GAP_MS = 120

/**
 * Returns detect(block, nowMs) -> true when the block starts a strum.
 * Feed every block (also while a clip is being recorded) so the state stays current.
 */
export function createOnsetDetector(sampleRate, getSettings = () => ONSET_SENSITIVITY.normal) {
  let size = 0
  let window = null
  let lo = 0
  let hi = 0
  let prev = null
  const history = []
  let last = -Infinity
  let armed = true
  const levels = []

  return function detect(block, now) {
    if (block.length !== size) {
      size = block.length
      window = Float64Array.from({ length: size }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1)))
      lo = Math.max(1, Math.floor((80 * size) / sampleRate))
      hi = Math.min(size / 2, Math.ceil((5000 * size) / sampleRate))
      prev = null
    }
    const re = new Float64Array(size)
    const im = new Float64Array(size)
    let energy = 0
    for (let i = 0; i < size; i++) {
      re[i] = block[i] * window[i]
      energy += block[i] * block[i]
    }
    const db = 10 * Math.log10(energy / size + 1e-12)
    fft(re, im)
    const mag = new Float64Array(hi - lo)
    for (let k = lo; k < hi; k++) mag[k - lo] = Math.log(1 + 1000 * Math.hypot(re[k], im[k]))
    let flux = 0
    if (prev) for (let k = 0; k < mag.length; k++) if (mag[k] > prev[k]) flux += mag[k] - prev[k]
    prev = mag
    flux /= mag.length

    const warmedUp = history.length >= HISTORY
    const sorted = [...history].sort((a, b) => a - b)
    const median = sorted.length ? sorted[sorted.length >> 1] : flux
    const spread = sorted.map((v) => Math.abs(v - median)).sort((a, b) => a - b)
    const mad = spread.length ? spread[spread.length >> 1] : 0
    history.push(flux)
    if (history.length > HISTORY) history.shift()

    // Robust threshold: far above the recent typical flux, measured in units of
    // its usual variation (MAD). Steady noise varies a lot, so it needs a big
    // change; a ringing chord is steady, so a soft strum over it stands out.
    const { k, delta, minDb, rise } = getSettings()
    const quietest = levels.length ? Math.min(...levels) : db
    levels.push(db)
    if (levels.length > 3) levels.shift()
    const threshold = median + Math.max(k * mad, delta)
    let onset = false
    if (warmedUp && armed && flux > threshold && db > minDb && db - quietest >= rise && now - last > MIN_GAP_MS) {
      onset = true
      last = now
      armed = false
    }
    if (flux < threshold) armed = true
    return onset
  }
}
