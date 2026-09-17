import { useEffect, type ReactNode } from 'react'
import type { TabKey } from '@/types'
import { DebtBot } from '@/components/assistant/DebtBot'
import { Sidebar } from './Sidebar'
import { Topbar } from './Topbar'
import { tabDef } from './tabs'

interface DashboardLayoutProps {
  active: TabKey
  onSelect: (tab: TabKey) => void
  onOpenGateway: () => void
  search: string
  onSearchChange: (value: string) => void
  menuOpen: boolean
  onMenuOpenChange: (open: boolean) => void
  children: ReactNode
}

export function DashboardLayout({
  active,
  onSelect,
  onOpenGateway,
  search,
  onSearchChange,
  menuOpen,
  onMenuOpenChange,
  children,
}: DashboardLayoutProps) {
  const def = tabDef(active)

  useEffect(() => {
    if (!menuOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onMenuOpenChange(false)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [menuOpen, onMenuOpenChange])

  const selectAndClose = (tab: TabKey) => {
    onSelect(tab)
    onMenuOpenChange(false)
  }

  return (
    <div className="flex h-full w-full overflow-hidden bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-slate-100">
      {/* Sidebar fija en escritorio */}
      <aside className="z-20 hidden w-64 shrink-0 border-r border-slate-200/90 dark:border-slate-800/90 md:block">
        <Sidebar active={active} onSelect={onSelect} onOpenGateway={onOpenGateway} />
      </aside>

      {/* Drawer en movil — el prototipo tenia el boton hamburguesa sin funcion */}
      {menuOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div
            className="absolute inset-0 bg-slate-950/50 dark:bg-slate-950/70 backdrop-blur-sm"
            onClick={() => onMenuOpenChange(false)}
            aria-hidden="true"
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Menú de navegación"
            className="absolute inset-y-0 left-0 w-72 max-w-[85vw] overflow-y-auto shadow-2xl"
          >
            <div className="flex justify-end p-2">
              <button
                type="button"
                onClick={() => onMenuOpenChange(false)}
                aria-label="Cerrar menú"
                className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400"
              >
                <i className="fa-solid fa-xmark" aria-hidden="true" />
              </button>
            </div>
            <Sidebar
              active={active}
              onSelect={selectAndClose}
              onOpenGateway={() => {
                onMenuOpenChange(false)
                onOpenGateway()
              }}
            />
          </div>
        </div>
      )}

      <div className="flex h-full flex-1 flex-col overflow-hidden">
        <Topbar
          search={search}
          onSearchChange={onSearchChange}
          onOpenMenu={() => onMenuOpenChange(true)}
          onGoToDebts={() => onSelect('deudas')}
        />

        <main className="flex-1 overflow-y-auto px-4 py-5 md:px-8 md:py-6">
          <div className="mx-auto max-w-7xl space-y-5">
            <div>
              <h2 className="font-display text-xl font-bold tracking-tight text-slate-900 dark:text-slate-50 md:text-2xl">
                {def.title}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 md:text-sm">{def.subtitle}</p>
            </div>
            {children}
          </div>
        </main>
      </div>

      <DebtBot />
    </div>
  )
}
