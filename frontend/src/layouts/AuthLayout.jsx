import { Link, Outlet, useLocation } from 'react-router-dom'
import { Logo } from '../components/Logo'

// A static, typographic chord sheet: it shows what Melobud does — one chord
// at a time, with the current one lit — rather than decorating the page.
const SHEET = [
  ['G', 'D', 'Em', 'C'],
  ['G', 'D', 'C', 'C'],
  ['Am', 'C', 'G', 'D'],
]

function BrandPanel() {
  return (
    <div className="relative hidden flex-col justify-between overflow-hidden border-r border-line bg-surface p-10 lg:flex">
      <Link to="/login" aria-label="Melobud">
        <Logo size="lg" />
      </Link>
      <div aria-hidden className="select-none">
        <div className="mb-6 flex items-center gap-3">
          {[1, 2, 3, 4].map((n) => (
            <span
              key={n}
              className={`flex h-7 w-7 items-center justify-center rounded-[6px] font-display text-[13px] font-bold ${
                n === 3 ? 'bg-brass text-brass-ink' : 'border border-line-strong text-ink-3'
              }`}
            >
              {n}
            </span>
          ))}
        </div>
        <div className="space-y-2">
          {SHEET.map((row, r) => (
            <div key={r} className="grid grid-cols-4 gap-2">
              {row.map((chord, c) => {
                const active = r === 0 && c === 2
                const past = r === 0 && c < 2
                return (
                  <div
                    key={c}
                    className={`chord-name flex h-[92px] items-end rounded-[10px] border px-4 pb-3 text-[46px] ${
                      active
                        ? 'border-brass/60 bg-brass-soft text-brass'
                        : past
                          ? 'border-line text-ink-3'
                          : 'border-line text-ink'
                    }`}
                  >
                    {chord}
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      </div>
      <div>
        <p className="font-display text-[26px] leading-tight font-extrabold tracking-[-0.03em]">
          Learn songs. Play chords.
          <br />
          <span className="text-ink-3">Grow musically.</span>
        </p>
        <p className="mt-3 max-w-sm text-[14px] text-ink-2">
          Upload a song and Melobud identifies its chords, displays them in time with the music, and evaluates your playing in real time.
        </p>
      </div>
    </div>
  )
}

export default function AuthLayout() {
  const location = useLocation()
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
      <BrandPanel />
      <div className="flex flex-col px-5 py-8 sm:px-10">
        <Link to="/login" className="mb-10 lg:hidden" aria-label="Melobud">
          <Logo />
        </Link>
        <main className="flex flex-1 items-center justify-center">
          <div key={location.pathname} className="page-enter w-full max-w-[380px]">
            <Outlet />
          </div>
        </main>
        <p className="mt-10 text-center text-[12px] text-ink-3">&copy; Melobud. Your musical buddy.</p>
      </div>
    </div>
  )
}
