import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react'
import { CircleAlert, CircleCheck, Info, X } from 'lucide-react'

const ToastContext = createContext(null)

const ICONS = { success: CircleCheck, error: CircleAlert, info: Info }
const TONES = { success: 'text-good', error: 'text-bad', info: 'text-ink-2' }

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])
  const nextId = useRef(1)

  const dismiss = useCallback((id) => setToasts((all) => all.filter((t) => t.id !== id)), [])
  const show = useCallback(
    (message, tone = 'info', ms = 4200) => {
      const id = nextId.current++
      setToasts((all) => [...all.slice(-3), { id, message, tone }])
      setTimeout(() => dismiss(id), ms)
    },
    [dismiss],
  )
  const api = useMemo(
    () => ({
      success: (m) => show(m, 'success'),
      error: (m) => show(m, 'error', 6000),
      info: (m) => show(m, 'info'),
    }),
    [show],
  )

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-20 z-50 flex flex-col items-center gap-2 px-4 md:bottom-6 md:right-6 md:left-auto md:items-end"
      >
        {toasts.map((t) => {
          const Icon = ICONS[t.tone]
          return (
            <div
              key={t.id}
              role={t.tone === 'error' ? 'alert' : 'status'}
              className="page-enter pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-[10px] border border-line-strong bg-raised px-4 py-3 shadow-[0_12px_32px_-12px_rgb(0_0_0/0.6)]"
            >
              <Icon size={18} className={`mt-px shrink-0 ${TONES[t.tone]}`} aria-hidden />
              <p className="flex-1 text-[13.5px] leading-snug">{t.message}</p>
              <button
                type="button"
                onClick={() => dismiss(t.id)}
                className="-mr-1 rounded p-0.5 text-ink-3 hover:text-ink"
                aria-label="Dismiss"
              >
                <X size={16} />
              </button>
            </div>
          )
        })}
      </div>
    </ToastContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useToast() {
  return useContext(ToastContext)
}
