import { useEffect, useMemo, useRef } from 'react'
import { Metronome, Pause, Play, RotateCcw, RotateCw, SkipBack, SkipForward, Volume1, Volume2, VolumeX } from 'lucide-react'
import { neighbours } from '../utils/timeline'
import { formatTime } from '../utils/format'
import { Segmented, Spinner } from './ui'

/** Previous / current / next chord. The current chord dominates the screen. */
export function ChordStage({ timeline, index, time, feedback, compact = false, showCountdown = true, row }) {
  const current = index >= 0 ? timeline[index] : null
  const around = index >= 0 ? neighbours(timeline, index) : { prev: null, next: timeline.find((s) => !s.noChord && s.start > time) || null }
  // With the bar counter, previous / next follow the bars: a chord that
  // continues into the next bar is shown again as "next" (F held for two bars
  // reads F → F), so the player knows exactly when to change. Without it,
  // they are the neighbouring chord changes.
  const prev = row ? (row.prev ? { name: row.prev } : null) : around.prev
  const next = row ? (row.next ? { name: row.next, start: around.next?.start } : null) : around.next
  const untilNext = next ? Math.max(0, next.start - time) : null
  const countdown = !row && showCountdown && untilNext != null && untilNext < 30 ? `in ${untilNext.toFixed(1)}s` : ''

  const ring =
    feedback === 'correct'
      ? 'border-good bg-good-soft'
      : feedback === 'incorrect'
        ? 'border-bad bg-bad-soft'
        : 'border-transparent'
  const currentColor =
    feedback === 'correct' ? 'text-good' : feedback === 'incorrect' ? 'text-bad' : current?.noChord ? 'text-ink-3' : 'text-ink'

  return (
    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 sm:gap-8">
      <div className="min-w-0 text-right">
        <p className="eyebrow mb-2">Previous</p>
        <p className="chord-name truncate text-[30px] text-ink-3 sm:text-[44px]">{prev?.name ?? '–'}</p>
      </div>

      <div
        className={`flex min-w-[148px] flex-col items-center rounded-[16px] border-2 px-6 py-5 transition-colors duration-200 sm:min-w-[260px] sm:px-10 sm:py-7 ${ring}`}
      >
        <p className="eyebrow mb-3">{current?.noChord ? 'No chord' : 'Now'}</p>
        <p
          key={current ? `${current.index}` : 'none'}
          aria-live="polite"
          className={`chord-enter chord-name text-center ${compact ? 'text-[72px] sm:text-[104px]' : 'text-[84px] sm:text-[140px]'} ${currentColor}`}
        >
          {current ? current.name : '–'}
        </p>
      </div>

      <div className="min-w-0">
        <p className="eyebrow mb-2">Next</p>
        <p className="chord-name truncate text-[30px] text-ink-2 sm:text-[44px]">{next?.name ?? '–'}</p>
        <p className="tabular mt-2 h-4 text-[12.5px] text-ink-3">{countdown}</p>
      </div>
    </div>
  )
}

/**
 * Bar counter for the current row (a bar, or the part of a bar played on one
 * chord), counted from 1. The last beat of every row is outlined in gold and
 * fills gold when it sounds, so players see where the row ends. Fixed height
 * and centered.
 */
export function BeatCounter({ row }) {
  return (
    <div className="flex h-12 w-full items-center justify-center">
      {row && (
        <div
          className="flex items-center justify-center gap-2"
          role="img"
          aria-label={`Beat ${row.current} of ${row.length}`}
        >
          {Array.from({ length: row.length }, (_, k) => k + 1).map((n) => {
            const active = n === row.current
            const cue = n === row.length
            return (
              <span
                key={n}
                className={`flex h-11 w-11 items-center justify-center rounded-[8px] font-display text-[16px] font-bold ${
                  active
                    ? cue
                      ? 'bg-brass text-brass-ink'
                      : 'bg-ink text-bg'
                    : cue
                      ? 'border-2 border-brass text-brass'
                      : 'border border-line-strong text-ink-3'
                }`}
              >
                {n}
              </span>
            )
          })}
        </div>
      )}
    </div>
  )
}

/** Metronome toggle (left) and playback speed (right), shared by player and practice. */
export function PlaybackOptions({ player, metronome, onMetronomeChange, children }) {
  return (
    <div className="mt-3 grid items-center gap-3 md:grid-cols-[1fr_auto_1fr]">
      <div className="flex justify-center md:justify-start">
        <button
          type="button"
          onClick={() => onMetronomeChange(!metronome)}
          aria-pressed={metronome}
          className={`btn btn-sm ${metronome ? 'border-brass/60 bg-brass-soft text-brass' : 'btn-ghost'}`}
          title="Click on every beat. The first beat of each chord is accented."
        >
          <Metronome size={15} aria-hidden />
          Metronome
        </button>
      </div>
      <div className="w-full md:w-[520px]">{children}</div>
      <div className="flex items-center justify-center gap-2 md:justify-end">
        <span className="text-[12px] text-ink-3">Speed</span>
        <Segmented
          size="sm"
          label="Playback speed"
          value={player.rate}
          onChange={player.setRate}
          options={[
            { value: 0.5, label: '0.5×' },
            { value: 0.75, label: '0.75×' },
            { value: 1, label: '1×' },
          ]}
        />
      </div>
    </div>
  )
}

const PX_PER_SECOND = 26

/** Horizontally scrolling chord lane. Click a chord to jump to it. */
export function TimelineStrip({ timeline, time, duration, onSeek }) {
  const scroller = useRef(null)
  const total = duration || timeline[timeline.length - 1]?.end || 0
  const width = Math.max(total * PX_PER_SECOND, 100)
  const x = time * PX_PER_SECOND

  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const target = x - el.clientWidth * 0.35
    if (Math.abs(el.scrollLeft - target) > el.clientWidth * 0.3) el.scrollLeft = target
    else el.scrollLeft += (target - el.scrollLeft) * 0.15
  }, [x])

  const blocks = useMemo(
    () =>
      timeline.map((seg) => ({
        ...seg,
        left: seg.start * PX_PER_SECOND,
        w: Math.max(2, (seg.end - seg.start) * PX_PER_SECOND - 2),
      })),
    [timeline],
  )

  return (
    <div ref={scroller} className="relative overflow-x-auto overflow-y-hidden pb-2 [scrollbar-width:thin]">
      <div className="relative h-12" style={{ width }}>
        {blocks.map((b) => {
          const active = time >= b.start && time < b.end
          return (
            <button
              key={b.index}
              type="button"
              onClick={() => onSeek(b.start + 0.01)}
              title={`${b.name} · ${formatTime(b.start)}`}
              className={`absolute top-0 flex h-12 items-center overflow-hidden rounded-[6px] border px-2 text-left font-display text-[13px] font-bold transition-colors ${
                active
                  ? 'border-ink/70 bg-hover text-ink'
                  : b.noChord
                    ? 'border-line bg-transparent text-ink-3'
                    : 'border-line bg-surface text-ink-2 hover:border-line-strong hover:text-ink'
              }`}
              style={{ left: b.left, width: b.w }}
              tabIndex={-1}
            >
              {b.w > 22 ? b.name : ''}
            </button>
          )
        })}
        <div className="pointer-events-none absolute top-[-4px] bottom-[-4px] w-0.5 rounded bg-ink" style={{ left: x }} />
      </div>
    </div>
  )
}

/** Mute button with a volume slider that slides out on hover or focus, like YouTube. */
export function VolumeControl({ player }) {
  const { volume, muted } = player
  const shown = muted ? 0 : volume
  const Icon = shown === 0 ? VolumeX : shown < 0.5 ? Volume1 : Volume2
  const pct = Math.round(shown * 100)
  return (
    <div className="group flex items-center">
      <button
        type="button"
        className="btn btn-ghost btn-icon"
        onClick={player.toggleMute}
        aria-label={shown === 0 ? 'Unmute' : 'Mute'}
        title={shown === 0 ? 'Unmute (M)' : 'Mute (M)'}
      >
        <Icon size={18} />
      </button>
      <div className="w-0 overflow-hidden transition-[width] duration-200 ease-out group-hover:w-[84px] group-focus-within:w-[84px]">
        <input
          type="range"
          className="range ml-1 w-[76px]"
          min={0}
          max={100}
          step={1}
          value={pct}
          style={{ '--fill': `${pct}%` }}
          onChange={(e) => player.setVolume(Number(e.target.value) / 100)}
          aria-label="Volume"
          aria-valuetext={`${pct}%`}
          title={`Volume ${pct}% (↑ / ↓)`}
        />
      </div>
    </div>
  )
}

export function Transport({ player, onPrevChord, onNextChord }) {
  const { time, duration, playing, buffering, ready } = player
  const pct = duration ? (time / duration) * 100 : 0
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <span className="tabular w-12 text-right text-[12.5px] text-ink-2">{formatTime(time)}</span>
        <input
          type="range"
          className="range flex-1"
          min={0}
          max={duration || 0}
          step={0.1}
          value={time}
          style={{ '--fill': `${pct}%` }}
          onChange={(e) => player.seek(Number(e.target.value))}
          aria-label="Seek"
          aria-valuetext={`${formatTime(time)} of ${formatTime(duration)}`}
          disabled={!duration}
        />
        <span className="tabular w-12 text-[12.5px] text-ink-3">{formatTime(duration)}</span>
      </div>
      <div className="relative flex flex-wrap items-center justify-center gap-1.5 sm:gap-2">
        <div className="sm:absolute sm:left-0">
          <VolumeControl player={player} />
        </div>
        <button type="button" className="btn btn-ghost btn-icon" onClick={onPrevChord} aria-label="Previous chord" title="Previous chord ( [ )">
          <SkipBack size={18} />
        </button>
        <button type="button" className="btn btn-ghost btn-icon" onClick={() => player.skip(-5)} aria-label="Back 5 seconds" title="Back 5s (←)">
          <RotateCcw size={18} />
        </button>
        <button
          type="button"
          onClick={player.toggle}
          disabled={!ready && !playing}
          className="mx-1 flex h-14 w-14 items-center justify-center rounded-full bg-brass text-brass-ink transition-transform hover:bg-brass-strong active:scale-95 disabled:opacity-50"
          aria-label={playing ? 'Pause' : 'Play'}
          title="Play / pause (Space)"
        >
          {buffering && playing ? <Spinner size={22} /> : playing ? <Pause size={24} fill="currentColor" /> : <Play size={24} fill="currentColor" className="ml-0.5" />}
        </button>
        <button type="button" className="btn btn-ghost btn-icon" onClick={() => player.skip(5)} aria-label="Forward 5 seconds" title="Forward 5s (→)">
          <RotateCw size={18} />
        </button>
        <button type="button" className="btn btn-ghost btn-icon" onClick={onNextChord} aria-label="Next chord" title="Next chord ( ] )">
          <SkipForward size={18} />
        </button>
      </div>
    </div>
  )
}
