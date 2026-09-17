import { useEffect, useId, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

interface ModalProps {
  open: boolean
  onClose: () => void
  title: string
  subtitle?: string
  icon?: string
  children: ReactNode
  footer?: ReactNode
  size?: 'md' | 'lg'
}

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * Modal accesible: cierra con Escape y con clic en el fondo, atrapa el foco y
 * lo devuelve al elemento que lo abrio. Los modales del prototipo no hacian
 * nada de esto.
 */
export function Modal({
  open,
  onClose,
  title,
  subtitle,
  icon = 'fa-circle-info',
  children,
  footer,
  size = 'md',
}: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const previouslyFocused = useRef<HTMLElement | null>(null)
  const titleId = useId()

  useEffect(() => {
    if (!open) return

    previouslyFocused.current = document.activeElement as HTMLElement | null
    const { overflow } = document.body.style
    document.body.style.overflow = 'hidden'

    const panel = panelRef.current
    panel?.querySelector<HTMLElement>(FOCUSABLE)?.focus()

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key !== 'Tab' || !panel) return

      const nodes = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null,
      )
      if (!nodes.length) return

      const first = nodes[0]
      const last = nodes[nodes.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = overflow
      previouslyFocused.current?.focus?.()
    }
  }, [open, onClose])

  if (!open) return null

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-950/70 dark:bg-slate-950/80 p-4 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`my-auto w-full ${size === 'lg' ? 'max-w-2xl' : 'max-w-lg'} space-y-4 rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 text-slate-800 dark:text-slate-100 shadow-2xl`}
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-brand-50 dark:bg-brand-500/10 text-lg text-brand-800 dark:text-brand-300">
              <i className={`fa-solid ${icon}`} aria-hidden="true" />
            </div>
            <div>
              <h3 id={titleId} className="text-base font-bold text-slate-900 dark:text-slate-50">
                {title}
              </h3>
              {subtitle && <p className="text-xs text-slate-400 dark:text-slate-500">{subtitle}</p>}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 transition-colors hover:bg-slate-200 dark:hover:bg-slate-700"
          >
            <i className="fa-solid fa-xmark" aria-hidden="true" />
          </button>
        </div>

        {children}

        {footer && (
          <div className="flex items-center justify-end gap-2 border-t border-slate-100 dark:border-slate-800 pt-3">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}
