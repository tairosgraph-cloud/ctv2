interface StatCardProps {
  label: string
  value: string
  hint?: string
  icon: string
  tone?: 'emerald' | 'rose' | 'amber' | 'brand' | 'slate'
}

const TONES = {
  emerald: 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-100 dark:border-emerald-500/25',
  rose: 'bg-rose-50 dark:bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-100 dark:border-rose-500/25',
  amber: 'bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-100 dark:border-amber-500/25',
  brand: 'bg-brand-50 dark:bg-brand-500/10 text-brand-800 dark:text-brand-300 border-brand-100 dark:border-brand-500/25',
  slate: 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-800',
} as const

export function StatCard({ label, value, hint, icon, tone = 'slate' }: StatCardProps) {
  return (
    <div className="rounded-2xl border border-slate-200/80 dark:border-slate-800/80 bg-white dark:bg-slate-900 p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">{label}</p>
        <span
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border text-xs ${TONES[tone]}`}
        >
          <i className={`fa-solid ${icon}`} aria-hidden="true" />
        </span>
      </div>
      <p className="mt-2 text-xl font-extrabold tracking-tight text-slate-900 dark:text-slate-50">{value}</p>
      {hint && <p className="mt-0.5 text-[11px] font-medium text-slate-400 dark:text-slate-500">{hint}</p>}
    </div>
  )
}
