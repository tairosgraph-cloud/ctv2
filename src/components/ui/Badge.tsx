import type { ReactNode } from 'react'

type BadgeTone = 'emerald' | 'rose' | 'amber' | 'brand' | 'slate' | 'purple' | 'blue'

const TONES: Record<BadgeTone, string> = {
  emerald: 'bg-emerald-100 dark:bg-emerald-500/15 text-emerald-800 dark:text-emerald-300',
  rose: 'bg-rose-100 dark:bg-rose-500/15 text-rose-800 dark:text-rose-300',
  amber: 'bg-amber-100 dark:bg-amber-500/15 text-amber-800 dark:text-amber-300',
  brand: 'bg-brand-100 dark:bg-brand-500/20 text-brand-800 dark:text-brand-300',
  slate: 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200',
  purple: 'bg-purple-100 dark:bg-purple-500/15 text-purple-800 dark:text-purple-300',
  blue: 'bg-blue-100 dark:bg-blue-500/15 text-blue-800 dark:text-blue-300',
}

export function Badge({
  tone = 'slate',
  children,
}: {
  tone?: BadgeTone
  children: ReactNode
}) {
  return (
    <span
      className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-bold ${TONES[tone]}`}
    >
      {children}
    </span>
  )
}

export type { BadgeTone }
