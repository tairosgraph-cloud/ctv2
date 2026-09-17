import { useMemo, useState } from 'react'
import { Badge } from '@/components/ui/Badge'
import { EmptyRow } from '@/components/ui/EmptyRow'
import { Pagination } from '@/components/ui/Pagination'
import { usePagination } from '@/hooks/usePagination'
import { money } from '@/lib/format'
import { useData } from '@/store/DataProvider'
import type { Debt, DebtKind } from '@/types'
import { AbonoModal } from './AbonoModal'
import { NewDebtModal } from './NewDebtModal'

export function DeudasView({ search }: { search: string }) {
  const { debts, stats, loading } = useData()
  const [kindFilter, setKindFilter] = useState<'ALL' | DebtKind>('ALL')
  const [onlyPending, setOnlyPending] = useState(true)
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<Debt | null>(null)
  const [paying, setPaying] = useState<Debt | null>(null)

  const query = search.toLowerCase().trim()

  const filtered = useMemo(
    () =>
      debts.filter((d) => {
        if (kindFilter !== 'ALL' && d.kind !== kindFilter) return false
        if (onlyPending && d.balance <= 0) return false
        if (!query) return true
        return (
          d.party.toLowerCase().includes(query) || d.concept.toLowerCase().includes(query)
        )
      }),
    [debts, kindFilter, onlyPending, query],
  )

  const paginacion = usePagination(filtered, {
    firma: `${query}|${kindFilter}|${onlyPending}`,
  })

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-amber-100 dark:border-amber-500/25 bg-amber-50 dark:bg-amber-500/10 p-3.5">
          <p className="text-[11px] font-semibold uppercase text-amber-700 dark:text-amber-300">Total por cobrar</p>
          <p className="text-lg font-extrabold tabular-nums text-amber-900 dark:text-amber-200">
            {money(stats.porCobrar)}
          </p>
        </div>
        <div className="rounded-2xl border border-rose-100 dark:border-rose-500/25 bg-rose-50 dark:bg-rose-500/10 p-3.5">
          <p className="text-[11px] font-semibold uppercase text-rose-700 dark:text-rose-300">Total por pagar</p>
          <p className="text-lg font-extrabold tabular-nums text-rose-900 dark:text-rose-200">
            {money(stats.porPagar)}
          </p>
        </div>
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3.5">
          <p className="text-[11px] font-semibold uppercase text-slate-500 dark:text-slate-400">Posición neta</p>
          <p
            className={`text-lg font-extrabold tabular-nums ${
              stats.porCobrar - stats.porPagar >= 0 ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-700 dark:text-rose-300'
            }`}
          >
            {money(stats.porCobrar - stats.porPagar)}
          </p>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-200/80 dark:border-slate-800/80 bg-white dark:bg-slate-900 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800 p-4">
          <div>
            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-50">Cuentas</h3>
            <p className="text-[11px] text-slate-400 dark:text-slate-500">{filtered.length} cuentas listadas</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex cursor-pointer items-center gap-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200">
              <input
                type="checkbox"
                checked={onlyPending}
                onChange={(event) => setOnlyPending(event.target.checked)}
                className="accent-brand-700"
              />
              Solo pendientes
            </label>
            <select
              value={kindFilter}
              onChange={(event) => setKindFilter(event.target.value as 'ALL' | DebtKind)}
              aria-label="Filtrar por tipo de cuenta"
              className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 outline-none"
            >
              <option value="ALL">Todas</option>
              <option value="COBRAR">Por cobrar</option>
              <option value="PAGAR">Por pagar</option>
            </select>
            <button type="button" onClick={() => setCreating(true)} className="btn-primary">
              <i className="fa-solid fa-plus" aria-hidden="true" />
              Nueva cuenta
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[52rem] border-collapse text-left">
            <thead className="bg-slate-50/80 dark:bg-slate-900/60">
              <tr>
                <th className="th pl-5">Tipo</th>
                <th className="th">Cliente / Proveedor</th>
                <th className="th">Concepto</th>
                <th className="th text-right">Total</th>
                <th className="th text-right">Abonado</th>
                <th className="th text-right">Saldo</th>
                <th className="th">Estado</th>
                <th className="th pr-5 text-center">Acción</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {loading ? (
                <EmptyRow colSpan={8} message="Cargando cuentas…" />
              ) : filtered.length === 0 ? (
                <EmptyRow colSpan={8} message="No hay cuentas que coincidan." />
              ) : (
                paginacion.visibles.map((d) => {
                  const isCobrar = d.kind === 'COBRAR'
                  const progress = d.total > 0 ? Math.min(100, (d.paid / d.total) * 100) : 0
                  return (
                    <tr key={d.id} className="transition-colors hover:bg-slate-50/80 dark:hover:bg-slate-900/60">
                      <td className="td pl-5">
                        <Badge tone={isCobrar ? 'amber' : 'rose'}>
                          {isCobrar ? 'POR COBRAR' : 'POR PAGAR'}
                        </Badge>
                      </td>
                      <td className="td font-bold text-slate-900 dark:text-slate-50">{d.party}</td>
                      <td className="td max-w-xs text-slate-700 dark:text-slate-200">
                        {d.concept}
                        <div className="mt-1.5 h-1 w-full max-w-[10rem] overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                          <div
                            className="h-full rounded-full bg-emerald-500 transition-all"
                            style={{ width: `${progress}%` }}
                          />
                        </div>
                      </td>
                      <td className="td text-right font-medium tabular-nums text-slate-600 dark:text-slate-300">
                        {money(d.total)}
                      </td>
                      <td className="td text-right font-medium tabular-nums text-emerald-700 dark:text-emerald-300">
                        {money(d.paid)}
                      </td>
                      <td
                        className={`td text-right font-extrabold tabular-nums ${isCobrar ? 'text-amber-800 dark:text-amber-300' : 'text-rose-700 dark:text-rose-300'}`}
                      >
                        {money(d.balance)}
                      </td>
                      <td className="td">
                        <Badge
                          tone={
                            d.status === 'Cancelado'
                              ? 'emerald'
                              : d.status === 'Parcial'
                                ? 'blue'
                                : 'slate'
                          }
                        >
                          {d.status.toUpperCase()}
                        </Badge>
                      </td>
                      <td className="td pr-5">
                        <div className="flex items-center justify-center gap-1">
                          {d.balance > 0 ? (
                            <button
                              type="button"
                              onClick={() => setPaying(d)}
                              className="inline-flex items-center gap-1 rounded-lg bg-brand-800 dark:bg-brand-600 px-2.5 py-1.5 text-[11px] font-bold text-white transition-colors hover:bg-brand-900"
                            >
                              <i className="fa-solid fa-hand-holding-dollar" aria-hidden="true" />
                              Abonar
                            </button>
                          ) : (
                            <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400">
                              Liquidado
                            </span>
                          )}

                          {/*
                            Las cuentas nacidas de una orden calculan su total
                            desde el pedido; editarlas aquí las desincronizaría.
                          */}
                          {d.workOrderId ? (
                            <span
                              title="Esta cuenta nace de una orden: corrígela en el libro contable"
                              className="p-1 text-slate-300 dark:text-slate-600"
                            >
                              <i className="fa-solid fa-link text-xs" aria-hidden="true" />
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setEditing(d)}
                              title="Corregir la cuenta"
                              aria-label={`Editar cuenta de ${d.party}`}
                              className="rounded p-1 text-slate-400 dark:text-slate-500 transition-colors hover:text-brand-700 dark:hover:text-brand-300"
                            >
                              <i className="fa-solid fa-pen text-xs" aria-hidden="true" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>

        <Pagination paginacion={paginacion} etiqueta="cuentas" />
      </div>

      <NewDebtModal open={creating} onClose={() => setCreating(false)} />
      <NewDebtModal
        key={editing?.id ?? 'nueva'}
        open={editing !== null}
        editing={editing}
        onClose={() => setEditing(null)}
      />
      <AbonoModal debt={paying} onClose={() => setPaying(null)} />
    </div>
  )
}
