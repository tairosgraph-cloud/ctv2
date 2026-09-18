import { supabase } from '@/lib/supabase'
import type {
  CashClosing,
  Debt,
  DebtPayment,
  NewDebt,
  NewProforma,
  UpdateProforma,
  UpdateDebt,
  NewTransaction,
  NewWorkOrder,
  UpdateWorkOrder,
  PaymentMethod,
  Proforma,
  Transaction,
  WorkOrder,
  WorkOrderItem,
  WorkOrderResult,
} from '@/types'
import type { ConvertResult, DataAdapter, NewClosing, PaymentResult } from './adapter'

function client() {
  if (!supabase) throw new Error('Supabase no está configurado')
  return supabase
}

/**
 * Supabase corta las consultas en 1000 filas por defecto (`max_rows`). Sin
 * pedir por tramos, a partir de ahi los listados devolverian datos incompletos
 * EN SILENCIO, y los totales de la app —que se calculan sobre esos arrays—
 * empezarian a mentir. Asi que se piden todos los tramos hasta agotar la tabla.
 */
const TAMANO_TRAMO = 1000
/** Freno de seguridad: 200 tramos son 200 000 filas. */
const TRAMOS_MAX = 200

async function traerTodo<T>(
  pedirTramo: (desde: number, hasta: number) => PromiseLike<{
    data: T[] | null
    error: { message: string } | null
  }>,
): Promise<T[]> {
  const filas: T[] = []

  for (let tramo = 0; tramo < TRAMOS_MAX; tramo++) {
    const desde = tramo * TAMANO_TRAMO
    const lote = unwrap(await pedirTramo(desde, desde + TAMANO_TRAMO - 1))
    filas.push(...lote)
    if (lote.length < TAMANO_TRAMO) return filas
  }

  throw new Error(
    `La tabla supera las ${TRAMOS_MAX * TAMANO_TRAMO} filas: hace falta filtrar por periodo`,
  )
}

/** Lanza con el mensaje de Postgres, que suele decir exactamente que fallo. */
function unwrap<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message)
  if (res.data === null) throw new Error('Supabase devolvió una respuesta vacía')
  return res.data
}

// --- mapeo snake_case (Postgres) <-> camelCase (TypeScript) -----------------

type TxRow = {
  id: string
  voucher: string
  type: Transaction['type']
  amount: string | number
  category: string
  party: string
  concept: string
  payment: PaymentMethod
  status: Transaction['status']
  occurred_at: string
  author: string
  notes: string
  source: Transaction['source']
  work_order_id: string | null
}

const toTx = (r: TxRow): Transaction => ({
  id: r.id,
  voucher: r.voucher,
  type: r.type,
  amount: Number(r.amount),
  category: r.category,
  party: r.party,
  concept: r.concept,
  payment: r.payment,
  status: r.status,
  occurredAt: r.occurred_at,
  author: r.author,
  notes: r.notes ?? '',
  source: r.source,
  workOrderId: r.work_order_id ?? null,
})

type ProformaRow = {
  id: string
  code: string
  client: string
  detail: string
  total: string | number
  validity_days: number
  status: Proforma['status']
  issued_at: string
  transaction_id: string | null
}

const toProforma = (r: ProformaRow): Proforma => ({
  id: r.id,
  code: r.code,
  client: r.client,
  detail: r.detail,
  total: Number(r.total),
  validityDays: r.validity_days,
  status: r.status,
  issuedAt: r.issued_at,
  transactionId: r.transaction_id,
})

type DebtRow = {
  id: string
  kind: Debt['kind']
  party: string
  concept: string
  total: string | number
  paid: string | number
  balance: string | number
  status: Debt['status']
  due_date: string | null
  created_at: string
  work_order_id: string | null
}

const toDebt = (r: DebtRow): Debt => ({
  id: r.id,
  kind: r.kind,
  party: r.party,
  concept: r.concept,
  total: Number(r.total),
  paid: Number(r.paid),
  balance: Number(r.balance),
  status: r.status,
  dueDate: r.due_date,
  createdAt: r.created_at,
  workOrderId: r.work_order_id ?? null,
})

type PaymentRow = {
  id: string
  debt_id: string
  amount: string | number
  payment_method: PaymentMethod
  transaction_id: string | null
  paid_at: string
}

const toPayment = (r: PaymentRow): DebtPayment => ({
  id: r.id,
  debtId: r.debt_id,
  amount: Number(r.amount),
  paymentMethod: r.payment_method,
  transactionId: r.transaction_id,
  paidAt: r.paid_at,
})

type WorkOrderRow = {
  id: string
  kind: WorkOrder['kind']
  party: string
  phone: string | null
  category: string
  total: string | number
  advance: string | number
  notes: string
  author: string
  created_at: string
  updated_at: string | null
  work_order_items: Array<{
    id: string
    position: number
    description: string
    amount: string | number
  }> | null
}

const toWorkOrder = (r: WorkOrderRow): WorkOrder => ({
  id: r.id,
  kind: r.kind,
  party: r.party,
  phone: r.phone ?? '',
  category: r.category,
  total: Number(r.total),
  advance: Number(r.advance),
  notes: r.notes ?? '',
  author: r.author,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  items: (r.work_order_items ?? [])
    .map<WorkOrderItem>((i) => ({
      id: i.id,
      position: i.position,
      description: i.description,
      amount: Number(i.amount),
    }))
    .sort((a, b) => a.position - b.position),
})

type ClosingRow = {
  id: string
  counted_cash: string | number
  expected_cash: string | number
  difference: string | number
  opening_cash: string | number
  notes: string
  author: string
  closed_at: string
}

const toClosing = (r: ClosingRow): CashClosing => ({
  id: r.id,
  countedCash: Number(r.counted_cash),
  expectedCash: Number(r.expected_cash),
  difference: Number(r.difference),
  openingCash: Number(r.opening_cash),
  notes: r.notes ?? '',
  author: r.author,
  closedAt: r.closed_at,
})

interface RpcIds {
  work_order_id: string
  transaction_id: string | null
  debt_id: string | null
}

/** Relee lo que dejó un RPC de pedido: la orden, su asiento y su deuda. */
async function readWorkOrderResult(ids: RpcIds): Promise<WorkOrderResult> {
  const workOrder = toWorkOrder(
    unwrap(
      await client()
        .from('work_orders')
        .select('*, work_order_items(*)')
        .eq('id', ids.work_order_id)
        .single<WorkOrderRow>(),
    ),
  )

  const transaction = ids.transaction_id
    ? toTx(
        unwrap(
          await client().from('transactions').select('*').eq('id', ids.transaction_id).single<TxRow>(),
        ),
      )
    : null

  const debt = ids.debt_id
    ? toDebt(
        unwrap(
          await client()
            .from('debts_with_balance')
            .select('*')
            .eq('id', ids.debt_id)
            .single<DebtRow>(),
        ),
      )
    : null

  return { workOrder, transaction, debt }
}

// --- adaptador --------------------------------------------------------------

export const supabaseAdapter: DataAdapter = {
  mode: 'supabase',

  async listTransactions() {
    const rows = await traerTodo<TxRow>((desde, hasta) =>
      client()
        .from('transactions')
        .select('*')
        .order('occurred_at', { ascending: false })
        .range(desde, hasta)
        .returns<TxRow[]>(),
    )
    return rows.map(toTx)
  },

  async createTransaction(input: NewTransaction) {
    const row = unwrap(
      await client()
        .from('transactions')
        .insert({
          ...(input.voucher ? { voucher: input.voucher } : {}),
          type: input.type,
          amount: input.amount,
          category: input.category,
          party: input.party,
          concept: input.concept,
          payment: input.payment,
          status: input.status,
          author: input.author,
          notes: input.notes,
          source: input.source,
          ...(input.occurredAt ? { occurred_at: input.occurredAt } : {}),
          ...(input.workOrderId ? { work_order_id: input.workOrderId } : {}),
        })
        .select()
        .single<TxRow>(),
    )
    return toTx(row)
  },

  async voidTransaction(id: string) {
    const row = unwrap(
      await client()
        .from('transactions')
        .update({ status: 'Anulado' })
        .eq('id', id)
        .select()
        .single<TxRow>(),
    )
    return toTx(row)
  },

  async deleteTransaction(id: string) {
    const { error } = await client().from('transactions').delete().eq('id', id)
    if (error) throw new Error(error.message)
  },

  async listProformas() {
    const rows = await traerTodo<ProformaRow>((desde, hasta) =>
      client()
        .from('proformas')
        .select('*')
        .order('created_at', { ascending: false })
        .range(desde, hasta)
        .returns<ProformaRow[]>(),
    )
    return rows.map(toProforma)
  },

  async createProforma(input: NewProforma) {
    const row = unwrap(
      await client()
        .from('proformas')
        .insert({
          client: input.client,
          detail: input.detail,
          total: input.total,
          validity_days: input.validityDays,
        })
        .select()
        .single<ProformaRow>(),
    )
    return toProforma(row)
  },

  async updateProforma(id: string, input: UpdateProforma) {
    const { error } = await client().rpc('update_proforma', {
      p_id: id,
      p_client: input.client,
      p_detail: input.detail,
      p_total: input.total,
      p_validity_days: input.validityDays,
    })
    if (error) throw new Error(error.message)

    return toProforma(
      unwrap(await client().from('proformas').select('*').eq('id', id).single<ProformaRow>()),
    )
  },

  async annulProforma(id: string) {
    const { error } = await client().rpc('annul_proforma', { p_id: id })
    if (error) throw new Error(error.message)

    return toProforma(
      unwrap(await client().from('proformas').select('*').eq('id', id).single<ProformaRow>()),
    )
  },

  async convertProforma(id, payment, author): Promise<ConvertResult> {
    const pf = toProforma(
      unwrap(await client().from('proformas').select('*').eq('id', id).single<ProformaRow>()),
    )
    if (pf.status === 'Convertida') throw new Error(`La proforma ${pf.code} ya fue cobrada`)

    const tx = await supabaseAdapter.createTransaction({
      type: 'Ingreso',
      amount: pf.total,
      category: 'Ventas',
      party: pf.client,
      concept: `Cobro de proforma ${pf.code}: ${pf.detail}`,
      payment,
      status: 'Completado',
      author,
      notes: `Generado automáticamente al cobrar la proforma ${pf.code}.`,
      source: 'proforma',
    })

    const updated = unwrap(
      await client()
        .from('proformas')
        .update({ status: 'Convertida', transaction_id: tx.id })
        .eq('id', id)
        .select()
        .single<ProformaRow>(),
    )

    return { proforma: toProforma(updated), transaction: tx }
  },

  async listDebts() {
    const rows = await traerTodo<DebtRow>((desde, hasta) =>
      client()
        .from('debts_with_balance')
        .select('*')
        .order('created_at', { ascending: false })
        .range(desde, hasta)
        .returns<DebtRow[]>(),
    )
    return rows.map(toDebt)
  },

  async createDebt(input: NewDebt) {
    const row = unwrap(
      await client()
        .from('debts')
        .insert({
          kind: input.kind,
          party: input.party,
          concept: input.concept,
          total: input.total,
          due_date: input.dueDate ?? null,
        })
        .select('id')
        .single<{ id: string }>(),
    )
    const fresh = unwrap(
      await client()
        .from('debts_with_balance')
        .select('*')
        .eq('id', row.id)
        .single<DebtRow>(),
    )
    return toDebt(fresh)
  },

  async updateDebt(id: string, input: UpdateDebt) {
    const { error } = await client().rpc('update_debt', {
      p_id: id,
      p_party: input.party,
      p_concept: input.concept,
      p_total: input.total,
      p_due_date: input.dueDate ?? null,
    })
    if (error) throw new Error(error.message)

    return toDebt(
      unwrap(
        await client().from('debts_with_balance').select('*').eq('id', id).single<DebtRow>(),
      ),
    )
  },

  async deleteDebtPayment(paymentId: string) {
    const { error } = await client().rpc('delete_debt_payment', { p_id: paymentId })
    if (error) throw new Error(error.message)
  },

  async listDebtPayments(debtId: string) {
    const rows = await traerTodo<PaymentRow>((desde, hasta) =>
      client()
        .from('debt_payments')
        .select('*')
        .eq('debt_id', debtId)
        .order('paid_at', { ascending: false })
        .range(desde, hasta)
        .returns<PaymentRow[]>(),
    )
    return rows.map(toPayment)
  },

  async listAllDebtPayments() {
    const rows = await traerTodo<PaymentRow>((desde, hasta) =>
      client()
        .from('debt_payments')
        .select('*')
        .order('paid_at', { ascending: false })
        .range(desde, hasta)
        .returns<PaymentRow[]>(),
    )
    return rows.map(toPayment)
  },

  async payDebt(debtId, amount, method, author): Promise<PaymentResult> {
    const debt = toDebt(
      unwrap(
        await client().from('debts_with_balance').select('*').eq('id', debtId).single<DebtRow>(),
      ),
    )
    if (amount > debt.balance + 0.001) {
      throw new Error(`El abono supera el saldo pendiente (${debt.balance.toFixed(2)})`)
    }

    const isCobrar = debt.kind === 'COBRAR'
    const tx = await supabaseAdapter.createTransaction({
      type: isCobrar ? 'Ingreso' : 'Egreso',
      amount,
      category: isCobrar ? 'Ventas' : 'Materiales',
      party: debt.party,
      concept: `${isCobrar ? 'Cobro' : 'Pago'} de deuda: ${debt.concept}`,
      payment: method,
      status: 'Completado',
      author,
      notes: `Abono registrado sobre la cuenta de ${debt.party}.`,
      source: 'abono',
    })

    const row = unwrap(
      await client()
        .from('debt_payments')
        .insert({
          debt_id: debtId,
          amount,
          payment_method: method,
          transaction_id: tx.id,
        })
        .select()
        .single<PaymentRow>(),
    )

    return { payment: toPayment(row), transaction: tx }
  },

  async listWorkOrders() {
    const rows = await traerTodo<WorkOrderRow>((desde, hasta) =>
      client()
        .from('work_orders')
        .select('*, work_order_items(*)')
        .order('created_at', { ascending: false })
        .range(desde, hasta)
        .returns<WorkOrderRow[]>(),
    )
    return rows.map(toWorkOrder)
  },

  async registerWorkOrder(input: NewWorkOrder): Promise<WorkOrderResult> {
    // Una sola llamada RPC: si algo falla, Postgres revierte el pedido entero.
    const ids = unwrap(
      await client().rpc('register_work_order', {
        p_kind: input.kind,
        p_party: input.party,
        p_phone: input.phone,
        p_category: input.category,
        p_payment: input.payment,
        p_advance: input.advance,
        p_notes: input.notes,
        p_author: input.author,
        p_items: input.items,
        p_source: input.source ?? 'manual',
      }),
    ) as { work_order_id: string; transaction_id: string | null; debt_id: string | null }

    return readWorkOrderResult(ids)
  },

  async updateWorkOrder(id: string, input: UpdateWorkOrder): Promise<WorkOrderResult> {
    const ids = unwrap(
      await client().rpc('update_work_order', {
        p_order_id: id,
        p_party: input.party,
        p_phone: input.phone,
        p_category: input.category,
        p_payment: input.payment,
        p_advance: input.advance,
        p_notes: input.notes,
        p_items: input.items,
      }),
    ) as { work_order_id: string; transaction_id: string | null; debt_id: string | null }

    return readWorkOrderResult(ids)
  },

  async listClosings() {
    const rows = await traerTodo<ClosingRow>((desde, hasta) =>
      client()
        .from('cash_closings')
        .select('*')
        .order('closed_at', { ascending: false })
        .range(desde, hasta)
        .returns<ClosingRow[]>(),
    )
    return rows.map(toClosing)
  },

  async createClosing(input: NewClosing) {
    const row = unwrap(
      await client()
        .from('cash_closings')
        .insert({
          counted_cash: input.countedCash,
          expected_cash: input.expectedCash,
          opening_cash: input.openingCash,
          notes: input.notes,
          author: input.author,
        })
        .select()
        .single<ClosingRow>(),
    )
    return toClosing(row)
  },
}
