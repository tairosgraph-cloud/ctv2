import type { CashClosing, Transaction } from '@/types'

/** Los asientos anulados no cuentan para ningún total. */
const isActive = (t: Transaction) => t.status !== 'Anulado'

const round2 = (value: number) => Math.round(value * 100) / 100

/** Milisegundos de una fecha ISO, o NaN si el dato es ilegible. */
const instante = (iso: string) => new Date(iso).getTime()

/**
 * Arqueo de caja: cuánto efectivo debería haber en el cajón ahora mismo.
 *
 * Cada cierre deja la caja saldada: el efectivo contado en el cierre es el
 * fondo con el que se abre el turno siguiente. Por eso el esperado solo puede
 * mirar los movimientos POSTERIORES al último cierre. Sumar además los de
 * ayer los contaría dos veces —una dentro del fondo de apertura y otra como
 * movimiento— e inventaría un faltante que crece cada día.
 */
export interface CashArqueo {
  /** Cierre desde el que arranca el conteo. null si todavía no hubo ninguno. */
  lastClosing: CashClosing | null
  /** Instante (ISO) desde el que se cuenta. null = desde el inicio de la historia. */
  since: string | null
  /** Suma con signo del efectivo movido después de `since`. */
  cashSince: number
  /** Cuántos asientos en efectivo entran en el cálculo. */
  movements: number
  /** Fondo de apertura + `cashSince`, redondeado a céntimos. */
  expectedCash: number
}

/**
 * El cierre más reciente de la bitácora. No se fía del orden en que venga la
 * lista: busca el `closedAt` mayor e ignora los sellos ilegibles.
 */
export function findLastClosing(closings: CashClosing[]): CashClosing | null {
  let last: CashClosing | null = null
  let lastMs = Number.NEGATIVE_INFINITY

  for (const c of closings) {
    const ms = instante(c.closedAt)
    if (Number.isNaN(ms) || ms <= lastMs) continue
    lastMs = ms
    last = c
  }

  return last
}

/**
 * Calcula el efectivo esperado en caja: fondo de apertura + los movimientos en
 * efectivo posteriores al último cierre. Sin cierres previos cuenta desde el
 * principio, porque entonces el fondo de apertura es el del primer día.
 *
 * Quedan fuera los asientos anulados y los que no se pagaron en efectivo. Un
 * asiento con fecha ilegible tampoco puede situarse respecto al cierre, así
 * que se excluye en vez de arriesgar un doble conteo.
 */
export function buildCashArqueo(
  transactions: Transaction[],
  closings: CashClosing[],
  openingCash = 0,
): CashArqueo {
  const lastClosing = findLastClosing(closings)
  const sinceMs = lastClosing ? instante(lastClosing.closedAt) : null

  let cashSince = 0
  let movements = 0

  for (const t of transactions) {
    if (!isActive(t) || t.payment !== 'Efectivo') continue
    if (sinceMs !== null) {
      const ms = instante(t.occurredAt)
      if (Number.isNaN(ms) || ms <= sinceMs) continue
    }
    movements++
    cashSince += t.type === 'Ingreso' ? t.amount : -t.amount
  }

  cashSince = round2(cashSince)

  return {
    lastClosing,
    since: lastClosing ? lastClosing.closedAt : null,
    cashSince,
    movements,
    expectedCash: round2(openingCash + cashSince),
  }
}

/**
 * Frase para la interfaz: desde cuándo se están contando los movimientos.
 * El formato de la fecha lo pone quien llama, para no atar el cálculo a una
 * localización concreta.
 */
export function describeCashWindow(
  arqueo: CashArqueo,
  formatDate: (iso: string) => string,
): string {
  return arqueo.since
    ? `desde el último cierre del ${formatDate(arqueo.since)}`
    : 'desde el inicio, aún sin cierres'
}
