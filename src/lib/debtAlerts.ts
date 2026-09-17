import type { Debt } from '@/types'

/** A partir de cuántos días una cuenta sin vencimiento ya pide atención. */
export const DIAS_PARA_ANTIGUA = 15

export type Urgencia = 'vencida' | 'antigua' | 'reciente'

export interface DebtAlert {
  debt: Debt
  /** Días desde que se registró la cuenta. */
  dias: number
  /** Días pasados de la fecha de vencimiento; 0 si no tiene o no venció. */
  diasVencida: number
  urgencia: Urgencia
}

export interface DebtBriefing {
  porCobrar: DebtAlert[]
  porPagar: DebtAlert[]
  /** Todas las cuentas vivas juntas, lo más urgente primero. Lo usa la cinta. */
  todas: DebtAlert[]
  totalCobrar: number
  totalPagar: number
  neto: number
  /** Cuentas vencidas o antiguas: las que conviene mirar hoy. */
  urgentes: number
  /** Total de cuentas con saldo vivo. */
  pendientes: number
}

function diasEntre(desde: string, hasta: Date): number {
  const d = new Date(desde)
  if (Number.isNaN(d.getTime())) return 0
  return Math.max(0, Math.floor((hasta.getTime() - d.getTime()) / 86_400_000))
}

/**
 * Clasifica una cuenta pendiente.
 *
 * `dueDate` es opcional y las cuentas que nacen de una orden nunca lo traen,
 * así que la antigüedad hace de segunda señal: sin ella, casi ninguna cuenta
 * llegaría a marcarse como urgente.
 */
function clasificar(debt: Debt, ahora: Date): DebtAlert {
  const dias = diasEntre(debt.createdAt, ahora)
  const diasVencida = debt.dueDate ? diasEntre(debt.dueDate, ahora) : 0

  const urgencia: Urgencia =
    diasVencida > 0 ? 'vencida' : dias >= DIAS_PARA_ANTIGUA ? 'antigua' : 'reciente'

  return { debt, dias, diasVencida, urgencia }
}

/** Primero lo vencido, después lo más viejo, y a igualdad el importe mayor. */
function porPrioridad(a: DebtAlert, b: DebtAlert): number {
  if (a.diasVencida !== b.diasVencida) return b.diasVencida - a.diasVencida
  if (a.dias !== b.dias) return b.dias - a.dias
  return b.debt.balance - a.debt.balance
}

export function buildDebtBriefing(debts: Debt[], ahora = new Date()): DebtBriefing {
  const vivas = debts.filter((d) => d.balance > 0)

  const porCobrar = vivas
    .filter((d) => d.kind === 'COBRAR')
    .map((d) => clasificar(d, ahora))
    .sort(porPrioridad)

  const porPagar = vivas
    .filter((d) => d.kind === 'PAGAR')
    .map((d) => clasificar(d, ahora))
    .sort(porPrioridad)

  const suma = (list: DebtAlert[]) =>
    Math.round(list.reduce((total, a) => total + a.debt.balance, 0) * 100) / 100

  const totalCobrar = suma(porCobrar)
  const totalPagar = suma(porPagar)

  return {
    porCobrar,
    porPagar,
    todas: [...porCobrar, ...porPagar].sort(porPrioridad),
    totalCobrar,
    totalPagar,
    neto: Math.round((totalCobrar - totalPagar) * 100) / 100,
    urgentes: [...porCobrar, ...porPagar].filter((a) => a.urgencia !== 'reciente').length,
    pendientes: vivas.length,
  }
}

/** "hace 18 días" / "vencida hace 3 días" */
export function describirAntiguedad(alert: DebtAlert): string {
  if (alert.diasVencida > 0) {
    return `vencida hace ${alert.diasVencida} ${alert.diasVencida === 1 ? 'día' : 'días'}`
  }
  if (alert.dias === 0) return 'de hoy'
  return `hace ${alert.dias} ${alert.dias === 1 ? 'día' : 'días'}`
}

const soles = (n: number) => `${n.toFixed(2)} soles`

/** Texto que lee el asistente. Se queda en los tres primeros de cada lado. */
export function briefingToSpeech(b: DebtBriefing): string {
  if (b.pendientes === 0) {
    return 'No tienes cuentas pendientes. Nadie te debe y no debes nada a proveedores.'
  }

  const partes: string[] = []

  if (b.porCobrar.length > 0) {
    const nombres = b.porCobrar
      .slice(0, 3)
      .map((a) => `${a.debt.party}, ${soles(a.debt.balance)}`)
      .join('. ')
    const resto = b.porCobrar.length > 3 ? ` Y ${b.porCobrar.length - 3} clientes más.` : ''
    partes.push(`Te deben ${soles(b.totalCobrar)}. ${nombres}.${resto}`)
  } else {
    partes.push('Nadie te debe dinero.')
  }

  if (b.porPagar.length > 0) {
    const nombres = b.porPagar
      .slice(0, 3)
      .map((a) => `${a.debt.party}, ${soles(a.debt.balance)}`)
      .join('. ')
    partes.push(`Tú debes ${soles(b.totalPagar)}. ${nombres}.`)
  } else {
    partes.push('No debes nada a proveedores.')
  }

  if (b.urgentes > 0) {
    partes.push(
      `Atención: ${b.urgentes} ${b.urgentes === 1 ? 'cuenta lleva' : 'cuentas llevan'} demasiado tiempo sin cobrarse.`,
    )
  }

  partes.push(
    `Tu posición neta es de ${soles(Math.abs(b.neto))} ${b.neto >= 0 ? 'a favor' : 'en contra'}.`,
  )

  return partes.join(' ')
}

// ---------------------------------------------------------------------------
// Mensajes del robot asistente
// ---------------------------------------------------------------------------

/** Cada trozo del mensaje se pinta de un color distinto en el globo. */
export type BotChunkKind = 'texto' | 'nombre' | 'cobro' | 'pago' | 'tiempo'

export interface BotChunk {
  text: string
  kind: BotChunkKind
}

export interface BotMessage {
  /** El mensaje partido en trozos, para colorearlo. */
  chunks: BotChunk[]
  /** El mismo mensaje en plano: para leerlo en voz alta y para las pruebas. */
  text: string
  /** Marca el color del globo. 'resumen' es el saludo inicial. */
  tone: Urgencia | 'resumen'
  debt: Debt | null
}

const money = (n: number) => `S/ ${n.toFixed(2)}`

const t = (text: string): BotChunk => ({ text, kind: 'texto' })
const nombre = (text: string): BotChunk => ({ text, kind: 'nombre' })
const cobro = (n: number): BotChunk => ({ text: money(n), kind: 'cobro' })
const pago = (n: number): BotChunk => ({ text: money(n), kind: 'pago' })
const tiempo = (text: string): BotChunk => ({ text, kind: 'tiempo' })

function armar(chunks: BotChunk[], tone: BotMessage['tone'], debt: Debt | null): BotMessage {
  return { chunks, text: chunks.map((c) => c.text).join(''), tone, debt }
}

/**
 * Lo que cuenta el robot: primero el resumen con el que saluda, y después una
 * cuenta por mensaje, de la más urgente a la menos.
 */
export function buildBotMessages(b: DebtBriefing): BotMessage[] {
  if (b.pendientes === 0) return []

  const saludo: BotChunk[] = []

  if (b.porCobrar.length > 0) {
    const cuantos = b.porCobrar.length
    saludo.push(
      t('Te deben '),
      cobro(b.totalCobrar),
      t(' de '),
      nombre(`${cuantos} ${cuantos === 1 ? 'cliente' : 'clientes'}`),
      t('. '),
    )
  }
  if (b.porPagar.length > 0) {
    saludo.push(t('Tú debes '), pago(b.totalPagar), t(' a proveedores. '))
  }

  const primero = b.todas[0]
  if (primero && primero.urgencia !== 'reciente') {
    saludo.push(
      t('Lo más urgente: '),
      nombre(primero.debt.party),
      t(', '),
      primero.debt.kind === 'COBRAR' ? cobro(primero.debt.balance) : pago(primero.debt.balance),
      t(', '),
      tiempo(describirAntiguedad(primero)),
      t('.'),
    )
  }

  const detalle = b.todas.map((a) =>
    armar(
      a.debt.kind === 'COBRAR'
        ? [
            nombre(a.debt.party),
            t(' te debe '),
            cobro(a.debt.balance),
            t(', '),
            tiempo(describirAntiguedad(a)),
            t('.'),
          ]
        : [
            t('Le debes '),
            pago(a.debt.balance),
            t(' a '),
            nombre(a.debt.party),
            t(', '),
            tiempo(describirAntiguedad(a)),
            t('.'),
          ],
      a.urgencia,
      a.debt,
    ),
  )

  return [armar(saludo, 'resumen', null), ...detalle]
}
