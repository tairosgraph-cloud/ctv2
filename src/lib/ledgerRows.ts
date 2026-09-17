import type { Debt, Transaction, TxType, WorkOrder } from '@/types'

/**
 * Situación de cobro de una fila del libro. Siempre se deriva del dinero
 * registrado, nunca se fija a mano: así el estado no puede contradecir a la
 * caja ni a la pestaña Deudas.
 *
 *   PAGADO     el importe entero se cobró (o se pagó, si es un egreso)
 *   PARCIAL    entró un adelanto y queda saldo
 *   PENDIENTE  no entró nada todavía: se entregó al crédito
 *   ANULADO    el asiento fue anulado
 */
export type LedgerState = 'PAGADO' | 'PARCIAL' | 'PENDIENTE' | 'ANULADO'

/**
 * Una fila de «Asientos del día». Puede venir de dos sitios:
 *  - un asiento real (dinero que se movió)
 *  - un pedido al crédito, que no generó asiento porque no entró plata
 *
 * `countsToCash` distingue las dos: las filas al crédito se muestran pero
 * quedan fuera de Ingresos, Egresos y del arqueo. Se reconocen porque su
 * `transaction` es null.
 */
export interface LedgerRow {
  id: string
  occurredAt: string
  type: TxType
  concept: string
  party: string
  category: string
  /** null en las filas al crédito: todavía no hubo forma de pago. */
  payment: string | null
  /** Monto general del trabajo. Es lo que se muestra en la columna Monto. */
  total: number
  /** Dinero que de verdad entró o salió por esta fila. Puede ser menor al total. */
  cash: number
  /** true si esta fila movió dinero y debe contarse en caja. */
  countsToCash: boolean
  state: LedgerState
  /** Saldo que falta cobrar o pagar de este pedido. */
  pending: number
  transaction: Transaction | null
  workOrder: WorkOrder | null
  debt: Debt | null
}

export interface BuildLedgerInput {
  transactions: Transaction[]
  workOrders: WorkOrder[]
  debts: Debt[]
}

/**
 * Une asientos y pedidos al crédito en una sola lista ordenada.
 *
 * Un pedido al crédito desaparece de la lista cuando termina de cobrarse: a
 * partir de ese momento el dinero ya está representado por los asientos de
 * abono, y dejarlo visible haría parecer que el importe entró dos veces.
 */
export function buildLedgerRows({
  transactions,
  workOrders,
  debts,
}: BuildLedgerInput): LedgerRow[] {
  const orderById = new Map(workOrders.map((w) => [w.id, w]))
  const debtByOrderId = new Map(
    debts.filter((d) => d.workOrderId).map((d) => [d.workOrderId as string, d]),
  )

  const rows: LedgerRow[] = transactions.map((t) => {
    const workOrder = t.workOrderId ? (orderById.get(t.workOrderId) ?? null) : null
    const debt = t.workOrderId ? (debtByOrderId.get(t.workOrderId) ?? null) : null
    const pending = debt ? debt.balance : 0
    const anulado = t.status === 'Anulado'

    let state: LedgerState = 'PAGADO'
    if (anulado) state = 'ANULADO'
    else if (pending > 0) state = 'PARCIAL'

    return {
      id: t.id,
      occurredAt: t.occurredAt,
      type: t.type,
      concept: t.concept,
      party: t.party,
      category: t.category,
      payment: t.payment,
      // Con pedido detrás, el monto general es el del trabajo completo;
      // el asiento por sí solo únicamente conoce el adelanto.
      total: workOrder ? workOrder.total : t.amount,
      cash: anulado ? 0 : t.amount,
      countsToCash: !anulado,
      state,
      pending,
      transaction: t,
      workOrder,
      debt,
    }
  })

  for (const order of workOrders) {
    // Solo los pedidos que no generaron asiento: los que se fueron al crédito.
    if (order.advance > 0) continue
    const debt = debtByOrderId.get(order.id) ?? null
    if (!debt || debt.balance <= 0) continue

    rows.push({
      id: `wo-${order.id}`,
      occurredAt: order.createdAt,
      type: order.kind,
      concept: order.items.map((i) => i.description).join(' + '),
      party: order.party,
      category: order.category,
      payment: null,
      total: order.total,
      cash: 0,
      countsToCash: false,
      state: 'PENDIENTE',
      pending: debt.balance,
      transaction: null,
      workOrder: order,
      debt,
    })
  }

  return rows.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
}
