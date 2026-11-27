// Written performance review for a practice session.
//
// Turns the raw attempts (expected chord, detected chord, result) into an
// overall rating, strengths, specific problems with their likely cause, and
// concrete next steps. Everything is derived from what was recorded; nothing
// is guessed when there is too little data.
import { parseChord } from '../audio/chordDetector'

const ROOTS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const MINOR = new Set(['m', 'm6', 'm7', 'm(maj7)'])
const MIN_ATTEMPTS = 2 // per chord, before judging it

const pct = (x) => `${Math.round(x * 100)}%`
const list = (items) => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`)

function rating(accuracy) {
  if (accuracy >= 0.9) return { label: 'Excellent', tone: 'good', text: 'You played the song accurately and consistently.' }
  if (accuracy >= 0.75) return { label: 'Good', tone: 'good', text: 'Most chords were correct. A few need attention.' }
  if (accuracy >= 0.5) return { label: 'Developing', tone: 'warn', text: 'You know the progression. Accuracy on some chords is holding you back.' }
  return { label: 'Needs practice', tone: 'bad', text: 'Several chords were not recognized as correct. Focus on the points below.' }
}

/** Why a played chord was heard as another one. */
function classify(expected, detected, neighbors) {
  if (neighbors.previous === detected) return 'late'
  if (neighbors.next === detected) return 'early'
  const e = parseChord(expected)
  const d = parseChord(detected)
  if (!e || !d) return 'other'
  const interval = (ROOTS.indexOf(d.root) - ROOTS.indexOf(e.root) + 12) % 12
  if (interval === 0 && MINOR.has(e.quality) !== MINOR.has(d.quality)) return 'third'
  if ((interval === 1 || interval === 11) && MINOR.has(e.quality) === MINOR.has(d.quality)) return 'semitone'
  return 'other'
}

const ADVICE = {
  third: (exp, det) => ({
    cause: `${exp} was heard as ${det}: the note that makes the chord major or minor is not ringing clearly.`,
    tip: `Press the string that changes ${exp} from ${det} firmly with your fingertip, and keep neighboring fingers from touching it. Strum and check that every string rings.`,
  }),
  semitone: (exp, det) => ({
    cause: `${exp} was heard as ${det}, one fret away.`,
    tip: 'Check your tuning with the tuner, confirm the capo position, and make sure the chord shape is on the correct fret.',
  }),
  late: (exp, det) => ({
    cause: `You were still playing ${det} when the song had moved to ${exp}.`,
    tip: `Practice the change into ${exp} slowly: switch on the last beat of the previous chord. Use 0.75× speed until the change is automatic.`,
  }),
  early: (exp, det) => ({
    cause: `You changed to ${det} before the song left ${exp}.`,
    tip: `Hold ${exp} for its full length. Count the beats aloud, or turn on the metronome.`,
  }),
  other: (exp, det) => ({
    cause: `${exp} was heard as ${det}.`,
    tip: `Form ${exp} slowly, one finger at a time, and strum each string individually to find the one that is muted or out of place.`,
  }),
}

/**
 * session: the session detail from the API (attempts, chords, timeline, mode).
 * Returns null when nothing was judged.
 */
export function evaluateSession(session) {
  const { correct = 0, incorrect = 0, missed = 0 } = session.attempts || {}
  const judged = correct + incorrect + missed
  if (!judged) return null
  const accuracy = correct / judged
  const timeline = session.timeline || []
  const playAlong = session.mode === 'play_along'

  const chords = (session.chords || [])
    .map((c) => {
      const total = c.correct + c.incorrect + c.missed
      return { ...c, total, accuracy: total ? c.correct / total : 0 }
    })
    .sort((a, b) => a.accuracy - b.accuracy || b.total - a.total)

  // Neighboring chords in the song, from the order of attempts.
  const neighborsOf = (chord, songTime) => {
    const i = timeline.findIndex((t) => t.expected === chord && t.song_time === songTime)
    let previous = null
    let next = null
    for (let k = i - 1; k >= 0; k--) if (timeline[k].expected !== chord) { previous = timeline[k].expected; break }
    for (let k = i + 1; k < timeline.length; k++) if (timeline[k].expected !== chord) { next = timeline[k].expected; break }
    return playAlong ? { previous, next } : {}
  }

  // Most frequent confusion per chord.
  const confusions = {}
  for (const t of timeline) {
    if (t.result !== 'incorrect' || !t.detected) continue
    const kind = classify(t.expected, t.detected, neighborsOf(t.expected, t.song_time))
    const key = `${t.expected}→${t.detected}`
    confusions[key] ??= { expected: t.expected, detected: t.detected, kind, count: 0 }
    confusions[key].count += 1
  }
  const topConfusions = Object.values(confusions).sort((a, b) => b.count - a.count)

  // Strengths.
  const strengths = []
  const solid = chords.filter((c) => c.total >= MIN_ATTEMPTS && c.accuracy >= 0.8).map((c) => c.chord)
  if (solid.length) strengths.push(`${list(solid)} ${solid.length === 1 ? 'was' : 'were'} played cleanly and consistently.`)
  if (playAlong && judged >= 5 && missed / judged <= 0.1) strengths.push('You kept up with the chord changes and rarely missed one.')
  if (accuracy >= 0.9) strengths.push(`Overall accuracy of ${pct(accuracy)} shows you are ready for a harder challenge.`)
  const best = [...chords].reverse().find((c) => c.total >= MIN_ATTEMPTS && c.correct)
  if (!solid.length && best) strengths.push(`${best.chord} was your strongest chord (${pct(best.accuracy)} correct).`)
  if (!strengths.length && correct) strengths.push(`You played ${correct} chord${correct === 1 ? '' : 's'} correctly. Keep building on that.`)

  // Areas to improve (at most three, most frequent first).
  const improvements = []
  const used = new Set()
  for (const c of topConfusions) {
    if (used.has(c.expected) || improvements.length >= 3) continue
    used.add(c.expected)
    const advice = ADVICE[c.kind](c.expected, c.detected)
    const stats = chords.find((x) => x.chord === c.expected)
    const title = stats ? `${c.expected}: ${stats.incorrect} of ${stats.total} incorrect` : `${c.expected}: ${c.count} incorrect`
    const often = stats && stats.incorrect > c.count ? ` This was the most common mistake (${c.count} of ${stats.incorrect}).` : ''
    improvements.push({ chord: c.expected, title, ...advice, cause: advice.cause + often })
  }
  if (missed / judged >= 0.15) {
    const worst = chords.filter((c) => c.missed).sort((a, b) => b.missed - a.missed).map((c) => c.chord).slice(0, 3)
    improvements.push({
      chord: null,
      title: `${missed} missed chord${missed === 1 ? '' : 's'}`,
      cause: playAlong
        ? `Some bars went by without a strum${worst.length ? `, most often on ${list(worst)}` : ''}.`
        : `You skipped ${missed} chord${missed === 1 ? '' : 's'} without playing ${missed === 1 ? 'it' : 'them'}.`,
      tip: playAlong
        ? 'Slow the song to 0.75× and strum once on the first beat of every chord. Accuracy comes before speed.'
        : 'Instead of skipping, use “Hear it” to listen to the chord, then try again.',
    })
  }

  // Next steps.
  const next = []
  if (!playAlong && accuracy >= 0.85) next.push('Move on to Play-along mode to practice the changes in time with the song.')
  if (!playAlong && accuracy < 0.85) next.push('Repeat Step-by-step mode until accuracy is above 85%.')
  if (playAlong && accuracy < 0.6) next.push('Switch to Step-by-step mode to learn each chord shape without time pressure.')
  if (playAlong && accuracy >= 0.6 && accuracy < 0.9) next.push('Repeat Play-along mode at 0.75× speed, then return to full speed.')
  if (playAlong && accuracy >= 0.9) next.push('Repeat Play-along mode at full speed without looking ahead at the next chord.')
  if (topConfusions.filter((c) => c.kind === 'semitone').reduce((n, c) => n + c.count, 0) >= 2) next.push('Tune your guitar with the tuner before your next session.')
  if (improvements[0]?.chord) next.push(`Spend two minutes on ${improvements[0].chord} alone before your next session.`)

  return { accuracy, judged, rating: rating(accuracy), strengths, improvements, next, chords }
}
