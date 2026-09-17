import type {
  CashClosing,
  Debt,
  DebtPayment,
  PaymentMethod,
  Proforma,
  Transaction,
  WorkOrder,
} from '@/types'

/**
 * Generador de datos de demostración de nivel intermedio.
 *
 * Los datos anteriores eran cinco asientos de un solo día: suficiente para ver
 * que la pantalla pinta, insuficiente para saber si el sistema aguanta. Con
 * esto hay unas ocho semanas de actividad real de imprenta, que es lo que hace
 * falta para ejercitar la paginación, el aviso de deudas antiguas, el arqueo
 * entre cierres y el informe de Excel con volumen de verdad.
 *
 * Es DETERMINISTA: la misma semilla da exactamente el mismo negocio. Sin eso
 * no se puede probar nada dos veces ni comparar un antes y un después.
 *
 * Respeta las mismas invariantes que las guardas de Postgres, porque unos datos
 * de demostración imposibles enseñarían estados que la app no puede producir:
 *   · el adelanto nunca supera el total del pedido
 *   · lo abonado nunca supera el saldo de la cuenta
 *   · cada asiento de adelanto cuadra con su pedido
 *   · cada cierre de caja cuadra con los movimientos en efectivo de su semana
 */

const AUTOR = 'María López (Admin)'

/** PRNG con semilla (mulberry32): reproducible entre ejecuciones y máquinas. */
function crearAzar(semilla: number) {
  let a = semilla >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const CLIENTES = [
  'Importadora San José', 'Corporación Vega', 'Restaurante El Sabor',
  'Constructora del Centro', 'Librería escolar Luz', 'Botica Santa Rosa',
  'Juan Pérez Quispe', 'Cristina Mamani', 'Colegio Virgen de Fátima',
  'Municipalidad de Comas', 'Pollería Don Tito', 'Rosa de la Cruz',
  'Ferretería El Tornillo', 'Distribuidora Andina', 'Panadería La Espiga',
  'Taller Mecánico Ramos', 'Estudio Contable Salas', 'Gimnasio Fuerza Total',
  'Veterinaria Patitas', 'Notaría Cárdenas', 'Grifo Primavera',
  'Clínica Dental Sonrisa', 'Transportes Huancayo', 'Bodega Doña Marleny',
]

const PROVEEDORES = [
  'Papelera Lima S.A.', 'Proveedor Pacheco S.A.C.', 'Tintas del Perú',
  'Distribuidora Gráfica Sur', 'Luz del Sur / Enel', 'Sedapal',
  'Movistar Empresas', 'Inmobiliaria Torres',
]

/** Trabajos típicos con su rango de precio realista en soles. */
const TRABAJOS: [string, number, number][] = [
  ['Millar de volantes A6 couché 150g', 180, 320],
  ['1,000 tarjetas de presentación', 90, 160],
  ['500 afiches A3 full color', 200, 380],
  ['Gigantografía 3x2m en banner', 220, 450],
  ['Anillado y empastado de tomos', 60, 180],
  ['Sello automático personalizado', 35, 70],
  ['Impresión de vinil adhesivo', 120, 300],
  ['Folletos tríptico couché', 160, 340],
  ['Catálogo de 20 páginas', 400, 900],
  ['Cartas menú plastificadas', 140, 280],
  ['Talonarios de boleta por 50', 80, 150],
  ['Diseño gráfico de logotipo', 150, 400],
  ['Banner roll-up con estructura', 180, 350],
  ['Stickers troquelados por millar', 110, 240],
  ['Fotocopias e impresiones varias', 20, 90],
]

const GASTOS: [string, string, number, number][] = [
  ['Compra de papel bond 75g', 'Materiales', 180, 420],
  ['Cartulina y couché para pedidos', 'Materiales', 200, 500],
  ['Tóner y tintas de plotter', 'Materiales', 150, 600],
  ['Pago mensual recibo de luz', 'Servicios Básicos', 180, 260],
  ['Recibo de agua', 'Servicios Básicos', 45, 90],
  ['Internet y teléfono del local', 'Servicios Básicos', 90, 140],
  ['Alquiler del local', 'Alquiler', 900, 900],
  ['Pago de personal quincenal', 'Planilla', 600, 900],
  ['Mantenimiento de la guillotina', 'Otros', 80, 250],
]

const METODOS: PaymentMethod[] = ['Efectivo', 'Yape/Plin', 'Transferencia', 'Tarjeta']
/** Pesos realistas de mostrador: en Perú manda el efectivo y el Yape. */
const PESOS_METODO = [0.45, 0.35, 0.15, 0.05]

export interface DatosDemo {
  transactions: Transaction[]
  workOrders: WorkOrder[]
  proformas: Proforma[]
  debts: Omit<Debt, 'paid' | 'balance' | 'status'>[]
  payments: DebtPayment[]
  closings: CashClosing[]
  voucherSeq: number
  proformaSeq: number
}

export interface OpcionesDemo {
  /** Cambiarla genera otro negocio, igual de coherente. */
  semilla?: number
  /** Cuántas semanas de historia hacia atrás. */
  semanas?: number
  /** Pedidos por semana, de media. */
  pedidosPorSemana?: number
  /** Fecha de referencia; se inyecta para poder probar con fechas fijas. */
  hasta?: Date
}

const DIA = 86_400_000

export function generarDemoIntermedio(opciones: OpcionesDemo = {}): DatosDemo {
  const { semilla = 20260917, semanas = 8, pedidosPorSemana = 16, hasta = new Date() } = opciones

  const azar = crearAzar(semilla)
  const entre = (min: number, max: number) => min + azar() * (max - min)
  const entero = (min: number, max: number) => Math.floor(entre(min, max + 1))
  const elegir = <T>(lista: T[]): T => lista[Math.floor(azar() * lista.length)]
  const redondear = (n: number) => Math.round(n * 100) / 100

  const metodo = (): PaymentMethod => {
    const r = azar()
    let acumulado = 0
    for (let i = 0; i < METODOS.length; i++) {
      acumulado += PESOS_METODO[i]
      if (r < acumulado) return METODOS[i]
    }
    return 'Efectivo'
  }

  const inicio = hasta.getTime() - semanas * 7 * DIA
  /** Hora laboral: entre las 8 y las 19. */
  const momento = (dia: number) => {
    const d = new Date(inicio + dia * DIA)
    d.setHours(entero(8, 18), entero(0, 59), 0, 0)
    return d.toISOString()
  }

  const transactions: Transaction[] = []
  const workOrders: WorkOrder[] = []
  const proformas: Proforma[] = []
  const debts: Omit<Debt, 'paid' | 'balance' | 'status'>[] = []
  const payments: DebtPayment[] = []
  const closings: CashClosing[] = []

  let voucherSeq = 1
  const voucher = () => `OP-${String(voucherSeq++).padStart(6, '0')}`
  let proformaSeq = 1001

  const totalDias = semanas * 7

  // ---------------------------------------------------------------- pedidos
  for (let dia = 0; dia < totalDias; dia++) {
    const domingo = new Date(inicio + dia * DIA).getDay() === 0
    const cuantos = domingo ? 0 : Math.round(entre(0, (pedidosPorSemana / 6) * 2))

    for (let i = 0; i < cuantos; i++) {
      const cuando = momento(dia)
      const cliente = elegir(CLIENTES)
      const nLineas = azar() < 0.65 ? 1 : azar() < 0.85 ? 2 : 3

      const items = Array.from({ length: nLineas }, (_, k) => {
        const [desc, min, max] = elegir(TRABAJOS)
        return {
          id: `demo-item-${workOrders.length}-${k}`,
          position: k + 1,
          description: desc,
          amount: redondear(entre(min, max)),
        }
      })

      const total = redondear(items.reduce((s, it) => s + it.amount, 0))

      // 70% paga todo, 20% adelanta una parte, 10% se lo lleva al crédito.
      const dado = azar()
      const advance =
        dado < 0.7 ? total : dado < 0.9 ? redondear(total * entre(0.2, 0.6)) : 0

      const pago = metodo()
      const resumen = items.map((it) => it.description).join(' + ')
      const orderId = `demo-wo-${String(workOrders.length + 1).padStart(3, '0')}`

      workOrders.push({
        id: orderId,
        kind: 'Ingreso',
        party: cliente,
        phone: azar() < 0.55 ? `9${entero(10_000_000, 99_999_999)}` : '',
        category: azar() < 0.8 ? 'Ventas' : 'Servicios',
        total,
        advance,
        notes: '',
        author: AUTOR,
        createdAt: cuando,
        updatedAt: null,
        items,
      })

      if (advance > 0) {
        transactions.push({
          id: `demo-tx-${transactions.length + 1}`,
          voucher: voucher(),
          type: 'Ingreso',
          amount: advance,
          category: workOrders[workOrders.length - 1].category,
          party: cliente,
          concept: advance < total ? `Adelanto de: ${resumen}` : resumen,
          payment: pago,
          status: 'Completado',
          occurredAt: cuando,
          author: AUTOR,
          notes: '',
          source: azar() < 0.25 ? 'voz' : 'manual',
          workOrderId: orderId,
        })
      }

      const saldo = redondear(total - advance)
      if (saldo > 0) {
        const debtId = `demo-debt-${debts.length + 1}`
        debts.push({
          id: debtId,
          kind: 'COBRAR',
          party: cliente,
          concept: `Saldo de: ${resumen}`,
          total: saldo,
          dueDate: null,
          createdAt: cuando,
          workOrderId: orderId,
        })

        // Parte de esos saldos se va cobrando en días posteriores.
        if (azar() < 0.55 && dia < totalDias - 3) {
          const diaAbono = Math.min(totalDias - 1, dia + entero(2, 20))
          const parcial = azar() < 0.4
          const importe = redondear(parcial ? saldo * entre(0.3, 0.7) : saldo)
          const cuandoAbono = momento(diaAbono)
          const metodoAbono = metodo()
          const txId = `demo-tx-${transactions.length + 1}`

          transactions.push({
            id: txId,
            voucher: voucher(),
            type: 'Ingreso',
            amount: importe,
            category: 'Ventas',
            party: cliente,
            concept: `Cobro de deuda: Saldo de: ${resumen}`,
            payment: metodoAbono,
            status: 'Completado',
            occurredAt: cuandoAbono,
            author: AUTOR,
            notes: '',
            source: 'abono',
            workOrderId: null,
          })

          payments.push({
            id: `demo-pay-${payments.length + 1}`,
            debtId,
            amount: importe,
            paymentMethod: metodoAbono,
            transactionId: txId,
            paidAt: cuandoAbono,
          })
        }
      }
    }
  }

  // ---------------------------------------------------------------- gastos
  for (let dia = 0; dia < totalDias; dia++) {
    if (azar() > 0.35) continue
    const [concepto, categoria, min, max] = elegir(GASTOS)
    transactions.push({
      id: `demo-tx-${transactions.length + 1}`,
      voucher: voucher(),
      type: 'Egreso',
      amount: redondear(entre(min, max)),
      category: categoria,
      party: elegir(PROVEEDORES),
      concept: concepto,
      payment: metodo(),
      status: 'Completado',
      occurredAt: momento(dia),
      author: AUTOR,
      notes: '',
      source: 'manual',
      workOrderId: null,
    })
  }

  // Una deuda con proveedor, para que «Tú debes» no salga siempre vacío.
  for (let i = 0; i < 3; i++) {
    const dia = entero(2, totalDias - 2)
    debts.push({
      id: `demo-debt-${debts.length + 1}`,
      kind: 'PAGAR',
      party: elegir(PROVEEDORES),
      concept: elegir(['Insumos de papel bond 75g', 'Tintas y tóner a crédito', 'Cartulina couché'])!,
      total: redondear(entre(200, 800)),
      dueDate: null,
      createdAt: momento(dia),
      workOrderId: null,
    })
  }

  // ------------------------------------------------------------- proformas
  for (let i = 0; i < 18; i++) {
    const dia = entero(0, totalDias - 1)
    const [desc, min, max] = elegir(TRABAJOS)
    const dado = azar()
    proformas.push({
      id: `demo-pf-${i + 1}`,
      code: `PF-${proformaSeq++}`,
      client: elegir(CLIENTES),
      detail: desc,
      total: redondear(entre(min, max) * entre(1, 2.5)),
      validityDays: elegir([7, 15, 30]),
      status: dado < 0.5 ? 'Vigente' : dado < 0.85 ? 'Convertida' : 'Anulada',
      issuedAt: momento(dia),
      transactionId: null,
    })
  }

  // ---------------------------------------------------------------- cierres
  // Un cierre semanal, cuadrado con los movimientos en efectivo de esa semana:
  // si no cuadraran, la demo enseñaría faltantes que el sistema no produce.
  transactions.sort((a, b) => a.occurredAt.localeCompare(b.occurredAt))
  let apertura = 150
  let desde = inicio

  for (let semana = 1; semana <= semanas - 1; semana++) {
    const corte = inicio + semana * 7 * DIA
    const efectivo = transactions
      .filter((t) => {
        const ts = new Date(t.occurredAt).getTime()
        return ts > desde && ts <= corte && t.payment === 'Efectivo' && t.status !== 'Anulado'
      })
      .reduce((s, t) => s + (t.type === 'Ingreso' ? t.amount : -t.amount), 0)

    const esperado = redondear(apertura + efectivo)
    // Un descuadre pequeño de vez en cuando, que es lo que pasa de verdad.
    const desvio = azar() < 0.25 ? redondear(entre(-12, 8)) : 0
    const contado = redondear(esperado + desvio)

    const cierre = new Date(corte)
    cierre.setHours(19, entero(0, 40), 0, 0)

    closings.push({
      id: `demo-cc-${semana}`,
      countedCash: contado,
      expectedCash: esperado,
      difference: redondear(contado - esperado),
      openingCash: apertura,
      notes: desvio === 0 ? '' : desvio > 0 ? 'Sobrante sin identificar' : 'Faltante por vuelto',
      author: AUTOR,
      closedAt: cierre.toISOString(),
    })

    apertura = contado
    desde = corte
  }

  closings.reverse()
  transactions.reverse()

  return { transactions, workOrders, proformas, debts, payments, closings, voucherSeq, proformaSeq }
}
