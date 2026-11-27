// Real-time guitar chord recognition, in the browser.
//
// A strum is analysed straight from the microphone samples (no upload), so
// feedback arrives as soon as the analysis window has been heard:
//   1. one FFT of a short window just after the strum (pick attack skipped)
//   2. spectral peaks between 70 Hz and 1.6 kHz, frequency refined by
//      parabolic interpolation
//   3. tuning offset = weighted mean deviation of the peaks from equal
//      temperament (a slightly sharp/flat guitar is compensated)
//   4. peaks folded into a 12-bin chroma
//   5. cosine match against chord templates that include each note's first
//      six harmonics (a strummed guitar's overtones are strong), with a small
//      bonus for chords whose root is the lowest strong note (the bass string)
// The result is binary: the strummed chord matches the expected one or not.
// When the expected chord scores almost as well as the winner (a string that
// rang weakly, a slow strum), the player gets the benefit of the doubt.

const ROOTS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const FLAT_TO_SHARP = { Db: 'C#', Eb: 'D#', Gb: 'F#', Ab: 'G#', Bb: 'A#', Cb: 'B', Fb: 'E', 'E#': 'F', 'B#': 'C' }
const DISPLAY_ROOT = { 'C#': 'C#', 'D#': 'Eb', 'F#': 'F#', 'G#': 'Ab', 'A#': 'Bb' }
const QUALITIES = {
  '': [0, 4, 7],
  m: [0, 3, 7],
  dim: [0, 3, 6],
  aug: [0, 4, 8],
  sus2: [0, 2, 7],
  sus4: [0, 5, 7],
  6: [0, 4, 7, 9],
  m6: [0, 3, 7, 9],
  7: [0, 4, 7, 10],
  maj7: [0, 4, 7, 11],
  m7: [0, 3, 7, 10],
  'm(maj7)': [0, 3, 7, 11],
  dim7: [0, 3, 6, 9],
  m7b5: [0, 3, 6, 10],
}
// Beginner families: 6ths, 7ths and sus chords count as their major/minor
// triad (same rule as the song analysis: Asus2 is played as A).
const FAMILY = { '': '', 6: '', 7: '', maj7: '', sus2: '', sus4: '', m: 'm', m6: 'm', m7: 'm', 'm(maj7)': 'm' }
const HARMONICS = [1, 0.6, 0.4, 0.25, 0.18, 0.12]
// Score bonus for a chord whose root is the bass note, and how close (in
// cosine score) the expected chord must be to the winner to still count.
// Tuned on simulated laptop-mic strums: right chords green 97.5% -> 99.1%,
// wrong chords red 99.2% -> 98.8%.
const BASS_BONUS = 0.04
const BENEFIT_OF_DOUBT = 0.02

export function parseChord(name) {
  if (!name || name === 'N.C.' || name === '?') return null
  const rootText = name.length > 1 && (name[1] === '#' || name[1] === 'b') ? name.slice(0, 2) : name.slice(0, 1)
  const root = FLAT_TO_SHARP[rootText] || rootText
  const quality = name.slice(rootText.length)
  if (!ROOTS.includes(root) || !(quality in QUALITIES)) return null
  return { root, quality }
}

function familyKey({ root, quality }) {
  return quality in FAMILY ? `${root}${FAMILY[quality]}` : `${root}${quality}`
}

function displayName({ root, quality }) {
  return (DISPLAY_ROOT[root] || root) + quality
}

function template({ root, quality }) {
  const t = new Float64Array(12)
  const base = ROOTS.indexOf(root)
  for (const interval of QUALITIES[quality]) {
    HARMONICS.forEach((w, h) => {
      t[(base + interval + Math.round(12 * Math.log2(h + 1))) % 12] += w
    })
  }
  const norm = Math.hypot(...t)
  return t.map((v) => v / norm)
}

const TRIADS = ROOTS.flatMap((root) => [{ root, quality: '' }, { root, quality: 'm' }])
const TEMPLATE_CACHE = new Map()
function cachedTemplate(chord) {
  const key = chord.root + chord.quality
  if (!TEMPLATE_CACHE.has(key)) TEMPLATE_CACHE.set(key, template(chord))
  return TEMPLATE_CACHE.get(key)
}

/** In-place iterative radix-2 FFT. re/im are Float64Arrays of length 2^k. */
export function fft(re, im) {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      ;[re[i], re[j]] = [re[j], re[i]]
      ;[im[i], im[j]] = [im[j], im[i]]
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len
    const wr = Math.cos(ang)
    const wi = Math.sin(ang)
    for (let i = 0; i < n; i += len) {
      let cr = 1
      let ci = 0
      for (let k = 0; k < len / 2; k++) {
        const ar = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci
        const ai = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr
        re[i + k + len / 2] = re[i + k] - ar
        im[i + k + len / 2] = im[i + k] - ai
        re[i + k] += ar
        im[i + k] += ai
        const t = cr * wr - ci * wi
        ci = cr * wi + ci * wr
        cr = t
      }
    }
  }
}

/** 12-bin chroma of a mono clip (tuning-compensated), or null if too quiet. */
export function chromaOf(samples, sampleRate, options) {
  return analyse(samples, sampleRate, options)?.chroma ?? null
}

/** Chroma plus the pitch class of the lowest strong note (the bass), or null. */
function analyse(samples, sampleRate, { fftSize = 16384 } = {}) {
  const n = Math.min(samples.length, fftSize)
  const re = new Float64Array(fftSize)
  const im = new Float64Array(fftSize)
  let mean = 0
  for (let i = 0; i < n; i++) mean += samples[i]
  mean /= n || 1
  for (let i = 0; i < n; i++) re[i] = (samples[i] - mean) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)))
  fft(re, im)
  const bins = fftSize / 2
  const mag = new Float64Array(bins)
  for (let k = 0; k < bins; k++) mag[k] = Math.hypot(re[k], im[k])

  const binHz = sampleRate / fftSize
  const lo = Math.max(2, Math.floor(70 / binHz))
  const hi = Math.min(bins - 2, Math.ceil(1600 / binHz))
  let max = 0
  for (let k = lo; k <= hi; k++) max = Math.max(max, mag[k])
  if (max <= 0) return null

  const peaks = []
  for (let k = lo; k <= hi; k++) {
    if (mag[k] > max * 0.03 && mag[k] >= mag[k - 1] && mag[k] > mag[k + 1]) {
      const a = Math.log(mag[k - 1] + 1e-12)
      const b = Math.log(mag[k] + 1e-12)
      const c = Math.log(mag[k + 1] + 1e-12)
      const offset = (0.5 * (a - c)) / (a - 2 * b + c || 1e-12)
      const freq = (k + Math.max(-0.5, Math.min(0.5, offset))) * binHz
      peaks.push({ midi: 69 + 12 * Math.log2(freq / 440), weight: mag[k], freq })
    }
  }
  if (!peaks.length) return null

  // Tuning: weighted circular mean of each peak's deviation from a semitone.
  let s = 0
  let c = 0
  for (const p of peaks) {
    const dev = p.midi - Math.round(p.midi)
    s += p.weight * Math.sin(2 * Math.PI * dev)
    c += p.weight * Math.cos(2 * Math.PI * dev)
  }
  const tuning = Math.atan2(s, c) / (2 * Math.PI)

  const pitchClass = (p) => ((Math.round(p.midi - tuning) % 12) + 12) % 12
  const chroma = new Float64Array(12)
  for (const p of peaks) chroma[pitchClass(p)] += p.weight

  // Bass: the lowest peak that is reasonably strong, if it is in the low register.
  const strongest = Math.max(...peaks.map((p) => p.weight))
  const low = peaks.find((p) => p.weight > strongest * 0.15)
  const bass = low && low.freq < 330 ? pitchClass(low) : null
  return { chroma, bass }
}

/**
 * Is this chroma a played chord rather than noise (claps, rumble, talking) or a
 * single tone (a knock, mains hum)? Measured on test strums: chords keep at least
 * 41% of their energy in their three strongest notes, broadband noise at most 37%.
 */
export function isChordLike(chroma) {
  const sorted = [...chroma].sort((a, b) => b - a)
  const total = sorted.reduce((a, b) => a + b, 0)
  if (!total) return false
  const top3 = (sorted[0] + sorted[1] + sorted[2]) / total
  const top1 = sorted[0] / total
  return top3 >= 0.39 && top1 <= 0.8
}

/**
 * Judge one strum against the expected chord.
 * Returns { status: 'correct' | 'incorrect', detected } or null when the clip
 * holds no usable tone (then no feedback is shown).
 */
export function judgeStrum(samples, sampleRate, expectedName) {
  const expected = parseChord(expectedName)
  if (!expected) return null
  const analysis = analyse(samples, sampleRate)
  if (!analysis || !isChordLike(analysis.chroma)) return null
  const { chroma, bass } = analysis
  const norm = Math.hypot(...chroma)
  if (!norm) return null
  const scoreOf = (cand) => {
    const t = cachedTemplate(cand)
    let score = 0
    for (let i = 0; i < 12; i++) score += (chroma[i] / norm) * t[i]
    return ROOTS.indexOf(cand.root) === bass ? score + BASS_BONUS : score
  }
  const candidates = [...TRIADS]
  if (!(expected.quality in FAMILY)) candidates.push(expected) // dim, aug…
  let best = null
  let bestScore = -1
  for (const cand of candidates) {
    const score = scoreOf(cand)
    if (score > bestScore) {
      bestScore = score
      best = cand
    }
  }
  const target = candidates.find((c) => familyKey(c) === familyKey(expected))
  const correct = familyKey(best) === familyKey(expected) || scoreOf(target) >= bestScore - BENEFIT_OF_DOUBT
  if (correct) return { status: 'correct', detected: expectedName }
  // Spell the detected root like the expected one (Db, not C#) when they match.
  const detected = best.root === expected.root ? displayName(best).replace(/^[A-G][#b]?/, expectedName.match(/^[A-G][#b]?/)[0]) : displayName(best)
  return { status: 'incorrect', detected }
}
