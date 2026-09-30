export type TxType = 'Ingreso' | 'Egreso'
export type TxStatus = 'Completado' | 'Pendiente' | 'Anulado'
export type PaymentMethod = 'Efectivo' | 'Yape/Plin' | 'Transferencia' | 'Tarjeta'
export type TxSource = 'manual' | 'voz' | 'proforma' | 'abono'
export type ProformaStatus = 'Vigente' | 'Convertida' | 'Anulada'
export type DebtKind = 'COBRAR' | 'PAGAR'
export type DebtStatus = 'Pendiente' | 'Parcial' | 'Cancelado'

/** En qué va un trabajo (0013). El orden es el del taller. */
export const ESTADOS_TRABAJO = ['recibido', 'diseno', 'aprobacion', 'produccion', 'listo', 'entregado'] as const
export type EstadoTrabajo = (typeof ESTADOS_TRABAJO)[number]
export const NOMBRE_ESTADO: Record<EstadoTrabajo, string> = {
  recibido: 'Recibido',
  diseno: 'En diseño',
  aprobacion: 'Esperando aprobación',
  produccion: 'En producción',
  listo: 'Listo',
  entregado: 'Entregado',
}

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
  /** El pedido que salió de esta proforma, si se aceptó con adelanto o al crédito. */
  workOrderId: string | null
  /** El cliente al que la vinculó la base (0014). */
  clienteId: string | null
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
  clienteId: string | null
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
  /** En qué va el trabajo; una venta al instante nace 'entregado'. */
  estado: EstadoTrabajo
  /** Fecha comprometida (AAAA-MM-DD), o null si no se dio. */
  entrega: string | null
  /** Desde cuándo está en ese estado. */
  estadoAt: string
  /** El cliente al que la vinculó la base (0014). */
  clienteId: string | null
}

/** Un cambio de estado de un trabajo. */
export interface EventoTrabajo {
  id: string
  workOrderId: string
  estado: EstadoTrabajo
  createdAt: string
  author: string
  /** Quién aprobó el diseño y cómo, al pasar a producción. */
  nota: string
}

/** Cliente o proveedor (0014). La base lo crea sola al registrar. */
export interface Cliente {
  id: string
  nombre: string
  telefono: string
  /** DNI o RUC, opcional. */
  documento: string
  notas: string
  proveedor: boolean
  createdAt: string
}

export type CambiosCliente = Partial<Pick<Cliente, 'nombre' | 'telefono' | 'documento' | 'notas' | 'proveedor'>>

/** En qué se cuenta un producto: su precio es «por» esta unidad. */
export const UNIDADES = ['unidad', 'ciento', 'millar', 'm2', 'metro', 'hoja', 'juego'] as const
export type Unidad = (typeof UNIDADES)[number]

export interface PrecioPorCantidad {
  /** Desde cuántas unidades vale. */
  desde: number
  /** Precio por unidad a partir de esa cantidad. */
  precio: number
}

export interface Producto {
  id: string
  nombre: string
  unidad: Unidad
  categoria: string
  activo: boolean
  /** Ordenados de menor a mayor cantidad. */
  precios: PrecioPorCantidad[]
}

export type ProductoAGuardar = Omit<Producto, 'id'> & { id: string | null }

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
  /** Sin indicar, 'entregado' (venta al instante). */
  estado?: EstadoTrabajo
  entrega?: string | null
}

/** Lo que falta para pasar una proforma aceptada a pedido. */
export interface PedidoDesdeProforma {
  payment: PaymentMethod
  advance: number
  author: string
  phone: string
  estado: EstadoTrabajo
  entrega: string | null
}

/**
 * Corrección de un pedido ya registrado. El tipo (Ingreso/Egreso) no cambia, y
 * el origen tampoco: corregir lo dictado no lo convierte en tecleado.
 */
export type UpdateWorkOrder = Omit<NewWorkOrder, 'kind' | 'author' | 'source' | 'estado' | 'entrega'>

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

/** Un dictado, tal como lo entendió el intérprete (tabla voice_extractions). */
export interface NuevoDictado {
  transcripcion: string
  /** La extracción completa, tal cual se mostró. */
  extraccion: unknown
  intent: string
  origen: 'llm' | 'reglas'
  modelo: string | null
  aviso: string | null
  ms: number
  uso: { entrada: number; cacheLectura: number; salida: number } | null
  /** Si esta fila es un arreglo: lo que se escribió para corregir el borrador. */
  arreglo?: string | null
  /** La fila del dictado que esta corrige; null en un dictado normal. */
  corrige?: string | null
}

export type TipoDeRegistro = 'pedido' | 'proforma' | 'deuda' | 'abono'

/** Lo que pasó al guardar: qué hubo que corregir y qué se creó. */
export interface ConfirmacionDictado {
  camposEditados: string[]
  registroTipo: TipoDeRegistro
  registroId: string | null
}

export type TabKey =
  | 'registro'
  | 'trabajos'
  | 'clientes'
  | 'catalogo'
  | 'movimientos'
  | 'proformas'
  | 'deudas'
  | 'arqueo'
  | 'configuracion'
