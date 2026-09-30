import { localAdapter, resetLocalStore } from '@/data/localAdapter'
import { cifrasDeLaFrase, parseVoiceEntry } from '@/lib/voiceParser'
import { expiryDate, parseAmount } from '@/lib/format'
import { buildLedgerRows } from '@/lib/ledgerRows'
import { buildCashArqueo, describeCashWindow, findLastClosing } from '@/lib/cashArqueo'
import { numerosDePagina } from '@/hooks/usePagination'
import { generarDemoIntermedio } from '@/data/demoIntermedio'
import { briefingToSpeech, buildBotMessages, buildDebtBriefing, describirAntiguedad } from '@/lib/debtAlerts'
import { diasCalendario, diasParaVencer, esHoy } from '@/lib/fechas'
import { buildProformaBriefing, diasParaCaducar } from '@/lib/proformas'
import { answerQuestion } from '@/components/gateway/knowledge'
import type { CashClosing, Debt, Producto, Proforma, Transaction, WorkOrder } from '@/types'
import { readFileSync } from 'node:fs'
import { desdeReglas } from '@/lib/dictado/reglas'
import { fusionarCorreccion, problemasDe } from '@/lib/dictado/corregir'
import { alinear, segmentar } from '@/lib/dictado/segmentar'
import { validarExtraccion } from '@/lib/dictado/validar'
import { leerCorpus, puntuarFrase, resumir } from '@/lib/dictado/puntuar'
import { cruzarConReglas } from '@/lib/dictado/cruzar'
import { corregirCon, extraerCon, hoyEnLima, type Invocar } from '@/lib/dictado/extraer'
import { destinoDelAbono, formularioDeAbono, formularioDeDeuda, formularioDePedido, formularioDeProforma } from '@/lib/dictado/formulario'
import { buscarParte, catalogoDePartes, normalizar } from '@/lib/partes'
import { construirPeticion, leerRespuesta, tieneForma } from '../supabase/functions/_shared/dictado/peticion.ts'
import { ERRORES_FRECUENTES, normalizarDictado } from '../supabase/functions/_shared/dictado/vocabulario.ts'
import { PROMPT_SISTEMA } from '../supabase/functions/_shared/dictado/prompt.ts'
import { puerta } from '@/lib/dictado/puerta'
import { fechaDeEntrega, fechaDeEntregaValida } from '../supabase/functions/_shared/dictado/fechas.ts'
import { armarTablero, plazoDe, siguienteEstado, textoPlazo } from '@/lib/trabajos'
import { enlaceWhatsApp, mensaje, numeroPeruano } from '@/lib/whatsapp'
import { describirLinea, precioPorUnidad, productoEnDescripcion, totalDe } from '@/lib/catalogo'
import type { Cobro, Extraccion } from '../supabase/functions/_shared/dictado/tipos.ts'

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

  // --- dictado: el monto es el precio, no la cantidad del trabajo ----------
  // Coger el primer número de la frase metía la cantidad ("mil volantes") en
  // los libros como si fuera el importe.
  const montoDictado = (frase: string) => parseVoiceEntry(frase).amount
  check('voz: el precio gana a la cantidad', montoDictado('mil volantes A6 por 240 soles'), 240)
  check('voz: cantidad en dígitos ignorada', montoDictado('1000 volantes por 240 soles'), 240)
  check('voz: precio tras "a"', montoDictado('cliente Luis mil volantes a 180 soles'), 180)
  // «2 millares a 180»: ¿180 cada millar o 180 por todo? No se elige.
  check('voz: varios millares «a 180» no se adivina', montoDictado('cliente Luis 2 millares a 180 soles'), null)
  check('voz: «a 180 el millar» sí es claro', montoDictado('cliente Luis 2 millares a 180 el millar'), 360)
  check('voz: "A6" no es un monto', montoDictado('volantes A6 por cincuenta soles'), 50)
  check('voz: S/ pegado al importe', montoDictado('ingreso de S/ 1,200.50 cliente Mary por banners'), 1200.5)
  check('voz: el teléfono no es un monto', montoDictado('cliente Juan 987654321 por volantes 50 soles'), 50)
  // Ante dos precios igual de respaldados, o una cantidad sin precio, callar es
  // más barato que inventar la cifra.
  check('voz: dos precios distintos no se adivinan', montoDictado('cobré 300 soles y quedaron 500 soles'), null)
  check('voz: cantidad sin precio no es monto', montoDictado('mil volantes para el cliente Rosa'), null)
  check('voz: "una gigantografía" no es S/ 1', montoDictado('venta de una gigantografía al cliente Beto'), null)
  check('voz: la fecha de entrega no es monto', montoDictado('entrega el 15 de mayo para el cliente Rosa'), null)
  // Controles: los casos que ya funcionaban siguen igual.
  check('voz: número suelto sigue valiendo', montoDictado('venta 350 cliente Pedro'), 350)
  check('voz: importe en palabras con miles', montoDictado('egreso mil doscientos soles por alquiler'), 1200)

  // --- dictado: método de pago sin falsos positivos ------------------------
  // En una alternancia \b sólo ata al primer y último término, así que "pos"
  // casaba dentro de "tipos" y "visa" dentro de "avisa".
  const pagoDictado = (frase: string) => parseVoiceEntry(frase).payment
  check('voz: "tipos" no es POS', pagoDictado('egreso por varios tipos de papel 80 soles'), null)
  check('voz: "grupos" no es POS', pagoDictado('cliente Grupos Unidos por afiches 120 soles'), null)
  check('voz: "avisa" no es Visa', pagoDictado('el cliente avisa que paga mañana'), null)
  // "tarjeta" es un producto de imprenta antes que una forma de pago.
  check('voz: tarjetas de presentación no son pago', pagoDictado('cliente Carmen por tarjetas de presentación 150 soles'), null)
  // Controles: los métodos dictados de verdad se siguen reconociendo.
  check('voz: tarjeta de crédito sí es pago', pagoDictado('cliente Ana por afiches 200 soles con tarjeta de crédito'), 'Tarjeta')
  check('voz: visa sí es pago', pagoDictado('el cliente pagó con visa 90 soles'), 'Tarjeta')
  check('voz: pos sí es pago', pagoDictado('cobré 45 soles por pos'), 'Tarjeta')
  check('voz: transferencia', pagoDictado('egreso 300 soles por toner en transferencia bcp'), 'Transferencia')
  check('voz: yape', pagoDictado('ingreso 90 soles por stickers en yape'), 'Yape/Plin')

  // --- dictado: el nombre no se corta en "de" ------------------------------
  // "Rosa de la Cruz" se guardaba como "Rosa" y "Distribuidora de Tintas" como
  // "Distribuidora": en Perú eso es media agenda.
  const nombreDictado = (frase: string) => parseVoiceEntry(frase).party
  check('voz: nombre con "de la"', nombreDictado('ingreso 200 soles cliente Rosa de la Cruz por volantes'), 'Rosa de la Cruz')
  check('voz: razón social con "de"', nombreDictado('egreso 890 soles proveedor Distribuidora de Tintas por toner'), 'Distribuidora de Tintas')
  check('voz: nombre con "del"', nombreDictado('egreso proveedor Papelera del Norte por papel bond'), 'Papelera del Norte')
  check('voz: conector suelto fuera del nombre', nombreDictado('proveedor de Tintas Perú por toner'), 'Tintas Perú')
  // Controles: los cortes que ya funcionaban siguen cortando.
  check('voz: corta en "por"', nombreDictado('cliente Juan Pérez por volantes'), 'Juan Pérez')
  check('voz: corta en "en"', nombreDictado('cliente Pedro Quispe en efectivo'), 'Pedro Quispe')
  check('voz: corta ante la cifra', nombreDictado('cliente Marta 150 soles'), 'Marta')
  check('voz: corta en la coma', nombreDictado('cliente Ana María, volantes'), 'Ana María')

  // Lo que el corpus destapó en el parser que usa producción: el nombre se
  // tragaba el método de pago, el verbo o la forma de cobro.
  check('voz: corta en el método sin preposición', nombreDictado('cobré 25 soles cliente Mario yape'), 'Mario')
  check('voz: corta en el verbo', nombreDictado('la señora María abonó 50 soles'), 'María')
  check('voz: corta en «me debe»', nombreDictado('el cliente Beto me debe 200 soles'), 'Beto')
  check('voz: corta en «al crédito»', nombreDictado('mil volantes para el cliente Rosa al crédito por 300'), 'Rosa')
  check('voz: corta en el «de» de una cantidad', nombreDictado('cotización para la señora María de mil volantes'), 'María')
  check('voz: estilo formulario', nombreDictado('Ingreso 800 soles. Cliente: Restaurante El Sabor. Pago: yape'), 'Restaurante El Sabor')
  check('voz: el «de» del apellido sigue dentro', nombreDictado('cliente José del Castillo en efectivo'), 'José del Castillo')

  // Precio unitario: registrar el de una unidad dejaba la venta en una fracción.
  check('voz: cantidad × precio unitario', montoDictado('vendí 3 banderolas a 70 soles cada una en efectivo'), 210)
  check('voz: precio unitario con adelanto aparte', montoDictado('12 polos estampados a 18 soles cada uno'), 216)
  check('voz: unitario sin cantidad clara no se adivina', montoDictado('volantes y tarjetas: 1000 volantes y 500 tarjetas a 0.20 cada una'), null)
  check('voz: «cada semana» no es precio unitario', montoDictado('gasté 30 soles de pasajes cada semana'), 30)

  // Lo que destapó el conjunto de control: cifras mal leídas que acababan en los libros.
  check('voz: «un ciento» son cien unidades, no 101', montoDictado('pagó en efectivo el señor huamán 55 por un ciento de tarjetas'), 55)
  check('voz: «5 mil» son 5000', cifrasDeLaFrase('cotiza 5 mil volantes').map((c) => c.valor), [5000])
  check('voz: un plural cuenta cosas aunque no esté en la lista', montoDictado('le yapeé 160 al de suministros por 8 planchas'), 160)
  check('voz: «15 días» es un plazo, no un precio', montoDictado('2 millares de hojas membretadas 280 vale 15 días'), 280)
  check('voz: «240 los volantes» sigue siendo precio', montoDictado('mil volantes 240 los volantes'), 240)
  check('voz: docenas por precio de pieza', montoDictado('vendí 3 docenas de llaveros a 2.50 cada uno'), 90)
  check('voz: «a 24 la resma»', montoDictado('compré 5 resmas de bond a 24 la resma'), 120)
  check('voz: «150 el diseño» no es precio unitario', montoDictado('150 el diseño y 200 los volantes'), null)
  check('voz: «más igv» no dice qué total registrar', montoDictado('cotiza 300 agendas 4500 más igv'), null)
  check('voz: dos métodos de pago, ninguno', parseVoiceEntry('le pagué 400 la mitad en efectivo y la otra mitad por transferencia').payment, null)

  // El concepto es el trabajo, no lo que sigue al primer «por».
  const conceptoDictado = (frase: string) => parseVoiceEntry(frase).concept
  check('voz: «por 240 soles» es el precio', conceptoDictado('mil volantes A6 por 240 soles cliente Rosa'), 'mil volantes A6')
  check('voz: «por transferencia» es el método', conceptoDictado('pagué el alquiler del local 1200 soles por transferencia'), 'alquiler del local')
  check('voz: la medida queda dentro del trabajo', conceptoDictado('cobré 350 por 2 gigantografías de 3 por 2'), '2 gigantografías de 3 por 2')
  check('voz: el «por» de una medida no abre el concepto', conceptoDictado('gigantografía de 3 por 2 para la señora María 350 soles'), 'gigantografía de 3')
  check('voz: «un» es artículo, no la cifra 1', conceptoDictado('me pagaron 85 soles por un empastado de tesis en efectivo'), 'un empastado de tesis')
  check('voz: tramos que nombran el trabajo', conceptoDictado('hazme una cotización para la señora María, son mil volantes a color, también incluye el diseño'), 'mil volantes a color + diseño')

  // La categoría depende de si el dinero entra o sale.
  check('voz: vinil comprado es material', parseVoiceEntry('compra de vinil adhesivo 260 soles proveedor Pacheco').category, 'Materiales')
  check('voz: pagar con tarjeta no es vender tarjetas', parseVoiceEntry('pagué 45 soles de internet con tarjeta').category, 'Servicios Básicos')

  // --- dictado: vocabulario de mostrador -----------------------------------
  // Solo corrige errores de transcripción: lo que reescribe acaba en el
  // concepto que el usuario lee.
  for (const [entrada, esperado] of [
    ['me pagó por llape 50', 'me pagó por yape 50'],
    ['pagó con yapé', 'pagó con yape'],
    ['yapé.', 'yape.'],
    ['una giganto grafía de 3x2', 'una gigantografía de 3x2'],
    ['tres gigante grafías', 'tres gigantografías'],
    ['por trans ferencia', 'por transferencia'],
    ['cincuenta lucas', 'cincuenta soles'],
    ['cliente Lucas Pérez', 'cliente Lucas Pérez'],
    ['el yapero', 'el yapero'],
    ['por transfe', 'por transferencia'],
    ['dejó 50 acuenta', 'dejó 50 a cuenta'],
  ]) {
    check(`vocabulario: «${entrada}»`, normalizarDictado(entrada), esperado)
  }

  // --- dictado: el intérprete de reglas con el contrato ---------------------
  const reglas = (frase: string) => validarExtraccion(desdeReglas(frase), frase)
  const cotiza = reglas('cotización para la señora María de mil volantes por 500 soles válida dos semanas')
  check('reglas: una cotización va a proformas', cotiza.intent, 'proforma')
  check('reglas: vigencia «dos semanas»', cotiza.proforma?.vigenciaDias, 15)
  const abonoDictado = reglas('la señora María abonó 50 soles en efectivo')
  check('reglas: un abono no es una venta nueva', [abonoDictado.intent, abonoDictado.abono?.parte, abonoDictado.abono?.monto], ['abono', 'María', 50])
  const conResto = reglas('mil volantes para la señora Gladys por 180 soles, pagó 80 y el resto a la entrega con yape')
  check('reglas: «pagó 80 y el resto» es un adelanto', conResto.pedido?.adelanto, { tipo: 'parcial', monto: 80 })
  check('reglas: y el precio es el total del trabajo', conResto.pedido?.items[0].monto, 180)
  const alCredito = reglas('mil volantes para el cliente Rosa al crédito por 300')
  check('reglas: al crédito no pide método de pago', alCredito.faltantes.includes('pago'), false)
  check('reglas: el teléfono se guarda', reglas('cliente Carlos 987 654 321 quinientas tarjetas por 150 soles').pedido?.telefono, '987654321')
  check('reglas: sin palabras de venta, «pagó todo» es un supuesto', reglas('mil volantes para Rosa por 240 soles en yape').supuestos.includes('cobro'), true)
  const dejo = reglas('para la señora nelly 3 docenas de recuerdos de bautizo dejó 50 nomás')
  check('reglas: «dejó 50» es un adelanto, no el precio', [dejo.pedido?.adelanto.monto, dejo.pedido?.items[0].monto], [50, null])
  check('reglas: «adelanto de sueldo» es un gasto pagado', [reglas('adelanto de sueldo a kevin 200 en efectivo').intent, reglas('adelanto de sueldo a kevin 200 en efectivo').pedido?.adelanto.tipo], ['egreso', 'total'])
  check('reglas: «2 millares a 180» ofrece 180 o 360', reglas('dos millares de volantes a 180 para jhonatan en efectivo').ambiguedades,
    [{ campo: 'items.0.monto', opciones: ['180', '360'] }])
  const dosConPrecio = reglas('cobré 95 por el empastado y 15 por el anillado cliente Mario yape')
  check('reglas: dos trabajos con su precio son dos líneas, cada una con el suyo', dosConPrecio.pedido?.items, [
    { descripcion: 'el empastado', monto: 95 },
    { descripcion: 'el anillado', monto: 15 },
  ])
  check('reglas: y el pago completo es la suma de las dos', dosConPrecio.pedido?.adelanto, { tipo: 'total', monto: 110 })
  check('reglas: un solo precio para dos cosas sigue siendo una línea',
    reglas('ingreso de 60 soles por fotocopias y anillado efectivo').pedido?.items.length, 1)
  const precioRepetido = reglas('mil volantes y quinientas tarjetas para Rosa, 240 los volantes y 150 las tarjetas, adelanto 100 en yape')
  check('reglas: el precio dicho después se junta con su trabajo', precioRepetido.pedido?.items, [
    { descripcion: 'mil volantes', monto: 240 },
    { descripcion: 'quinientas tarjetas para Rosa', monto: 150 },
  ])
  check('reglas: y el adelanto no se cuela como precio de una línea', precioRepetido.pedido?.adelanto, { tipo: 'parcial', monto: 100 })
  check('reglas: una medida no es otro precio', reglas('vendí una gigantografía de 2 por 1 a doña Pilar por 120 soles con plin').pedido?.items[0].monto, 120)
  check('reglas: ni el celular', reglas('cliente Carlos 987 654 321 quinientas tarjetas por 150 soles dejó 50 a cuenta en efectivo').pedido?.items[0].monto, 150)
  check('reglas: ni el precio por unidad', reglas('3 sellos automáticos a 35 soles cada uno cliente Núñez, adelanto 50 soles efectivo').pedido?.items[0].monto, 105)
  check('reglas: «deja 20» es un adelanto', reglas('cien stickers circulares 60 soles deja 20 a nombre de mily').pedido?.adelanto, { tipo: 'parcial', monto: 20 })
  check('reglas: «dejan dos millares» es un encargo, no un adelanto',
    reglas('dejan dos millares de volantes para Rosa, 180 soles').pedido?.adelanto.tipo !== 'parcial', true)
  check('reglas: números en femenino son cantidades', reglas('quinientas tarjetas para la señora Luz por 90 soles en efectivo').pedido?.items[0].monto, 90)
  check('voz: «veinticinco soles»', montoDictado('pagué veinticinco soles de movilidad'), 25)
  check('voz: «dieciocho soles»', montoDictado('gasté dieciocho soles en pasajes'), 18)
  check('reglas: una pregunta es una consulta', reglas('cuánto vendí hoy').intent, 'consulta')
  check('reglas: una muletilla no toca nada', reglas('eh este un momento').intent, 'desconocido')

  // --- dictado: partir la frase en sus trabajos -----------------------------
  const trozosDe = (frase: string) => {
    const s = segmentar(frase)
    return s.varios ? s.lineas.map((l) => l.texto) : null
  }
  const dosPrecios = '500 tarjetas a 85 y mil volantes a 240 para Rosa en yape'
  check('segmentar: dos trabajos con su precio se parten', trozosDe('500 tarjetas a 85 y mil volantes a 240'),
    ['500 tarjetas a 85', 'mil volantes a 240'])
  check('segmentar: un precio para dos cosas no se parte', trozosDe('60 soles por fotocopias y anillado'), null)
  check('segmentar: «cincuenta y dos» no es un corte', trozosDe('volantes por cincuenta y dos soles'), null)
  check('segmentar: un trabajo sin precio no es otra línea', segmentar('mil volantes a 240 y el diseño').varios, false)
  check('segmentar: el adelanto y el pago no son un trabajo',
    segmentar('500 tarjetas a 85 y mil volantes a 240, dejó 100 en efectivo').comun, 'dejó 100 en efectivo')
  check('alinear: empareja por las palabras, no por el orden',
    alinear(['mil volantes', '500 tarjetas'], segmentar(dosPrecios).lineas),
    ['mil volantes a 240 para Rosa en yape', '500 tarjetas a 85'])
  check('alinear: si el intérprete partió de otra forma, no se empareja nada',
    alinear(['todo el pedido'], segmentar(dosPrecios).lineas), [null])

  // --- dictado: el validador ------------------------------------------------
  const extraccion = (over: Partial<Extraccion>): Extraccion => ({
    intent: 'ingreso', pedido: null, proforma: null, abono: null, deuda: null, consulta: null,
    faltantes: [], supuestos: [], ambiguedades: [], origen: 'llm', esquema: 1, ...over,
  })
  const pedidoDictado = (monto: number | null, adelanto: Cobro) => ({
    kind: 'Ingreso' as const, parte: 'Rosa', telefono: null, categoria: 'Ventas' as const, pago: 'Yape/Plin' as const,
    items: [{ descripcion: 'volantes', monto }], adelanto, notas: null, entrega: null as string | null,
  })
  const guardada = (frase: string, ex: Extraccion) => validarExtraccion(ex, frase)
  check('validar: una cantidad no se acepta como precio',
    guardada('mil volantes para Rosa en yape', extraccion({ intent: 'pedido', pedido: pedidoDictado(1000, { tipo: 'credito', monto: 0 }) })).pedido?.items[0].monto, null)
  check('validar: una cifra que nadie dijo se rechaza',
    guardada('mil volantes por 240 soles para Rosa en yape', extraccion({ pedido: pedidoDictado(500, { tipo: 'total', monto: 500 }) })).pedido?.items[0].monto, null)
  check('validar: la cifra dicha se conserva',
    guardada('mil volantes por 240 soles para Rosa en yape', extraccion({ pedido: pedidoDictado(240, { tipo: 'total', monto: 240 }) })).pedido?.items[0].monto, 240)
  check('validar: con dos cifras posibles, que elija la persona',
    guardada('volantes 240 soles, afiches 150 soles, Rosa, yape', extraccion({ pedido: pedidoDictado(390, { tipo: 'total', monto: 390 }) })).ambiguedades,
    [{ campo: 'items.0.monto', opciones: ['150', '240'] }])
  check('validar: precio unitario anunciado admite el producto',
    guardada('vendí 3 banderolas a 70 soles cada una a Rosa en yape', extraccion({ pedido: pedidoDictado(210, { tipo: 'total', monto: 210 }) })).pedido?.items[0].monto, 210)
  check('validar: «la mitad» admite medio precio de adelanto',
    guardada('gigantografía 350 soles para Rosa, adelantó la mitad en yape', extraccion({ intent: 'pedido', pedido: pedidoDictado(350, { tipo: 'parcial', monto: 175 }) })).pedido?.adelanto.monto, 175)
  check('validar: un adelanto mayor que el total no pasa',
    guardada('volantes por 240 soles adelanto 300 soles Rosa yape', extraccion({ intent: 'pedido', pedido: pedidoDictado(240, { tipo: 'parcial', monto: 300 }) })).pedido?.adelanto.monto, null)
  check('validar: el total de una proforma puede ser la suma de precios',
    guardada('cotiza a María 500 tarjetas a 200 y 100 afiches a 150 por 15 días',
      extraccion({ intent: 'proforma', proforma: { cliente: 'María', detalle: 'tarjetas y afiches', total: 350, vigenciaDias: 15 } })).proforma?.total, 350)
  check('validar: un egreso no puede traer kind Ingreso',
    guardada('pagué 80 soles de papel en efectivo', extraccion({ intent: 'egreso', pedido: { ...pedidoDictado(80, { tipo: 'total', monto: 80 }), kind: 'Ingreso' } })).pedido?.kind, null)
  const dosLineasDe = (a: number | null, b: number | null) =>
    extraccion({
      intent: 'ingreso',
      pedido: {
        ...pedidoDictado(null, { tipo: 'total', monto: null }),
        items: [
          { descripcion: '500 tarjetas', monto: a },
          { descripcion: 'mil volantes', monto: b },
        ],
      },
    })
  check('validar: cada precio en su trabajo pasa',
    guardada(dosPrecios, dosLineasDe(85, 240)).pedido?.items.map((i) => i.monto), [85, 240])
  const mezclados = guardada(dosPrecios, dosLineasDe(240, 85))
  check('validar: el precio del otro trabajo no pasa, aunque esté dicho en la frase',
    mezclados.pedido?.items.map((i) => i.monto), [null, null])
  check('validar: y cada línea ofrece las cifras dichas', mezclados.ambiguedades, [
    { campo: 'items.0.monto', opciones: ['85', '240'] },
    { campo: 'items.1.monto', opciones: ['85', '240'] },
  ])
  const intacta = extraccion({ pedido: pedidoDictado(500, { tipo: 'total', monto: 500 }) })
  const antesDeValidar = JSON.stringify(intacta)
  validarExtraccion(intacta, 'volantes por 240 soles')
  check('validar: no modifica lo que recibe', JSON.stringify(intacta), antesDeValidar)

  // --- dictado: la petición al modelo y su respuesta (sin llamarlo) ---------
  const hoyA = construirPeticion('mil volantes por 240 soles', '2026-09-18')
  const hoyB = construirPeticion('pagué la luz 90 soles', '2027-01-01', 'high')
  check('modelo: el sistema no cambia con la frase ni la fecha (caché)', JSON.stringify(hoyA.system), JSON.stringify(hoyB.system))
  check('modelo: el esquema tampoco', JSON.stringify(hoyA.output_config.format), JSON.stringify(hoyB.output_config.format))
  check('modelo: la fecha va en el mensaje, con su día', hoyA.messages[0].content, 'Hoy es 2026-09-18 (viernes).\nDictado: «mil volantes por 240 soles»')
  // Opus 5 no guarda en caché prompts de menos de 512 tokens; ~3 caracteres
  // por token en español deja margen.
  check('modelo: el sistema es cacheable', hoyA.system[0].text.length > 2000, true)
  const texto = (t: string, stop = 'end_turn') => ({ stop_reason: stop, content: [{ type: 'text', text: t }] })
  const valida = JSON.stringify({
    intent: 'abono', pedido: null, proforma: null, abono: { parte: 'María', monto: 50, pago: 'Efectivo' }, deuda: null,
    consulta: null, faltantes: [], supuestos: [], ambiguedades: [],
  })
  check('modelo: una respuesta válida se marca como del modelo', [leerRespuesta(texto(valida))?.origen, leerRespuesta(texto(valida))?.esquema], ['llm', 1])
  check('modelo: un rechazo cae a las reglas', leerRespuesta(texto(valida, 'refusal')), null)
  check('modelo: una respuesta cortada cae a las reglas', leerRespuesta(texto(valida.slice(0, 40), 'max_tokens')), null)
  check('modelo: un JSON roto cae a las reglas', leerRespuesta(texto('{"intent": "abono"')), null)
  check('modelo: una intención desconocida cae a las reglas', leerRespuesta(texto(valida.replace('"abono"', '"venta"'))), null)
  check('modelo: un bloque que no es objeto cae a las reglas', leerRespuesta(texto(valida.replace('"deuda":null', '"deuda":"no sé"'))), null)
  check('modelo: sin las listas del esquema cae a las reglas',
    leerRespuesta(texto('{"intent":"consulta","pedido":null,"proforma":null,"abono":null,"deuda":null,"consulta":{"pregunta":"x"}}')), null)
  check('modelo: un pedido sin líneas cae a las reglas', leerRespuesta(texto(valida.replace('"pedido":null', '"pedido":{"adelanto":{}}'))), null)
  check('modelo: sin bloque de texto cae a las reglas', leerRespuesta({ stop_reason: 'end_turn', content: [] }), null)

  for (const [dichos, correcto] of ERRORES_FRECUENTES) {
    for (const dicho of dichos) check(`prompt: «${dicho}» lo corrigen también las reglas`, normalizarDictado(dicho).toLowerCase().includes(correcto), true)
  }
  const ejemplos = [...PROMPT_SISTEMA.matchAll(/^Dictado: «(.+)»\n(\{.+\})$/gm)]
  check('prompt: tiene ejemplos de las ocho intenciones… al menos siete', new Set(ejemplos.map((m) => JSON.parse(m[2]).intent)).size >= 7, true)
  check('prompt: cada ejemplo tiene la forma del esquema', ejemplos.every((m) => tieneForma(JSON.parse(m[2]))), true)
  const frasesDelCorpus = new Set(
    ['scripts/corpus-dictado.jsonl', 'scripts/corpus-dictado-control.jsonl', 'scripts/corpus-dictado-control-2.jsonl']
      .flatMap((f) => leerCorpus(readFileSync(f, 'utf8')))
      .map((e) => e.frase.toLowerCase()),
  )
  check('prompt: ningún ejemplo sale del corpus (sería enseñar el examen)', ejemplos.filter((m) => frasesDelCorpus.has(m[1].toLowerCase())).map((m) => m[1]), [])

  // --- dictado: la segunda opinión de las reglas ----------------------------
  const delModelo = (monto: number | null, over: Partial<Extraccion> = {}) =>
    extraccion({ intent: 'ingreso', pedido: pedidoDictado(monto, { tipo: 'total', monto }), ...over })
  const deReglas = (monto: number | null, over: Partial<Extraccion> = {}) =>
    extraccion({ intent: 'ingreso', pedido: pedidoDictado(monto, { tipo: 'total', monto }), origen: 'reglas', ...over })
  const discrepan = cruzarConReglas(delModelo(240), deReglas(180))
  check('cruzar: si discrepan, ninguna cifra se afirma', discrepan.pedido?.items[0].monto, null)
  check('cruzar: y se ofrecen las dos, de menor a mayor', discrepan.ambiguedades, [{ campo: 'items.0.monto', opciones: ['180', '240'] }])
  const coinciden = delModelo(240)
  check('cruzar: si coinciden, no se toca nada', cruzarConReglas(coinciden, deReglas(240)), coinciden)
  check('cruzar: si las reglas no vieron cifra, manda el modelo', cruzarConReglas(delModelo(240), deReglas(null)).pedido?.items[0].monto, 240)
  const millares = { campo: 'items.0.monto', opciones: ['180', '360'] }
  const eligio = cruzarConReglas(delModelo(360), deReglas(null, { ambiguedades: [millares] }))
  check('cruzar: si las reglas vieron dos lecturas, el modelo no elige', [eligio.pedido?.items[0].monto, eligio.ambiguedades], [null, [millares]])
  const hueco = cruzarConReglas(delModelo(null, { faltantes: ['items.0.monto'] }), deReglas(null, { ambiguedades: [millares] }))
  check('cruzar: el hueco del modelo recibe las opciones de las reglas', [hueco.ambiguedades, hueco.faltantes], [[millares], []])
  const otraRuta = delModelo(240, { intent: 'abono' })
  check('cruzar: con distinta intención no hay nada que cruzar', cruzarConReglas(otraRuta, deReglas(180)), otraRuta)
  const dosLineas = delModelo(240)
  dosLineas.pedido!.items.push({ descripcion: 'afiches', monto: 150 })
  check('cruzar: una línea contra dos no se compara', cruzarConReglas(dosLineas, deReglas(390)), dosLineas)
  const dosDe = (a: number | null, b: number | null, origen: 'llm' | 'reglas' = 'llm') =>
    extraccion({
      intent: 'ingreso',
      origen,
      pedido: {
        ...pedidoDictado(null, { tipo: 'total', monto: null }),
        items: [
          { descripcion: 'tarjetas', monto: a },
          { descripcion: 'volantes', monto: b },
        ],
      },
    })
  const porLinea = cruzarConReglas(dosDe(85, 240), dosDe(85, 180, 'reglas'))
  check('cruzar: con dos líneas se compara línea por línea',
    porLinea.pedido?.items.map((i) => i.monto), [85, null])
  check('cruzar: y solo la que discrepa ofrece las dos lecturas',
    porLinea.ambiguedades, [{ campo: 'items.1.monto', opciones: ['180', '240'] }])
  const original = delModelo(240)
  const copia = JSON.stringify(original)
  cruzarConReglas(original, deReglas(180))
  check('cruzar: no modifica lo que recibe', JSON.stringify(original), copia)

  // --- dictado: el extractor y sus salidas de emergencia --------------------
  const venta = 'mil volantes por 240 soles para Rosa en yape'
  const responde = (data: unknown, error: unknown = null): Invocar => async () => ({ data, error })
  const origenYAviso = async (invocar: Invocar | null, limite?: number) => {
    const r = await extraerCon(venta, invocar, limite)
    return [r.extraccion.origen, r.aviso]
  }
  check('extraer: sin sesión, reglas y sin aviso', await origenYAviso(null), ['reglas', null])
  check('extraer: si la función falla, reglas y aviso',
    await origenYAviso(responde(null, new Error('500'))), ['reglas', 'El intérprete inteligente no respondió; usé el básico.'])
  check('extraer: si la red se cae, reglas y aviso',
    await origenYAviso(async () => { throw new TypeError('Failed to fetch') }), ['reglas', 'El intérprete inteligente no respondió; usé el básico.'])
  check('extraer: una respuesta sin la forma del esquema no pasa',
    (await extraerCon(venta, responde({ extraccion: { intent: 'ingreso' } }))).extraccion.origen, 'reglas')
  let señal: AbortSignal | null = null
  const colgada: Invocar = (_, signal) => { señal = signal; return new Promise(() => {}) }
  const tarde = await extraerCon(venta, colgada, 30)
  check('extraer: si no contesta a tiempo, reglas y aviso', [tarde.extraccion.origen, tarde.aviso], ['reglas', 'El intérprete inteligente tardó demasiado; usé el básico.'])
  check('extraer: y no se queda esperando', tarde.ms < 1000, true)
  check('extraer: y cancela la petición', (señal as AbortSignal | null)?.aborted, true)
  let pedido: unknown = null
  const bien = await extraerCon(venta, async (cuerpo) => { pedido = cuerpo; return { data: { extraccion: delModelo(240), modelo: 'claude-opus-5' }, error: null } })
  check('extraer: la respuesta del modelo llega al formulario', [bien.extraccion.origen, bien.extraccion.pedido?.items[0].monto, bien.modelo, bien.aviso], ['llm', 240, 'claude-opus-5', null])
  check('extraer: manda la frase y la fecha de Lima', pedido, { texto: venta, hoy: hoyEnLima() })
  check('extraer: lo del modelo también pasa por la guarda',
    (await extraerCon(venta, responde({ extraccion: delModelo(999) }))).extraccion.pedido?.items[0].monto, null)
  check('extraer: a las 22:00 de Lima sigue siendo hoy en Lima', hoyEnLima(new Date('2026-09-19T03:00:00Z')), '2026-09-18')

  // --- dictado: el arreglo escrito (segundo filtro) --------------------------
  const dictadoJulio = 'gigantografía para don julio 250 soles'
  const borradorJulio = extraccion({
    intent: 'pedido',
    pedido: {
      kind: 'Ingreso', parte: 'Julio', telefono: null, categoria: null, pago: null,
      items: [{ descripcion: 'gigantografía', monto: 250 }],
      adelanto: { tipo: null, monto: null }, notas: null, entrega: null,
    },
    faltantes: ['cobro', 'pago'],
  })
  const corregidoJulio = (over: Partial<NonNullable<Extraccion['pedido']>> = {}) =>
    extraccion({
      intent: 'pedido',
      pedido: {
        kind: null, parte: null, telefono: null, categoria: null, pago: 'Yape/Plin',
        items: [{ descripcion: '', monto: 280 }],
        adelanto: { tipo: 'parcial', monto: 100 }, notas: null, entrega: null,
        ...over,
      },
    })
  const fusionJulio = fusionarCorreccion(borradorJulio, corregidoJulio())
  check('arreglo: lo que no nombra se conserva',
    [fusionJulio.extraccion.pedido?.parte, fusionJulio.extraccion.pedido?.kind, fusionJulio.extraccion.pedido?.items[0].descripcion],
    ['Julio', 'Ingreso', 'gigantografía'])
  check('arreglo: lo que nombra manda',
    [fusionJulio.extraccion.pedido?.items[0].monto, fusionJulio.extraccion.pedido?.adelanto, fusionJulio.extraccion.pedido?.pago],
    [280, { tipo: 'parcial', monto: 100 }, 'Yape/Plin'])
  check('arreglo: dice qué cambió', fusionJulio.cambios, ['pago', 'items.0.monto', 'cobro', 'adelanto'])
  check('arreglo: sin líneas devueltas quedan las del borrador',
    fusionarCorreccion(borradorJulio, corregidoJulio({ items: [] })).extraccion.pedido?.items, [{ descripcion: 'gigantografía', monto: 250 }])
  const cambiaDeRuta = extraccion({ intent: 'proforma', proforma: { cliente: 'Julio', detalle: 'gigantografía', total: 250, vigenciaDias: 15 } })
  check('arreglo: si cambia de tipo, manda el bloque nuevo',
    [fusionarCorreccion(borradorJulio, cambiaDeRuta).extraccion.intent, fusionarCorreccion(borradorJulio, cambiaDeRuta).cambios], ['proforma', ['todo']])
  check('arreglo: los problemas van con nombre de campo',
    problemasDe(extraccion({ faltantes: ['pago'], ambiguedades: [{ campo: 'items.0.monto', opciones: ['180', '360'] }] })),
    ['items.0.monto: ¿180 o 360?', 'pago: no se dijo'])

  const pedirArreglo = (invocar: Invocar | null, limite?: number) =>
    corregirCon(borradorJulio, dictadoJulio, 'eran 280 y dejó 100 en yape', invocar, limite)
  const sinInterprete = await pedirArreglo(null)
  check('arreglo: sin intérprete inteligente el borrador no se toca',
    [sinInterprete.extraccion === borradorJulio, sinInterprete.aviso],
    [true, 'Para arreglar por escrito hace falta el intérprete inteligente; corrígelo a mano.'])
  const falla = await pedirArreglo(responde(null, new Error('500')))
  check('arreglo: si el intérprete falla, el borrador no se toca',
    [falla.extraccion === borradorJulio, falla.aviso],
    [true, 'No pude aplicar tu arreglo; corrígelo a mano en el formulario.'])
  const aplicado = await pedirArreglo(responde({ extraccion: corregidoJulio(), modelo: 'claude-opus-5' }))
  check('arreglo: la cifra que escribió la persona cuenta como dicha',
    [aplicado.extraccion.pedido?.items[0].monto, aplicado.extraccion.pedido?.adelanto.monto, aplicado.extraccion.faltantes],
    [280, 100, []])
  const inventado = await pedirArreglo(responde({ extraccion: corregidoJulio({ items: [{ descripcion: 'gigantografía', monto: 999 }] }) }))
  check('arreglo: una cifra que nadie escribió tampoco pasa', inventado.extraccion.pedido?.items[0].monto, null)
  let cuerpoArreglo: unknown = null
  await corregirCon(borradorJulio, dictadoJulio, 'eran 280', async (cuerpo) => {
    cuerpoArreglo = cuerpo
    return { data: { extraccion: corregidoJulio() }, error: null }
  })
  check('arreglo: manda el borrador y lo que la guarda vio mal', [
    (cuerpoArreglo as { texto: string }).texto,
    (cuerpoArreglo as { arreglo: { texto: string } }).arreglo.texto,
    (cuerpoArreglo as { arreglo: { problemas: string[] } }).arreglo.problemas,
  ], [dictadoJulio, 'eran 280', ['cobro: no se dijo', 'pago: no se dijo']])

  // --- dictado: emparejar el nombre con los que ya existen ------------------
  const catalogo = catalogoDePartes([
    { nombre: 'Rosa de la Cruz', fecha: '2026-09-10' },
    { nombre: 'Botica Santa Rosa', fecha: '2026-09-12' },
    { nombre: 'Juan Pérez Quispe', fecha: '2026-09-01' },
    { nombre: 'Cliente Juan Pérez', fecha: '2026-09-15' },
    { nombre: 'Cristina Mamani', fecha: '2026-08-20' },
    { nombre: 'Pollería Don Tito', fecha: '2026-09-02' },
    { nombre: 'rosa de la cruz', fecha: '2026-09-11' },
  ])
  check('partes: sin tratamientos ni tildes', normalizar('la señora María Ñáñez'), 'maria nanez')
  check('partes: una persona, una entrada (la escritura más reciente)',
    catalogo.filter((p) => normalizar(p.nombre) === 'rosa de la cruz').map((p) => p.nombre), ['rosa de la cruz'])
  check('partes: el mismo nombre se reconoce', buscarParte('Rosa de la Cruz', catalogo), { tipo: 'exacta', nombre: 'rosa de la cruz' })
  check('partes: «Rosa» es Rosa de la Cruz, no la Botica Santa Rosa', buscarParte('la señora Rosa', catalogo), { tipo: 'unica', nombre: 'rosa de la cruz' })
  check('partes: con dos Juanes, se pregunta', buscarParte('Juan', catalogo),
    { tipo: 'varias', opciones: ['Cliente Juan Pérez', 'Juan Pérez Quispe'] })
  check('partes: una letra de diferencia solo se sugiere', buscarParte('Cristina Mamany', catalogo),
    { tipo: 'parecida', nombre: 'Cristina Mamani', dicho: 'Cristina Mamany' })
  check('partes: una palabra interna solo se sugiere', buscarParte('don Tito', catalogo).tipo, 'parecida')
  check('partes: alguien que no está es nuevo', buscarParte('Kevin', catalogo), { tipo: 'nueva', nombre: 'Kevin' })
  check('partes: nada dicho, nada inventado', buscarParte('  ', catalogo), { tipo: 'nueva', nombre: '' })

  // --- dictado: de la extracción al formulario ------------------------------
  const pedidoRosa = formularioDePedido(delModelo(240, { intent: 'pedido', pedido: pedidoDictado(240, { tipo: 'parcial', monto: 100 }) }), catalogo)
  check('formulario: el nombre dictado se empareja', pedidoRosa?.parte, 'rosa de la cruz')
  check('formulario: adelanto parcial', pedidoRosa?.cobro, { parcial: true, adelanto: '100' })
  check('formulario: lo dictado queda en ámbar',
    ['tipo', 'parte', 'pago', 'descripcion-0', 'monto-0', 'adelanto', 'cobro'].every((m) => pedidoRosa?.marcas.includes(m)), true)
  const alCreditoF = formularioDePedido(delModelo(300, { intent: 'pedido', pedido: pedidoDictado(300, { tipo: 'credito', monto: 0 }) }), catalogo)
  check('formulario: al crédito es adelanto 0', alCreditoF?.cobro, { parcial: true, adelanto: '0' })
  const sinCobro = formularioDePedido(
    delModelo(240, { intent: 'pedido', pedido: pedidoDictado(240, { tipo: null, monto: null }), faltantes: ['cobro'] }), catalogo)
  check('formulario: sin decir cómo se cobró, no se toca y se avisa', [sinCobro?.cobro, sinCobro?.marcas.includes('cobro'), sinCobro?.faltantes],
    [null, true, ['si pagó todo o dejó un adelanto']])
  const millaresF = formularioDePedido(reglas('dos millares de volantes a 180 para jhonatan en efectivo'), catalogo)
  check('formulario: «2 millares a 180» pregunta el precio', [millaresF?.lineas[0].monto, millaresF?.dudas.map((d) => [d.campo, d.opciones.map((o) => o.valor)])],
    ['', [['items.0.monto', ['180', '360']]]])
  check('formulario: y el tipo supuesto se dice', millaresF?.supuestos, ['si es ingreso o egreso', 'que se pagó todo'])
  const dosJuanes = formularioDePedido(delModelo(240, { pedido: { ...pedidoDictado(240, { tipo: 'total', monto: 240 }), parte: 'Juan' } }), catalogo)
  check('formulario: con dos Juanes, el cliente queda vacío y se pregunta',
    [dosJuanes?.parte, dosJuanes?.dudas[0]?.opciones.map((o) => o.texto)], [null, ['Cliente Juan Pérez', 'Juan Pérez Quispe', 'Juan (nuevo)']])
  const dosLineasF = formularioDePedido(delModelo(240, {
    pedido: { ...pedidoDictado(240, { tipo: 'total', monto: null }), items: [{ descripcion: 'volantes', monto: 240 }, { descripcion: 'afiches', monto: null }] },
    faltantes: ['items.1.monto'],
  }), catalogo)
  check('formulario: varias líneas', dosLineasF?.lineas, [{ descripcion: 'volantes', monto: '240' }, { descripcion: 'afiches', monto: '' }])
  check('formulario: y el hueco dice de qué línea es', dosLineasF?.faltantes, ['el monto del trabajo 2'])
  check('formulario: una proforma no llena el libro', formularioDePedido(extraccion({ intent: 'proforma' }), catalogo), null)

  const proformaF = formularioDeProforma(reglas('cotización para la señora María de mil volantes por 500 soles válida dos semanas'), catalogo)
  check('formulario: proforma', [proformaF?.cliente, proformaF?.total, proformaF?.vigencia], ['María', '500', 15])
  const deudaF = formularioDeDeuda(extraccion({
    intent: 'deuda',
    deuda: { kind: null, parte: 'Juan Pérez Quispe', concepto: 'banner', total: 200, vence: null },
    ambiguedades: [{ campo: 'kind', opciones: ['COBRAR', 'PAGAR'] }],
  }), catalogo)
  check('formulario: deuda sin saber quién debe, se pregunta',
    [deudaF?.tipo, deudaF?.parte, deudaF?.dudas.map((d) => d.opciones.map((o) => o.texto))], [null, 'Juan Pérez Quispe', [['Me deben', 'Debo']]])

  const cuentaViva = (id: string, party: string, balance: number, createdAt = '2026-09-01'): Debt => ({
    id, kind: 'COBRAR', party, concept: 'volantes', total: 300, paid: 300 - balance, balance,
    status: balance > 0 ? 'Parcial' : 'Cancelado', dueDate: null, createdAt, workOrderId: null, clienteId: null,
  })
  const cuentas = [cuentaViva('a', 'Rosa de la Cruz', 150), cuentaViva('b', 'Juan Pérez Quispe', 80), cuentaViva('c', 'Cliente Juan Pérez', 40), cuentaViva('d', 'Kevin Soto', 0), cuentaViva('e', 'Cristina Mamani', 60)]
  const abonoDe = (parte: string | null) => extraccion({ intent: 'abono', abono: { parte, monto: 50, pago: 'Efectivo' } })
  check('abono: una sola cuenta de Rosa, se abre', destinoDelAbono(abonoDe('Rosa'), cuentas), { tipo: 'una', deuda: cuentas[0] })
  check('abono: con dos Juanes, se pregunta', destinoDelAbono(abonoDe('Juan'), cuentas).tipo, 'varias')
  check('abono: una cuenta ya pagada no cuenta', destinoDelAbono(abonoDe('Kevin'), cuentas), { tipo: 'ninguna', parte: 'Kevin' })
  check('abono: un nombre solo parecido no se da por bueno', destinoDelAbono(abonoDe('Cristina Mamany'), cuentas).tipo, 'varias')
  check('abono: sin nombre, se ofrecen las pendientes', destinoDelAbono(abonoDe(null), cuentas).tipo, 'varias')
  const dosEscrituras = [cuentaViva('p1', 'Rosa Pérez', 50, '2026-09-01'), cuentaViva('p2', 'Rosa Perez', 70, '2026-09-10')]
  check('abono: la misma persona escrita de dos formas tiene sus dos cuentas', destinoDelAbono(abonoDe('Rosa Pérez'), dosEscrituras),
    { tipo: 'varias', deudas: [dosEscrituras[1], dosEscrituras[0]] })
  check('abono: monto y método dictados', formularioDeAbono(abonoDe('Rosa')), { monto: '50', pago: 'Efectivo', marcas: ['monto', 'pago'], dudas: [], faltantes: [], supuestos: [] })

  // --- dictado: la puntuación y la puerta -----------------------------------
  const dosTrabajos = { id: 't', frase: 'cobré 95 por el empastado y 15 por el anillado', etiquetas: [],
    esperado: { intent: 'ingreso' as const, pedido: { items: [{ monto: 95 }, { monto: 15 }] } } }
  const unaLinea = extraccion({ pedido: pedidoDictado(95, { tipo: 'total', monto: 95 }) })
  check('puntuar: juntar dos trabajos con un total que no es, es afirmar algo falso',
    puntuarFrase(dosTrabajos, unaLinea).campos.find((c) => c.campo === 'total del pedido')?.veredicto, 'erroneo')
  const juntasBien = extraccion({ pedido: pedidoDictado(110, { tipo: 'total', monto: 110 }) })
  check('puntuar: juntarlos con el total correcto no es un error de dinero (aunque falte partirlos)',
    puntuarFrase(dosTrabajos, juntasBien).campos.find((c) => c.campo === 'total del pedido')?.veredicto, 'acierto')
  const medicion = (over: Partial<ReturnType<typeof resumir>>, caidas = 0) => ({
    resumen: { ...resumir([]), frases: 40, rutaCorrecta: 38, aceptables: 6, afirmacionesFalsas: 4, msP50: 1500, msP95: 3000, ...over }, caidas })
  const deReglasP = medicion({ msP50: 1, msP95: 2 })
  check('puerta: un modelo mejor en todo pasa', puerta(deReglasP, medicion({ aceptables: 20, afirmacionesFalsas: 1, rutaCorrecta: 39 })).every((c) => c.cumple), true)
  check('puerta: si miente más que las reglas, no pasa',
    puerta(deReglasP, medicion({ aceptables: 30, afirmacionesFalsas: 5 })).filter((c) => !c.cumple).map((c) => c.nombre), ['No afirma más cosas falsas que las reglas'])
  check('puerta: si es lento, no pasa', puerta(deReglasP, medicion({ aceptables: 20, msP95: 6500 })).some((c) => !c.cumple), true)
  check('puerta: si cae mucho a las reglas, no pasa', puerta(deReglasP, medicion({ aceptables: 20 }, 3)).some((c) => !c.cumple), true)

  // --- dictado: el corpus ---------------------------------------------------
  // La puerta que impide que las reglas vuelvan a mentir. El número de frases
  // aceptables es un trinquete: se sube cuando mejora, nunca se baja.
  const corpus = leerCorpus(readFileSync('scripts/corpus-dictado.jsonl', 'utf8'))
  const medida = resumir(corpus.map((entrada) => puntuarFrase(entrada, reglas(entrada.frase))))
  check('corpus: las reglas no afirman nada falso', medida.afirmacionesFalsas, 0)
  check('corpus: ninguna cifra fuera de la frase', medida.cifrasFuera, 0)
  check('corpus: nada esperado quedó sin avisar', medida.sinDeclarar, 0)
  check('corpus: frases aceptables no bajan de 82', medida.aceptables >= 82, true)

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
  // La prueba crea su propio escenario en vez de apoyarse en los datos de
  // demostración: si la demo cambia, la prueba no debe romperse.
  const d1Base = await localAdapter.createDebt({
    kind: 'COBRAR',
    party: 'Fixture Constructora',
    concept: 'Saldo pendiente por impresión de planos',
    total: 600,
  })
  await localAdapter.payDebt(d1Base.id, 200, 'Efectivo', 'Test')
  const d1 = (await localAdapter.listDebts()).find((d) => d.id === d1Base.id)!
  check('deuda: total', d1.total, 600)
  check('deuda: abonado', d1.paid, 200)
  check('deuda: saldo', d1.balance, 400)
  check('deuda: estado parcial', d1.status, 'Parcial')

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
  check('pedido: sin indicar origen queda como tecleado', parcial.transaction?.source, 'manual')

  // Un pedido dictado conserva su origen: sin eso no hay forma de medir, con
  // uso real, cuánto hay que corregir lo que rellena el dictado.
  const dictado = await localAdapter.registerWorkOrder({
    kind: 'Ingreso', party: 'Rosa', phone: '', category: 'Ventas', payment: 'Yape/Plin',
    advance: 50, notes: '', author: 'Test', items, source: 'voz',
  })
  check('pedido dictado: el asiento guarda origen voz', dictado.transaction?.source, 'voz')
  const corregido = await localAdapter.updateWorkOrder(dictado.workOrder.id, {
    party: 'Rosa de la Cruz', phone: '', category: 'Ventas', payment: 'Yape/Plin',
    advance: 60, notes: '', items,
  })
  check('pedido dictado: corregirlo no borra el origen', corregido.transaction?.source, 'voz')

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
    items: [{ id: 'i1', position: 1, description: 'Afiches escolares', amount: 450 }],
    estado: 'entregado', entrega: null, estadoAt: '2026-08-22T09:00:00.000Z', clienteId: null, ...over,
  })
  const dbt = (over: Partial<Debt>): Debt => ({
    id: 'd', kind: 'COBRAR', party: 'X', concept: 'c', total: 450, paid: 0, balance: 450,
    status: 'Pendiente', dueDate: null, createdAt: '2026-08-22T09:00:00.000Z',
    workOrderId: null, clienteId: null, ...over,
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
  // Relativo al estado inicial: los datos de demostración traen proformas en
  // varios estados, así que no se puede asumir que todas empiecen vigentes.
  const vigentesAlEmpezar = pfs.filter((p) => p.status === 'Vigente').length
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
    vigentesAlEmpezar - 2,
  )

  // --- corregir cuentas y deshacer abonos -----------------------------------
  const manualBase = await localAdapter.createDebt({
    kind: 'COBRAR',
    party: 'Fixture Constructora',
    concept: 'Saldo pendiente por impresión de planos',
    total: 600,
  })
  await localAdapter.payDebt(manualBase.id, 200, 'Efectivo', 'Test')
  const manual = (await localAdapter.listDebts()).find((d) => d.id === manualBase.id)!
  check('cuenta: creada a mano, sin pedido detrás', manual.workOrderId, null)
  check('cuenta: ya tiene S/200 abonados', manual.paid, 200)

  const corregida2 = await localAdapter.updateDebt(manual.id, {
    party: 'Fixture Constructora S.A.', concept: 'Planos corregidos', total: 700, dueDate: null,
  })
  check('cuenta: cliente corregido', corregida2.party, 'Fixture Constructora S.A.')
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
    status: 'Pendiente', dueDate: null, createdAt: hace(1), workOrderId: null, clienteId: null, ...over,
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

  // --- fechas sin hora --------------------------------------------------------
  // Postgres manda due_date como 'YYYY-MM-DD'. Al restar en crudo, esa fecha se
  // situaba a las 19:00 del día anterior en Lima, así que al anochecer —hora de
  // trabajo en una imprenta— una cuenta que vencía hoy figuraba como vencida.
  const manana8 = new Date(2026, 8, 17, 8, 0)
  const noche20 = new Date(2026, 8, 17, 20, 0)

  check('fechas: vence hoy, por la mañana no ha vencido', diasCalendario('2026-09-17', manana8), 0)
  check('fechas: vence hoy, de noche tampoco', diasCalendario('2026-09-17', noche20), 0)
  check('fechas: ayer cuenta un día', diasCalendario('2026-09-16', noche20), 1)
  check('fechas: mañana va en negativo', diasCalendario('2026-09-18', noche20), -1)
  check('fechas: cuántos días faltan', diasParaVencer('2026-09-20', noche20), 3)
  check('fechas: aguanta el ISO del adaptador local', diasCalendario('2026-09-16T23:30:00.000Z', noche20), 1)
  check('fechas: sin fecha devuelve null, no cero', diasCalendario(null, noche20), null)
  check('fechas: esHoy de noche', esHoy('2026-09-17', noche20), true)

  const venceHoy = buildDebtBriefing(
    [cuenta({ id: 'h', party: 'Vence hoy', createdAt: '2026-09-10', dueDate: '2026-09-17' })],
    noche20,
  )
  check('aviso: al anochecer, la que vence hoy no está vencida', venceHoy.porCobrar[0].diasVencida, 0)
  check('aviso: y por tanto no alarma', venceHoy.porCobrar[0].urgencia, 'reciente')

  // --- trabajos: la fecha de entrega dictada ---------------------------------
  // Hoy es martes 22 de septiembre de 2026.
  const martes = '2026-09-22'
  for (const [frase, esperado] of [
    ['mil volantes para Rosa para el viernes', '2026-09-25'],
    ['lo necesita para mañana', '2026-09-23'],
    ['para pasado mañana sin falta', '2026-09-24'],
    ['es para hoy', '2026-09-22'],
    ['para el martes', '2026-09-29'],
    ['lo recoge el lunes', '2026-09-28'],
    ['para el 25', '2026-09-25'],
    ['para el 5', '2026-10-05'],
    ['entrega el 5 de octubre', '2026-10-05'],
    ['para el 10 de enero', '2027-01-10'],
    ['entrega dentro de 3 días', '2026-09-25'],
    ['para el 31 de septiembre', null],
    ['entrega 20 soles', null],
    ['dejó 30 y el saldo el lunes', null],
    ['para el colegio San Martín', null],
    ['mañana te pago', null],
  ] as const) {
    check(`entrega: «${frase}»`, fechaDeEntrega(frase, martes), esperado)
  }
  check('entrega: una fecha pasada no vale', fechaDeEntregaValida('2026-09-21', martes), false)
  check('entrega: dentro del año sí', fechaDeEntregaValida('2026-12-24', martes), true)
  check('entrega: un texto cualquiera no', fechaDeEntregaValida('mañana', martes), false)
  check('entrega: las reglas la leen', desdeReglas('mil volantes para la señora Rosa por 240 dejó 100 para el viernes', martes).pedido?.entrega, '2026-09-25')
  const conFecha = extraccion({ pedido: { ...pedidoDictado(240, { tipo: 'total', monto: 240 }), entrega: '2026-09-25' } })
  check('entrega: la del modelo sin decirla en la frase no pasa',
    validarExtraccion(conFecha, 'volantes por 240 soles para Rosa en yape', martes).pedido?.entrega, null)
  check('entrega: la del modelo dicha en la frase sí',
    validarExtraccion(conFecha, 'volantes por 240 soles para Rosa en yape, para el viernes', martes).pedido?.entrega, '2026-09-25')
  check('entrega: el formulario la trae marcada',
    [formularioDePedido(conFecha, [])?.entrega, formularioDePedido(conFecha, [])?.marcas.includes('entrega')], ['2026-09-25', true])

  // --- trabajos: el tablero --------------------------------------------------
  const lunesNoche = new Date(2026, 8, 21, 20)
  check('plazo: ayer es atrasado', plazoDe('2026-09-20', lunesNoche), { tipo: 'atrasado', dias: 1 })
  check('plazo: hoy', textoPlazo(plazoDe('2026-09-21', lunesNoche)), 'Para hoy')
  check('plazo: mañana', textoPlazo(plazoDe('2026-09-22', lunesNoche)), 'Para mañana')
  check('plazo: sin fecha', textoPlazo(plazoDe(null, lunesNoche)), 'Sin fecha')
  check('estado: del diseño a esperar la aprobación', siguienteEstado('diseno'), 'aprobacion')
  check('estado: lo entregado no sigue', siguienteEstado('entregado'), null)
  const t = (id: string, estado: WorkOrder['estado'], entrega: string | null, over: Partial<WorkOrder> = {}) =>
    wo({ id, estado, entrega, estadoAt: '2026-09-21T10:00:00.000Z', ...over })
  const tablero = armarTablero(
    [t('a', 'recibido', '2026-09-25'), t('b', 'recibido', '2026-09-19'), t('c', 'recibido', null), t('d', 'listo', '2026-09-21'),
      t('e', 'entregado', null, { createdAt: '2026-09-20T09:00:00.000Z', estadoAt: '2026-09-21T15:00:00.000Z' }),
      t('f', 'entregado', null, { createdAt: '2026-09-21T09:00:00.000Z', estadoAt: '2026-09-21T09:00:00.000Z' })],
    [dbt({ id: 'deuda-a', workOrderId: 'a', balance: 90 })],
    lunesNoche,
  )
  check('tablero: lo atrasado primero, lo sin fecha al final', tablero.columnas.recibido.map((x) => x.pedido.id), ['b', 'a', 'c'])
  check('tablero: cuenta atrasados y para hoy', [tablero.atrasados, tablero.paraHoy], [1, 1])
  check('tablero: el saldo sale de su cuenta', tablero.columnas.recibido.find((x) => x.pedido.id === 'a')?.saldo, 90)
  check('tablero: la venta al instante no cuenta como entregada después', tablero.entregadosRecientes.map((x) => x.pedido.id), ['e'])

  // --- WhatsApp -----------------------------------------------------------
  check('whatsapp: celular con espacios', numeroPeruano('987 654 321'), '51987654321')
  check('whatsapp: con +51', numeroPeruano('+51 987-654-321'), '51987654321')
  check('whatsapp: un fijo no es WhatsApp', numeroPeruano('01 456 7890'), null)
  check('whatsapp: sin número deja elegir el chat', enlaceWhatsApp('', 'hola').startsWith('https://wa.me/?text='), true)
  check('whatsapp: el texto va codificado', enlaceWhatsApp('987654321', 'listo & 50%'), 'https://wa.me/51987654321?text=listo%20%26%2050%25')
  const listo = mensaje.listo(wo({ party: 'Rosa', items: [{ id: 'i', position: 1, description: 'mil volantes', amount: 240 }] }), 140)
  check('whatsapp: «listo» con el saldo', [listo.includes('Rosa'), listo.includes('mil volantes'), listo.includes('140.00')], [true, true, true])
  check('whatsapp: «listo» sin saldo no lo menciona', mensaje.listo(wo({}), 0).includes('saldo'), false)

  // --- trabajos: el flujo en el adaptador local -----------------------------
  const encargo = await localAdapter.registerWorkOrder({
    kind: 'Ingreso', party: 'Taller Prueba', phone: '987654321', category: 'Ventas', payment: 'Efectivo',
    advance: 50, notes: '', author: 'T', items: [{ description: 'mil volantes', amount: 240 }],
    estado: 'recibido', entrega: '2026-09-30',
  })
  check('local: el encargo nace recibido y con fecha', [encargo.workOrder.estado, encargo.workOrder.entrega], ['recibido', '2026-09-30'])
  const ventaAlInstante = await localAdapter.registerWorkOrder({
    kind: 'Ingreso', party: 'Mostrador', phone: '', category: 'Ventas', payment: 'Efectivo',
    advance: 5, notes: '', author: 'T', items: [{ description: 'copias', amount: 5 }],
  })
  check('local: la venta de siempre nace entregada', ventaAlInstante.workOrder.estado, 'entregado')
  await localAdapter.avanzarTrabajo(encargo.workOrder.id, 'listo', 'T')
  await localAdapter.fijarEntrega(encargo.workOrder.id, '2026-10-01')
  const movido = (await localAdapter.listWorkOrders()).find((w) => w.id === encargo.workOrder.id)
  check('local: avanza y cambia de fecha', [movido?.estado, movido?.entrega], ['listo', '2026-10-01'])
  check('local: con su historial', (await localAdapter.listEventosTrabajo(encargo.workOrder.id)).map((e) => e.estado), ['recibido', 'listo'])
  const pfAceptada = await localAdapter.createProforma({ client: 'Cliente Proforma', detail: 'agendas', total: 500, validityDays: 15 })
  const desdePf = await localAdapter.pedidoDesdeProforma(pfAceptada.id, {
    payment: 'Yape/Plin', advance: 200, author: 'T', phone: '', estado: 'recibido', entrega: null,
  })
  check('local: proforma aceptada pasa a pedido con adelanto y saldo',
    [desdePf.workOrder.total, desdePf.transaction?.amount, desdePf.debt?.balance, desdePf.workOrder.estado], [500, 200, 300, 'recibido'])
  const pfDespues = (await localAdapter.listProformas()).find((p) => p.id === pfAceptada.id)
  check('local: la proforma queda convertida y enlazada', [pfDespues?.status, pfDespues?.workOrderId], ['Convertida', desdePf.workOrder.id])
  let dosVeces = ''
  await localAdapter.pedidoDesdeProforma(pfAceptada.id, { payment: 'Efectivo', advance: 0, author: 'T', phone: '', estado: 'recibido', entrega: null })
    .catch((e: Error) => { dosVeces = e.message })
  check('local: no se usa dos veces', /ya se usó/.test(dosVeces), true)

  // --- catálogo: precios por cantidad -----------------------------------------
  const volantes: Producto = { id: 'v', nombre: 'Volantes A5', unidad: 'millar', categoria: 'Ventas', activo: true,
    precios: [{ desde: 5, precio: 150 }, { desde: 1, precio: 180 }, { desde: 10, precio: 130 }] }
  const sellos: Producto = { id: 's', nombre: 'Sellos automáticos', unidad: 'unidad', categoria: 'Ventas', activo: true, precios: [{ desde: 1, precio: 45 }] }
  const lona: Producto = { id: 'l', nombre: 'Banner lona', unidad: 'm2', categoria: 'Ventas', activo: true, precios: [{ desde: 1, precio: 25 }] }
  const catalogoPrueba = [volantes, sellos, lona]
  check('catálogo: 2 millares al precio del primer tramo', [precioPorUnidad(volantes, 2), totalDe(volantes, 2)], [180, 360])
  check('catálogo: desde 5 baja el precio', totalDe(volantes, 5), 750)
  check('catálogo: y desde 10 más', totalDe(volantes, 12), 1560)
  check('catálogo: medio millar paga la tarifa base', totalDe(volantes, 0.5), 90)
  check('catálogo: sin cantidad no hay precio', totalDe(volantes, 0), null)
  check('catálogo: cómo se describe', [describirLinea(volantes, 2), describirLinea(volantes, 1), describirLinea(sellos, 3)],
    ['2 millares de Volantes A5', '1 millar de Volantes A5', '3 Sellos automáticos'])
  const enDictado = (d: string) => {
    const r = productoEnDescripcion(d, catalogoPrueba)
    return r ? [r.producto.id, r.cantidad] : null
  }
  check('catálogo: «2 millares de volantes A5»', enDictado('2 millares de volantes A5'), ['v', 2])
  check('catálogo: «mil volantes a5»', enDictado('mil volantes a5'), ['v', 1])
  check('catálogo: «500 volantes A5» es medio millar', enDictado('500 volantes A5'), ['v', 0.5])
  check('catálogo: «3 sellos automáticos»', enDictado('3 sellos automáticos'), ['s', 3])
  check('catálogo: sin cantidad no se adivina', enDictado('volantes A5'), null)
  check('catálogo: en m² no se adivina la cantidad', enDictado('2 banners lona'), null)
  check('catálogo: un producto que no está', enDictado('mil tarjetas'), null)
  const conCatalogo = formularioDePedido(extraccion({ pedido: { ...pedidoDictado(null, { tipo: 'total', monto: null }), items: [{ descripcion: '2 millares de volantes A5', monto: null }] } }), [], catalogoPrueba)
  check('catálogo: el dictado sin precio sugiere el del catálogo',
    conCatalogo?.dudas.map((d) => [d.campo, d.opciones.map((o) => o.valor)]), [['items.0.monto', ['360']]])
  const millaresConCatalogo = formularioDePedido(reglas('dos millares de volantes A5 a 180 para jhonatan en efectivo'), [], catalogoPrueba)
  check('catálogo: con dos lecturas, el del catálogo es una opción más (sin repetir)',
    millaresConCatalogo?.dudas[0]?.opciones.map((o) => o.valor), ['180', '360'])
  const conPrecioDicho = formularioDePedido(extraccion({ pedido: { ...pedidoDictado(300, { tipo: 'total', monto: 300 }), items: [{ descripcion: '2 millares de volantes A5', monto: 300 }] } }), [], catalogoPrueba)
  check('catálogo: nunca pisa un precio dicho', [conPrecioDicho?.lineas[0].monto, conPrecioDicho?.dudas.length], ['300', 0])

  // --- clientes: se crean y vinculan solos (modo local) -------------------------
  const unaVez = await localAdapter.registerWorkOrder({
    kind: 'Ingreso', party: 'Imprenta Cliente Nuevo', phone: '', category: 'Ventas', payment: 'Efectivo',
    advance: 10, notes: '', author: 'T', items: [{ description: 'copias', amount: 10 }],
  })
  const otraVez = await localAdapter.registerWorkOrder({
    kind: 'Ingreso', party: 'la señora imprenta cliente nuevo', phone: '987 000 111', category: 'Ventas', payment: 'Efectivo',
    advance: 10, notes: '', author: 'T', items: [{ description: 'copias', amount: 10 }],
  })
  const pedidosCliente = (await localAdapter.listWorkOrders()).filter((w) => w.id === unaVez.workOrder.id || w.id === otraVez.workOrder.id)
  check('clientes: la misma persona escrita de dos formas es un solo cliente',
    new Set(pedidosCliente.map((w) => w.clienteId)).size === 1 && pedidosCliente.every((w) => w.clienteId), true)
  const elCliente = (await localAdapter.listClientes()).find((c) => c.id === pedidosCliente[0].clienteId)
  check('clientes: con el primer nombre que se escribió y el teléfono que se dio', [elCliente?.nombre, elCliente?.telefono], ['Imprenta Cliente Nuevo', '987000111'])
  let repetido = ''
  await localAdapter.crearCliente({ nombre: 'IMPRENTA cliente nuevo', telefono: '', documento: '', notas: '', proveedor: false }).catch((e: Error) => { repetido = e.message })
  check('clientes: no se crea dos veces', repetido, 'Ya hay un cliente con ese nombre')
  const clienteCorregido = await localAdapter.actualizarCliente(elCliente!.id, { documento: ' 20123456789 ', telefono: '+51 999-888-777' })
  check('clientes: se corrigen sus datos', [clienteCorregido.documento, clienteCorregido.telefono], ['20123456789', '51999888777'])
  const proveedorDeuda = await localAdapter.createDebt({ kind: 'PAGAR', party: 'Papelera Prueba', concept: 'papel', total: 50 })
  const elProveedor = (await localAdapter.listClientes()).find((c) => c.nombre === 'Papelera Prueba')
  check('clientes: una deuda por pagar crea un proveedor', [elProveedor?.proveedor, Boolean(proveedorDeuda.id)], [true, true])

  // --- catálogo en modo local -------------------------------------------------
  let sinPrecios = ''
  await localAdapter.guardarProducto({ id: null, nombre: 'Nada', unidad: 'unidad', categoria: 'Ventas', activo: true, precios: [] })
    .catch((e: Error) => { sinPrecios = e.message })
  check('catálogo: un producto sin precios no se guarda', sinPrecios, 'El producto necesita al menos un precio')
  const idVolantes = await localAdapter.guardarProducto({ id: null, nombre: 'Volantes A5', unidad: 'millar', categoria: 'Ventas', activo: true,
    precios: [{ desde: 5, precio: 150 }, { desde: 1, precio: 180 }] })
  check('catálogo: se guarda con la escala ordenada', (await localAdapter.listProductos()).find((p) => p.id === idVolantes)?.precios.map((p) => p.desde), [1, 5])
  let productoRepetido = ''
  await localAdapter.guardarProducto({ id: null, nombre: 'volantes a5', unidad: 'millar', categoria: 'Ventas', activo: true, precios: [{ desde: 1, precio: 1 }] })
    .catch((e: Error) => { productoRepetido = e.message })
  check('catálogo: no se repite un nombre', productoRepetido, 'Ya hay un producto con ese nombre')

  // --- caducidad de cotizaciones ---------------------------------------------
  // El estado 'Vigente' no caduca solo: sin esto, una proforma muerta seguía
  // contando como dinero en juego en la tarjeta de Registro y en la barra lateral.
  const proforma = (over: Partial<Proforma>): Proforma => ({
    id: 'p', code: 'PRO-001', client: 'Cliente', detail: 'd', total: 100,
    validityDays: 15, status: 'Vigente', issuedAt: '2026-09-01', transactionId: null, workOrderId: null, clienteId: null, ...over,
  })

  check('proformas: emitida hoy con 15 días le quedan 15', diasParaCaducar('2026-09-17', 15, noche20), 15)
  check('proformas: caduca hoy', diasParaCaducar('2026-09-02', 15, noche20), 0)
  check('proformas: caducó ayer', diasParaCaducar('2026-09-01', 15, noche20), -1)
  check('proformas: la fecha pintada coincide con el cálculo', expiryDate('2026-09-01', 15), '16/9/2026')

  const cotizaciones = buildProformaBriefing(
    [
      proforma({ id: 'viva', issuedAt: '2026-09-15', total: 500 }),
      proforma({ id: 'justa', issuedAt: '2026-09-04', total: 200 }),
      proforma({ id: 'muerta', issuedAt: '2026-08-01', total: 800 }),
      proforma({ id: 'cobrada', issuedAt: '2026-08-01', total: 999, status: 'Convertida' }),
    ],
    noche20,
  )
  check('proformas: la caducada sale de las vivas', cotizaciones.vivas.map((p) => p.id), ['viva', 'justa'])
  check('proformas: y se lista aparte', cotizaciones.caducadas.map((p) => p.id), ['muerta'])
  check('proformas: avisa de la que caduca en 2 días', cotizaciones.porCaducar.map((p) => p.id), ['justa'])
  check('proformas: el monto vivo excluye la muerta', cotizaciones.montoVivas, 700)
  check('proformas: y contabiliza lo que se dejó escapar', cotizaciones.montoCaducadas, 800)
  check('proformas: una convertida ni vive ni caduca', cotizaciones.vivas.concat(cotizaciones.caducadas).some((p) => p.id === 'cobrada'), false)

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
  // ySplit solo existe en las vistas congeladas: el tipo general no lo conoce.
  check('excel: panel congelado bajo la cabecera', (wsMovs.views[0] as { ySplit?: number } | undefined)?.ySplit, 4)
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

  // --- datos de demostración: volumen e invariantes ------------------------
  const fija = new Date('2026-09-17T12:00:00.000Z')
  const demo = generarDemoIntermedio({ hasta: fija })
  const demo2 = generarDemoIntermedio({ hasta: fija })

  check('demo: es determinista', JSON.stringify(demo) === JSON.stringify(demo2), true)
  check('demo: otra semilla da otro negocio',
    JSON.stringify(generarDemoIntermedio({ hasta: fija, semilla: 99 })) === JSON.stringify(demo), false)

  check('demo: hay volumen de pedidos', demo.workOrders.length > 60, true)
  check('demo: hay volumen de asientos', demo.transactions.length > 100, true)
  check('demo: suficientes filas para paginar', demo.transactions.length > 25, true)
  check('demo: hay proformas', demo.proformas.length, 18)
  check('demo: hay cierres de caja', demo.closings.length > 0, true)
  check('demo: hay deudas por pagar', demo.debts.some((d) => d.kind === 'PAGAR'), true)
  check('demo: hay deudas por cobrar', demo.debts.some((d) => d.kind === 'COBRAR'), true)

  // --- las mismas guardas que protege Postgres ---
  check('demo: ningún adelanto supera su total',
    demo.workOrders.every((w) => w.advance <= w.total + 0.001), true)
  check('demo: todo pedido tiene al menos un trabajo',
    demo.workOrders.every((w) => w.items.length >= 1), true)
  check('demo: el total del pedido es la suma de sus trabajos',
    demo.workOrders.every((w) =>
      Math.abs(w.items.reduce((s, i) => s + i.amount, 0) - w.total) < 0.02), true)
  check('demo: ningún importe es cero o negativo',
    demo.transactions.every((t) => t.amount > 0), true)

  // --- coherencia entre pedido, asiento y deuda ---
  const porPedido = new Map(demo.workOrders.map((w) => [w.id, w]))
  check('demo: cada asiento de pedido cuadra con su adelanto',
    demo.transactions
      .filter((t) => t.workOrderId)
      .every((t) => Math.abs((porPedido.get(t.workOrderId!)?.advance ?? -1) - t.amount) < 0.02),
    true)
  check('demo: un pedido pagado entero no deja deuda',
    demo.workOrders
      .filter((w) => Math.abs(w.advance - w.total) < 0.01)
      .every((w) => !demo.debts.some((d) => d.workOrderId === w.id)),
    true)

  // --- los abonos nunca superan el saldo de su cuenta ---
  const abonadoPorDeuda = new Map<string, number>()
  for (const p of demo.payments) {
    abonadoPorDeuda.set(p.debtId, (abonadoPorDeuda.get(p.debtId) ?? 0) + p.amount)
  }
  check('demo: ningún abono supera el saldo de su cuenta',
    demo.debts.every((d) => (abonadoPorDeuda.get(d.id) ?? 0) <= d.total + 0.02), true)
  check('demo: cada abono tiene su asiento',
    demo.payments.every((p) => demo.transactions.some((t) => t.id === p.transactionId)), true)

  // --- los vouchers siguen siendo únicos y correlativos ---
  check('demo: vouchers únicos',
    new Set(demo.transactions.map((t) => t.voucher)).size, demo.transactions.length)
  check('demo: identificadores únicos',
    new Set(demo.transactions.map((t) => t.id)).size, demo.transactions.length)

  // --- los cierres cuadran con el efectivo de su ventana ---
  check('demo: los cierres respetan diferencia = contado − esperado',
    demo.closings.every((c) =>
      Math.abs(c.difference - (c.countedCash - c.expectedCash)) < 0.02), true)
  check('demo: la mayoría de cierres cuadran exactos',
    demo.closings.filter((c) => c.difference === 0).length >= demo.closings.length / 2, true)

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
