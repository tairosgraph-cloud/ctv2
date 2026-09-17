import { useMemo, useState } from 'react'
import { Badge, type BadgeTone } from '@/components/ui/Badge'
import { EmptyRow } from '@/components/ui/EmptyRow'
import { Pagination } from '@/components/ui/Pagination'
import { usePagination } from '@/hooks/usePagination'
import { StatCard } from '@/components/ui/StatCard'
import { AbonoModal } from '@/features/deudas/AbonoModal'
import { useToast } from '@/hooks/useToast'
import { money, shortDateTime, signedMoney } from '@/lib/format'
import { useData } from '@/store/DataProvider'
import type { Debt, TxType, WorkOrder } from '@/types'
import { NewOrderModal } from './NewOrderModal'
import { buildLedgerRows, type LedgerRow, type LedgerState } from '@/lib/ledgerRows'

const STATE_TONE: Record<LedgerState, BadgeTone> = {
  PAGADO: 'emerald',
  PARCIAL: 'amber',
  PENDIENTE: 'rose',
  ANULADO: 'slate',
}

export function RegistroView({ search }: { search: string }) {
  const {
    transactions,
    workOrders,
    debts,
    stats,
    voidTransaction,
    removeTransaction,
    loading,
  } = useData()
  const toast = useToast()
  const [typeFilter, setTypeFilter] = useState<'ALL' | TxType>('ALL')
  const [localSearch, setLocalSearch] = useState('')
  const [paying, setPaying] = useState<Debt | null>(null)
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<WorkOrder | null>(null)

  const abrirEdicion = (row: LedgerRow) => {
    if (!row.workOrder) {
      toast.error('Este asiento no nace de una orden, no se puede corregir aquí')
      return
    }
    setEditing(row.workOrder)
  }

  const query = (search || localSearch).toLowerCase().trim()

  const rows = useMemo(
    () => buildLedgerRows({ transactions, workOrders, debts }),
    [transactions, workOrders, debts],
  )

  const filtered = useMemo(
    () =>
      rows.filter((row) => {
        if (typeFilter !== 'ALL' && row.type !== typeFilter) return false
        if (!query) return true
        return (
          row.concept.toLowerCase().includes(query) ||
          row.party.toLowerCase().includes(query) ||
          row.category.toLowerCase().includes(query) ||
          (row.transaction?.voucher.toLowerCase().includes(query) ?? false)
        )
      }),
    [rows, typeFilter, query],
  )

  const creditCount = filtered.filter((r) => r.transaction === null).length

  const paginacion = usePagination(filtered, { firma: `${query}|${typeFilter}` })

  /**
   * Pie de tabla. Se calcula sobre TODO lo filtrado, no sobre la página que
   * se está viendo: desde que la columna Monto muestra el total del trabajo,
   * hace falta dejar explícito cuánto de eso entró de verdad a la caja.
   */
  const totals = useMemo(() => {
    let entro = 0
    let salio = 0
    let pendiente = 0
    for (const row of filtered) {
      if (row.countsToCash) {
        if (row.type === 'Ingreso') entro += row.cash
        else salio += row.cash
      }
      pendiente += row.pending
    }
    return { entro, salio, pendiente }
  }, [filtered])

  const anular = async (id: string, voucher: string) => {
    if (!window.confirm(`¿Anular el asiento ${voucher}? Quedará registrado pero no sumará.`)) return
    try {
      await voidTransaction(id)
      toast.success(`Asiento ${voucher} anulado`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo anular')
    }
  }

  const eliminar = async (id: string, voucher: string) => {
    if (!window.confirm(`¿Eliminar definitivamente el asiento ${voucher}? No se puede deshacer.`))
      return
    try {
      await removeTransaction(id)
      toast.success(`Asiento ${voucher} eliminado`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo eliminar')
    }
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Ingresos"
          value={money(stats.ingresos)}
          icon="fa-arrow-down"
          tone="emerald"
        />
        <StatCard label="Egresos" value={money(stats.egresos)} icon="fa-arrow-up" tone="rose" />
        <StatCard
          label="Por cobrar"
          value={money(stats.porCobrar)}
          icon="fa-hand-holding-dollar"
          tone="amber"
        />
        <StatCard
          label="Proformas"
          value={money(stats.proformasMonto)}
          hint={`${stats.proformasVigentes} vigentes`}
          icon="fa-file-invoice"
          tone="brand"
        />
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-200/80 dark:border-slate-800/80 bg-white dark:bg-slate-900 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800 p-4">
          <div>
            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-50">Asientos del día</h3>
            <p className="text-[11px] text-slate-400 dark:text-slate-500">
              {filtered.length} de {rows.length} registros
              {creditCount > 0 && (
                <>
                  {' · '}
                  <span className="font-semibold text-rose-600 dark:text-rose-400">
                    {creditCount} sin cobrar
                  </span>{' '}
                  (no suman a caja)
                </>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="search"
              value={localSearch}
              onChange={(event) => setLocalSearch(event.target.value)}
              placeholder="Filtrar asientos…"
              aria-label="Filtrar asientos"
              disabled={Boolean(search)}
              className="w-36 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-xs outline-none focus:border-brand-500 disabled:opacity-50 sm:w-48"
            />
            <select
              value={typeFilter}
              onChange={(event) => setTypeFilter(event.target.value as 'ALL' | TxType)}
              aria-label="Filtrar por tipo"
              className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 outline-none"
            >
              <option value="ALL">Todos</option>
              <option value="Ingreso">Ingresos</option>
              <option value="Egreso">Egresos</option>
            </select>
            <button type="button" onClick={() => setCreating(true)} className="btn-primary">
              <i className="fa-solid fa-plus" aria-hidden="true" />
              Nueva orden
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[48rem] border-collapse text-left">
            <thead className="bg-slate-50/80 dark:bg-slate-900/60">
              <tr>
                <th className="th pl-5">Tipo</th>
                <th className="th">Concepto</th>
                <th className="th">Cliente / Proveedor</th>
                <th className="th">Categoría</th>
                <th className="th">Método</th>
                <th className="th text-right">Monto</th>
                <th className="th">Estado</th>
                <th className="th pr-5 text-center">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {loading ? (
                <EmptyRow colSpan={8} message="Cargando asientos…" />
              ) : filtered.length === 0 ? (
                <EmptyRow colSpan={8} message="No hay asientos que coincidan." />
              ) : (
                paginacion.visibles.map((row) => {
                  const anulado = row.state === 'ANULADO'
                  // Fila al crédito: pedido sin asiento detrás, no movió dinero.
                  const credito = row.transaction === null
                  const isIngreso = row.type === 'Ingreso'

                  return (
                    <tr
                      key={row.id}
                      className={`transition-colors hover:bg-slate-50/80 dark:hover:bg-slate-900/60 ${
                        anulado ? 'opacity-50' : credito ? 'bg-rose-50/30 dark:bg-rose-500/10' : ''
                      }`}
                    >
                      <td className="td pl-5">
                        <div className="flex items-center gap-2">
                          <span
                            className={`h-2 w-2 rounded-full ${
                              credito
                                ? 'bg-rose-300'
                                : isIngreso
                                  ? 'bg-emerald-500'
                                  : 'bg-rose-500'
                            }`}
                          />
                          <span
                            className={`text-[11px] font-bold uppercase ${
                              credito
                                ? 'text-rose-500 dark:text-rose-400'
                                : isIngreso
                                  ? 'text-emerald-700 dark:text-emerald-300'
                                  : 'text-rose-600 dark:text-rose-400'
                            }`}
                          >
                            {row.type}
                          </span>
                        </div>
                        <p className="mt-0.5 text-[10px] text-slate-400 dark:text-slate-500">
                          {shortDateTime(row.occurredAt)}
                        </p>
                      </td>

                      <td className="td font-semibold text-slate-800 dark:text-slate-100">{row.concept}</td>
                      <td className="td text-slate-600 dark:text-slate-300">{row.party}</td>
                      <td className="td">
                        <Badge tone="slate">{row.category}</Badge>
                      </td>
                      <td className="td text-[11px] text-slate-500 dark:text-slate-400">
                        {row.payment ?? <span className="italic text-slate-400 dark:text-slate-500">—</span>}
                      </td>

                      <td className="td text-right tabular-nums">
                        {/*
                          Monto general del trabajo. Lleva signo solo cuando
                          todo ese importe se movió de verdad; si fue un
                          adelanto o una venta al crédito, el signo mentiría.
                        */}
                        <span
                          className={`font-bold ${
                            anulado
                              ? 'text-slate-400 dark:text-slate-500 line-through'
                              : credito || row.cash < row.total
                                ? 'text-slate-700 dark:text-slate-200'
                                : isIngreso
                                  ? 'text-emerald-700 dark:text-emerald-300'
                                  : 'text-slate-900 dark:text-slate-50'
                          }`}
                        >
                          {credito || row.cash < row.total
                            ? money(row.total)
                            : signedMoney(row.total, row.type)}
                        </span>

                        {!anulado && row.cash > 0 && row.cash < row.total && (
                          <p
                            className={`mt-0.5 text-[10px] font-semibold ${
                              isIngreso ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
                            }`}
                          >
                            {isIngreso ? 'cobrado' : 'pagado'}{' '}
                            {signedMoney(row.cash, row.type)}
                          </p>
                        )}
                      </td>

                      <td className="td">
                        <Badge tone={STATE_TONE[row.state]}>{row.state}</Badge>
                        {row.pending > 0 && (
                          <p
                            className={`mt-0.5 text-[10px] font-medium ${
                              credito ? 'text-rose-600 dark:text-rose-400' : 'text-amber-700 dark:text-amber-300'
                            }`}
                          >
                            falta {money(row.pending)}
                          </p>
                        )}
                      </td>

                      <td className="td pr-5">
                        <div className="flex items-center justify-center gap-1">
                          {/*
                            Cobrar aparece en cualquier fila con saldo vivo,
                            tenga asiento detrás o no: tanto un PENDIENTE como
                            un PARCIAL se terminan de cobrar desde aquí.
                          */}
                          {row.pending > 0 && row.debt && (
                            <button
                              type="button"
                              onClick={() => setPaying(row.debt)}
                              title={`${isIngreso ? 'Cobrar' : 'Pagar'} el saldo de ${money(row.pending)}`}
                              className="inline-flex items-center gap-1 rounded-lg bg-brand-800 dark:bg-brand-600 px-2.5 py-1.5 text-[11px] font-bold text-white transition-colors hover:bg-brand-900"
                            >
                              <i className="fa-solid fa-hand-holding-dollar" aria-hidden="true" />
                              {isIngreso ? 'Cobrar' : 'Pagar'}
                            </button>
                          )}

                          {row.workOrder && !anulado && (
                            <button
                              type="button"
                              onClick={() => abrirEdicion(row)}
                              title="Corregir la orden"
                              aria-label={`Editar ${row.concept}`}
                              className="rounded p-1 text-slate-400 dark:text-slate-500 transition-colors hover:text-brand-700 dark:hover:text-brand-300"
                            >
                              <i className="fa-solid fa-pen text-xs" aria-hidden="true" />
                            </button>
                          )}

                          {row.transaction && !anulado && (
                            <button
                              type="button"
                              onClick={() =>
                                void anular(row.transaction!.id, row.transaction!.voucher)
                              }
                              title="Anular asiento (conserva el registro)"
                              aria-label={`Anular asiento ${row.transaction.voucher}`}
                              className="rounded p-1 text-slate-400 dark:text-slate-500 transition-colors hover:text-amber-600 dark:hover:text-amber-400"
                            >
                              <i className="fa-solid fa-ban text-xs" aria-hidden="true" />
                            </button>
                          )}

                          {row.transaction && (
                            <button
                              type="button"
                              onClick={() =>
                                void eliminar(row.transaction!.id, row.transaction!.voucher)
                              }
                              title="Eliminar asiento"
                              aria-label={`Eliminar asiento ${row.transaction.voucher}`}
                              className="rounded p-1 text-slate-400 dark:text-slate-500 transition-colors hover:text-rose-600 dark:hover:text-rose-400"
                            >
                              <i className="fa-solid fa-trash-can text-xs" aria-hidden="true" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>

            {filtered.length > 0 && (
              <tfoot className="border-t-2 border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-900/60">
                <tr>
                  <td colSpan={5} className="td pl-5 text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                    La columna Monto es el total del trabajo; abajo, lo que se movió de verdad.
                  </td>
                  <td colSpan={3} className="td pr-5">
                    <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-1 text-[11px]">
                      <span className="text-slate-500 dark:text-slate-400">
                        Entró a caja{' '}
                        <span className="font-bold tabular-nums text-emerald-700 dark:text-emerald-300">
                          {money(totals.entro)}
                        </span>
                      </span>
                      <span className="text-slate-500 dark:text-slate-400">
                        Salió{' '}
                        <span className="font-bold tabular-nums text-rose-700 dark:text-rose-300">
                          {money(totals.salio)}
                        </span>
                      </span>
                      <span className="text-slate-500 dark:text-slate-400">
                        Pendiente{' '}
                        <span className="font-bold tabular-nums text-amber-700 dark:text-amber-300">
                          {money(totals.pendiente)}
                        </span>
                      </span>
                    </div>
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>

        <Pagination paginacion={paginacion} etiqueta="asientos" />
      </div>

      <NewOrderModal open={creating} onClose={() => setCreating(false)} />
      <NewOrderModal open={editing !== null} editing={editing} onClose={() => setEditing(null)} />
      <AbonoModal debt={paying} onClose={() => setPaying(null)} />
    </div>
  )
}
