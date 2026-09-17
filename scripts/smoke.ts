import { localAdapter, resetLocalStore } from '@/data/localAdapter'
import { parseVoiceEntry } from '@/lib/voiceParser'
import { parseAmount } from '@/lib/format'
import { buildLedgerRows } from '@/lib/ledgerRows'
import { buildCashArqueo, describeCashWindow, findLastClosing } from '@/lib/cashArqueo'
import { numerosDePagina } from '@/hooks/usePagination'
import { briefingToSpeech, buildBotMessages, buildDebtBriefing, describirAntiguedad } from '@/lib/debtAlerts'
import { answerQuestion } from '@/components/gateway/knowledge'
import type { CashClosing, Debt, Transaction, WorkOrder } from '@/types'

let failures = 0
function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failures++
  console.log(`${ok ? 'OK  ' : 'FAIL'}  ${name}${ok ? '' : `\n        esperado ${JSON.stringify(expected)}\n        obtenido ${JSON.stringify(actual)}`}`)
}

async function main() {
  resetLocalStore()

  // --- dictado por voz -----------------------------------------------------
  const a = parseVoiceEntry('ingreso 500 soles cliente Juan Pérez por volantes en Yape')
  check('voz: tipo', a.type, 'Ingreso')
  check('voz: monto', a.amount, 500)
  check('voz: método', a.payment, 'Yape/Plin')
  check('voz: cliente', a.party, 'Juan Pérez')
  check('voz: concepto', a.concept, 'volantes')

  const b = parseVoiceEntry('egreso quinientos cincuenta soles proveedor Pacheco por cartulina en efectivo')
  check('voz: egreso detectado', b.type, 'Egreso')
  check('voz: número en palabras', b.amount, 550)
  check('voz: categoría inferida', b.category, 'Materiales')
  check('voz: monto con miles', parseVoiceEntry('ingreso 1.250,50 en efectivo').amount, 1250.5)

  // --- montos --------------------------------------------------------------
  check('monto: 1.234,50', parseAmount('1.234,50'), 1234.5)
  check('monto: negativo rechazado', parseAmount('-20'), 0)
  check('monto: basura', parseAmount('abc'), 0)
  check('monto: 1,234.50', parseAmount('1,234.50'), 1234.5)
  check('monto: 1.500 (miles)', parseAmount('1.500'), 1500)
  check('monto: 1234.50', parseAmount('1234.50'), 1234.5)
  check('monto: 1.5', parseAmount('1.5'), 1.5)
  check('monto: S/ 2 500,75', parseAmount('S/ 2 500,75'), 2500.75)

  // --- asistente -----------------------------------------------------------
  check('asistente: reconoce arqueo', answerQuestion('cómo hago el cuadre de caja').includes('arqueo'), true)

  // --- flujo de deudas con abonos parciales --------------------------------
  const debts0 = await localAdapter.listDebts()
  const d1 = debts0.find((d) => d.party === 'Constructora del Centro')!
  check('deuda semilla: total', d1.total, 600)
  check('deuda semilla: abonado', d1.paid, 200)
  check('deuda semilla: saldo', d1.balance, 400)
  check('deuda semilla: estado', d1.status, 'Parcial')

  await localAdapter.payDebt(d1.id, 150, 'Yape/Plin', 'Test')
  const d1b = (await localAdapter.listDebts()).find((d) => d.id === d1.id)!
  check('abono parcial: saldo', d1b.balance, 250)
  check('abono parcial: sigue parcial', d1b.status, 'Parcial')

  let rejected = false
  try {
    await localAdapter.payDebt(d1.id, 9999, 'Efectivo', 'Test')
  } catch {
    rejected = true
  }
  check('abono: rechaza exceso sobre el saldo', rejected, true)

  await localAdapter.payDebt(d1.id, 250, 'Efectivo', 'Test')
  const d1c = (await localAdapter.listDebts()).find((d) => d.id === d1.id)!
  check('liquidación: saldo cero', d1c.balance, 0)
  check('liquidación: cancelado', d1c.status, 'Cancelado')

  // --- proforma -> asiento -------------------------------------------------
  const pf = (await localAdapter.listProformas())[0]
  const { transaction } = await localAdapter.convertProforma(pf.id, 'Transferencia', 'Test')
  check('proforma: monto del asiento', transaction.amount, pf.total)
  check('proforma: método respetado', transaction.payment, 'Transferencia')
  const pfAfter = (await localAdapter.listProformas()).find((p) => p.id === pf.id)!
  check('proforma: queda convertida', pfAfter.status, 'Convertida')

  let doubleCharge = false
  try {
    await localAdapter.convertProforma(pf.id, 'Efectivo', 'Test')
  } catch {
    doubleCharge = true
  }
  check('proforma: no se cobra dos veces', doubleCharge, true)

  // --- pedidos con varios trabajos y adelanto ------------------------------
  const items = [
    { description: '1,000 volantes A6', amount: 240 },
    { description: '500 tarjetas de visita', amount: 150 },
  ]

  // a) adelanto parcial: nace un asiento por el adelanto y una deuda por el saldo
  const parcial = await localAdapter.registerWorkOrder({
    kind: 'Ingreso', party: 'Juan Pérez', phone: '987654321', category: 'Ventas', payment: 'Yape/Plin',
    advance: 200, notes: '', author: 'Test', items,
  })
  check('pedido: total calculado', parcial.workOrder.total, 390)
  check('pedido: dos trabajos guardados', parcial.workOrder.items.length, 2)
  check('pedido: asiento por el adelanto', parcial.transaction?.amount, 200)
  check('pedido: concepto resumido', parcial.transaction?.concept, 'Adelanto de: 1,000 volantes A6 + 500 tarjetas de visita')
  check('pedido: deuda por el saldo', parcial.debt?.balance, 190)
  check('pedido: deuda es por cobrar', parcial.debt?.kind, 'COBRAR')
  check('pedido: asiento enlazado', parcial.transaction?.workOrderId, parcial.workOrder.id)
  check('pedido: deuda enlazada', parcial.debt?.workOrderId, parcial.workOrder.id)

  // b) pago completo: solo asiento, sin deuda
  const completo = await localAdapter.registerWorkOrder({
    kind: 'Ingreso', party: 'Cristina', phone: '', category: 'Ventas', payment: 'Efectivo',
    advance: 390, notes: '', author: 'Test', items,
  })
  check('pago total: asiento por el total', completo.transaction?.amount, 390)
  check('pago total: sin deuda', completo.debt, null)
  check('pago total: concepto sin prefijo', completo.transaction?.concept, '1,000 volantes A6 + 500 tarjetas de visita')

  // c) al crédito: no se movió dinero, así que no hay asiento
  const credito = await localAdapter.registerWorkOrder({
    kind: 'Ingreso', party: 'Librería Luz', phone: '', category: 'Ventas', payment: 'Efectivo',
    advance: 0, notes: '', author: 'Test', items,
  })
  check('al crédito: sin asiento', credito.transaction, null)
  check('al crédito: deuda por el total', credito.debt?.balance, 390)

  // d) egreso a proveedor con adelanto parcial → cuenta por pagar
  const egreso = await localAdapter.registerWorkOrder({
    kind: 'Egreso', party: 'Papelera Lima', phone: '', category: 'Materiales', payment: 'Transferencia',
    advance: 100, notes: '', author: 'Test', items: [{ description: 'Papel bond 75g', amount: 320 }],
  })
  check('egreso: asiento de salida', egreso.transaction?.type, 'Egreso')
  check('egreso: deuda es por pagar', egreso.debt?.kind, 'PAGAR')
  check('egreso: saldo por pagar', egreso.debt?.balance, 220)

  // e) validaciones
  let tooMuch = false
  try {
    await localAdapter.registerWorkOrder({
      kind: 'Ingreso', party: 'X', phone: '', category: 'Ventas', payment: 'Efectivo',
      advance: 9999, notes: '', author: 'Test', items,
    })
  } catch { tooMuch = true }
  check('pedido: rechaza adelanto mayor al total', tooMuch, true)

  let noItems = false
  try {
    await localAdapter.registerWorkOrder({
      kind: 'Ingreso', party: 'X', phone: '', category: 'Ventas', payment: 'Efectivo',
      advance: 0, notes: '', author: 'Test', items: [],
    })
  } catch { noItems = true }
  check('pedido: rechaza pedido sin trabajos', noItems, true)

  // f) el adelanto es lo que entra a caja, no el total del trabajo
  const efectivoDelPedido = (await localAdapter.listTransactions())
    .filter((t) => t.workOrderId === parcial.workOrder.id)
    .reduce((sum, t) => sum + t.amount, 0)
  check('caja: solo entra el adelanto', efectivoDelPedido, 200)

  // --- filas del libro: estados y exclusión de la caja ----------------------
  const tx = (over: Partial<Transaction>): Transaction => ({
    id: 't', voucher: 'OP-1', type: 'Ingreso', amount: 100, category: 'Ventas',
    party: 'X', concept: 'c', payment: 'Efectivo', status: 'Completado',
    occurredAt: '2026-08-22T10:00:00.000Z', author: 'T', notes: '', source: 'manual',
    workOrderId: null, ...over,
  })
  const wo = (over: Partial<WorkOrder>): WorkOrder => ({
    id: 'w', kind: 'Ingreso', party: 'X', phone: '', category: 'Ventas', total: 450, advance: 0,
    notes: '', author: 'T', createdAt: '2026-08-22T09:00:00.000Z', updatedAt: null,
    items: [{ id: 'i1', position: 1, description: 'Afiches escolares', amount: 450 }], ...over,
  })
  const dbt = (over: Partial<Debt>): Debt => ({
    id: 'd', kind: 'COBRAR', party: 'X', concept: 'c', total: 450, paid: 0, balance: 450,
    status: 'Pendiente', dueDate: null, createdAt: '2026-08-22T09:00:00.000Z',
    workOrderId: null, ...over,
  })

  // a) pago íntegro sin pedido -> PAGADO y cuenta a caja
  const r1 = buildLedgerRows({ transactions: [tx({ id: 'a' })], workOrders: [], debts: [] })
  check('libro: pago íntegro es PAGADO', r1[0].state, 'PAGADO')
  check('libro: pago íntegro suma a caja', r1[0].countsToCash, true)

  // b) adelanto parcial -> ADELANTO con el saldo vivo de la deuda
  const r2 = buildLedgerRows({
    transactions: [tx({ id: 'b', amount: 200, workOrderId: 'w1' })],
    workOrders: [wo({ id: 'w1', total: 390, advance: 200 })],
    debts: [dbt({ id: 'd1', workOrderId: 'w1', total: 190, balance: 190 })],
  })
  check('libro: adelanto es PARCIAL', r2[0].state, 'PARCIAL')
  check('libro: adelanto muestra el saldo', r2[0].pending, 190)
  check('libro: monto general es el del trabajo', r2[0].total, 390)
  check('libro: a caja solo entra el adelanto', r2[0].cash, 200)

  // c) el saldo baja al abonar y el estado sigue siendo ADELANTO
  const r3 = buildLedgerRows({
    transactions: [tx({ id: 'c', amount: 200, workOrderId: 'w1' })],
    workOrders: [wo({ id: 'w1', total: 390, advance: 200 })],
    debts: [dbt({ id: 'd1', workOrderId: 'w1', total: 190, paid: 100, balance: 90 })],
  })
  check('libro: saldo refleja los abonos', r3[0].pending, 90)

  // d) saldo liquidado -> el asiento pasa a PAGADO automáticamente
  const r4 = buildLedgerRows({
    transactions: [tx({ id: 'd', amount: 200, workOrderId: 'w1' })],
    workOrders: [wo({ id: 'w1', total: 390, advance: 200 })],
    debts: [dbt({ id: 'd1', workOrderId: 'w1', total: 190, paid: 190, balance: 0 })],
  })
  check('libro: saldo liquidado pasa a PAGADO', r4[0].state, 'PAGADO')

  // e) pedido al crédito -> fila visible que NO suma a caja
  const r5 = buildLedgerRows({
    transactions: [],
    workOrders: [wo({ id: 'w2' })],
    debts: [dbt({ id: 'd2', workOrderId: 'w2' })],
  })
  check('libro: crédito aparece como fila', r5.length, 1)
  check('libro: crédito es PENDIENTE', r5[0].state, 'PENDIENTE')
  check('libro: crédito no tiene asiento detrás', r5[0].transaction, null)
  check('libro: crédito NO suma a caja', r5[0].countsToCash, false)
  check('libro: crédito sin método de pago', r5[0].payment, null)
  check('libro: crédito muestra el total del pedido', r5[0].total, 450)
  check('libro: crédito no aporta efectivo', r5[0].cash, 0)

  // f) crédito ya cobrado -> desaparece, su dinero ya está en los abonos
  const r6 = buildLedgerRows({
    transactions: [tx({ id: 'f', amount: 450, workOrderId: 'w2', source: 'abono' })],
    workOrders: [wo({ id: 'w2' })],
    debts: [dbt({ id: 'd2', workOrderId: 'w2', paid: 450, balance: 0 })],
  })
  check('libro: crédito cobrado no se duplica', r6.length, 1)
  check('libro: queda solo el asiento del cobro', r6[0].state, 'PAGADO')

  // g) anulado
  const r7 = buildLedgerRows({
    transactions: [tx({ id: 'g', status: 'Anulado' })], workOrders: [], debts: [],
  })
  check('libro: anulado es ANULADO', r7[0].state, 'ANULADO')
  check('libro: anulado no suma a caja', r7[0].countsToCash, false)
  check('libro: anulado no aporta efectivo', r7[0].cash, 0)
  check('libro: anulado conserva su monto general', r7[0].total, 100)

  // el pago íntegro tiene monto general = efectivo, así que no lleva subtexto
  check('libro: pago íntegro monto = efectivo', [r1[0].total, r1[0].cash], [100, 100])

  // h) la caja solo suma las filas que movieron dinero
  const mixed = buildLedgerRows({
    transactions: [tx({ id: 'h1', amount: 200, workOrderId: 'w1' }), tx({ id: 'h2', status: 'Anulado', amount: 500 })],
    workOrders: [wo({ id: 'w1', total: 390, advance: 200 }), wo({ id: 'w2' })],
    debts: [dbt({ id: 'd1', workOrderId: 'w1', total: 190, balance: 190 }), dbt({ id: 'd2', workOrderId: 'w2' })],
  })
  check('libro: tres filas visibles', mixed.length, 3)
  check(
    'libro: a caja solo entran S/200',
    mixed.filter((r) => r.countsToCash).reduce((sum, r) => sum + r.cash, 0),
    200,
  )
  check(
    'libro: los montos generales suman S/890 (40+390 no es caja)',
    mixed.reduce((sum, r) => sum + r.total, 0),
    390 + 500 + 450,
  )
  check(
    'libro: pendiente total S/640',
    mixed.reduce((sum, r) => sum + r.pending, 0),
    190 + 450,
  )

  // h2) el estado se deriva del dinero: mismo pedido, tres desenlaces
  const escenario = (paid: number) =>
    buildLedgerRows({
      transactions: paid > 0 ? [tx({ id: 'x', amount: paid, workOrderId: 'wx' })] : [],
      workOrders: [wo({ id: 'wx', total: 100, advance: paid })],
      debts: [
        dbt({
          id: 'dx',
          workOrderId: 'wx',
          total: 100 - paid,
          balance: 100 - paid,
          paid: 0,
        }),
      ],
    })[0]

  check('estado: paga todo -> PAGADO', escenario(100).state, 'PAGADO')
  check('estado: paga una parte -> PARCIAL', escenario(60).state, 'PARCIAL')
  check('estado: no paga nada -> PENDIENTE', escenario(0).state, 'PENDIENTE')
  check('estado: PAGADO no deja saldo', escenario(100).pending, 0)
  check('estado: PARCIAL deja el resto', escenario(60).pending, 40)
  check('estado: PENDIENTE debe el total', escenario(0).pending, 100)

  // i) el caso exacto de la captura: trabajo S/40, adelanto S/15
  resetLocalStore()
  const mario = await localAdapter.registerWorkOrder({
    kind: 'Ingreso', party: 'mario', phone: '987 654 321', category: 'Ventas', payment: 'Efectivo',
    advance: 15, notes: '', author: 'Test',
    items: [{ description: '1 mll', amount: 40 }],
  })
  const marioRow = buildLedgerRows({
    transactions: await localAdapter.listTransactions(),
    workOrders: await localAdapter.listWorkOrders(),
    debts: await localAdapter.listDebts(),
  }).find((r) => r.workOrder?.id === mario.workOrder.id)!
  check('captura: monto general S/40', marioRow.total, 40)
  check('captura: cobrado S/15', marioRow.cash, 15)
  check('captura: falta S/25', marioRow.pending, 25)
  check('captura: estado PARCIAL', marioRow.state, 'PARCIAL')
  check('captura: las tres cifras cuadran', marioRow.cash + marioRow.pending, marioRow.total)

  // i2) el cliente pendiente termina de pagar: el estado se actualiza solo
  const rowsDe = async (workOrderId: string) =>
    buildLedgerRows({
      transactions: await localAdapter.listTransactions(),
      workOrders: await localAdapter.listWorkOrders(),
      debts: await localAdapter.listDebts(),
    }).filter((r) => r.workOrder?.id === workOrderId)

  // parte de un PARCIAL: S/40 de trabajo con S/15 adelantados
  const antes = (await rowsDe(mario.workOrder.id))[0]
  check('cobro: arranca en PARCIAL', antes.state, 'PARCIAL')
  check('cobro: hay una deuda a la que cobrar', antes.debt !== null, true)

  // cobra el saldo completo, como hace el botón «Ya pagó todo»
  await localAdapter.payDebt(antes.debt!.id, antes.pending, 'Efectivo', 'Test')

  const despues = await rowsDe(mario.workOrder.id)
  const filaPedido = despues.find((r) => r.workOrder?.advance === 15)!
  check('cobro: el pedido pasa a PAGADO', filaPedido.state, 'PAGADO')
  check('cobro: ya no queda saldo', filaPedido.pending, 0)
  // El abono es un asiento propio, no enlazado al pedido: si lo estuviera,
  // mostraría otra vez S/40 como monto general y se leería duplicado.
  const todasDeMario = buildLedgerRows({
    transactions: await localAdapter.listTransactions(),
    workOrders: await localAdapter.listWorkOrders(),
    debts: await localAdapter.listDebts(),
  }).filter((r) => r.party === 'mario')
  check('cobro: quedan dos filas (adelanto y abono)', todasDeMario.length, 2)
  check(
    'cobro: entre las dos entró a caja el total del trabajo',
    todasDeMario.reduce((sum, r) => sum + r.cash, 0),
    40,
  )
  check('cobro: ninguna queda con saldo', todasDeMario.every((r) => r.pending === 0), true)

  // un pedido al crédito que se cobra entero desaparece del libro
  const credito2 = await localAdapter.registerWorkOrder({
    kind: 'Ingreso', party: 'Luz', phone: '', category: 'Ventas', payment: 'Efectivo',
    advance: 0, notes: '', author: 'Test',
    items: [{ description: 'Afiches', amount: 80 }],
  })
  check('cobro: crédito arranca en PENDIENTE', (await rowsDe(credito2.workOrder.id))[0].state, 'PENDIENTE')
  await localAdapter.payDebt(credito2.debt!.id, 80, 'Efectivo', 'Test')
  const trasCobro = await rowsDe(credito2.workOrder.id)
  check('cobro: la fila al crédito se retira al cobrarse', trasCobro.length, 0)

  // --- corregir una orden mal tipeada -------------------------------------
  resetLocalStore()
  const orden = await localAdapter.registerWorkOrder({
    kind: 'Ingreso', party: 'mrio', phone: '', category: 'Ventas', payment: 'Efectivo',
    advance: 200, notes: '', author: 'Test',
    items: [{ description: '1,000 volantes', amount: 240 }, { description: '500 tarjetas', amount: 150 }],
  })
  check('editar: teléfono se guarda vacío', orden.workOrder.phone, '')
  check('editar: arranca sin marca de corrección', orden.workOrder.updatedAt, null)

  // corrige el nombre, añade el teléfono y sube un monto
  const corregida = await localAdapter.updateWorkOrder(orden.workOrder.id, {
    party: 'mario', phone: '987 654 321', category: 'Ventas', payment: 'Yape/Plin',
    advance: 200, notes: '',
    items: [{ description: '1,000 volantes A6', amount: 350 }, { description: '500 tarjetas', amount: 150 }],
  })
  check('editar: nombre corregido', corregida.workOrder.party, 'mario')
  check('editar: teléfono guardado', corregida.workOrder.phone, '987 654 321')
  check('editar: total recalculado', corregida.workOrder.total, 500)
  check('editar: saldo recalculado', corregida.debt?.balance, 300)
  check('editar: el asiento conserva el adelanto', corregida.transaction?.amount, 200)
  check('editar: método de pago corregido', corregida.transaction?.payment, 'Yape/Plin')
  check('editar: el cliente se corrige también en el asiento', corregida.transaction?.party, 'mario')
  check('editar: queda marcada como corregida', corregida.workOrder.updatedAt !== null, true)
  check('editar: no duplica asientos', (await localAdapter.listTransactions()).filter((t) => t.workOrderId === orden.workOrder.id).length, 1)

  // bajar el total por debajo de lo ya cobrado debe rechazarse
  await localAdapter.payDebt(corregida.debt!.id, 100, 'Efectivo', 'Test')
  let bajoDeLoCobrado = false
  try {
    await localAdapter.updateWorkOrder(orden.workOrder.id, {
      party: 'mario', phone: '', category: 'Ventas', payment: 'Efectivo',
      advance: 200, notes: '', items: [{ description: 'x', amount: 250 }],
    })
  } catch { bajoDeLoCobrado = true }
  check('editar: rechaza dejar el total bajo lo ya cobrado', bajoDeLoCobrado, true)
  check('editar: el rechazo no tocó nada', (await localAdapter.listWorkOrders()).find((w) => w.id === orden.workOrder.id)!.total, 500)

  // transición: adelanto a cero borra el asiento
  const suelta = await localAdapter.registerWorkOrder({
    kind: 'Ingreso', party: 'ana', phone: '', category: 'Ventas', payment: 'Efectivo',
    advance: 100, notes: '', author: 'Test', items: [{ description: 'afiches', amount: 300 }],
  })
  check('transición: nace con asiento', suelta.transaction !== null, true)
  const sinAdelanto = await localAdapter.updateWorkOrder(suelta.workOrder.id, {
    party: 'ana', phone: '', category: 'Ventas', payment: 'Efectivo',
    advance: 0, notes: '', items: [{ description: 'afiches', amount: 300 }],
  })
  check('transición: adelanto a 0 borra el asiento', sinAdelanto.transaction, null)
  check('transición: el saldo pasa a ser el total', sinAdelanto.debt?.balance, 300)
  check('transición: no queda asiento huérfano', (await localAdapter.listTransactions()).filter((t) => t.workOrderId === suelta.workOrder.id).length, 0)

  // transición: pagar todo borra la deuda
  const saldada = await localAdapter.updateWorkOrder(suelta.workOrder.id, {
    party: 'ana', phone: '', category: 'Ventas', payment: 'Efectivo',
    advance: 300, notes: '', items: [{ description: 'afiches', amount: 300 }],
  })
  check('transición: pago total borra la deuda', saldada.debt, null)
  check('transición: el asiento renace con el total', saldada.transaction?.amount, 300)
  check('transición: el concepto pierde el prefijo Adelanto', saldada.transaction?.concept, 'afiches')

  // --- corregir proformas ---------------------------------------------------
  resetLocalStore()
  const pfs = await localAdapter.listProformas()
  const vigente = pfs.find((p) => p.status === 'Vigente')!

  const pfEditada = await localAdapter.updateProforma(vigente.id, {
    client: 'Corporación Vega S.A.C.', detail: 'Manual de marca', total: 520, validityDays: 30,
  })
  check('proforma: cliente corregido', pfEditada.client, 'Corporación Vega S.A.C.')
  check('proforma: monto corregido', pfEditada.total, 520)
  check('proforma: sigue vigente', pfEditada.status, 'Vigente')

  let pfMontoCero = false
  try {
    await localAdapter.updateProforma(vigente.id, { client: 'x', detail: 'y', total: 0, validityDays: 7 })
  } catch { pfMontoCero = true }
  check('proforma: rechaza monto cero', pfMontoCero, true)

  // una vez cobrada queda bloqueada
  await localAdapter.convertProforma(vigente.id, 'Efectivo', 'Test')
  let pfCobradaEditable = false
  try {
    await localAdapter.updateProforma(vigente.id, { client: 'x', detail: 'y', total: 9, validityDays: 7 })
  } catch { pfCobradaEditable = true }
  check('proforma: cobrada ya no se edita', pfCobradaEditable, true)

  let pfCobradaAnulable = false
  try { await localAdapter.annulProforma(vigente.id) } catch { pfCobradaAnulable = true }
  check('proforma: cobrada no se anula', pfCobradaAnulable, true)

  // anular una vigente la saca del total cotizado
  const otra = (await localAdapter.listProformas()).find((p) => p.status === 'Vigente')!
  const anulada = await localAdapter.annulProforma(otra.id)
  check('proforma: se anula la vigente', anulada.status, 'Anulada')
  check(
    'proforma: la anulada ya no cuenta como vigente',
    (await localAdapter.listProformas()).filter((p) => p.status === 'Vigente').length,
    pfs.length - 2,
  )

  // --- corregir cuentas y deshacer abonos -----------------------------------
  const cuentas = await localAdapter.listDebts()
  const manual = cuentas.find((d) => d.party === 'Constructora del Centro')!
  check('cuenta: la de la semilla es manual', manual.workOrderId, null)
  check('cuenta: ya tiene S/200 abonados', manual.paid, 200)

  const corregida2 = await localAdapter.updateDebt(manual.id, {
    party: 'Constructora del Centro S.A.', concept: 'Planos corregidos', total: 700, dueDate: null,
  })
  check('cuenta: cliente corregido', corregida2.party, 'Constructora del Centro S.A.')
  check('cuenta: total corregido', corregida2.total, 700)
  check('cuenta: saldo recalculado', corregida2.balance, 500)

  let bajoAbonado = false
  try {
    await localAdapter.updateDebt(manual.id, { party: 'x', concept: 'y', total: 150, dueDate: null })
  } catch { bajoAbonado = true }
  check('cuenta: rechaza total bajo lo abonado', bajoAbonado, true)

  // una cuenta nacida de una orden no se toca desde aquí
  const pedidoConSaldo = await localAdapter.registerWorkOrder({
    kind: 'Ingreso', party: 'pedro', phone: '', category: 'Ventas', payment: 'Efectivo',
    advance: 50, notes: '', author: 'Test', items: [{ description: 'tarjetas', amount: 300 }],
  })
  let deudaDeOrden = false
  try {
    await localAdapter.updateDebt(pedidoConSaldo.debt!.id, {
      party: 'x', concept: 'y', total: 100, dueDate: null,
    })
  } catch { deudaDeOrden = true }
  check('cuenta: la nacida de una orden se rechaza', deudaDeOrden, true)

  // deshacer un abono retira también su asiento
  const antesDelAbono = (await localAdapter.listTransactions()).length
  const { payment } = await localAdapter.payDebt(manual.id, 50, 'Efectivo', 'Test')
  check('abono: crea su asiento', (await localAdapter.listTransactions()).length, antesDelAbono + 1)
  check(
    'abono: baja el saldo',
    (await localAdapter.listDebts()).find((d) => d.id === manual.id)!.balance,
    450,
  )

  await localAdapter.deleteDebtPayment(payment.id)
  check('deshacer: el asiento se va con él', (await localAdapter.listTransactions()).length, antesDelAbono)
  check(
    'deshacer: el saldo vuelve a su sitio',
    (await localAdapter.listDebts()).find((d) => d.id === manual.id)!.balance,
    500,
  )
  check(
    'deshacer: no queda asiento huérfano',
    (await localAdapter.listTransactions()).some((t) => t.id === payment.transactionId),
    false,
  )

  // --- avisos de deudas y cobros -------------------------------------------
  const hace = (dias: number) =>
    new Date(Date.now() - dias * 86_400_000).toISOString()

  const cuenta = (over: Partial<Debt>): Debt => ({
    id: 'x', kind: 'COBRAR', party: 'X', concept: 'c', total: 100, paid: 0, balance: 100,
    status: 'Pendiente', dueDate: null, createdAt: hace(1), workOrderId: null, ...over,
  })

  const aviso = buildDebtBriefing([
    cuenta({ id: 'a', party: 'Constructora', balance: 400, createdAt: hace(18) }),
    cuenta({ id: 'b', party: 'Librería Luz', balance: 450, createdAt: hace(3) }),
    cuenta({ id: 'c', party: 'Papelera Lima', kind: 'PAGAR', balance: 320, createdAt: hace(5) }),
    cuenta({ id: 'd', party: 'Ya pagada', balance: 0, createdAt: hace(40) }),
  ])

  check('aviso: solo cuenta las que tienen saldo', aviso.pendientes, 3)
  check('aviso: total por cobrar', aviso.totalCobrar, 850)
  check('aviso: total por pagar', aviso.totalPagar, 320)
  check('aviso: posición neta', aviso.neto, 530)
  check('aviso: detecta la que lleva 18 días', aviso.urgentes, 1)
  check('aviso: la antigua va primero', aviso.porCobrar[0].debt.party, 'Constructora')
  check('aviso: clasificada como antigua', aviso.porCobrar[0].urgencia, 'antigua')
  check('aviso: la reciente no alarma', aviso.porCobrar[1].urgencia, 'reciente')

  // el robot recorre todas las cuentas juntas, lo más urgente primero
  check('robot: recorre todas las cuentas vivas', aviso.todas.length, 3)
  check('robot: la más atrasada va primero', aviso.todas[0].debt.party, 'Constructora')
  check(
    'robot: mezcla cobros y pagos',
    aviso.todas.map((a) => a.debt.kind).includes('PAGAR'),
    true,
  )
  check(
    'robot: nunca menciona una cuenta saldada',
    aviso.todas.every((a) => a.debt.balance > 0),
    true,
  )
  check(
    'robot: ordenado de más a menos antigua',
    aviso.todas.map((a) => a.dias),
    [18, 5, 3],
  )

  // lo que dice el robot: saludo + una cuenta por mensaje
  const globos = buildBotMessages(aviso)
  check('robot: un saludo más una cuenta por mensaje', globos.length, 4)
  // El robot solo cuenta los primeros avisos y se va; con muchas deudas no
  // puede quedarse hablando un minuto entero.
  const muchas = buildDebtBriefing(
    Array.from({ length: 12 }, (_, i) =>
      cuenta({ id: `m${i}`, party: `Cliente ${i}`, balance: 10 + i, createdAt: hace(i + 1) }),
    ),
  )
  check('robot: con 12 deudas sigue habiendo 13 mensajes posibles', buildBotMessages(muchas).length, 13)
  check(
    'robot: pero solo cuenta los cuatro primeros',
    buildBotMessages(muchas).slice(0, 4).length,
    4,
  )
  check(
    'robot: y los que cuenta son los más urgentes',
    buildBotMessages(muchas)
      .slice(1, 4)
      .map((g) => g.debt?.party),
    ['Cliente 11', 'Cliente 10', 'Cliente 9'],
  )
  check('robot: abre con el resumen', globos[0].tone, 'resumen')
  check('robot: el saludo dice cuánto te deben', globos[0].text.includes('Te deben S/ 850.00'), true)
  check('robot: el saludo dice cuánto debes', globos[0].text.includes('Tú debes S/ 320.00'), true)
  check('robot: el saludo señala lo más urgente', globos[0].text.includes('Constructora'), true)
  check('robot: el primer detalle es el más atrasado', globos[1].debt?.party, 'Constructora')
  check('robot: colorea por urgencia', globos[1].tone, 'antigua')
  check(
    'robot: redacta los cobros en segunda persona',
    globos[1].text,
    'Constructora te debe S/ 400.00, hace 18 días.',
  )
  const pago = globos.find((g) => g.debt?.kind === 'PAGAR')!
  check('robot: distingue lo que tú debes', pago.text.startsWith('Le debes'), true)

  // El globo colorea cada dato: nombres, importes y antigüedad por separado.
  const trozos = globos[1].chunks
  check('color: el mensaje va troceado', trozos.length > 1, true)
  check(
    'color: el plano es la suma de los trozos',
    trozos.map((c) => c.text).join(''),
    globos[1].text,
  )
  check('color: el nombre va aparte', trozos[0], { text: 'Constructora', kind: 'nombre' })
  check(
    'color: el importe a cobrar se marca como cobro',
    trozos.find((c) => c.text.includes('400.00'))?.kind,
    'cobro',
  )
  check(
    'color: la antigüedad se marca como tiempo',
    trozos.find((c) => c.text.includes('18 días'))?.kind,
    'tiempo',
  )
  check(
    'color: lo que debes se marca como pago',
    pago.chunks.find((c) => c.text.startsWith('S/'))?.kind,
    'pago',
  )
  check(
    'color: el saludo mezcla cobro y pago',
    [...new Set(globos[0].chunks.map((c) => c.kind))].sort(),
    ['cobro', 'nombre', 'pago', 'texto', 'tiempo'],
  )

  // una vencida manda por encima de una simplemente vieja
  const conVencida = buildDebtBriefing([
    cuenta({ id: 'v', party: 'Vencida', balance: 100, createdAt: hace(5), dueDate: hace(3) }),
    cuenta({ id: 'w', party: 'Vieja', balance: 900, createdAt: hace(30) }),
  ])
  check('aviso: la vencida va primero aunque sea menor', conVencida.porCobrar[0].debt.party, 'Vencida')
  check('aviso: marcada como vencida', conVencida.porCobrar[0].urgencia, 'vencida')
  check('aviso: días de vencimiento', conVencida.porCobrar[0].diasVencida, 3)
  check('aviso: texto de antigüedad', describirAntiguedad(conVencida.porCobrar[0]), 'vencida hace 3 días')
  check('aviso: ambas son urgentes', conVencida.urgentes, 2)
  check('robot: la vencida encabeza la ronda', conVencida.todas[0].debt.party, 'Vencida')
  check('robot: la vencida tiñe su globo', buildBotMessages(conVencida)[1].tone, 'vencida')

  // sin nada pendiente el aviso calla
  const vacio = buildDebtBriefing([cuenta({ balance: 0 })])
  check('aviso: sin pendientes no alerta', vacio.pendientes, 0)
  check('aviso: sin pendientes no hay urgentes', vacio.urgentes, 0)
  check('robot: sin pendientes no aparece', buildBotMessages(vacio).length, 0)
  check('aviso: mensaje de todo al día', briefingToSpeech(vacio).includes('No tienes cuentas pendientes'), true)

  // el texto hablado nombra a quién y cuánto
  const hablado = briefingToSpeech(aviso)
  check('voz: dice cuánto te deben', hablado.includes('Te deben 850.00 soles'), true)
  check('voz: nombra al cliente', hablado.includes('Constructora'), true)
  check('voz: dice cuánto debes', hablado.includes('Tú debes 320.00 soles'), true)
  check('voz: avisa de la atrasada', hablado.includes('demasiado tiempo'), true)

  // el cerebro responde con cifras solo si le preguntas por deudas
  check('cerebro: pregunta de deudas da cifras', answerQuestion('quién me debe', aviso).includes('850.00'), true)
  check('cerebro: pregunta de deudas sin datos explica el módulo', answerQuestion('quién me debe', vacio).includes('abonos parciales'), true)
  for (const frase of ['quién me debe', 'cuánto me deben', 'a quién le debo', 'cuánto debo yo', 'quiénes están pendientes', 'mis morosos', 'saldos por cobrar']) {
    check(`cerebro: entiende «${frase}»`, answerQuestion(frase, aviso).includes('850.00'), true)
  }
  check('cerebro: otra pregunta no saca cifras', answerQuestion('cómo hago el arqueo', aviso).includes('850.00'), false)
  check('cerebro: sin resumen sigue explicando', answerQuestion('deudas').includes('abonos parciales'), true)

  // --- informes en Excel ----------------------------------------------------
  const { libroInformeGeneral, libroMovimientos } = await import('@/lib/reports')

  const hojaMovs = await libroMovimientos(await localAdapter.listTransactions())
  const wsMovs = hojaMovs.getWorksheet('Movimientos')!
  check('excel: la hoja de movimientos existe', wsMovs !== undefined, true)
  check('excel: el título va en la primera fila', String(wsMovs.getCell('A1').value).startsWith('TAIROS.RC'), true)
  check('excel: la cabecera va en la cuarta', wsMovs.getCell('A4').value, 'Voucher')
  check('excel: la cabecera se repite al imprimir', wsMovs.pageSetup.printTitlesRow, '4:4')
  check('excel: panel congelado bajo la cabecera', wsMovs.views[0]?.ySplit, 4)
  check('excel: márgenes definidos', wsMovs.pageSetup.margins?.left, 0.45)
  check('excel: se ajusta al ancho de la página', wsMovs.pageSetup.fitToWidth, 1)
  check('excel: los importes llevan formato de soles', wsMovs.getCell('J5').numFmt, '"S/" #,##0.00')
  check('excel: los importes son números, no texto', typeof wsMovs.getCell('J5').value, 'number')
  check('excel: las fechas son fechas', wsMovs.getCell('B5').value instanceof Date, true)

  const informe = await libroInformeGeneral({
    stats: {
      ingresos: 1425, egresos: 333, balance: 1092, porCobrar: 1090, porPagar: 320,
      proformasVigentes: 2, proformasMonto: 970, efectivo: 302, digital: 790,
    },
    transactions: await localAdapter.listTransactions(),
    workOrders: await localAdapter.listWorkOrders(),
    proformas: await localAdapter.listProformas(),
    debts: await localAdapter.listDebts(),
    payments: await localAdapter.listAllDebtPayments(),
    closings: await localAdapter.listClosings(),
  })

  check(
    'informe: trae las ocho hojas',
    informe.worksheets.map((w) => w.name),
    ['Resumen', 'Movimientos', 'Órdenes', 'Trabajos', 'Proformas', 'Deudas', 'Abonos', 'Arqueos'],
  )
  const wsResumen = informe.getWorksheet('Resumen')!
  check('informe: abre por el resumen', informe.worksheets[0].name, 'Resumen')
  check('informe: el resumen va en vertical', wsResumen.pageSetup.orientation, 'portrait')
  check('informe: el resumen tiene sus márgenes', wsResumen.pageSetup.margins?.top, 0.75)

  const etiquetas: string[] = []
  wsResumen.eachRow((row) => {
    const v = row.getCell(1).value
    if (typeof v === 'string') etiquetas.push(v)
  })
  check('informe: lista el balance neto', etiquetas.includes('Balance neto'), true)
  check('informe: lista lo que te deben', etiquetas.includes('Por cobrar a clientes'), true)
  check('informe: lista el efectivo en caja', etiquetas.includes('Efectivo en caja'), true)

  // En .xlsx un texto que empieza por «=» se guarda como texto: una fórmula
  // necesita la propiedad `f` explícita, así que no hay riesgo de inyección
  // como lo había en CSV.
  const conFormula = await libroMovimientos([
    { ...(await localAdapter.listTransactions())[0], concept: '=CMD()|calc' },
  ])
  const celdaSospechosa = conFormula.getWorksheet('Movimientos')!.getCell('E5')
  check('excel: un texto con «=» no se vuelve fórmula', typeof celdaSospechosa.value, 'string')
  check('excel: y se guarda tal cual', celdaSospechosa.value, '=CMD()|calc')

  const wsTrabajos = informe.getWorksheet('Trabajos')!
  check('informe: una fila por trabajo', wsTrabajos.getCell('D4').value, 'Descripción del trabajo')

  // el archivo generado tiene que ser un xlsx válido
  const bytes = await informe.xlsx.writeBuffer()
  check('informe: genera un archivo con contenido', bytes.byteLength > 5000, true)
  const cabeceraZip = Buffer.from(bytes.slice(0, 2)).toString()
  check('informe: el archivo es un zip (formato xlsx)', cabeceraZip, 'PK')

  // --- arqueo: solo el efectivo posterior al último cierre ------------------
  const cierre = (over: Partial<CashClosing>): CashClosing => ({
    id: 'c', countedCash: 130, expectedCash: 130, difference: 0, openingCash: 100,
    notes: '', author: 'T', closedAt: '2026-08-28T23:00:00.000Z', ...over,
  })

  // Día 1: abre con S/ 100 y mueve +240 / −210 en efectivo. Aún no hay cierres.
  const dia1 = [
    tx({ id: 'a1', type: 'Ingreso', amount: 240, occurredAt: '2026-08-28T13:00:00.000Z' }),
    tx({ id: 'a2', type: 'Egreso', amount: 210, occurredAt: '2026-08-28T16:00:00.000Z' }),
  ]
  const arqueo1 = buildCashArqueo(dia1, [], 100)
  check('arqueo: día 1 sin cierres espera 130', arqueo1.expectedCash, 130)
  check('arqueo: día 1 cuenta los dos movimientos', arqueo1.movements, 2)
  check('arqueo: día 1 arranca desde el inicio', arqueo1.since, null)
  check('arqueo: día 1 sin cierre de referencia', arqueo1.lastClosing, null)

  // Día 2: ayer se cerró con S/ 130 contados, hoy solo entran S/ 50 nuevos.
  const cierreDia1 = cierre({ id: 'c1' })
  const dia2 = [
    ...dia1,
    tx({ id: 'b1', type: 'Ingreso', amount: 50, occurredAt: '2026-08-29T15:00:00.000Z' }),
  ]
  const arqueo2 = buildCashArqueo(dia2, [cierreDia1], 130)
  check('arqueo: día 2 espera 180', arqueo2.expectedCash, 180)
  // El fallo antiguo sumaba todo el histórico al fondo: 130 + 80 = 210.
  check('arqueo: día 2 NO espera 210', arqueo2.expectedCash === 210, false)
  check('arqueo: día 2 no arrastra el efectivo de ayer', arqueo2.cashSince, 50)
  check('arqueo: día 2 cuenta un solo movimiento', arqueo2.movements, 1)
  check('arqueo: día 2 arranca en el último cierre', arqueo2.since, cierreDia1.closedAt)
  check('arqueo: día 2 conserva el cierre de referencia', arqueo2.lastClosing?.id, 'c1')

  // Día 3: sin movimientos nuevos, el esperado es exactamente el fondo.
  const arqueo3 = buildCashArqueo(dia2, [cierre({ id: 'c2', closedAt: '2026-08-29T23:00:00.000Z' })], 180)
  check('arqueo: sin movimientos nuevos espera el fondo', arqueo3.expectedCash, 180)
  check('arqueo: sin movimientos nuevos no cuenta ninguno', arqueo3.movements, 0)

  // Sin ningún cierre en la bitácora se cuenta desde el principio de la historia.
  const arqueoSinCierres = buildCashArqueo(dia2, [], 0)
  check('arqueo: sin cierres suma toda la historia', arqueoSinCierres.expectedCash, 80)
  check('arqueo: sin cierres cuenta todos los movimientos', arqueoSinCierres.movements, 3)

  // Los anulados no suman, aunque sean posteriores al cierre.
  const conAnulado = [
    ...dia2,
    tx({ id: 'x1', amount: 500, status: 'Anulado', occurredAt: '2026-08-29T16:00:00.000Z' }),
  ]
  const arqueoAnulado = buildCashArqueo(conAnulado, [cierreDia1], 130)
  check('arqueo: el asiento anulado no suma', arqueoAnulado.expectedCash, 180)
  check('arqueo: el asiento anulado no se cuenta', arqueoAnulado.movements, 1)

  // Lo que no se cobró en efectivo vive en las cuentas digitales, no en el cajón.
  const conDigital = [
    ...dia2,
    tx({ id: 'x2', amount: 400, payment: 'Yape/Plin', occurredAt: '2026-08-29T17:00:00.000Z' }),
    tx({ id: 'x3', amount: 300, payment: 'Transferencia', occurredAt: '2026-08-29T18:00:00.000Z' }),
    tx({ id: 'x4', amount: 250, payment: 'Tarjeta', occurredAt: '2026-08-29T19:00:00.000Z' }),
  ]
  const arqueoDigital = buildCashArqueo(conDigital, [cierreDia1], 130)
  check('arqueo: Yape, transferencia y tarjeta quedan fuera', arqueoDigital.expectedCash, 180)
  check('arqueo: solo cuenta movimientos en efectivo', arqueoDigital.movements, 1)

  // Un egreso en efectivo posterior al cierre resta.
  const conEgreso = [
    ...dia2,
    tx({ id: 'x5', type: 'Egreso', amount: 70, occurredAt: '2026-08-29T20:00:00.000Z' }),
  ]
  check('arqueo: el egreso posterior resta', buildCashArqueo(conEgreso, [cierreDia1], 130).expectedCash, 110)

  // Justo en el instante del cierre: ya quedó contado dentro del fondo.
  const enElCierre = [tx({ id: 'x6', amount: 90, occurredAt: cierreDia1.closedAt })]
  check('arqueo: el asiento del instante del cierre no se repite', buildCashArqueo(enElCierre, [cierreDia1], 130).expectedCash, 130)

  // Céntimos: el esperado nunca arrastra basura de coma flotante.
  const centimos = [
    tx({ id: 'x7', amount: 0.1, occurredAt: '2026-08-29T21:00:00.000Z' }),
    tx({ id: 'x8', amount: 0.2, occurredAt: '2026-08-29T21:30:00.000Z' }),
  ]
  check('arqueo: redondea a céntimos', buildCashArqueo(centimos, [cierreDia1], 0).expectedCash, 0.3)

  // La bitácora puede llegar en cualquier orden: manda el cierre más reciente.
  const desordenados = [cierre({ id: 'viejo', closedAt: '2026-08-27T23:00:00.000Z' }), cierreDia1]
  check('arqueo: elige el cierre más reciente', findLastClosing(desordenados)?.id, 'c1')
  check('arqueo: bitácora vacía no tiene cierre', findLastClosing([]), null)
  check('arqueo: ignora un sello ilegible', findLastClosing([cierre({ id: 'roto', closedAt: 'no-es-fecha' })]), null)
  check('arqueo: con la bitácora desordenada sigue esperando 180', buildCashArqueo(dia2, desordenados, 130).expectedCash, 180)

  // El texto que lee el usuario sale del mismo cálculo.
  check(
    'arqueo: explica desde qué cierre cuenta',
    describeCashWindow(arqueo2, () => '28 ago 18:30'),
    'desde el último cierre del 28 ago 18:30',
  )
  check(
    'arqueo: explica que aún no hay cierres',
    describeCashWindow(arqueo1, () => '—'),
    'desde el inicio, aún sin cierres',
  )

  // Y sobre el almacén real: el cierre guardado marca el punto de partida.
  await localAdapter.createClosing({
    countedCash: 500, expectedCash: 500, openingCash: 0, notes: '', author: 'Test',
  })
  const bitacora = await localAdapter.listClosings()
  const antesDelAsiento = buildCashArqueo(await localAdapter.listTransactions(), bitacora, 0)
  await localAdapter.createTransaction({
    type: 'Ingreso', amount: 77.5, category: 'Ventas', party: 'Kiosco', concept: 'afiches',
    payment: 'Efectivo', status: 'Completado', author: 'Test', notes: '', source: 'manual',
    occurredAt: new Date(Date.now() + 60_000).toISOString(),
  })
  const trasElAsiento = buildCashArqueo(await localAdapter.listTransactions(), bitacora, 0)
  check('arqueo: usa el cierre guardado en la bitácora', trasElAsiento.lastClosing?.id, bitacora[0].id)
  check(
    'arqueo: solo el asiento posterior al cierre mueve el esperado',
    [
      trasElAsiento.movements - antesDelAsiento.movements,
      Math.round((trasElAsiento.cashSince - antesDelAsiento.cashSince) * 100) / 100,
    ],
    [1, 77.5],
  )

  // --- controles de paginación ---------------------------------------------
  check('paginado: con pocas páginas las lista todas', numerosDePagina(1, 5), [1, 2, 3, 4, 5])
  check('paginado: justo en el límite sin huecos', numerosDePagina(4, 7), [1, 2, 3, 4, 5, 6, 7])
  check(
    'paginado: en medio abre huecos a los dos lados',
    numerosDePagina(7, 14),
    [1, 'hueco', 6, 7, 8, 'hueco', 14],
  )
  check(
    'paginado: al principio solo hay hueco al final',
    numerosDePagina(1, 14),
    [1, 2, 'hueco', 14],
  )
  check(
    'paginado: al final solo hay hueco al principio',
    numerosDePagina(14, 14),
    [1, 'hueco', 13, 14],
  )
  check('paginado: una sola página', numerosDePagina(1, 1), [1])
  check(
    'paginado: nunca repite ni desordena',
    (() => {
      const n = numerosDePagina(8, 20).filter((x): x is number => x !== 'hueco')
      return n.every((v, i) => i === 0 || v > n[i - 1])
    })(),
    true,
  )

  // j) orden descendente por fecha
  const ordered = buildLedgerRows({
    transactions: [tx({ id: 'old', occurredAt: '2026-08-22T08:00:00.000Z' })],
    workOrders: [wo({ id: 'w3', createdAt: '2026-08-22T11:00:00.000Z' })],
    debts: [dbt({ id: 'd3', workOrderId: 'w3' })],
  })
  check('libro: más reciente primero', ordered[0].workOrder?.id, 'w3')

  // --- correlativos únicos -------------------------------------------------
  const created = await Promise.all(
    Array.from({ length: 5 }, (_, i) =>
      localAdapter.createTransaction({
        type: 'Ingreso', amount: 10 + i, category: 'Ventas', party: 'X',
        concept: `t${i}`, payment: 'Efectivo', status: 'Completado',
        author: 'Test', notes: '', source: 'manual',
      }),
    ),
  )
  check('ids únicos', new Set(created.map((t) => t.id)).size, 5)
  check('vouchers únicos', new Set(created.map((t) => t.voucher)).size, 5)

  console.log(failures === 0 ? '\n✅ Todas las comprobaciones pasaron' : `\n❌ ${failures} fallo(s)`)
  process.exit(failures === 0 ? 0 : 1)
}

void main()
