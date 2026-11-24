export default function ResultCounts({ attempts }) {
  const { correct = 0, incorrect = 0, missed = 0 } = attempts
  const total = correct + incorrect + missed
  if (!total) return <span className="text-[12.5px] text-ink-3">No attempts</span>
  const pct = (n) => `${(n / total) * 100}%`
  return (
    <span className="flex items-center gap-3">
      <span className="flex h-1.5 w-24 shrink-0 overflow-hidden rounded-full bg-line-strong" aria-hidden>
        <span className="bg-good" style={{ width: pct(correct) }} />
        <span className="bg-bad" style={{ width: pct(incorrect) }} />
        <span className="bg-ink-3" style={{ width: pct(missed) }} />
      </span>
      <span className="tabular text-[12.5px] text-ink-2">
        <span className="text-good">{correct}</span> correct · <span className="text-bad">{incorrect}</span> incorrect · {missed} missed ·{' '}
        {Math.round((correct / total) * 100)}% accuracy
      </span>
    </span>
  )
}
