import type { Workbook } from 'exceljs'
import type { Stats } from '@/store/DataProvider'
import type {
  CashClosing,
  Debt,
  DebtPayment,
  Proforma,
  Transaction,
  WorkOrder,
} from '@/types'
import { expiryDate } from '@/lib/format'
import { filaResumen, montarHoja, nuevoLibro, type Columna } from '@/lib/excel'

/** Las fechas van como Date para que Excel las trate como fechas de verdad. */
const fecha = (iso: string): Date | null => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : d
}

const ORIGEN: Record<Transaction['source'], string> = {
  manual: 'Formulario',
  voz: 'Dictado por voz',
  proforma: 'Cobro de proforma',
  abono: 'Abono de deuda',
}

// --- columnas de cada hoja --------------------------------------------------

const COLS_MOVIMIENTOS: Columna[] = [
  { titulo: 'Voucher', ancho: 14 },
  { titulo: 'Fecha', ancho: 17, formato: 'fecha' },
  { titulo: 'Tipo', ancho: 10 },
  { titulo: 'Categoría', ancho: 16 },
  { titulo: 'Concepto', ancho: 42 },
  { titulo: 'Cliente / Proveedor', ancho: 26 },
  { titulo: 'Método', ancho: 14 },
  { titulo: 'Estado', ancho: 12, alinear: 'center' },
  { titulo: 'Origen', ancho: 18 },
  { titulo: 'Monto', ancho: 14, formato: 'soles' },
]

const filaMovimiento = (t: Transaction) => [
  t.voucher,
  fecha(t.occurredAt),
  t.type,
  t.category,
  t.concept,
  t.party,
  t.payment,
  t.status,
  ORIGEN[t.source],
  t.amount,
]

const COLS_ORDENES: Columna[] = [
  { titulo: 'Fecha', ancho: 17, formato: 'fecha' },
  { titulo: 'Tipo', ancho: 10 },
  { titulo: 'Cliente / Proveedor', ancho: 26 },
  { titulo: 'Teléfono', ancho: 15 },
  { titulo: 'Categoría', ancho: 16 },
  { titulo: 'Trabajos', ancho: 46 },
  { titulo: 'Total', ancho: 14, formato: 'soles' },
  { titulo: 'Adelanto', ancho: 14, formato: 'soles' },
  { titulo: 'Saldo', ancho: 14, formato: 'soles' },
  { titulo: 'Corregida', ancho: 17, formato: 'fecha' },
]

const filaOrden = (w: WorkOrder) => [
  fecha(w.createdAt),
  w.kind,
  w.party,
  w.phone || '—',
  w.category,
  w.items.map((i) => i.description).join(' + '),
  w.total,
  w.advance,
  Math.round((w.total - w.advance) * 100) / 100,
  w.updatedAt ? fecha(w.updatedAt) : null,
]

const COLS_TRABAJOS: Columna[] = [
  { titulo: 'Fecha', ancho: 17, formato: 'fecha' },
  { titulo: 'Cliente / Proveedor', ancho: 26 },
  { titulo: '#', ancho: 6, alinear: 'center' },
  { titulo: 'Descripción del trabajo', ancho: 52 },
  { titulo: 'Importe', ancho: 14, formato: 'soles' },
]

const COLS_PROFORMAS: Columna[] = [
  { titulo: 'Código', ancho: 12 },
  { titulo: 'Cliente', ancho: 28 },
  { titulo: 'Detalle', ancho: 50 },
  { titulo: 'Emitida', ancho: 14, formato: 'fecha' },
  { titulo: 'Vence', ancho: 14 },
  { titulo: 'Estado', ancho: 13, alinear: 'center' },
  { titulo: 'Total', ancho: 14, formato: 'soles' },
]

const filaProforma = (p: Proforma) => [
  p.code,
  p.client,
  p.detail,
  fecha(p.issuedAt),
  expiryDate(p.issuedAt, p.validityDays),
  p.status,
  p.total,
]

const COLS_DEUDAS: Columna[] = [
  { titulo: 'Tipo', ancho: 13, alinear: 'center' },
  { titulo: 'Cliente / Proveedor', ancho: 28 },
  { titulo: 'Concepto', ancho: 46 },
  { titulo: 'Registrada', ancho: 17, formato: 'fecha' },
  { titulo: 'Vence', ancho: 14 },
  { titulo: 'Total', ancho: 14, formato: 'soles' },
  { titulo: 'Abonado', ancho: 14, formato: 'soles' },
  { titulo: 'Saldo', ancho: 14, formato: 'soles' },
  { titulo: 'Estado', ancho: 13, alinear: 'center' },
]

const filaDeuda = (d: Debt) => [
  d.kind === 'COBRAR' ? 'Por cobrar' : 'Por pagar',
  d.party,
  d.concept,
  fecha(d.createdAt),
  d.dueDate ? new Date(d.dueDate).toLocaleDateString('es-PE') : '—',
  d.total,
  d.paid,
  d.balance,
  d.status,
]

const COLS_ABONOS: Columna[] = [
  { titulo: 'Fecha', ancho: 17, formato: 'fecha' },
  { titulo: 'Cliente / Proveedor', ancho: 28 },
  { titulo: 'Concepto de la cuenta', ancho: 46 },
  { titulo: 'Método', ancho: 15 },
  { titulo: 'Importe', ancho: 14, formato: 'soles' },
]

const COLS_ARQUEOS: Columna[] = [
  { titulo: 'Fecha del cierre', ancho: 19, formato: 'fecha' },
  { titulo: 'Responsable', ancho: 24 },
  { titulo: 'Apertura', ancho: 14, formato: 'soles' },
  { titulo: 'Esperado', ancho: 14, formato: 'soles' },
  { titulo: 'Contado', ancho: 14, formato: 'soles' },
  { titulo: 'Diferencia', ancho: 14, formato: 'soles' },
  { titulo: 'Observaciones', ancho: 42 },
]

// --- informes ---------------------------------------------------------------

/** Solo los movimientos, con los filtros que tuviera la pantalla aplicados. */
export async function libroMovimientos(
  transactions: Transaction[],
  subtitulo?: string,
): Promise<Workbook> {
  const wb = await nuevoLibro('Movimientos')
  montarHoja(wb.addWorksheet('Movimientos'), {
    titulo: 'Movimientos',
    subtitulo,
    columnas: COLS_MOVIMIENTOS,
    filas: transactions.map(filaMovimiento),
  })
  return wb
}

/** Solo las cotizaciones. */
export async function libroProformas(
  proformas: Proforma[],
  subtitulo?: string,
): Promise<Workbook> {
  const wb = await nuevoLibro('Proformas')
  montarHoja(wb.addWorksheet('Proformas'), {
    titulo: 'Proformas y cotizaciones',
    subtitulo,
    columnas: COLS_PROFORMAS,
    filas: proformas.map(filaProforma),
  })
  return wb
}

export interface DatosInforme {
  stats: Stats
  transactions: Transaction[]
  workOrders: WorkOrder[]
  proformas: Proforma[]
  debts: Debt[]
  payments: DebtPayment[]
  closings: CashClosing[]
}

/**
 * El informe general: un libro con una pestaña por cada cosa del negocio.
 * Abre en el resumen, y el detalle queda en las hojas siguientes.
 */
export async function libroInformeGeneral(datos: DatosInforme): Promise<Workbook> {
  const { stats, transactions, workOrders, proformas, debts, payments, closings } = datos
  const wb = await nuevoLibro('Informe general')

  // --- 1. Resumen -----------------------------------------------------------
  const resumen = wb.addWorksheet('Resumen')
  resumen.pageSetup = {
    paperSize: 9,
    orientation: 'portrait',
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    margins: { left: 0.7, right: 0.7, top: 0.75, bottom: 0.6, header: 0.3, footer: 0.3 },
  }
  resumen.columns = [{ width: 34 }, { width: 20 }]

  resumen.mergeCells('A1:B1')
  const titulo = resumen.getCell('A1')
  titulo.value = 'TAIROS.RC — RESUMEN EJECUTIVO'
  titulo.font = { name: 'Calibri', bold: true, size: 16, color: { argb: 'FF0A5C53' } }
  resumen.getRow(1).height = 28

  resumen.mergeCells('A2:B2')
  const sub = resumen.getCell('A2')
  sub.value = `Emitido el ${new Date().toLocaleString('es-PE')}`
  sub.font = { name: 'Calibri', size: 9, italic: true, color: { argb: 'FF64748B' } }

  let f = 4
  const seccion = (texto: string) => {
    const celda = resumen.getCell(f, 1)
    celda.value = texto.toUpperCase()
    celda.font = { name: 'Calibri', bold: true, size: 10, color: { argb: 'FF64748B' } }
    f += 1
  }

  seccion('Flujo de caja')
  filaResumen(resumen, f++, 'Total de ingresos', stats.ingresos, { soles: true })
  filaResumen(resumen, f++, 'Total de egresos', stats.egresos, { soles: true })
  filaResumen(resumen, f++, 'Balance neto', stats.balance, { soles: true, destacar: true })
  f += 1

  seccion('Desglose por cuenta')
  filaResumen(resumen, f++, 'Efectivo en caja', stats.efectivo, { soles: true })
  filaResumen(resumen, f++, 'Cuentas digitales', stats.digital, { soles: true })
  f += 1

  seccion('Cuentas pendientes')
  filaResumen(resumen, f++, 'Por cobrar a clientes', stats.porCobrar, { soles: true })
  filaResumen(resumen, f++, 'Por pagar a proveedores', stats.porPagar, { soles: true })
  filaResumen(resumen, f++, 'Posición neta', stats.porCobrar - stats.porPagar, {
    soles: true,
    destacar: true,
  })
  f += 1

  seccion('Cotizaciones')
  filaResumen(resumen, f++, 'Proformas vigentes', stats.proformasVigentes)
  filaResumen(resumen, f++, 'Monto cotizado vigente', stats.proformasMonto, { soles: true })
  f += 1

  seccion('Volumen registrado')
  filaResumen(resumen, f++, 'Asientos contables', transactions.filter((t) => t.status !== 'Anulado').length)
  filaResumen(resumen, f++, 'Órdenes de trabajo', workOrders.length)
  filaResumen(resumen, f++, 'Cuentas pendientes', debts.filter((d) => d.balance > 0).length)
  filaResumen(resumen, f++, 'Abonos registrados', payments.length)
  filaResumen(resumen, f++, 'Arqueos de caja', closings.length)

  // --- 2. Movimientos -------------------------------------------------------
  montarHoja(wb.addWorksheet('Movimientos'), {
    titulo: 'Movimientos',
    columnas: COLS_MOVIMIENTOS,
    filas: transactions.map(filaMovimiento),
  })

  // --- 3. Órdenes -----------------------------------------------------------
  montarHoja(wb.addWorksheet('Órdenes'), {
    titulo: 'Órdenes de trabajo',
    columnas: COLS_ORDENES,
    filas: workOrders.map(filaOrden),
  })

  // --- 4. Trabajos ----------------------------------------------------------
  const trabajos = workOrders.flatMap((w) =>
    w.items.map((item) => [
      fecha(w.createdAt),
      w.party,
      item.position,
      item.description,
      item.amount,
    ]),
  )
  montarHoja(wb.addWorksheet('Trabajos'), {
    titulo: 'Trabajos detallados',
    subtitulo: `Una línea por trabajo · ${trabajos.length} en ${workOrders.length} órdenes`,
    columnas: COLS_TRABAJOS,
    filas: trabajos,
  })

  // --- 5. Proformas ---------------------------------------------------------
  montarHoja(wb.addWorksheet('Proformas'), {
    titulo: 'Proformas y cotizaciones',
    columnas: COLS_PROFORMAS,
    filas: proformas.map(filaProforma),
  })

  // --- 6. Deudas ------------------------------------------------------------
  montarHoja(wb.addWorksheet('Deudas'), {
    titulo: 'Cuentas por cobrar y por pagar',
    columnas: COLS_DEUDAS,
    filas: debts.map(filaDeuda),
  })

  // --- 7. Abonos ------------------------------------------------------------
  const porId = new Map(debts.map((d) => [d.id, d]))
  montarHoja(wb.addWorksheet('Abonos'), {
    titulo: 'Abonos recibidos y entregados',
    columnas: COLS_ABONOS,
    filas: payments.map((p) => {
      const cuenta = porId.get(p.debtId)
      return [
        fecha(p.paidAt),
        cuenta?.party ?? '—',
        cuenta?.concept ?? '—',
        p.paymentMethod,
        p.amount,
      ]
    }),
  })

  // --- 8. Arqueos -----------------------------------------------------------
  montarHoja(wb.addWorksheet('Arqueos'), {
    titulo: 'Cierres de caja',
    columnas: COLS_ARQUEOS,
    filas: closings.map((c) => [
      fecha(c.closedAt),
      c.author,
      c.openingCash,
      c.expectedCash,
      c.countedCash,
      c.difference,
      c.notes || '—',
    ]),
  })

  return wb
}
