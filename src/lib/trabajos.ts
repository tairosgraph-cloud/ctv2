/**
 * El tablero del taller: qué trabajos siguen dentro, en qué va cada uno y
 * cuáles corren prisa. Puro, para probarlo en smoke.
 */
import { diasParaVencer } from '@/lib/fechas'
import { ESTADOS_TRABAJO, type Debt, type EstadoTrabajo, type WorkOrder } from '@/types'

export type Plazo =
  | { tipo: 'atrasado'; dias: number }
  | { tipo: 'hoy' }
  | { tipo: 'manana' }
  | { tipo: 'pronto'; dias: number }
  | { tipo: 'sin-fecha' }

export function plazoDe(entrega: string | null, ahora: Date): Plazo {
  const faltan = diasParaVencer(entrega, ahora)
  if (faltan === null) return { tipo: 'sin-fecha' }
  if (faltan < 0) return { tipo: 'atrasado', dias: -faltan }
  if (faltan === 0) return { tipo: 'hoy' }
  if (faltan === 1) return { tipo: 'manana' }
  return { tipo: 'pronto', dias: faltan }
}

export function textoPlazo(p: Plazo): string {
  switch (p.tipo) {
    case 'atrasado':
      return p.dias === 1 ? 'Atrasado 1 día' : `Atrasado ${p.dias} días`
    case 'hoy':
      return 'Para hoy'
    case 'manana':
      return 'Para mañana'
    case 'pronto':
      return `En ${p.dias} días`
    case 'sin-fecha':
      return 'Sin fecha'
  }
}

/** Para ordenar: lo atrasado primero, lo sin fecha al final. */
const urgencia = (p: Plazo): number =>
  p.tipo === 'atrasado' ? -1000 + -p.dias : p.tipo === 'hoy' ? 0 : p.tipo === 'manana' ? 1 : p.tipo === 'pronto' ? p.dias : 10_000

export interface TrabajoEnTablero {
  pedido: WorkOrder
  plazo: Plazo
  /** Lo que falta cobrar de ese pedido (0 si ya está pagado). */
  saldo: number
  /** La cuenta pendiente del pedido, para cobrar desde el tablero. */
  deuda: Debt | null
}

/** Los estados que ocupan el tablero: todos menos «entregado». */
export const EN_EL_TALLER = ESTADOS_TRABAJO.filter((e) => e !== 'entregado') as Exclude<EstadoTrabajo, 'entregado'>[]

export interface Tablero {
  columnas: Record<Exclude<EstadoTrabajo, 'entregado'>, TrabajoEnTablero[]>
  atrasados: number
  paraHoy: number
  /** Entregados en los últimos 7 días, del más reciente al más antiguo. */
  entregadosRecientes: TrabajoEnTablero[]
}

export function armarTablero(pedidos: ReadonlyArray<WorkOrder>, deudas: ReadonlyArray<Debt>, ahora: Date): Tablero {
  const deudaDe = new Map(deudas.filter((d) => d.workOrderId).map((d) => [d.workOrderId!, d]))
  const vista = (pedido: WorkOrder): TrabajoEnTablero => {
    const deuda = deudaDe.get(pedido.id) ?? null
    return { pedido, plazo: plazoDe(pedido.entrega, ahora), saldo: deuda && deuda.balance > 0 ? deuda.balance : 0, deuda }
  }

  const columnas = Object.fromEntries(EN_EL_TALLER.map((e) => [e, [] as TrabajoEnTablero[]])) as Tablero['columnas']
  const entregados: TrabajoEnTablero[] = []
  const hace7dias = ahora.getTime() - 7 * 86_400_000

  for (const pedido of pedidos) {
    if (pedido.estado === 'entregado') {
      if (new Date(pedido.estadoAt).getTime() >= hace7dias && pedido.estadoAt !== pedido.createdAt) {
        entregados.push(vista(pedido))
      }
      continue
    }
    columnas[pedido.estado].push(vista(pedido))
  }
  for (const e of EN_EL_TALLER) {
    columnas[e].sort((a, b) => urgencia(a.plazo) - urgencia(b.plazo) || a.pedido.createdAt.localeCompare(b.pedido.createdAt))
  }
  const activos = EN_EL_TALLER.flatMap((e) => columnas[e])
  return {
    columnas,
    atrasados: activos.filter((t) => t.plazo.tipo === 'atrasado').length,
    paraHoy: activos.filter((t) => t.plazo.tipo === 'hoy').length,
    entregadosRecientes: entregados.sort((a, b) => b.pedido.estadoAt.localeCompare(a.pedido.estadoAt)),
  }
}

/** El siguiente paso natural de un trabajo; null si ya está entregado. */
export function siguienteEstado(estado: EstadoTrabajo): EstadoTrabajo | null {
  const i = ESTADOS_TRABAJO.indexOf(estado)
  return i >= 0 && i < ESTADOS_TRABAJO.length - 1 ? ESTADOS_TRABAJO[i + 1] : null
}
