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
  WorkOrderResult,
} from '@/types'

export interface ConvertResult {
  proforma: Proforma
  transaction: Transaction
}

export interface PaymentResult {
  payment: DebtPayment
  transaction: Transaction
}

export interface NewClosing {
  countedCash: number
  expectedCash: number
  openingCash: number
  notes: string
  author: string
}

/**
 * Contrato unico para acceder a los datos. Hay dos implementaciones:
 * `supabaseAdapter` (produccion) y `localAdapter` (localStorage, para
 * desarrollo sin backend). La UI nunca sabe cual esta usando.
 */
export interface DataAdapter {
  readonly mode: 'supabase' | 'local'

  listTransactions(): Promise<Transaction[]>
  createTransaction(input: NewTransaction): Promise<Transaction>
  voidTransaction(id: string): Promise<Transaction>
  deleteTransaction(id: string): Promise<void>

  listProformas(): Promise<Proforma[]>
  createProforma(input: NewProforma): Promise<Proforma>
  /** Corrige una cotización. Rechaza las que ya fueron cobradas. */
  updateProforma(id: string, input: UpdateProforma): Promise<Proforma>
  /** Retira una cotización que el cliente rechazó. */
  annulProforma(id: string): Promise<Proforma>
  convertProforma(id: string, payment: PaymentMethod, author: string): Promise<ConvertResult>

  listDebts(): Promise<Debt[]>
  createDebt(input: NewDebt): Promise<Debt>
  /** Corrige una cuenta creada a mano. Rechaza las nacidas de una orden. */
  updateDebt(id: string, input: UpdateDebt): Promise<Debt>
  /** Deshace un abono mal registrado, junto con el asiento que generó. */
  deleteDebtPayment(paymentId: string): Promise<void>
  listDebtPayments(debtId: string): Promise<DebtPayment[]>
  /** Todos los abonos de todas las cuentas. Lo usa el informe general. */
  listAllDebtPayments(): Promise<DebtPayment[]>
  payDebt(
    debtId: string,
    amount: number,
    method: PaymentMethod,
    author: string,
  ): Promise<PaymentResult>

  listWorkOrders(): Promise<WorkOrder[]>
  /**
   * Registra un pedido completo: crea los trabajos, el asiento por el
   * adelanto (si lo hubo) y la cuenta pendiente por el saldo (si queda).
   */
  registerWorkOrder(input: NewWorkOrder): Promise<WorkOrderResult>
  /**
   * Corrige un pedido: rehace los trabajos, reajusta el asiento del adelanto
   * y recalcula el saldo. Rechaza dejar el total por debajo de lo ya cobrado.
   */
  updateWorkOrder(id: string, input: UpdateWorkOrder): Promise<WorkOrderResult>

  listClosings(): Promise<CashClosing[]>
  createClosing(input: NewClosing): Promise<CashClosing>
}
