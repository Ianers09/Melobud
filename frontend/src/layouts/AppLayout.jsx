import { useEffect, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { ChevronUp, Guitar, History, House, Library, LogOut, Settings, ShieldCheck, Upload, UserRound } from 'lucide-react'
import { Logo } from '../components/Logo'
import { useAuth } from '../contexts/AuthContext'
import { nameFromUser } from '../utils/format'

const NAV = [
  { to: '/', label: 'Home', icon: House, end: true },
  { to: '/library', label: 'Library', icon: Library },
  { to: '/upload', label: 'Upload', icon: Upload },
  { to: '/practice', label: 'Practice', icon: Guitar },
  { to: '/history', label: 'History', icon: History },
]

function SideLink({ item }) {
  const Icon = item.icon
  return (
    <NavLink
      to={item.to}
      end={item.end}
      className={({ isActive }) =>
        `group flex h-9 items-center gap-3 rounded-[7px] px-3 text-[13.5px] font-medium transition-colors ${
          isActive ? 'bg-raised text-ink' : 'text-ink-2 hover:bg-raised/60 hover:text-ink'
        }`
      }
    >
      {({ isActive }) => (
        <>
          <Icon size={17} className={isActive ? 'text-brass' : 'text-ink-3 group-hover:text-ink-2'} aria-hidden />
          {item.label}
        </>
      )}
    </NavLink>
  )
}

function AccountMenu() {
  const { user, logout } = useAuth()
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const navigate = useNavigate()

  useEffect(() => {
    if (!open) return undefined
    const close = (e) => {
      if (e.type === 'keydown' && e.key !== 'Escape') return
      if (e.type === 'mousedown' && ref.current?.contains(e.target)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', close)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', close)
    }
  }, [open])

  const item = 'flex h-9 w-full items-center gap-2.5 rounded-[6px] px-2.5 text-left text-[13.5px] text-ink-2 hover:bg-hover hover:text-ink'
  return (
    <div ref={ref} className="relative">
      {open && (
        <div role="menu" className="page-enter absolute right-0 bottom-full left-0 mb-2 rounded-[10px] border border-line-strong bg-raised p-1 shadow-[0_16px_40px_-12px_rgb(0_0_0/0.7)]">
          <button role="menuitem" className={item} onClick={() => (setOpen(false), navigate('/settings'))}>
            <Settings size={16} aria-hidden /> Settings
          </button>
          <div className="my-1 h-px bg-line" />
          <button role="menuitem" className={item} onClick={() => logout().then(() => navigate('/login'))}>
            <LogOut size={16} aria-hidden /> Sign out
          </button>
        </div>
      )}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex w-full items-center gap-3 rounded-[8px] px-2 py-2 text-left hover:bg-raised"
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-hover font-display text-[13px] font-bold text-ink uppercase">
          {nameFromUser(user).slice(0, 1)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold">{nameFromUser(user)}</span>
          <span className="block truncate text-[12px] text-ink-3">{user?.email}</span>
        </span>
        <ChevronUp size={15} className={`text-ink-3 transition-transform ${open ? '' : 'rotate-180'}`} aria-hidden />
      </button>
    </div>
  )
}

const ADMIN_ITEM = { to: '/admin', label: 'Users', icon: ShieldCheck }

export default function AppLayout() {
  const location = useLocation()
  const { user } = useAuth()
  // Full-bleed screens (player / practice) get the whole viewport width.
  const immersive = /^\/songs\/\d+\/(play|practice)/.test(location.pathname)

  return (
    <div className="min-h-dvh md:grid md:grid-cols-[232px_1fr]">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded focus:bg-raised focus:px-3 focus:py-2">
        Skip to content
      </a>
      <aside className="sticky top-0 hidden h-dvh flex-col border-r border-line bg-bg px-3 pt-5 pb-3 md:flex">
        <NavLink to="/" className="mb-7 px-3" aria-label="Melobud home">
          <Logo />
        </NavLink>
        <nav aria-label="Main" className="flex flex-col gap-0.5">
          {NAV.map((item) => (
            <SideLink key={item.to} item={item} />
          ))}
        </nav>
        {user?.is_staff && (
          <nav aria-label="Administration" className="mt-6 flex flex-col gap-0.5">
            <p className="eyebrow mb-1 px-3">Admin</p>
            <SideLink item={ADMIN_ITEM} />
          </nav>
        )}
        <div className="mt-auto border-t border-line pt-3">
          <AccountMenu />
        </div>
      </aside>

      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-line bg-bg/95 px-4 backdrop-blur md:hidden">
        <NavLink to="/" aria-label="Melobud home">
          <Logo />
        </NavLink>
        <div className="flex items-center gap-1">
          {user?.is_staff && (
            <NavLink to="/admin" aria-label="Manage users" className="flex h-9 w-9 items-center justify-center rounded-full text-ink-2 hover:bg-raised">
              <ShieldCheck size={19} />
            </NavLink>
          )}
          <NavLink to="/settings" aria-label="Settings" className="flex h-9 w-9 items-center justify-center rounded-full text-ink-2 hover:bg-raised">
            <UserRound size={19} />
          </NavLink>
        </div>
      </header>

      <main id="main" className={`min-w-0 ${immersive ? 'pb-16 md:pb-0' : 'mx-auto w-full max-w-[1120px] px-4 pt-6 pb-24 sm:px-6 md:px-10 md:pt-10 md:pb-10'}`}>
        <div key={location.pathname} className="page-enter">
          <Outlet />
        </div>
      </main>

      <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-line bg-bg/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
        {NAV.map((item) => {
          const Icon = item.icon
          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `flex h-15 flex-col items-center justify-center gap-1 text-[11px] font-medium ${isActive ? 'text-ink' : 'text-ink-3'}`
              }
            >
              {({ isActive }) => (
                <>
                  <Icon size={20} className={isActive ? 'text-brass' : ''} aria-hidden />
                  {item.label}
                </>
              )}
            </NavLink>
          )
        })}
      </nav>
    </div>
  )
}
