import { useEffect, useRef } from 'react'
import { money, todayLong } from '@/lib/format'
import { useInformeGeneral } from '@/hooks/useInformeGeneral'
import { useData } from '@/store/DataProvider'
import { AlertsBell } from './AlertsBell'
import { ThemeToggle } from './ThemeToggle'

interface TopbarProps {
  search: string
  onSearchChange: (value: string) => void
  onOpenMenu: () => void
  onGoToDebts: () => void
}

export function Topbar({ search, onSearchChange, onOpenMenu, onGoToDebts }: TopbarProps) {
  const { stats } = useData()
  const informe = useInformeGeneral()
  const inputRef = useRef<HTMLInputElement>(null)

  // El prototipo dibujaba el atajo ⌘K pero nunca lo implementó.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        inputRef.current?.focus()
        inputRef.current?.select()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  const positive = stats.balance >= 0

  return (
    <header className="flex h-16 shrink-0 items-center justify-between gap-3 border-b border-slate-200/80 dark:border-slate-800/80 bg-white dark:bg-slate-900 px-4 md:px-8">
      <div className="flex max-w-xl flex-1 items-center gap-3">
        <button
          type="button"
          onClick={onOpenMenu}
          aria-label="Abrir menú de navegación"
          className="rounded-lg p-2 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 md:hidden"
        >
          <i className="fa-solid fa-bars text-lg" aria-hidden="true" />
        </button>

        <div className="relative w-full">
          <i
            className="fa-solid fa-magnifying-glass absolute left-3.5 top-1/2 -translate-y-1/2 text-xs text-slate-400 dark:text-slate-500"
            aria-hidden="true"
          />
          <input
            ref={inputRef}
            type="search"
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Buscar en movimientos, proformas, deudas..."
            aria-label="Búsqueda global"
            className="w-full rounded-xl border border-transparent bg-slate-100/80 dark:bg-slate-800/70 py-2.5 pl-9 pr-14 text-xs text-slate-700 dark:text-slate-200 outline-none transition-all focus:border-brand-500 focus:bg-white dark:focus:bg-slate-900"
          />
          <kbd className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 rounded border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-1.5 py-0.5 text-[10px] font-medium text-slate-400 dark:text-slate-500 sm:block">
            ⌘K
          </kbd>
        </div>
      </div>

      <div className="flex items-center gap-2 md:gap-3">
        <AlertsBell onGoToDebts={onGoToDebts} />

        <button
          type="button"
          onClick={() => void informe.descargar()}
          disabled={informe.generando}
          title="Descargar el informe general en Excel"
          aria-label="Descargar el informe general en Excel"
          className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-500 dark:text-slate-400 transition-colors hover:bg-emerald-50 dark:hover:bg-emerald-500/10 hover:text-emerald-700 dark:hover:text-emerald-300 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <i
            className={`fa-solid ${informe.generando ? 'fa-spinner fa-spin' : 'fa-file-excel'} text-sm`}
            aria-hidden="true"
          />
        </button>

        <ThemeToggle />

        <div className="hidden items-center gap-2 rounded-xl border border-slate-200/60 dark:border-slate-800/60 bg-slate-100/80 dark:bg-slate-800/70 px-3 py-2 text-xs font-medium text-slate-600 dark:text-slate-300 lg:flex">
          <i className="fa-regular fa-calendar text-brand-700 dark:text-brand-300" aria-hidden="true" />
          <span>{todayLong()}</span>
        </div>

        <div className="rounded-xl border border-slate-200/60 dark:border-slate-800/60 bg-slate-50 dark:bg-slate-950 px-3 py-1.5 text-right">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
            Balance
          </p>
          <p
            className={`text-sm font-extrabold tabular-nums ${positive ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-600 dark:text-rose-400'}`}
          >
            {positive ? '+' : '−'} {money(Math.abs(stats.balance))}
          </p>
        </div>
      </div>
    </header>
  )
}
