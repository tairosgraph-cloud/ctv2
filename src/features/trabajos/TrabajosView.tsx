import { useEffect, useMemo, useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import { db } from '@/data'
import { usePermisos } from '@/hooks/usePermisos'
import { useToast } from '@/hooks/useToast'
import { money, shortDateTime } from '@/lib/format'
import { armarTablero, EN_EL_TALLER, siguienteEstado, textoPlazo, type Plazo, type TrabajoEnTablero } from '@/lib/trabajos'
import { enlaceWhatsApp, mensaje } from '@/lib/whatsapp'
import { useData } from '@/store/DataProvider'
import { ESTADOS_TRABAJO, NOMBRE_ESTADO, PAYMENT_METHODS, type EstadoTrabajo, type EventoTrabajo, type PaymentMethod } from '@/types'

type Filtro = 'todos' | 'atrasados' | 'hoy' | 'semana'

const TONO_PLAZO: Record<Plazo['tipo'], string> = {
  atrasado: 'bg-rose-100 text-rose-800 dark:bg-rose-500/15 dark:text-rose-300',
  hoy: 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300',
  manana: 'bg-brand-50 text-brand-800 dark:bg-brand-500/10 dark:text-brand-300',
  pronto: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
  'sin-fecha': 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400',
}

const ORDEN = ESTADOS_TRABAJO as readonly EstadoTrabajo[]
/** De diseño o aprobación a algo posterior: hay que decir quién aprobó. */
const necesitaAprobacion = (desde: EstadoTrabajo, hasta: EstadoTrabajo) =>
  (desde === 'diseno' || desde === 'aprobacion') && ORDEN.indexOf(hasta) > ORDEN.indexOf('aprobacion')

const pasaFiltro = (t: TrabajoEnTablero, filtro: Filtro) =>
  filtro === 'todos' ||
  (filtro === 'atrasados' && t.plazo.tipo === 'atrasado') ||
  (filtro === 'hoy' && t.plazo.tipo === 'hoy') ||
  (filtro === 'semana' &&
    (t.plazo.tipo === 'atrasado' || t.plazo.tipo === 'hoy' || t.plazo.tipo === 'manana' || (t.plazo.tipo === 'pronto' && t.plazo.dias <= 7)))

const fechaCorta = (iso: string) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString('es-PE', { weekday: 'short', day: '2-digit', month: '2-digit' })

/**
 * El taller de un vistazo: qué trabajos siguen dentro, en qué va cada uno y
 * cuáles corren prisa. Mover un trabajo lo anota en su historial.
 */
export function TrabajosView({ search }: { search: string }) {
  const { workOrders, debts, loading, avanzarTrabajo, fijarEntrega } = useData()
  const { puedeRegistrar } = usePermisos()
  const toast = useToast()
  const [filtro, setFiltro] = useState<Filtro>('todos')
  const [entregando, setEntregando] = useState<{ t: TrabajoEnTablero; nota: string } | null>(null)
  const [aprobando, setAprobando] = useState<{ t: TrabajoEnTablero; estado: EstadoTrabajo } | null>(null)
  const [verEntregados, setVerEntregados] = useState(false)

  const tablero = useMemo(() => armarTablero(workOrders, debts, new Date()), [workOrders, debts])
  const q = search.toLowerCase().trim()
  const coincide = (t: TrabajoEnTablero) =>
    !q ||
    t.pedido.party.toLowerCase().includes(q) ||
    t.pedido.items.some((i) => i.description.toLowerCase().includes(q))

  const mover = async (t: TrabajoEnTablero, estado: EstadoTrabajo, nota?: string) => {
    // Un trabajo que pasó por diseño no se imprime sin decir quién lo aprobó.
    if (nota === undefined && necesitaAprobacion(t.pedido.estado, estado)) return setAprobando({ t, estado })
    if (estado === 'entregado') return setEntregando({ t, nota: nota ?? '' })
    try {
      await avanzarTrabajo(t.pedido.id, estado, nota)
      toast.success(`${t.pedido.party}: ${NOMBRE_ESTADO[estado].toLowerCase()}`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo mover el trabajo')
    }
  }

  const cambiarFecha = async (t: TrabajoEnTablero, fecha: string) => {
    try {
      await fijarEntrega(t.pedido.id, fecha || null)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo cambiar la fecha')
    }
  }

  const enTaller = EN_EL_TALLER.reduce((n, e) => n + tablero.columnas[e].length, 0)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2 text-xs font-bold">
          <span className="rounded-xl bg-rose-50 px-3 py-1.5 text-rose-800 dark:bg-rose-500/10 dark:text-rose-300">
            {tablero.atrasados} atrasados
          </span>
          <span className="rounded-xl bg-amber-50 px-3 py-1.5 text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
            {tablero.paraHoy} para hoy
          </span>
          <span className="rounded-xl bg-slate-100 px-3 py-1.5 text-slate-700 dark:bg-slate-800 dark:text-slate-200">
            {enTaller} en el taller
          </span>
        </div>
        <div role="radiogroup" aria-label="Filtrar trabajos" className="flex gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
          {(
            [
              ['todos', 'Todos'],
              ['atrasados', 'Atrasados'],
              ['hoy', 'Para hoy'],
              ['semana', 'Esta semana'],
            ] as const
          ).map(([valor, texto]) => (
            <button
              key={valor}
              type="button"
              role="radio"
              aria-checked={filtro === valor}
              onClick={() => setFiltro(valor)}
              className={`rounded-lg px-2.5 py-1 text-[11px] font-bold transition-colors ${
                filtro === valor
                  ? 'bg-white text-slate-900 shadow dark:bg-slate-900 dark:text-slate-50'
                  : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-100'
              }`}
            >
              {texto}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <p className="py-10 text-center text-xs text-slate-400">Cargando trabajos…</p>
      ) : enTaller === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 p-8 text-center dark:border-slate-700">
          <p className="text-sm font-bold text-slate-700 dark:text-slate-200">No hay trabajos en el taller</p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Un pedido con adelanto o al crédito, o uno con fecha de entrega, aparece aquí.
          </p>
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          {EN_EL_TALLER.map((estado) => {
            const trabajos = tablero.columnas[estado].filter((t) => pasaFiltro(t, filtro) && coincide(t))
            return (
              <section
                key={estado}
                aria-label={NOMBRE_ESTADO[estado]}
                className="min-w-0 rounded-2xl border border-slate-200/80 bg-slate-50/60 p-2.5 dark:border-slate-800/80 dark:bg-slate-900/60"
              >
                <h3 className="mb-2 flex items-center justify-between px-1 text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  {NOMBRE_ESTADO[estado]}
                  <span className="rounded-md bg-white px-1.5 py-0.5 text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                    {trabajos.length}
                  </span>
                </h3>
                <ul className="space-y-2">
                  {trabajos.map((t) => (
                    <Tarjeta key={t.pedido.id} t={t} editable={puedeRegistrar} onMover={mover} onFecha={cambiarFecha} />
                  ))}
                </ul>
              </section>
            )
          })}
        </div>
      )}

      {tablero.entregadosRecientes.length > 0 && (
        <div className="rounded-2xl border border-slate-200/80 bg-white p-3 dark:border-slate-800/80 dark:bg-slate-900">
          <button
            type="button"
            onClick={() => setVerEntregados((v) => !v)}
            aria-expanded={verEntregados}
            className="flex w-full items-center justify-between text-xs font-bold text-slate-600 dark:text-slate-300"
          >
            Entregados en los últimos 7 días ({tablero.entregadosRecientes.length})
            <i className={`fa-solid fa-chevron-${verEntregados ? 'up' : 'down'} text-[10px]`} aria-hidden="true" />
          </button>
          {verEntregados && (
            <ul className="mt-2 divide-y divide-slate-100 text-xs dark:divide-slate-800">
              {tablero.entregadosRecientes.map((t) => (
                <li key={t.pedido.id} className="flex items-center justify-between gap-2 py-1.5">
                  <span className="min-w-0 truncate">
                    <span className="font-semibold text-slate-800 dark:text-slate-100">{t.pedido.party}</span>
                    <span className="text-slate-500 dark:text-slate-400"> · {t.pedido.items.map((i) => i.description).join(' + ')}</span>
                  </span>
                  <span className="shrink-0 text-[11px] text-slate-400">{shortDateTime(t.pedido.estadoAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {entregando && <EntregarModal t={entregando.t} nota={entregando.nota} onClose={() => setEntregando(null)} />}
      {aprobando && (
        <AprobacionModal
          t={aprobando.t}
          onClose={() => setAprobando(null)}
          onAprobar={(nota) => {
            const { t, estado } = aprobando
            setAprobando(null)
            void mover(t, estado, nota)
          }}
        />
      )}
    </div>
  )
}

function Tarjeta({
  t,
  onMover,
  editable,
  onFecha,
}: {
  t: TrabajoEnTablero
  /** false en una cuenta que solo consulta: la base rechaza sus escrituras. */
  editable: boolean
  onMover: (t: TrabajoEnTablero, estado: EstadoTrabajo) => void
  onFecha: (t: TrabajoEnTablero, fecha: string) => void
}) {
  const [historial, setHistorial] = useState<EventoTrabajo[] | null>(null)
  const [verHistorial, setVerHistorial] = useState(false)
  const siguiente = siguienteEstado(t.pedido.estado)
  const { pedido } = t

  useEffect(() => {
    if (!verHistorial || historial) return
    let vivo = true
    void db
      .listEventosTrabajo(pedido.id)
      .then((e) => vivo && setHistorial(e))
      .catch(() => vivo && setHistorial([]))
    return () => {
      vivo = false
    }
  }, [verHistorial, historial, pedido.id])

  return (
    <li className="space-y-2 rounded-xl border border-slate-200 bg-white p-2.5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 truncate text-xs font-bold text-slate-900 dark:text-slate-50">{pedido.party}</p>
        <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-bold ${TONO_PLAZO[t.plazo.tipo]}`}>
          {textoPlazo(t.plazo)}
        </span>
      </div>
      <p className="line-clamp-2 text-[11px] text-slate-600 dark:text-slate-300">
        {pedido.items.map((i) => i.description).join(' + ')}
      </p>
      <div className="flex items-center justify-between gap-2 text-[11px]">
        <span className="font-semibold tabular-nums text-slate-700 dark:text-slate-200">{money(pedido.total)}</span>
        {t.saldo > 0 ? (
          <span className="font-bold tabular-nums text-amber-700 dark:text-amber-300">Saldo {money(t.saldo)}</span>
        ) : (
          <span className="font-bold text-emerald-700 dark:text-emerald-300">Pagado</span>
        )}
      </div>
      <label className="flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
        <i className="fa-regular fa-calendar" aria-hidden="true" />
        <span className="sr-only">Fecha de entrega</span>
        <input
          type="date"
          value={pedido.entrega ?? ''}
          onChange={(e) => onFecha(t, e.target.value)}
          disabled={!editable}
          className="min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-1 py-0.5 text-[11px] font-semibold text-slate-700 hover:border-slate-200 focus:border-brand-400 dark:text-slate-200 dark:hover:border-slate-700"
          aria-label={`Fecha de entrega de ${pedido.party}`}
        />
        {pedido.entrega && <span className="shrink-0 capitalize">{fechaCorta(pedido.entrega)}</span>}
      </label>

      <div className="flex flex-wrap items-center gap-1.5">
        {(pedido.estado === 'diseno' || pedido.estado === 'aprobacion') && (
          <a
            href={enlaceWhatsApp(pedido.phone, mensaje.prueba(pedido))}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 rounded-lg border border-emerald-300 px-2 py-1 text-[11px] font-bold text-emerald-700 transition-colors hover:bg-emerald-50 dark:border-emerald-500/40 dark:text-emerald-300 dark:hover:bg-emerald-500/10"
            title="Pedir el visto bueno del diseño (adjunta la imagen en WhatsApp)"
          >
            <i className="fa-brands fa-whatsapp" aria-hidden="true" />
            Enviar prueba
          </a>
        )}
        {pedido.estado === 'listo' ? (
          <>
            <a
              href={enlaceWhatsApp(pedido.phone, mensaje.listo(pedido, t.saldo))}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-2 py-1 text-[11px] font-bold text-white transition-colors hover:bg-emerald-700"
              title={pedido.phone ? `Avisar a ${pedido.phone}` : 'Sin teléfono: elige el chat en WhatsApp'}
            >
              <i className="fa-brands fa-whatsapp" aria-hidden="true" />
              Avisar
            </a>
            {editable && (
              <button
                type="button"
                onClick={() => onMover(t, 'entregado')}
                className="inline-flex items-center gap-1 rounded-lg bg-brand-800 px-2 py-1 text-[11px] font-bold text-white transition-colors hover:bg-brand-900 dark:bg-brand-600"
              >
                <i className="fa-solid fa-hand-holding" aria-hidden="true" />
                Entregar
              </button>
            )}
          </>
        ) : (
          siguiente &&
          editable && (
            <button
              type="button"
              onClick={() => onMover(t, siguiente)}
              className="inline-flex items-center gap-1 rounded-lg bg-brand-50 px-2 py-1 text-[11px] font-bold text-brand-800 transition-colors hover:bg-brand-100 dark:bg-brand-500/10 dark:text-brand-300"
            >
              {NOMBRE_ESTADO[siguiente]}
              <i className="fa-solid fa-arrow-right text-[9px]" aria-hidden="true" />
            </button>
          )
        )}
        {editable && (
          <select
            value=""
            onChange={(e) => e.target.value && onMover(t, e.target.value as EstadoTrabajo)}
            aria-label={`Mover el trabajo de ${pedido.party}`}
            className="rounded-lg border border-slate-200 bg-white px-1 py-1 text-[11px] text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400"
          >
            <option value="">Mover a…</option>
            {ESTADOS_TRABAJO.filter((e) => e !== pedido.estado).map((e) => (
              <option key={e} value={e}>
                {NOMBRE_ESTADO[e]}
              </option>
            ))}
          </select>
        )}
        <button
          type="button"
          onClick={() => setVerHistorial((v) => !v)}
          aria-expanded={verHistorial}
          title="Historial del trabajo"
          aria-label={`Historial de ${pedido.party}`}
          className="ml-auto rounded p-1 text-slate-400 transition-colors hover:text-brand-700 dark:text-slate-500 dark:hover:text-brand-300"
        >
          <i className="fa-solid fa-clock-rotate-left text-[11px]" aria-hidden="true" />
        </button>
      </div>

      {verHistorial && (
        <ol className="space-y-0.5 border-t border-slate-100 pt-1.5 text-[10px] text-slate-500 dark:border-slate-800 dark:text-slate-400">
          {historial === null ? (
            <li>Cargando…</li>
          ) : historial.length === 0 ? (
            <li>Sin historial (pedido anterior a los estados).</li>
          ) : (
            historial.map((e) => (
              <li key={e.id}>
                {shortDateTime(e.createdAt)} · <span className="font-semibold">{NOMBRE_ESTADO[e.estado]}</span>
                {e.author && ` · ${e.author}`}
                {e.nota && <span className="block pl-2 italic">{e.nota}</span>}
              </li>
            ))
          )}
        </ol>
      )}
    </li>
  )
}

/**
 * Entregar con saldo pendiente: se cobra ahí mismo o se deja anotado, pero no
 * se entrega sin que quien lo hace lo vea.
 */
function EntregarModal({ t, nota, onClose }: { t: TrabajoEnTablero; nota: string; onClose: () => void }) {
  const { avanzarTrabajo, abonarDeuda } = useData()
  const toast = useToast()
  const [metodo, setMetodo] = useState<PaymentMethod>('Efectivo')
  const [guardando, setGuardando] = useState(false)

  const entregar = async (cobrar: boolean) => {
    setGuardando(true)
    try {
      if (cobrar && t.deuda && t.saldo > 0) await abonarDeuda(t.deuda.id, t.saldo, metodo)
      await avanzarTrabajo(t.pedido.id, 'entregado', nota)
      toast.success(cobrar ? `Cobrado ${money(t.saldo)} y entregado` : `Entregado a ${t.pedido.party}`)
      onClose()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo entregar')
    } finally {
      setGuardando(false)
    }
  }

  return (
    <Modal open onClose={onClose} title="Entregar el trabajo" subtitle={t.pedido.party} icon="fa-hand-holding">
      <div className="space-y-3">
        <p className="text-xs text-slate-600 dark:text-slate-300">{t.pedido.items.map((i) => i.description).join(' + ')}</p>
        {t.saldo > 0 ? (
          <>
            <div className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300">
              Queda un saldo de {money(t.saldo)}.
            </div>
            <label className="field-label" htmlFor="entregar-metodo">
              ¿Con qué paga el saldo?
            </label>
            <select
              id="entregar-metodo"
              value={metodo}
              onChange={(e) => setMetodo(e.target.value as PaymentMethod)}
              className="field"
            >
              {PAYMENT_METHODS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
            <div className="flex flex-wrap justify-end gap-2 pt-1">
              <button type="button" disabled={guardando} onClick={() => void entregar(false)} className="btn-ghost">
                Entregar sin cobrar
              </button>
              <button type="button" disabled={guardando} onClick={() => void entregar(true)} className="btn-primary px-4">
                {guardando ? 'Guardando…' : `Cobrar ${money(t.saldo)} y entregar`}
              </button>
            </div>
          </>
        ) : (
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="btn-ghost">
              Cancelar
            </button>
            <button type="button" disabled={guardando} onClick={() => void entregar(false)} className="btn-primary px-4">
              {guardando ? 'Guardando…' : 'Marcar como entregado'}
            </button>
          </div>
        )}
      </div>
    </Modal>
  )
}

/**
 * Antes de imprimir: quién dio el visto bueno al diseño y cómo. Queda en el
 * historial del trabajo; si luego hay reclamo, se sabe qué se aprobó.
 */
function AprobacionModal({ t, onAprobar, onClose }: { t: TrabajoEnTablero; onAprobar: (nota: string) => void; onClose: () => void }) {
  const [detalle, setDetalle] = useState('')
  const opciones = [
    ['El cliente aprobó por WhatsApp', 'fa-brands fa-whatsapp'],
    ['El cliente aprobó en persona', 'fa-solid fa-user-check'],
    ['No lleva diseño que aprobar', 'fa-solid fa-ban'],
  ] as const
  return (
    <Modal open onClose={onClose} title="¿Quién aprobó el diseño?" subtitle={t.pedido.party} icon="fa-circle-check">
      <div className="space-y-3">
        <p className="text-xs text-slate-600 dark:text-slate-300">{t.pedido.items.map((i) => i.description).join(' + ')}</p>
        <div className="grid gap-2">
          {opciones.map(([texto, icono]) => (
            <button
              key={texto}
              type="button"
              onClick={() => onAprobar(detalle.trim() ? `${texto}: ${detalle.trim()}` : texto)}
              className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-left text-xs font-semibold text-slate-700 transition-colors hover:border-brand-400 hover:bg-brand-50 dark:border-slate-800 dark:text-slate-200 dark:hover:bg-brand-500/10"
            >
              <i className={`${icono} w-4 text-brand-700 dark:text-brand-300`} aria-hidden="true" />
              {texto}
            </button>
          ))}
        </div>
        <div>
          <label className="field-label" htmlFor="aprob-detalle">
            Detalle <span className="font-normal text-slate-400">(opcional)</span>
          </label>
          <input
            id="aprob-detalle"
            value={detalle}
            onChange={(e) => setDetalle(e.target.value)}
            placeholder="Ej: con el logo más grande"
            maxLength={120}
            className="field"
          />
        </div>
      </div>
    </Modal>
  )
}
