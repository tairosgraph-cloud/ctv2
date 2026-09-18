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
  Proforma,
  Transaction,
  WorkOrder,
  WorkOrderResult,
} from '@/types'
import type { ConvertResult, DataAdapter, NewClosing, PaymentResult } from './adapter'
import { generarDemoIntermedio } from './demoIntermedio'

/**
 * Adaptador de respaldo: guarda todo en localStorage.
 * Se usa automaticamente cuando .env.local no trae credenciales de Supabase,
 * para que la app sea utilizable desde el primer `npm run dev`.
 *
 * Replica el comportamiento del adaptador de Supabase, incluidos los
 * correlativos de voucher (OP-000001) y de proforma (PF-1001).
 */

const KEY = 'tairos.rc.v2'

interface Store {
  transactions: Transaction[]
  workOrders: WorkOrder[]
  proformas: Proforma[]
  debts: Omit<Debt, 'paid' | 'balance' | 'status'>[]
  payments: DebtPayment[]
  closings: CashClosing[]
  voucherSeq: number
  proformaSeq: number
}

function seeded(): Store {
  // Ocho semanas de actividad en vez de cinco asientos de un día: es lo que
  // hace falta para ver la paginación, los avisos de deuda antigua y el arqueo
  // entre cierres comportándose como en un negocio real.
  const demo = generarDemoIntermedio()
  return {
    transactions: demo.transactions,
    workOrders: demo.workOrders,
    proformas: demo.proformas,
    debts: demo.debts,
    payments: demo.payments,
    closings: demo.closings,
    voucherSeq: demo.voucherSeq,
    proformaSeq: demo.proformaSeq,
  }
}

function read(): Store {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) {
      const fresh = seeded()
      write(fresh)
      return fresh
    }
    return { ...seeded(), ...(JSON.parse(raw) as Partial<Store>) } as Store
  } catch {
    return seeded()
  }
}

function write(store: Store): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(store))
  } catch {
    /* cuota llena o modo privado: la sesion sigue en memoria */
  }
}

function mutate<T>(fn: (store: Store) => T): T {
  const store = read()
  const result = fn(store)
  write(store)
  return result
}

const uid = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `id-${Math.random().toString(36).slice(2)}-${performance.now().toString(36)}`

/** Reconstruye el saldo de una deuda a partir de sus abonos (como la vista SQL). */
function withBalance(base: Store['debts'][number], payments: DebtPayment[]): Debt {
  const paid = payments
    .filter((p) => p.debtId === base.id)
    .reduce((sum, p) => sum + p.amount, 0)
  const rounded = Math.round(paid * 100) / 100
  return {
    ...base,
    paid: rounded,
    balance: Math.round((base.total - rounded) * 100) / 100,
    status: rounded >= base.total ? 'Cancelado' : rounded > 0 ? 'Parcial' : 'Pendiente',
  }
}

export const localAdapter: DataAdapter = {
  mode: 'local',

  async listTransactions() {
    return read().transactions.slice().sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
  },

  async createTransaction(input: NewTransaction) {
    return mutate((store) => {
      const tx: Transaction = {
        id: uid(),
        voucher: input.voucher || `OP-${String(store.voucherSeq++).padStart(6, '0')}`,
        occurredAt: input.occurredAt || new Date().toISOString(),
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
        workOrderId: input.workOrderId ?? null,
      }
      store.transactions.unshift(tx)
      return tx
    })
  },

  async voidTransaction(id: string) {
    return mutate((store) => {
      const tx = store.transactions.find((t) => t.id === id)
      if (!tx) throw new Error('El asiento ya no existe')
      tx.status = 'Anulado'
      return tx
    })
  },

  async deleteTransaction(id: string) {
    mutate((store) => {
      store.transactions = store.transactions.filter((t) => t.id !== id)
    })
  },

  async listProformas() {
    return read().proformas.slice()
  },

  async createProforma(input: NewProforma) {
    return mutate((store) => {
      const pf: Proforma = {
        id: uid(),
        code: `PF-${store.proformaSeq++}`,
        client: input.client,
        detail: input.detail,
        total: input.total,
        validityDays: input.validityDays,
        status: 'Vigente',
        issuedAt: new Date().toISOString(),
        transactionId: null,
      }
      store.proformas.unshift(pf)
      return pf
    })
  },

  async updateProforma(id: string, input: UpdateProforma) {
    return mutate((store) => {
      const pf = store.proformas.find((p) => p.id === id)
      if (!pf) throw new Error('La proforma ya no existe')
      if (pf.status !== 'Vigente') {
        throw new Error(`Esta proforma está ${pf.status.toLowerCase()}; ya no se puede editar`)
      }
      if (input.total <= 0) throw new Error('El monto cotizado debe ser mayor a cero')

      pf.client = input.client
      pf.detail = input.detail
      pf.total = input.total
      pf.validityDays = input.validityDays
      return { ...pf }
    })
  },

  async annulProforma(id: string) {
    return mutate((store) => {
      const pf = store.proformas.find((p) => p.id === id)
      if (!pf) throw new Error('La proforma ya no existe')
      if (pf.status === 'Convertida') {
        throw new Error('Esta proforma ya fue cobrada; anula su asiento en el libro')
      }
      pf.status = 'Anulada'
      return { ...pf }
    })
  },

  async convertProforma(id, payment, author): Promise<ConvertResult> {
    const pf = read().proformas.find((p) => p.id === id)
    if (!pf) throw new Error('La proforma no existe')
    if (pf.status === 'Convertida') throw new Error(`La proforma ${pf.code} ya fue cobrada`)

    const transaction = await localAdapter.createTransaction({
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

    const proforma = mutate((store) => {
      const target = store.proformas.find((p) => p.id === id)!
      target.status = 'Convertida'
      target.transactionId = transaction.id
      return { ...target }
    })

    return { proforma, transaction }
  },

  async listDebts() {
    const store = read()
    return store.debts.map((d) => withBalance(d, store.payments))
  },

  async createDebt(input: NewDebt) {
    return mutate((store) => {
      const base = {
        id: uid(),
        kind: input.kind,
        party: input.party,
        concept: input.concept,
        total: input.total,
        dueDate: input.dueDate ?? null,
        createdAt: new Date().toISOString(),
        workOrderId: null,
      }
      store.debts.unshift(base)
      return withBalance(base, store.payments)
    })
  },

  async updateDebt(id: string, input: UpdateDebt) {
    const store = read()
    const base = store.debts.find((d) => d.id === id)
    if (!base) throw new Error('La cuenta ya no existe')
    if (base.workOrderId) {
      throw new Error('Esta cuenta nace de una orden: corrígela desde el libro contable')
    }
    if (input.total <= 0) throw new Error('El monto debe ser mayor a cero')

    const paid =
      Math.round(
        store.payments.filter((p) => p.debtId === id).reduce((sum, p) => sum + p.amount, 0) * 100,
      ) / 100
    if (input.total < paid - 0.001) {
      throw new Error(
        `Ya se abonaron S/ ${paid.toFixed(2)}; el total no puede quedar por debajo`,
      )
    }

    return mutate((s2) => {
      const debt = s2.debts.find((d) => d.id === id)!
      debt.party = input.party
      debt.concept = input.concept
      debt.total = input.total
      debt.dueDate = input.dueDate ?? null
      return withBalance(debt, s2.payments)
    })
  },

  async deleteDebtPayment(paymentId: string) {
    mutate((store) => {
      const payment = store.payments.find((p) => p.id === paymentId)
      if (!payment) throw new Error('El abono ya no existe')

      store.payments = store.payments.filter((p) => p.id !== paymentId)
      // El asiento que generó se va con él: si no, la caja queda descuadrada.
      if (payment.transactionId) {
        store.transactions = store.transactions.filter((t) => t.id !== payment.transactionId)
      }
    })
  },

  async listDebtPayments(debtId: string) {
    return read()
      .payments.filter((p) => p.debtId === debtId)
      .sort((a, b) => b.paidAt.localeCompare(a.paidAt))
  },

  async listAllDebtPayments() {
    return read().payments.slice().sort((a, b) => b.paidAt.localeCompare(a.paidAt))
  },

  async payDebt(debtId, amount, method, author): Promise<PaymentResult> {
    const store = read()
    const base = store.debts.find((d) => d.id === debtId)
    if (!base) throw new Error('La cuenta no existe')
    const debt = withBalance(base, store.payments)
    if (amount > debt.balance + 0.001) {
      throw new Error(`El abono supera el saldo pendiente (${debt.balance.toFixed(2)})`)
    }

    const isCobrar = debt.kind === 'COBRAR'
    const transaction = await localAdapter.createTransaction({
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

    const payment = mutate((s) => {
      const p: DebtPayment = {
        id: uid(),
        debtId,
        amount,
        paymentMethod: method,
        transactionId: transaction.id,
        paidAt: new Date().toISOString(),
      }
      s.payments.unshift(p)
      return p
    })

    return { payment, transaction }
  },

  async listWorkOrders() {
    return read().workOrders.slice()
  },

  async registerWorkOrder(input: NewWorkOrder): Promise<WorkOrderResult> {
    if (!input.items.length) throw new Error('El pedido necesita al menos un trabajo')

    const total =
      Math.round(input.items.reduce((sum, i) => sum + i.amount, 0) * 100) / 100
    if (total <= 0) throw new Error('El total del pedido debe ser mayor a cero')
    if (input.advance < 0 || input.advance > total + 0.001) {
      throw new Error(`El adelanto debe estar entre 0 y ${total.toFixed(2)}`)
    }

    const summary = input.items.map((i) => i.description).join(' + ')
    const orderId = uid()

    const workOrder: WorkOrder = {
      id: orderId,
      kind: input.kind,
      party: input.party,
      phone: input.phone,
      category: input.category,
      total,
      advance: input.advance,
      notes: input.notes,
      author: input.author,
      createdAt: new Date().toISOString(),
      updatedAt: null,
      items: input.items.map((i, index) => ({
        id: uid(),
        position: index + 1,
        description: i.description,
        amount: i.amount,
      })),
    }

    mutate((store) => {
      store.workOrders.unshift(workOrder)
    })

    // Asiento: solo si de verdad se movio dinero.
    const transaction =
      input.advance > 0
        ? await localAdapter.createTransaction({
            type: input.kind,
            amount: input.advance,
            category: input.category,
            party: input.party,
            concept: input.advance < total ? `Adelanto de: ${summary}` : summary,
            payment: input.payment,
            status: 'Completado',
            author: input.author,
            notes: input.notes,
            source: input.source ?? 'manual',
            workOrderId: orderId,
          })
        : null

    // Deuda: por el saldo que queda pendiente.
    const balance = Math.round((total - input.advance) * 100) / 100
    const debt =
      balance > 0
        ? mutate((store) => {
            const base = {
              id: uid(),
              kind: (input.kind === 'Ingreso' ? 'COBRAR' : 'PAGAR') as Debt['kind'],
              party: input.party,
              concept: `Saldo de: ${summary}`,
              total: balance,
              dueDate: null,
              createdAt: new Date().toISOString(),
              workOrderId: orderId,
            }
            store.debts.unshift(base)
            return withBalance(base, store.payments)
          })
        : null

    return { workOrder, transaction, debt }
  },

  async updateWorkOrder(id: string, input: UpdateWorkOrder): Promise<WorkOrderResult> {
    const store = read()
    const current = store.workOrders.find((w) => w.id === id)
    if (!current) throw new Error('El pedido ya no existe')
    if (!input.items.length) throw new Error('El pedido necesita al menos un trabajo')

    const total = Math.round(input.items.reduce((sum, i) => sum + i.amount, 0) * 100) / 100
    if (total <= 0) throw new Error('El total del pedido debe ser mayor a cero')
    if (input.advance < 0 || input.advance > total + 0.001) {
      throw new Error(
        `El adelanto (S/ ${input.advance.toFixed(2)}) no puede superar el total (S/ ${total.toFixed(2)})`,
      )
    }

    const existingDebt = store.debts.find((d) => d.workOrderId === id) ?? null
    const paid = existingDebt
      ? Math.round(
          store.payments
            .filter((p) => p.debtId === existingDebt.id)
            .reduce((sum, p) => sum + p.amount, 0) * 100,
        ) / 100
      : 0

    const balance = Math.round((total - input.advance) * 100) / 100
    if (balance < paid - 0.001) {
      const cobrado = (input.advance + paid).toFixed(2)
      throw new Error(
        `Ya se cobraron S/ ${cobrado} de este pedido. El total no puede quedar por debajo de S/ ${cobrado}`,
      )
    }

    const summary = input.items.map((i) => i.description).join(' + ')
    const concept = input.advance < total ? `Adelanto de: ${summary}` : summary

    return mutate((s2) => {
      const order = s2.workOrders.find((w) => w.id === id)!
      order.party = input.party
      order.phone = input.phone
      order.category = input.category
      order.total = total
      order.advance = input.advance
      order.notes = input.notes
      order.updatedAt = new Date().toISOString()
      order.items = input.items.map((i, index) => ({
        id: uid(),
        position: index + 1,
        description: i.description,
        amount: i.amount,
      }))

      // --- asiento del adelanto ---
      let transaction: Transaction | null = s2.transactions.find((t) => t.workOrderId === id) ?? null
      if (input.advance > 0) {
        if (transaction) {
          transaction.amount = input.advance
          transaction.category = input.category
          transaction.party = input.party
          transaction.concept = concept
          transaction.payment = input.payment
          transaction.notes = input.notes
        } else {
          transaction = {
            id: uid(),
            voucher: `OP-${String(s2.voucherSeq++).padStart(6, '0')}`,
            type: order.kind,
            amount: input.advance,
            category: input.category,
            party: input.party,
            concept,
            payment: input.payment,
            status: 'Completado',
            occurredAt: new Date().toISOString(),
            author: order.author,
            notes: input.notes,
            source: 'manual',
            workOrderId: id,
          }
          s2.transactions.unshift(transaction)
        }
      } else if (transaction) {
        // El adelanto se corrigió a cero: ese dinero nunca se movió.
        s2.transactions = s2.transactions.filter((t) => t.workOrderId !== id)
        transaction = null
      }

      // --- cuenta pendiente ---
      let debtBase = s2.debts.find((d) => d.workOrderId === id) ?? null
      if (balance > 0) {
        if (debtBase) {
          debtBase.party = input.party
          debtBase.concept = `Saldo de: ${summary}`
          debtBase.total = balance
        } else {
          debtBase = {
            id: uid(),
            kind: order.kind === 'Ingreso' ? 'COBRAR' : 'PAGAR',
            party: input.party,
            concept: `Saldo de: ${summary}`,
            total: balance,
            dueDate: null,
            createdAt: new Date().toISOString(),
            workOrderId: id,
          }
          s2.debts.unshift(debtBase)
        }
      } else if (debtBase) {
        s2.debts = s2.debts.filter((d) => d.workOrderId !== id)
        debtBase = null
      }

      return {
        workOrder: { ...order },
        transaction,
        debt: debtBase ? withBalance(debtBase, s2.payments) : null,
      }
    })
  },

  async listClosings() {
    return read().closings.slice()
  },

  async createClosing(input: NewClosing) {
    return mutate((store) => {
      const closing: CashClosing = {
        id: uid(),
        countedCash: input.countedCash,
        expectedCash: input.expectedCash,
        difference: Math.round((input.countedCash - input.expectedCash) * 100) / 100,
        openingCash: input.openingCash,
        notes: input.notes,
        author: input.author,
        closedAt: new Date().toISOString(),
      }
      store.closings.unshift(closing)
      return closing
    })
  },
}

/** Vacia el almacen local y vuelve a los datos de demostracion. */
export function resetLocalStore(): void {
  localStorage.removeItem(KEY)
}
