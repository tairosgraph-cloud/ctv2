export type TxType = 'Ingreso' | 'Egreso'
export type TxStatus = 'Completado' | 'Pendiente' | 'Anulado'
export type PaymentMethod = 'Efectivo' | 'Yape/Plin' | 'Transferencia' | 'Tarjeta'
export type TxSource = 'manual' | 'voz' | 'proforma' | 'abono'
export type ProformaStatus = 'Vigente' | 'Convertida' | 'Anulada'
export type DebtKind = 'COBRAR' | 'PAGAR'
export type DebtStatus = 'Pendiente' | 'Parcial' | 'Cancelado'

export const PAYMENT_METHODS: PaymentMethod[] = [
  'Efectivo',
  'Yape/Plin',
  'Transferencia',
  'Tarjeta',
]

export const CATEGORIES = [
  'Ventas',
  'Servicios',
  'Materiales',
  'Servicios Básicos',
  'Planilla',
  'Alquiler',
  'Otros',
] as const

export interface Transaction {
  id: string
  voucher: string
  type: TxType
  amount: number
  category: string
  party: string
  concept: string
  payment: PaymentMethod
  status: TxStatus
  occurredAt: string
  author: string
  notes: string
  source: TxSource
  /** Pedido del que nació este asiento, si vino del formulario de trabajos. */
  workOrderId: string | null
}

export type NewTransaction = Omit<
  Transaction,
  'id' | 'voucher' | 'occurredAt' | 'workOrderId'
> &
  Partial<Pick<Transaction, 'voucher' | 'occurredAt' | 'workOrderId'>>

export interface Proforma {
  id: string
  code: string
  client: string
  detail: string
  total: number
  validityDays: number
  status: ProformaStatus
  issuedAt: string
  transactionId: string | null
}

export type NewProforma = Pick<Proforma, 'client' | 'detail' | 'total' | 'validityDays'>
/** Corrección de una cotización. Solo se admite mientras esté Vigente. */
export type UpdateProforma = NewProforma

export interface DebtPayment {
  id: string
  debtId: string
  amount: number
  paymentMethod: PaymentMethod
  transactionId: string | null
  paidAt: string
}

/** Deuda con saldo ya calculado (vista `debts_with_balance`). */
export interface Debt {
  id: string
  kind: DebtKind
  party: string
  concept: string
  total: number
  paid: number
  balance: number
  status: DebtStatus
  dueDate: string | null
  createdAt: string
  /** Pedido del que nació esta cuenta, si vino de un adelanto parcial. */
  workOrderId: string | null
}

export type NewDebt = Pick<Debt, 'kind' | 'party' | 'concept' | 'total'> & {
  dueDate?: string | null
}

/**
 * Corrección de una cuenta. El tipo (cobrar/pagar) no cambia, y solo se
 * admite en cuentas creadas a mano: las que nacen de una orden se corrigen
 * desde el libro, que es donde se calcula su total.
 */
export type UpdateDebt = Pick<Debt, 'party' | 'concept' | 'total'> & {
  dueDate?: string | null
}

/** Un trabajo dentro de un pedido: "1,000 volantes A6" por S/ 240.00 */
export interface WorkOrderItem {
  id: string
  position: number
  description: string
  amount: number
}

/**
 * Lo que el cliente encarga. Puede tener varios trabajos y un adelanto.
 * De un pedido salen hasta dos registros: el asiento por el adelanto y la
 * cuenta pendiente por el saldo.
 */
export interface WorkOrder {
  id: string
  kind: TxType
  party: string
  /** Teléfono del cliente. Cadena vacía si no se anotó. */
  phone: string
  category: string
  total: number
  advance: number
  notes: string
  author: string
  createdAt: string
  /** Sólo si el pedido fue corregido después de registrarse. */
  updatedAt: string | null
  items: WorkOrderItem[]
}

export interface NewWorkOrderItem {
  description: string
  amount: number
}

export interface NewWorkOrder {
  kind: TxType
  party: string
  phone: string
  category: string
  payment: PaymentMethod
  advance: number
  notes: string
  author: string
  items: NewWorkOrderItem[]
  /** Origen del asiento del adelanto. Sin indicar, 'manual'. */
  source?: TxSource
}

/**
 * Corrección de un pedido ya registrado. El tipo (Ingreso/Egreso) no cambia, y
 * el origen tampoco: corregir lo dictado no lo convierte en tecleado.
 */
export type UpdateWorkOrder = Omit<NewWorkOrder, 'kind' | 'author' | 'source'>

export interface WorkOrderResult {
  workOrder: WorkOrder
  transaction: Transaction | null
  debt: Debt | null
}

export interface CashClosing {
  id: string
  countedCash: number
  expectedCash: number
  difference: number
  openingCash: number
  notes: string
  author: string
  closedAt: string
}

export type TabKey =
  | 'registro'
  | 'movimientos'
  | 'proformas'
  | 'deudas'
  | 'arqueo'
  | 'configuracion'
