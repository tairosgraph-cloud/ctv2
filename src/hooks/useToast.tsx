import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'

type ToastKind = 'success' | 'error' | 'info'

interface Toast {
  id: number
  message: string
  kind: ToastKind
}

interface ToastApi {
  success: (message: string) => void
  error: (message: string) => void
  info: (message: string) => void
}

const ToastContext = createContext<ToastApi | null>(null)

const STYLES: Record<ToastKind, { box: string; icon: string }> = {
  success: {
    box: 'border-emerald-500/40 bg-white dark:bg-slate-900 text-emerald-800 dark:text-emerald-300',
    icon: 'fa-circle-check text-emerald-500',
  },
  error: {
    box: 'border-rose-500/40 bg-white dark:bg-slate-900 text-rose-800 dark:text-rose-300',
    icon: 'fa-circle-exclamation text-rose-500 dark:text-rose-400',
  },
  info: {
    box: 'border-brand-500/40 bg-white dark:bg-slate-900 text-brand-900 dark:text-brand-200',
    icon: 'fa-circle-info text-brand-600 dark:text-brand-400',
  },
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const nextId = useRef(1)

  const push = useCallback((message: string, kind: ToastKind) => {
    const id = nextId.current++
    setToasts((current) => [...current, { id, message, kind }])
    window.setTimeout(() => {
      setToasts((current) => current.filter((t) => t.id !== id))
    }, 3800)
  }, [])

  const api = useMemo<ToastApi>(
    () => ({
      success: (m) => push(m, 'success'),
      error: (m) => push(m, 'error'),
      info: (m) => push(m, 'info'),
    }),
    [push],
  )

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        className="pointer-events-none fixed right-4 top-4 z-[60] flex w-[min(22rem,calc(100vw-2rem))] flex-col gap-2"
        role="status"
        aria-live="polite"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto flex animate-toast-in items-center gap-2.5 rounded-2xl border px-4 py-3 text-xs font-semibold shadow-xl ${STYLES[t.kind].box}`}
          >
            <i className={`fa-solid ${STYLES[t.kind].icon} text-sm`} aria-hidden="true" />
            <span className="flex-1">{t.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast debe usarse dentro de <ToastProvider>')
  return ctx
}
