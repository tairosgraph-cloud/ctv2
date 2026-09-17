import { useEffect, useMemo, useRef, useState } from 'react'
import { StatCard } from '@/components/ui/StatCard'
import { useToast } from '@/hooks/useToast'
import { buildCashArqueo, describeCashWindow } from '@/lib/cashArqueo'
import { money, parseAmount, shortDateTime } from '@/lib/format'
import { useData } from '@/store/DataProvider'
import { ExportSummaryModal } from './ExportSummaryModal'

const DENOMINATIONS = [200, 100, 50, 20, 10, 5, 2, 1, 0.5, 0.2, 0.1]

export function ArqueoView() {
  const { stats, closings, transactions, registrarCierre } = useData()
  const toast = useToast()
  const [opening, setOpening] = useState('')
  /** Deja de precargar en cuanto el usuario escribe: no le pisamos el número. */
  const aperturaTocada = useRef(false)
  const [counted, setCounted] = useState('')
  const [notes, setNotes] = useState('')
  const [useDenominations, setUseDenominations] = useState(false)
  const [tally, setTally] = useState<Record<number, string>>({})
  const [exporting, setExporting] = useState(false)
  const [saving, setSaving] = useState(false)

  const openingCash = parseAmount(opening)

  /**
   * Efectivo que el sistema espera: fondo de apertura + solo los movimientos
   * en efectivo posteriores al último cierre. Lo anterior ya está dentro del
   * fondo, así que volver a sumarlo inventaría un faltante.
   */
  const arqueo = useMemo(
    () => buildCashArqueo(transactions, closings, openingCash),
    [transactions, closings, openingCash],
  )
  const expectedCash = arqueo.expectedCash
  const ventana = describeCashWindow(arqueo, shortDateTime)

  /**
   * Precarga el fondo con el efectivo que se contó en el último cierre, que es
   * exactamente con lo que abre el turno siguiente.
   *
   * Sin esto el campo se vaciaba al recargar la página, y dejarlo en blanco
   * vuelve a dar un esperado equivocado: el mismo error que se acaba de
   * corregir, entrando por otra puerta.
   */
  useEffect(() => {
    if (aperturaTocada.current || opening !== '') return
    if (arqueo.lastClosing) setOpening(arqueo.lastClosing.countedCash.toFixed(2))
  }, [arqueo.lastClosing, opening])

  const tallyTotal = useMemo(
    () =>
      Math.round(
        DENOMINATIONS.reduce((sum, d) => sum + d * (Number(tally[d]) || 0), 0) * 100,
      ) / 100,
    [tally],
  )

  const countedCash = useDenominations ? tallyTotal : parseAmount(counted)
  const hasCount = useDenominations ? Object.keys(tally).length > 0 : counted.trim() !== ''
  const difference = Math.round((countedCash - expectedCash) * 100) / 100

  const cerrar = async () => {
    if (!hasCount) {
      toast.error('Registra primero el efectivo contado')
      return
    }
    setSaving(true)
    try {
      await registrarCierre(countedCash, openingCash, notes.trim())
      toast.success('Cierre de caja guardado en la bitácora')
      // Lo que queda contado en el cajón es el fondo del turno siguiente.
      aperturaTocada.current = false
      setOpening(countedCash.toFixed(2))
      setCounted('')
      setTally({})
      setNotes('')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo guardar el cierre')
    } finally {
      setSaving(false)
    }
  }

  /** Todos los movimientos en efectivo de la historia: los del acumulado. */
  const cashMovements = transactions.filter(
    (t) => t.status !== 'Anulado' && t.payment === 'Efectivo',
  ).length

  const movimientosVentana = `${arqueo.movements} ${
    arqueo.movements === 1 ? 'movimiento' : 'movimientos'
  } en efectivo`

  const hintEsperado = arqueo.lastClosing
    ? `Apertura + ${arqueo.movements} mov. desde el cierre del ${shortDateTime(
        arqueo.lastClosing.closedAt,
      )}`
    : `Apertura + ${arqueo.movements} mov. desde el inicio`

  const aperturaHint = arqueo.lastClosing
    ? `Efectivo que quedó en caja tras el cierre del ${shortDateTime(
        arqueo.lastClosing.closedAt,
      )}, donde se contaron ${money(arqueo.lastClosing.countedCash)}.`
    : 'Efectivo con el que se abrió la caja por primera vez.'

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Efectivo del sistema"
          value={money(stats.efectivo)}
          hint={`Acumulado histórico · ${cashMovements} movimientos`}
          icon="fa-money-bill-wave"
          tone="emerald"
        />
        <StatCard
          label="Cuentas digitales"
          value={money(stats.digital)}
          hint="Yape, transferencias, tarjeta"
          icon="fa-mobile-screen"
          tone="brand"
        />
        <StatCard
          label="Total en cuentas"
          value={money(stats.efectivo + stats.digital)}
          icon="fa-scale-balanced"
          tone="slate"
        />
        <StatCard
          label="Esperado en caja"
          value={money(expectedCash)}
          hint={hintEsperado}
          icon="fa-cash-register"
          tone="amber"
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-4 rounded-2xl border border-slate-200/80 dark:border-slate-800/80 bg-white dark:bg-slate-900 p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-50">Conteo físico</h3>
              <p className="text-[11px] text-slate-400 dark:text-slate-500">
                Cuenta billetes y monedas, y compara contra el sistema.
              </p>
            </div>
            <label className="flex cursor-pointer items-center gap-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200">
              <input
                type="checkbox"
                checked={useDenominations}
                onChange={(event) => setUseDenominations(event.target.checked)}
                className="accent-brand-700"
              />
              Contar por denominación
            </label>
          </div>

          <div className="flex items-start gap-2 rounded-xl border border-brand-200 dark:border-brand-500/30 bg-brand-50 dark:bg-brand-500/10 p-3 text-[11px] text-brand-900 dark:text-brand-100">
            <i className="fa-solid fa-circle-info mt-px shrink-0" aria-hidden="true" />
            <p>
              El esperado suma al fondo de apertura{' '}
              <span className="font-bold">{movimientosVentana}</span> {ventana}.{' '}
              {arqueo.lastClosing
                ? 'Lo anterior a ese cierre ya está dentro del fondo, por eso no se vuelve a contar.'
                : 'En cuanto cierres la caja, el siguiente arqueo contará solo desde ese cierre.'}
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="field-label" htmlFor="arqueo-opening">
                Fondo de apertura (S/)
              </label>
              <input
                id="arqueo-opening"
                inputMode="decimal"
                value={opening}
                onChange={(event) => {
                  aperturaTocada.current = true
                  setOpening(event.target.value)
                }}
                placeholder="0.00"
                className="field font-bold"
              />
              <p className="mt-1 text-[11px] text-slate-400 dark:text-slate-500">
                {aperturaHint}
              </p>
            </div>

            {!useDenominations && (
              <div>
                <label className="field-label" htmlFor="arqueo-counted">
                  Efectivo contado (S/)
                </label>
                <input
                  id="arqueo-counted"
                  inputMode="decimal"
                  value={counted}
                  onChange={(event) => setCounted(event.target.value)}
                  placeholder="0.00"
                  className="field font-bold"
                />
              </div>
            )}
          </div>

          {useDenominations && (
            <div className="rounded-2xl border border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-3.5">
              <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Billetes y monedas
              </p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                {DENOMINATIONS.map((d) => (
                  <label key={d} className="flex items-center gap-2 text-xs">
                    <span className="w-14 shrink-0 font-semibold tabular-nums text-slate-600 dark:text-slate-300">
                      S/ {d.toFixed(2)}
                    </span>
                    <input
                      type="number"
                      min={0}
                      inputMode="numeric"
                      value={tally[d] ?? ''}
                      onChange={(event) =>
                        setTally((current) => ({ ...current, [d]: event.target.value }))
                      }
                      placeholder="0"
                      aria-label={`Cantidad de S/ ${d.toFixed(2)}`}
                      className="w-full rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-2 py-1.5 text-xs outline-none focus:border-brand-500"
                    />
                  </label>
                ))}
              </div>
              <p className="mt-2.5 text-right text-xs font-bold text-slate-700 dark:text-slate-200">
                Total contado: <span className="tabular-nums">{money(tallyTotal)}</span>
              </p>
            </div>
          )}

          <div
            className={`rounded-2xl border p-4 ${
              !hasCount
                ? 'border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950'
                : difference === 0
                  ? 'border-emerald-200 dark:border-emerald-500/30 bg-emerald-50 dark:bg-emerald-500/10'
                  : difference > 0
                    ? 'border-blue-200 dark:border-blue-500/30 bg-blue-50 dark:bg-blue-500/10'
                    : 'border-rose-200 dark:border-rose-500/30 bg-rose-50 dark:bg-rose-500/10'
            }`}
            aria-live="polite"
          >
            {!hasCount ? (
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Registra el efectivo contado para ver la diferencia.
              </p>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Resultado del arqueo
                  </p>
                  <p
                    className={`text-lg font-extrabold tabular-nums ${
                      difference === 0
                        ? 'text-emerald-800 dark:text-emerald-300'
                        : difference > 0
                          ? 'text-blue-800 dark:text-blue-300'
                          : 'text-rose-800 dark:text-rose-300'
                    }`}
                  >
                    {difference === 0
                      ? 'Caja cuadrada — diferencia S/ 0.00'
                      : difference > 0
                        ? `Sobrante: ${money(difference)}`
                        : `Faltante: ${money(Math.abs(difference))}`}
                  </p>
                </div>
                <div className="text-right text-[11px] text-slate-500 dark:text-slate-400">
                  <p>
                    Contado: <span className="font-bold tabular-nums">{money(countedCash)}</span>
                  </p>
                  <p>
                    Esperado: <span className="font-bold tabular-nums">{money(expectedCash)}</span>
                  </p>
                  <p className="italic text-slate-400 dark:text-slate-500">
                    Apertura {money(openingCash)} · {movimientosVentana} {ventana}
                  </p>
                </div>
              </div>
            )}
          </div>

          <div>
            <label className="field-label" htmlFor="arqueo-notes">
              Observaciones <span className="font-normal text-slate-400 dark:text-slate-500">(opcional)</span>
            </label>
            <textarea
              id="arqueo-notes"
              rows={2}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Ej: faltante justificado por vuelto entregado de más"
              className="field resize-none"
            />
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2">
            <button type="button" onClick={() => setExporting(true)} className="btn-ghost">
              <i className="fa-solid fa-file-export" aria-hidden="true" />
              Resumen ejecutivo
            </button>
            <button
              type="button"
              onClick={() => void cerrar()}
              disabled={saving || !hasCount}
              className="btn-primary px-5 py-2.5"
            >
              <i className="fa-solid fa-lock" aria-hidden="true" />
              {saving ? 'Guardando…' : 'Cerrar caja'}
            </button>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200/80 dark:border-slate-800/80 bg-white dark:bg-slate-900 p-5 shadow-sm">
          <h3 className="mb-3 text-sm font-bold text-slate-900 dark:text-slate-50">Bitácora de cierres</h3>
          {closings.length === 0 ? (
            <p className="text-xs italic text-slate-400 dark:text-slate-500">
              Todavía no hay cierres registrados. El primero quedará guardado aquí.
            </p>
          ) : (
            <ul className="space-y-2.5">
              {closings.map((c) => (
                <li key={c.id} className="rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                      {shortDateTime(c.closedAt)}
                    </span>
                    <span
                      className={`text-xs font-extrabold tabular-nums ${
                        c.difference === 0
                          ? 'text-emerald-700 dark:text-emerald-300'
                          : c.difference > 0
                            ? 'text-blue-700 dark:text-blue-300'
                            : 'text-rose-700 dark:text-rose-300'
                      }`}
                    >
                      {c.difference === 0
                        ? 'Cuadrado'
                        : `${c.difference > 0 ? '+' : '−'} ${money(Math.abs(c.difference))}`}
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                    Contado {money(c.countedCash)} · Esperado {money(c.expectedCash)}
                  </p>
                  {c.notes && <p className="mt-1 text-[11px] italic text-slate-500 dark:text-slate-400">{c.notes}</p>}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <ExportSummaryModal open={exporting} onClose={() => setExporting(false)} />
    </div>
  )
}
