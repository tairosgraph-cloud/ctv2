import { useMemo, useState } from 'react'
import { Badge } from '@/components/ui/Badge'
import { EmptyRow } from '@/components/ui/EmptyRow'
import { Pagination } from '@/components/ui/Pagination'
import { usePagination } from '@/hooks/usePagination'
import { descargarLibro } from '@/lib/excel'
import { libroProformas } from '@/lib/reports'
import { useToast } from '@/hooks/useToast'
import { expiryDate, fileStamp, money } from '@/lib/format'
import { useData } from '@/store/DataProvider'
import type { Proforma } from '@/types'
import { CobrarProformaModal } from './CobrarProformaModal'
import { NewProformaModal } from './NewProformaModal'

export function ProformasView({ search }: { search: string }) {
  const { proformas, stats, loading, anularProforma } = useData()
  const toast = useToast()
  const [localSearch, setLocalSearch] = useState('')
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<Proforma | null>(null)
  const [charging, setCharging] = useState<Proforma | null>(null)

  const query = (search || localSearch).toLowerCase().trim()

  const filtered = useMemo(
    () =>
      proformas.filter((p) => {
        if (!query) return true
        return (
          p.client.toLowerCase().includes(query) ||
          p.code.toLowerCase().includes(query) ||
          p.detail.toLowerCase().includes(query)
        )
      }),
    [proformas, query],
  )

  const paginacion = usePagination(filtered, { firma: query })

  const anular = async (pf: Proforma) => {
    if (!window.confirm(`¿Anular la proforma ${pf.code} de ${pf.client}?`)) return
    try {
      await anularProforma(pf.id)
      toast.success(`Proforma ${pf.code} anulada`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo anular')
    }
  }

  const [exportando, setExportando] = useState(false)

  const exportExcel = async () => {
    if (!filtered.length) return toast.error('No hay proformas que exportar')
    setExportando(true)
    try {
      const wb = await libroProformas(
        filtered,
        `Emitido el ${new Date().toLocaleString('es-PE')} · ${filtered.length} de ${proformas.length} cotizaciones`,
      )
      await descargarLibro(wb, `proformas_tairos_${fileStamp()}`)
      toast.success(`${filtered.length} proformas exportadas a Excel`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo generar el Excel')
    } finally {
      setExportando(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-brand-100 dark:border-brand-500/25 bg-brand-50 dark:bg-brand-500/10 p-3.5">
          <p className="text-[11px] font-semibold uppercase text-brand-700 dark:text-brand-300">Monto vigente</p>
          <p className="text-lg font-extrabold tabular-nums text-brand-900 dark:text-brand-200">
            {money(stats.proformasMonto)}
          </p>
        </div>
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3.5">
          <p className="text-[11px] font-semibold uppercase text-slate-500 dark:text-slate-400">Vigentes</p>
          <p className="text-lg font-extrabold text-slate-900 dark:text-slate-50">{stats.proformasVigentes}</p>
        </div>
        <div className="rounded-2xl border border-emerald-100 dark:border-emerald-500/25 bg-emerald-50 dark:bg-emerald-500/10 p-3.5">
          <p className="text-[11px] font-semibold uppercase text-emerald-700 dark:text-emerald-300">Convertidas</p>
          <p className="text-lg font-extrabold text-emerald-800 dark:text-emerald-300">
            {proformas.filter((p) => p.status === 'Convertida').length}
          </p>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-200/80 dark:border-slate-800/80 bg-white dark:bg-slate-900 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800 p-4">
          <div>
            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-50">Cotizaciones</h3>
            <p className="text-[11px] text-slate-400 dark:text-slate-500">{filtered.length} registradas</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="search"
              value={localSearch}
              onChange={(event) => setLocalSearch(event.target.value)}
              placeholder="Cliente, código, detalle…"
              aria-label="Buscar proformas"
              disabled={Boolean(search)}
              className="w-44 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-xs outline-none focus:border-brand-500 disabled:opacity-50"
            />
            <button
              type="button"
              onClick={() => void exportExcel()}
              disabled={exportando}
              className="btn-ghost"
            >
              <i
                className={`fa-solid ${exportando ? 'fa-spinner fa-spin' : 'fa-file-excel'}`}
                aria-hidden="true"
              />
              {exportando ? 'Generando…' : 'Excel'}
            </button>
            <button type="button" onClick={() => setCreating(true)} className="btn-primary">
              <i className="fa-solid fa-plus" aria-hidden="true" />
              Nueva proforma
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[48rem] border-collapse text-left">
            <thead className="bg-slate-50/80 dark:bg-slate-900/60">
              <tr>
                <th className="th pl-5">Código</th>
                <th className="th">Cliente</th>
                <th className="th">Detalle</th>
                <th className="th">Vence</th>
                <th className="th">Estado</th>
                <th className="th text-right">Total</th>
                <th className="th pr-5 text-center">Acción</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {loading ? (
                <EmptyRow colSpan={7} message="Cargando proformas…" />
              ) : filtered.length === 0 ? (
                <EmptyRow colSpan={7} message="No hay proformas registradas." />
              ) : (
                paginacion.visibles.map((p) => (
                  <tr key={p.id} className="transition-colors hover:bg-slate-50/80 dark:hover:bg-slate-900/60">
                    <td className="td pl-5 font-mono font-bold text-brand-800 dark:text-brand-300">{p.code}</td>
                    <td className="td font-bold text-slate-900 dark:text-slate-50">{p.client}</td>
                    <td className="td max-w-xs text-slate-700 dark:text-slate-200">{p.detail}</td>
                    <td className="td text-[11px] text-slate-500 dark:text-slate-400">
                      {expiryDate(p.issuedAt, p.validityDays)}
                      <span className="block text-[10px] text-slate-400 dark:text-slate-500">
                        {p.validityDays} días
                      </span>
                    </td>
                    <td className="td">
                      <Badge
                        tone={
                          p.status === 'Convertida'
                            ? 'emerald'
                            : p.status === 'Anulada'
                              ? 'slate'
                              : 'purple'
                        }
                      >
                        {p.status}
                      </Badge>
                    </td>
                    <td className="td text-right font-extrabold tabular-nums text-slate-900 dark:text-slate-50">
                      {money(p.total)}
                    </td>
                    <td className="td pr-5">
                      <div className="flex items-center justify-center gap-1">
                        {p.status === 'Vigente' ? (
                          <>
                            <button
                              type="button"
                              onClick={() => setCharging(p)}
                              className="inline-flex items-center gap-1 rounded-lg bg-emerald-50 dark:bg-emerald-500/10 px-2.5 py-1.5 text-[11px] font-bold text-emerald-800 dark:text-emerald-300 transition-colors hover:bg-emerald-100 dark:hover:bg-emerald-500/15"
                            >
                              <i className="fa-solid fa-cart-arrow-down" aria-hidden="true" />
                              Cobrar
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditing(p)}
                              title="Corregir la cotización"
                              aria-label={`Editar proforma ${p.code}`}
                              className="rounded p-1 text-slate-400 dark:text-slate-500 transition-colors hover:text-brand-700 dark:hover:text-brand-300"
                            >
                              <i className="fa-solid fa-pen text-xs" aria-hidden="true" />
                            </button>
                            <button
                              type="button"
                              onClick={() => void anular(p)}
                              title="Anular: el cliente no la aceptó"
                              aria-label={`Anular proforma ${p.code}`}
                              className="rounded p-1 text-slate-400 dark:text-slate-500 transition-colors hover:text-rose-600 dark:hover:text-rose-400"
                            >
                              <i className="fa-solid fa-ban text-xs" aria-hidden="true" />
                            </button>
                          </>
                        ) : (
                          <span
                            className="text-[10px] font-semibold text-slate-400 dark:text-slate-500"
                            title={
                              p.status === 'Convertida'
                                ? 'Ya generó un asiento: corrígelo en el libro'
                                : 'Cotización anulada'
                            }
                          >
                            {p.status === 'Convertida' ? 'Procesada' : 'Anulada'}
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <Pagination paginacion={paginacion} etiqueta="proformas" />
      </div>

      <NewProformaModal open={creating} onClose={() => setCreating(false)} />
      <NewProformaModal
        key={editing?.id ?? 'nueva'}
        open={editing !== null}
        editing={editing}
        onClose={() => setEditing(null)}
      />
      <CobrarProformaModal proforma={charging} onClose={() => setCharging(null)} />
    </div>
  )
}
