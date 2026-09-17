import { useEffect, useMemo, useRef, useState } from 'react'
import { useSpeaker } from '@/hooks/useSpeech'
import { briefingToSpeech, buildDebtBriefing, describirAntiguedad, type DebtAlert } from '@/lib/debtAlerts'
import { money } from '@/lib/format'
import { useData } from '@/store/DataProvider'

const URGENCIA_ESTILO = {
  vencida: { punto: 'bg-rose-500', texto: 'text-rose-600 dark:text-rose-400' },
  antigua: { punto: 'bg-amber-500', texto: 'text-amber-600 dark:text-amber-400' },
  reciente: { punto: 'bg-slate-300 dark:bg-slate-600', texto: 'text-slate-400 dark:text-slate-500' },
} as const

function Fila({ alert }: { alert: DebtAlert }) {
  const estilo = URGENCIA_ESTILO[alert.urgencia]
  return (
    <li className="flex items-start justify-between gap-3 py-1.5">
      <span className="flex min-w-0 items-start gap-2">
        <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${estilo.punto}`} />
        <span className="min-w-0">
          <span className="block truncate text-xs font-semibold text-slate-800 dark:text-slate-100">
            {alert.debt.party}
          </span>
          <span className={`block text-[10px] font-medium ${estilo.texto}`}>
            {describirAntiguedad(alert)}
          </span>
        </span>
      </span>
      <span className="shrink-0 text-xs font-bold tabular-nums text-slate-900 dark:text-slate-50">
        {money(alert.debt.balance)}
      </span>
    </li>
  )
}

/**
 * Campana de avisos: quiénes te deben y a quiénes debes.
 *
 * Nunca se abre sola: interrumpir el panel al entrar resultaba molesto. El
 * recordatorio pasivo lo hace la cinta de abajo; aquí está el detalle cuando
 * lo pides. Tampoco suena nada solo: la voz está tras el botón «Escuchar».
 */
export function AlertsBell({ onGoToDebts }: { onGoToDebts: () => void }) {
  const { debts } = useData()
  const { speaking, say, stop } = useSpeaker()
  const [open, setOpen] = useState(false)
  const contenedor = useRef<HTMLDivElement>(null)

  const briefing = useMemo(() => buildDebtBriefing(debts), [debts])

  // Cerrar al pulsar fuera o con Escape.
  useEffect(() => {
    if (!open) return
    const fuera = (event: MouseEvent) => {
      if (!contenedor.current?.contains(event.target as Node)) setOpen(false)
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', fuera)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('mousedown', fuera)
      document.removeEventListener('keydown', escape)
    }
  }, [open])

  useEffect(() => () => stop(), [stop])

  const hayUrgentes = briefing.urgentes > 0

  return (
    <div ref={contenedor} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={`Avisos de deudas: ${briefing.pendientes} cuentas pendientes`}
        title="Avisos de deudas y cobros"
        className="relative flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-500 dark:text-slate-400 transition-colors hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-700 dark:hover:text-slate-200"
      >
        <i className="fa-regular fa-bell text-sm" aria-hidden="true" />
        {briefing.pendientes > 0 && (
          <span
            className={`absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold text-white ${
              hayUrgentes ? 'bg-rose-600' : 'bg-brand-700 dark:bg-brand-600'
            }`}
          >
            {briefing.pendientes}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Avisos de deudas y cobros"
          className="absolute right-0 top-11 z-40 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xl"
        >
          <div className="flex items-start justify-between gap-2 border-b border-slate-100 dark:border-slate-800 p-4">
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-50">Deudas y cobros</h3>
              <p className="text-[11px] text-slate-400 dark:text-slate-500">
                {briefing.pendientes === 0
                  ? 'Nada pendiente'
                  : hayUrgentes
                    ? `${briefing.urgentes} de ${briefing.pendientes} llevan tiempo esperando`
                    : `${briefing.pendientes} cuentas al día`}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Cerrar avisos"
              className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 transition-colors hover:bg-slate-200 dark:hover:bg-slate-700"
            >
              <i className="fa-solid fa-xmark text-xs" aria-hidden="true" />
            </button>
          </div>

          <div className="max-h-[24rem] overflow-y-auto p-4 pt-3">
            {briefing.pendientes === 0 ? (
              <p className="py-4 text-center text-xs italic text-slate-400 dark:text-slate-500">
                Nadie te debe y no debes nada a proveedores.
              </p>
            ) : (
              <div className="space-y-4">
                <section>
                  <div className="flex items-baseline justify-between border-b border-slate-100 dark:border-slate-800 pb-1">
                    <h4 className="text-[11px] font-bold uppercase tracking-wide text-amber-700 dark:text-amber-300">
                      Te deben
                    </h4>
                    <span className="text-xs font-extrabold tabular-nums text-amber-800 dark:text-amber-300">
                      {money(briefing.totalCobrar)}
                    </span>
                  </div>
                  {briefing.porCobrar.length > 0 ? (
                    <ul className="divide-y divide-slate-50 dark:divide-slate-800/60">
                      {briefing.porCobrar.map((a) => (
                        <Fila key={a.debt.id} alert={a} />
                      ))}
                    </ul>
                  ) : (
                    <p className="py-2 text-[11px] italic text-slate-400 dark:text-slate-500">Nadie te debe.</p>
                  )}
                </section>

                <section>
                  <div className="flex items-baseline justify-between border-b border-slate-100 dark:border-slate-800 pb-1">
                    <h4 className="text-[11px] font-bold uppercase tracking-wide text-rose-700 dark:text-rose-300">
                      Tú debes
                    </h4>
                    <span className="text-xs font-extrabold tabular-nums text-rose-800 dark:text-rose-300">
                      {money(briefing.totalPagar)}
                    </span>
                  </div>
                  {briefing.porPagar.length > 0 ? (
                    <ul className="divide-y divide-slate-50 dark:divide-slate-800/60">
                      {briefing.porPagar.map((a) => (
                        <Fila key={a.debt.id} alert={a} />
                      ))}
                    </ul>
                  ) : (
                    <p className="py-2 text-[11px] italic text-slate-400 dark:text-slate-500">
                      No debes nada a proveedores.
                    </p>
                  )}
                </section>

                <div className="flex items-baseline justify-between rounded-xl bg-slate-50 dark:bg-slate-950 px-3 py-2">
                  <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">Posición neta</span>
                  <span
                    className={`text-sm font-extrabold tabular-nums ${
                      briefing.neto >= 0 ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-700 dark:text-rose-300'
                    }`}
                  >
                    {money(briefing.neto)}
                  </span>
                </div>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 border-t border-slate-100 dark:border-slate-800 p-3">
            <button
              type="button"
              onClick={() => (speaking ? stop() : void say(briefingToSpeech(briefing)))}
              className="btn-ghost flex-1"
            >
              <i
                className={`fa-solid ${speaking ? 'fa-stop' : 'fa-volume-high'}`}
                aria-hidden="true"
              />
              {speaking ? 'Detener' : 'Escuchar'}
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false)
                stop()
                onGoToDebts()
              }}
              className="btn-primary flex-1"
            >
              Ver deudas
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
