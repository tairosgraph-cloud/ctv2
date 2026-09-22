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
  NuevoDictado,
  ConfirmacionDictado,
  EstadoTrabajo,
  EventoTrabajo,
  PedidoDesdeProforma,
  Cliente,
  CambiosCliente,
  Producto,
  ProductoAGuardar,
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
  /** Mueve un trabajo de estado y lo anota en su historial (con la nota de aprobación, si la hay). */
  avanzarTrabajo(id: string, estado: EstadoTrabajo, author: string, nota?: string): Promise<void>
  /** Cambia (o quita, con null) la fecha de entrega. */
  fijarEntrega(id: string, entrega: string | null): Promise<void>
  /** Los cambios de estado de un trabajo, del más antiguo al más reciente. */
  listEventosTrabajo(workOrderId: string): Promise<EventoTrabajo[]>
  /** La proforma aceptada pasa a pedido, con su adelanto o al crédito, de una vez. */
  pedidoDesdeProforma(proformaId: string, datos: PedidoDesdeProforma): Promise<WorkOrderResult>

  listClientes(): Promise<Cliente[]>
  /** Un cliente nuevo a mano (al registrar, la base los crea sola). */
  crearCliente(datos: Omit<Cliente, 'id' | 'createdAt'>): Promise<Cliente>
  actualizarCliente(id: string, cambios: CambiosCliente): Promise<Cliente>

  listProductos(): Promise<Producto[]>
  /** Crea o reemplaza un producto con toda su escala de precios, de una vez. */
  guardarProducto(producto: ProductoAGuardar): Promise<string>
  borrarProducto(id: string): Promise<void>

  listClosings(): Promise<CashClosing[]>
  createClosing(input: NewClosing): Promise<CashClosing>

  /**
   * Deja constancia de un dictado para medir el acierto en el mostrador.
   * Devuelve su id, o null donde no se guarda (modo local).
   */
  registrarDictado(input: NuevoDictado): Promise<string | null>
  /** Completa el dictado al guardar el formulario. */
  confirmarDictado(id: string, confirmacion: ConfirmacionDictado): Promise<void>
}
