import { useData } from '@/store/DataProvider'
import type { TabKey } from '@/types'
import { GROUPS, TABS } from './tabs'

interface SidebarProps {
  active: TabKey
  onSelect: (tab: TabKey) => void
  onOpenGateway: () => void
}

export function Sidebar({ active, onSelect, onOpenGateway }: SidebarProps) {
  const { transactions, proformas, debts, mode } = useData()

  const badges: Partial<Record<TabKey, { text: string; className: string }>> = {
    movimientos: {
      text: String(transactions.filter((t) => t.status !== 'Anulado').length),
      className: 'bg-brand-100 dark:bg-brand-500/20 text-brand-800 dark:text-brand-300',
    },
    proformas: {
      text: String(proformas.filter((p) => p.status === 'Vigente').length),
      className: 'bg-amber-100 dark:bg-amber-500/15 text-amber-800 dark:text-amber-300',
    },
    deudas: {
      text: String(debts.filter((d) => d.balance > 0).length),
      className: 'bg-rose-100 dark:bg-rose-500/15 text-rose-800 dark:text-rose-300',
    },
  }

  return (
    <div className="flex h-full flex-col justify-between bg-white dark:bg-slate-900">
      <div className="p-5">
        <div className="mb-8 flex items-center gap-3 px-2">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-brand-800 dark:bg-brand-600 text-xl text-brand-100 shadow-md shadow-brand-900/20">
            <i className="fa-solid fa-microphone-lines text-brand-300" aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-lg font-bold leading-tight text-slate-900 dark:text-slate-50">
              tairos<span className="text-brand-700 dark:text-brand-300">.rc</span>
            </h1>
            <p className="text-xs font-medium text-slate-400 dark:text-slate-500">Asistente Comercial</p>
          </div>
        </div>

        <nav className="space-y-6" aria-label="Navegación principal">
          {GROUPS.map((group) => (
            <div key={group}>
              <p className="mb-2 px-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                {group}
              </p>
              <div className="space-y-1">
                {TABS.filter((t) => t.group === group).map((tab) => {
                  const isActive = tab.key === active
                  const badge = badges[tab.key]
                  return (
                    <button
                      key={tab.key}
                      type="button"
                      onClick={() => onSelect(tab.key)}
                      aria-current={isActive ? 'page' : undefined}
                      className={`flex w-full items-center justify-between rounded-xl px-3.5 py-2.5 text-left text-sm transition-all ${
                        isActive
                          ? 'border border-brand-200/60 dark:border-brand-500/30 bg-brand-50 dark:bg-brand-500/10 font-semibold text-brand-800 dark:text-brand-300 shadow-sm'
                          : 'font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100/80 dark:hover:bg-slate-800/70 hover:text-slate-900 dark:hover:text-slate-50'
                      }`}
                    >
                      <span className="flex items-center gap-3">
                        <i
                          className={`fa-solid ${tab.icon} w-5 ${isActive ? 'text-brand-700 dark:text-brand-300' : 'text-slate-400 dark:text-slate-500'}`}
                          aria-hidden="true"
                        />
                        <span>{tab.label}</span>
                      </span>
                      {badge && (
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${badge.className}`}
                        >
                          {badge.text}
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </nav>
      </div>

      <div className="space-y-3 border-t border-slate-100 dark:border-slate-800 p-4">
        <button
          type="button"
          onClick={onOpenGateway}
          className="group flex w-full items-center justify-between rounded-2xl border border-brand-200/80 dark:border-brand-500/30 bg-brand-50 dark:bg-brand-500/10 p-3 text-left transition-all hover:bg-brand-100/80 dark:hover:bg-brand-500/20"
        >
          <span className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-brand-800 dark:bg-brand-600 text-xs text-brand-200 shadow-sm">
              <i className="fa-solid fa-brain" aria-hidden="true" />
            </span>
            <span>
              <span className="block text-xs font-bold text-brand-900 dark:text-brand-200">Asistente Cerebro</span>
              <span className="block text-[10px] text-brand-700 dark:text-brand-300">Ver guía interactiva</span>
            </span>
          </span>
          <i
            className="fa-solid fa-chevron-right text-xs text-brand-600 dark:text-brand-400 transition-transform group-hover:translate-x-0.5"
            aria-hidden="true"
          />
        </button>

        <div
          className={`rounded-xl px-3 py-2 text-[10px] font-semibold ${
            mode === 'supabase'
              ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
              : 'bg-amber-50 dark:bg-amber-500/10 text-amber-800 dark:text-amber-300'
          }`}
        >
          <i
            className={`fa-solid ${mode === 'supabase' ? 'fa-database' : 'fa-hard-drive'} mr-1.5`}
            aria-hidden="true"
          />
          {mode === 'supabase' ? 'Conectado a Supabase' : 'Modo local (localStorage)'}
        </div>
      </div>
    </div>
  )
}
