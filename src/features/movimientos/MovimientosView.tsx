import { useMemo, useState } from 'react'
import { Badge } from '@/components/ui/Badge'
import { EmptyRow } from '@/components/ui/EmptyRow'
import { Pagination } from '@/components/ui/Pagination'
import { usePagination } from '@/hooks/usePagination'
import { useToast } from '@/hooks/useToast'
import { descargarLibro } from '@/lib/excel'
import { libroMovimientos } from '@/lib/reports'
import { fileStamp, money, shortDateTime, signedMoney } from '@/lib/format'
import { useData } from '@/store/DataProvider'
import { PAYMENT_METHODS, type PaymentMethod, type Transaction, type TxStatus } from '@/types'
import { MovDetailModal } from './MovDetailModal'

const STATUS_TONE: Record<TxStatus, 'emerald' | 'amber' | 'slate'> = {
  Completado: 'emerald',
  Pendiente: 'amber',
  Anulado: 'slate',
}

export function MovimientosView({ search }: { search: string }) {
  const { transactions, loading } = useData()
  const toast = useToast()
  const [localSearch, setLocalSearch] = useState('')
  const [account, setAccount] = useState<'ALL' | PaymentMethod>('ALL')
  const [status, setStatus] = useState<'ALL' | TxStatus>('ALL')
  const [selected, setSelected] = useState<Transaction | null>(null)

  const query = (search || localSearch).toLowerCase().trim()

  const filtered = useMemo(
    () =>
      transactions.filter((t) => {
        if (account !== 'ALL' && t.payment !== account) return false
        if (status !== 'ALL' && t.status !== status) return false
        if (!query) return true
        return (
          t.concept.toLowerCase().includes(query) ||
          t.party.toLowerCase().includes(query) ||
          t.voucher.toLowerCase().includes(query) ||
          t.payment.toLowerCase().includes(query) ||
          t.category.toLowerCase().includes(query)
        )
      }),
    [transactions, account, status, query],
  )

  const totals = useMemo(() => {
    let ingresos = 0
    let egresos = 0
    for (const t of filtered) {
      if (t.status === 'Anulado') continue
      if (t.type === 'Ingreso') ingresos += t.amount
      else egresos += t.amount
    }
    return { ingresos, egresos, neto: ingresos - egresos }
  }, [filtered])

  const paginacion = usePagination(filtered, { firma: `${query}|${account}|${status}` })

  const resetFilters = () => {
    setAccount('ALL')
    setStatus('ALL')
    setLocalSearch('')
  }

  const [exportando, setExportando] = useState(false)

  const exportExcel = async () => {
    if (!filtered.length) {
      toast.error('No hay movimientos que exportar con estos filtros')
      return
    }
    setExportando(true)
    try {
      const hayFiltro = Boolean(query) || account !== 'ALL' || status !== 'ALL'
      const wb = await libroMovimientos(
        filtered,
        `Emitido el ${new Date().toLocaleString('es-PE')} · ${filtered.length} de ${transactions.length} movimientos${hayFiltro ? ' (con filtros aplicados)' : ''}`,
      )
      await descargarLibro(wb, `movimientos_tairos_${fileStamp()}`)
      toast.success(`${filtered.length} movimientos exportados a Excel`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo generar el Excel')
    } finally {
      setExportando(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-2xl border border-emerald-100 dark:border-emerald-500/25 bg-emerald-50 dark:bg-emerald-500/10 p-3.5">
          <p className="text-[11px] font-semibold uppercase text-emerald-700 dark:text-emerald-300">Ingresos filtrados</p>
          <p className="text-lg font-extrabold tabular-nums text-emerald-800 dark:text-emerald-300">
            {money(totals.ingresos)}
          </p>
        </div>
        <div className="rounded-2xl border border-rose-100 dark:border-rose-500/25 bg-rose-50 dark:bg-rose-500/10 p-3.5">
          <p className="text-[11px] font-semibold uppercase text-rose-700 dark:text-rose-300">Egresos filtrados</p>
          <p className="text-lg font-extrabold tabular-nums text-rose-800 dark:text-rose-300">
            {money(totals.egresos)}
          </p>
        </div>
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3.5">
          <p className="text-[11px] font-semibold uppercase text-slate-500 dark:text-slate-400">Neto</p>
          <p
            className={`text-lg font-extrabold tabular-nums ${totals.neto >= 0 ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-700 dark:text-rose-300'}`}
          >
            {money(totals.neto)}
          </p>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-200/80 dark:border-slate-800/80 bg-white dark:bg-slate-900 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800 p-4">
          <div>
            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-50">Movimientos auditados</h3>
            <p className="text-[11px] text-slate-400 dark:text-slate-500">
              {filtered.length} de {transactions.length} movimientos
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <input
              type="search"
              value={localSearch}
              onChange={(event) => setLocalSearch(event.target.value)}
              placeholder="Voucher, cliente, concepto…"
              aria-label="Buscar movimientos"
              disabled={Boolean(search)}
              className="w-44 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-xs outline-none focus:border-brand-500 disabled:opacity-50"
            />
            <select
              value={account}
              onChange={(event) => setAccount(event.target.value as 'ALL' | PaymentMethod)}
              aria-label="Filtrar por método de pago"
              className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 outline-none"
            >
              <option value="ALL">Todas las cuentas</option>
              {PAYMENT_METHODS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value as 'ALL' | TxStatus)}
              aria-label="Filtrar por estado"
              className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 outline-none"
            >
              <option value="ALL">Todos los estados</option>
              <option value="Completado">Completados</option>
              <option value="Pendiente">Pendientes</option>
              <option value="Anulado">Anulados</option>
            </select>
            <button type="button" onClick={resetFilters} className="btn-ghost">
              <i className="fa-solid fa-rotate-left" aria-hidden="true" />
              Limpiar
            </button>
            <button
              type="button"
              onClick={() => void exportExcel()}
              disabled={exportando}
              className="btn-primary"
            >
              <i
                className={`fa-solid ${exportando ? 'fa-spinner fa-spin' : 'fa-file-excel'}`}
                aria-hidden="true"
              />
              {exportando ? 'Generando…' : 'Excel'}
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[56rem] border-collapse text-left">
            <thead className="bg-slate-50/80 dark:bg-slate-900/60">
              <tr>
                <th className="th pl-5">Voucher</th>
                <th className="th">Fecha</th>
                <th className="th">Tipo</th>
                <th className="th">Concepto</th>
                <th className="th">Cliente / Proveedor</th>
                <th className="th">Método</th>
                <th className="th">Estado</th>
                <th className="th text-right">Monto</th>
                <th className="th pr-5 text-center">Ficha</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {loading ? (
                <EmptyRow colSpan={9} message="Cargando movimientos…" />
              ) : filtered.length === 0 ? (
                <EmptyRow colSpan={9} message="No se encontraron movimientos con los filtros aplicados." />
              ) : (
                paginacion.visibles.map((t) => {
                  const isIngreso = t.type === 'Ingreso'
                  const anulado = t.status === 'Anulado'
                  return (
                    <tr
                      key={t.id}
                      className={`transition-colors hover:bg-slate-50/80 dark:hover:bg-slate-900/60 ${anulado ? 'opacity-60' : ''}`}
                    >
                      <td className="td pl-5">
                        <span className="font-mono text-[11px] font-bold text-brand-800 dark:text-brand-300">
                          {t.voucher}
                        </span>
                      </td>
                      <td className="td text-[11px] text-slate-500 dark:text-slate-400">
                        {shortDateTime(t.occurredAt)}
                      </td>
                      <td className="td">
                        <span
                          className={`text-[11px] font-bold uppercase ${isIngreso ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-600 dark:text-rose-400'}`}
                        >
                          {t.type}
                        </span>
                        <span className="block text-[10px] text-slate-400 dark:text-slate-500">{t.category}</span>
                      </td>
                      <td className="td max-w-xs font-semibold text-slate-800 dark:text-slate-100">{t.concept}</td>
                      <td className="td text-slate-600 dark:text-slate-300">{t.party}</td>
                      <td className="td">
                        <Badge tone="slate">{t.payment}</Badge>
                      </td>
                      <td className="td">
                        <Badge tone={STATUS_TONE[t.status]}>{t.status}</Badge>
                      </td>
                      <td
                        className={`td text-right font-bold tabular-nums ${
                          anulado
                            ? 'text-slate-400 dark:text-slate-500 line-through'
                            : isIngreso
                              ? 'text-emerald-700 dark:text-emerald-300'
                              : 'text-slate-900 dark:text-slate-50'
                        }`}
                      >
                        {signedMoney(t.amount, t.type)}
                      </td>
                      <td className="td pr-5 text-center">
                        <button
                          type="button"
                          onClick={() => setSelected(t)}
                          aria-label={`Ver ficha del movimiento ${t.voucher}`}
                          className="rounded-lg bg-brand-50 dark:bg-brand-500/10 p-1.5 text-brand-700 dark:text-brand-300 transition-colors hover:bg-brand-100 dark:hover:bg-brand-500/20 hover:text-brand-900 dark:hover:text-brand-200"
                        >
                          <i className="fa-solid fa-eye text-xs" aria-hidden="true" />
                        </button>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>

        <Pagination paginacion={paginacion} etiqueta="movimientos" />
      </div>

      <MovDetailModal transaction={selected} onClose={() => setSelected(null)} />
    </div>
  )
}
