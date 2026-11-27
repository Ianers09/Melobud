// Single-note pitch detection for the guitar tuner (YIN, de Cheveigné & Kawahara 2002).
// Works on one block of raw microphone samples; no allocation-heavy FFT needed.

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

/** Standard tuning, low to high (string 6 to string 1). */
export const STANDARD_TUNING = [
  { string: 6, name: 'E', octave: 2, midi: 40 },
  { string: 5, name: 'A', octave: 2, midi: 45 },
  { string: 4, name: 'D', octave: 3, midi: 50 },
  { string: 3, name: 'G', octave: 3, midi: 55 },
  { string: 2, name: 'B', octave: 3, midi: 59 },
  { string: 1, name: 'E', octave: 4, midi: 64 },
]

export const midiToFrequency = (midi, a4 = 440) => a4 * 2 ** ((midi - 69) / 12)

/**
 * Fundamental frequency of a block (Hz), or null when there is no clear pitch
 * (silence, noise, or a chord). Range covers a guitar in standard or drop tuning.
 */
export function detectPitch(samples, sampleRate, { minHz = 60, maxHz = 1100, threshold = 0.12, minRms = 0.002 } = {}) {
  const n = samples.length
  let energy = 0
  for (let i = 0; i < n; i++) energy += samples[i] * samples[i]
  if (Math.sqrt(energy / n) < minRms) return null

  const maxLag = Math.min(Math.floor(sampleRate / minHz), Math.floor(n / 2))
  const minLag = Math.max(2, Math.floor(sampleRate / maxHz))
  const window = n - maxLag
  const diff = new Float32Array(maxLag + 1)
  for (let lag = 1; lag <= maxLag; lag++) {
    let sum = 0
    for (let i = 0; i < window; i++) {
      const d = samples[i] - samples[i + lag]
      sum += d * d
    }
    diff[lag] = sum
  }
  // Cumulative mean normalised difference.
  let running = 0
  diff[0] = 1
  for (let lag = 1; lag <= maxLag; lag++) {
    running += diff[lag]
    diff[lag] = running ? (diff[lag] * lag) / running : 1
  }
  let lag = -1
  for (let t = minLag; t <= maxLag; t++) {
    if (diff[t] < threshold) {
      while (t + 1 <= maxLag && diff[t + 1] < diff[t]) t++
      lag = t
      break
    }
  }
  if (lag < 0) return null
  // Parabolic interpolation around the minimum for sub-sample accuracy.
  const a = diff[lag - 1] ?? diff[lag]
  const b = diff[lag]
  const c = diff[lag + 1] ?? diff[lag]
  const denom = a - 2 * b + c
  const shift = denom ? (0.5 * (a - c)) / denom : 0
  return sampleRate / (lag + Math.max(-1, Math.min(1, shift)))
}

/** Nearest note to a frequency: { name, octave, midi, cents } (cents in -50..50). */
export function describePitch(frequency, a4 = 440) {
  const exact = 69 + 12 * Math.log2(frequency / a4)
  const midi = Math.round(exact)
  return {
    name: NOTE_NAMES[((midi % 12) + 12) % 12],
    octave: Math.floor(midi / 12) - 1,
    midi,
    cents: Math.round((exact - midi) * 100),
  }
}

/** The open string closest to a frequency, and how far off it is in cents. */
export function nearestString(frequency, tuning = STANDARD_TUNING) {
  const exact = 69 + 12 * Math.log2(frequency / 440)
  let best = tuning[0]
  for (const s of tuning) if (Math.abs(exact - s.midi) < Math.abs(exact - best.midi)) best = s
  return { ...best, cents: Math.round((exact - best.midi) * 100) }
}
