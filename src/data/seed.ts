import type { CashClosing, Debt, DebtPayment, Proforma, Transaction } from '@/types'

/**
 * Datos de demostracion — los mismos del prototipo HTML.
 * Solo los usa el adaptador local; en Supabase equivalen a `supabase/seed.sql`.
 */

const AUTHOR = 'María López (Admin)'

/** Hoy a la hora indicada, en ISO. */
function at(hour: number, minute: number): string {
  const d = new Date()
  d.setHours(hour, minute, 0, 0)
  return d.toISOString()
}

export function seedTransactions(): Transaction[] {
  const base = [
    {
      voucher: 'OP-000001',
      type: 'Ingreso' as const,
      amount: 500,
      category: 'Ventas',
      party: 'Cliente Juan Pérez',
      concept: 'Millar de volantes A6 couche 150g',
      payment: 'Yape/Plin' as const,
      occurredAt: at(9, 15),
      notes: 'Transferido a la cuenta Yape de empresa.',
    },
    {
      voucher: 'OP-000002',
      type: 'Egreso' as const,
      amount: 350,
      category: 'Materiales',
      party: 'Proveedor Pacheco S.A.C.',
      concept: 'Compra de cartulina e insumos de imprenta',
      payment: 'Transferencia' as const,
      occurredAt: at(10, 30),
      notes: 'Factura F001-8392 adjunta.',
    },
    {
      voucher: 'OP-000003',
      type: 'Ingreso' as const,
      amount: 240,
      category: 'Ventas',
      party: 'Cliente Cristina',
      concept: '1,000 afiches A3 full color',
      payment: 'Efectivo' as const,
      occurredAt: at(11, 45),
      notes: 'Entregado en mostrador principal.',
    },
    {
      voucher: 'OP-000004',
      type: 'Ingreso' as const,
      amount: 400,
      category: 'Servicios',
      party: 'Imprenta Express',
      concept: 'Anillado y empastado de tomos',
      payment: 'Yape/Plin' as const,
      occurredAt: at(13, 20),
      notes: 'Pago verificado en app Yape.',
    },
    {
      voucher: 'OP-000005',
      type: 'Egreso' as const,
      amount: 210,
      category: 'Servicios Básicos',
      party: 'Luz del Sur / Enel',
      concept: 'Pago mensual recibo de luz local',
      payment: 'Efectivo' as const,
      occurredAt: at(14, 0),
      notes: 'Pagado con efectivo de caja chica.',
    },
  ]

  return base
    .map<Transaction>((t) => ({
      ...t,
      id: `seed-tx-${t.voucher}`,
      status: 'Completado',
      author: AUTHOR,
      source: 'manual',
      workOrderId: null,
    }))
    .reverse()
}

export function seedProformas(): Proforma[] {
  return [
    {
      id: 'seed-pf-1003',
      code: 'PF-1003',
      client: 'Restaurante El Sabor',
      detail: '10 Cartas menú acrílicas e impresiones en vinil',
      total: 290,
      validityDays: 30,
      status: 'Vigente',
      issuedAt: at(8, 0),
      transactionId: null,
    },
    {
      id: 'seed-pf-1002',
      code: 'PF-1002',
      client: 'Corporación Vega',
      detail: 'Diseño gráfico y manual de marca institucional',
      total: 450,
      validityDays: 7,
      status: 'Vigente',
      issuedAt: at(8, 30),
      transactionId: null,
    },
    {
      id: 'seed-pf-1001',
      code: 'PF-1001',
      client: 'Importadora San José',
      detail: '5,000 Folletos couche + Gigantografía 3x2m',
      total: 680,
      validityDays: 15,
      status: 'Vigente',
      issuedAt: at(9, 0),
      transactionId: null,
    },
  ]
}

export function seedDebts(): Omit<Debt, 'paid' | 'balance' | 'status'>[] {
  return [
    {
      id: 'seed-debt-1',
      kind: 'COBRAR',
      party: 'Constructora del Centro',
      concept: 'Saldo pendiente por impresión de planos',
      total: 600,
      dueDate: null,
      createdAt: at(8, 0),
      workOrderId: null,
    },
    {
      id: 'seed-debt-2',
      kind: 'COBRAR',
      party: 'Librería escolar Luz',
      concept: 'Afiches de campaña escolar',
      total: 450,
      dueDate: null,
      createdAt: at(8, 15),
      workOrderId: null,
    },
    {
      id: 'seed-debt-3',
      kind: 'PAGAR',
      party: 'Papelera Lima S.A.',
      concept: 'Insumos de papel bond 75g',
      total: 320,
      dueDate: null,
      createdAt: at(8, 30),
      workOrderId: null,
    },
  ]
}

export function seedPayments(): DebtPayment[] {
  return [
    {
      id: 'seed-pay-1',
      debtId: 'seed-debt-1',
      amount: 200,
      paymentMethod: 'Efectivo',
      transactionId: null,
      paidAt: at(8, 45),
    },
  ]
}

export function seedClosings(): CashClosing[] {
  return []
}
