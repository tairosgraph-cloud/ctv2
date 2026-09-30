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
  NuevoDictado,
  ConfirmacionDictado,
  EstadoTrabajo,
  EventoTrabajo,
  PedidoDesdeProforma,
  Cliente,
  CambiosCliente,
  Producto,
  ProductoAGuardar,
  Unidad,
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
  work_order_id: string | null
  cliente_id?: string | null
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
  workOrderId: r.work_order_id ?? null,
  clienteId: r.cliente_id ?? null,
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
  cliente_id?: string | null
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
  clienteId: r.cliente_id ?? null,
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
  estado: EstadoTrabajo | null
  entrega: string | null
  estado_at: string | null
  cliente_id?: string | null
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
  // Con una base anterior a 0013 no hay estado: lo que existía, entregado.
  estado: r.estado ?? 'entregado',
  entrega: r.entrega ?? null,
  estadoAt: r.estado_at ?? r.created_at,
  clienteId: r.cliente_id ?? null,
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

type ClienteRow = {
  id: string
  nombre: string
  telefono: string
  documento: string
  notas: string
  proveedor: boolean
  created_at: string
}

const toCliente = (r: ClienteRow): Cliente => ({
  id: r.id,
  nombre: r.nombre,
  telefono: r.telefono ?? '',
  documento: r.documento ?? '',
  notas: r.notas ?? '',
  proveedor: Boolean(r.proveedor),
  createdAt: r.created_at,
})

type ProductoRow = {
  id: string
  nombre: string
  unidad: Unidad
  categoria: string
  activo: boolean
  precios_producto: Array<{ desde: string | number; precio: string | number }> | null
}

const toProducto = (r: ProductoRow): Producto => ({
  id: r.id,
  nombre: r.nombre,
  unidad: r.unidad,
  categoria: r.categoria,
  activo: r.activo,
  precios: (r.precios_producto ?? [])
    .map((p) => ({ desde: Number(p.desde), precio: Number(p.precio) }))
    .sort((a, b) => a.desde - b.desde),
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
    const rows = unwrap(
      await client().from('transactions').update({ status: 'Anulado' }).eq('id', id).select().returns<TxRow[]>(),
    )
    // RLS no da error cuando no deja: devuelve cero filas (0009, solo gerente).
    if (!rows.length) throw new Error('No se anuló: el asiento ya no existe o tu cuenta no puede anular')
    return toTx(rows[0])
  },

  async deleteTransaction(id: string) {
    const { data, error } = await client().from('transactions').delete().eq('id', id).select('id')
    if (error) throw new Error(error.message)
    // Sin permiso, RLS no borra nada y tampoco da error: no afirmar que se borró.
    if (!data?.length) throw new Error('No se eliminó: el asiento ya no existe o tu cuenta no puede borrar')
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
    // Asiento y proforma en una sola transacción (0012): si algo falla, no
    // queda un ingreso suelto que un segundo intento duplicaría.
    const { data, error } = await client().rpc('cobrar_proforma', {
      p_id: id,
      p_payment: payment,
      p_author: author,
    })
    if (error) throw new Error(error.message)
    const txId = (data as { transaction_id?: string } | null)?.transaction_id
    if (!txId) throw new Error('El cobro no devolvió su asiento')

    const [pf, tx] = await Promise.all([
      client().from('proformas').select('*').eq('id', id).single<ProformaRow>(),
      client().from('transactions').select('*').eq('id', txId).single<TxRow>(),
    ])
    return { proforma: toProforma(unwrap(pf)), transaction: toTx(unwrap(tx)) }
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
        p_estado: input.estado ?? 'entregado',
        p_entrega: input.entrega ?? null,
      }),
    ) as { work_order_id: string; transaction_id: string | null; debt_id: string | null }

    return readWorkOrderResult(ids)
  },

  async avanzarTrabajo(id: string, estado: EstadoTrabajo, author: string, nota = '') {
    const { error } = await client().rpc('avanzar_trabajo', { p_id: id, p_estado: estado, p_author: author, p_nota: nota })
    if (error) throw new Error(error.message)
  },

  async fijarEntrega(id: string, entrega: string | null) {
    const { error } = await client().rpc('fijar_entrega', { p_id: id, p_entrega: entrega })
    if (error) throw new Error(error.message)
  },

  async listEventosTrabajo(workOrderId: string) {
    const rows = unwrap(
      await client()
        .from('work_order_events')
        .select('id, work_order_id, estado, created_at, author, nota')
        .eq('work_order_id', workOrderId)
        .order('created_at', { ascending: true })
        .returns<Array<{ id: string; work_order_id: string; estado: EstadoTrabajo; created_at: string; author: string; nota: string | null }>>(),
    )
    return rows.map<EventoTrabajo>((r) => ({
      id: r.id,
      workOrderId: r.work_order_id,
      estado: r.estado,
      createdAt: r.created_at,
      author: r.author,
      nota: r.nota ?? '',
    }))
  },

  async pedidoDesdeProforma(proformaId: string, datos: PedidoDesdeProforma) {
    // Una sola transacción (0013): el pedido, su adelanto, su saldo y la
    // proforma marcada, o nada.
    const ids = unwrap(
      await client().rpc('pedido_desde_proforma', {
        p_proforma: proformaId,
        p_payment: datos.payment,
        p_advance: datos.advance,
        p_author: datos.author,
        p_phone: datos.phone,
        p_estado: datos.estado,
        p_entrega: datos.entrega,
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

  async listClientes() {
    const rows = await traerTodo<ClienteRow>((desde, hasta) =>
      client().from('clientes').select('*').order('nombre').range(desde, hasta).returns<ClienteRow[]>(),
    )
    return rows.map(toCliente)
  },

  async crearCliente(datos) {
    const { data, error } = await client()
      .from('clientes')
      .insert({
        nombre: datos.nombre.trim(),
        telefono: datos.telefono.replace(/\D/g, ''),
        documento: datos.documento.trim(),
        notas: datos.notas,
        proveedor: datos.proveedor,
      })
      .select()
      .single<ClienteRow>()
    if (error) throw new Error(error.code === '23505' ? 'Ya hay un cliente con ese nombre' : error.message)
    return toCliente(data)
  },

  async actualizarCliente(id: string, cambios: CambiosCliente) {
    const { data, error } = await client()
      .from('clientes')
      .update({
        ...cambios,
        ...(cambios.telefono !== undefined ? { telefono: cambios.telefono.replace(/\D/g, '') } : {}),
      })
      .eq('id', id)
      .select()
      .returns<ClienteRow[]>()
    if (error) throw new Error(error.code === '23505' ? 'Ya hay un cliente con ese nombre' : error.message)
    if (!data?.length) throw new Error('No se guardó: el cliente no existe o tu cuenta no puede cambiarlo')
    return toCliente(data[0])
  },

  async listProductos() {
    const rows = unwrap(
      await client()
        .from('productos')
        .select('*, precios_producto(*)')
        .order('nombre')
        .returns<ProductoRow[]>(),
    )
    return rows.map(toProducto)
  },

  async guardarProducto(producto: ProductoAGuardar) {
    const { data, error } = await client().rpc('guardar_producto', {
      p_id: producto.id,
      p_nombre: producto.nombre,
      p_unidad: producto.unidad,
      p_categoria: producto.categoria,
      p_activo: producto.activo,
      p_precios: producto.precios,
    })
    if (error) throw new Error(error.code === '23505' ? 'Ya hay un producto con ese nombre' : error.message)
    return data as string
  },

  async borrarProducto(id: string) {
    const { data, error } = await client().from('productos').delete().eq('id', id).select('id')
    if (error) throw new Error(error.message)
    if (!data?.length) throw new Error('No se borró: el producto no existe o tu cuenta no puede cambiar el catálogo')
  },

  async registrarDictado(input: NuevoDictado) {
    const row = unwrap(
      await client()
        .from('voice_extractions')
        .insert({
          transcripcion: input.transcripcion.slice(0, 1000),
          extraccion: input.extraccion,
          intent: input.intent,
          origen: input.origen,
          modelo: input.modelo,
          aviso: input.aviso,
          ms: Math.max(0, Math.round(input.ms)),
          tokens_entrada: input.uso?.entrada ?? null,
          tokens_cache: input.uso?.cacheLectura ?? null,
          tokens_salida: input.uso?.salida ?? null,
          arreglo: input.arreglo?.slice(0, 1000) ?? null,
          corrige: input.corrige ?? null,
        })
        .select('id')
        .single<{ id: string }>(),
    )
    return row.id
  },

  async confirmarDictado(id: string, confirmacion: ConfirmacionDictado) {
    const { error } = await client()
      .from('voice_extractions')
      .update({
        confirmada_at: new Date().toISOString(),
        campos_editados: confirmacion.camposEditados,
        registro_tipo: confirmacion.registroTipo,
        registro_id: confirmacion.registroId,
      })
      .eq('id', id)
    if (error) throw new Error(error.message)
  },
}
