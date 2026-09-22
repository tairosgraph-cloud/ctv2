/**
 * El intérprete de reglas con el contrato del dictado.
 *
 * Envuelve a parseVoiceEntry (cuyas aserciones en smoke.ts son la especificación
 * de «no miente») y le añade lo mínimo para hablar el mismo
 * idioma que el modelo: la intención, los faltantes y los supuestos. Es el
 * respaldo cuando no hay modelo —modo local, sin conexión, error— así que su
 * única obligación es no inventar nada, aunque deje muchos campos vacíos.
 */
import {
  categoriaExplicita,
  cifrasDeLaFrase,
  colectivoAmbiguo,
  hayPrecioUnitario,
  parseVoiceEntry,
  tipoExplicito,
} from '@/lib/voiceParser'
import {
  CAMPOS,
  CATEGORIAS,
  montoDeItem,
  type Categoria,
  type Cobro,
  type Extraccion,
  type Intencion,
  type Vigencia,
} from '../../../supabase/functions/_shared/dictado/tipos.ts'
import { normalizarDictado, palabra } from '../../../supabase/functions/_shared/dictado/vocabulario.ts'
import { fechaDeEntrega, hoyEnLima } from '../../../supabase/functions/_shared/dictado/fechas.ts'

const NUMERO = [
  'un|uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|trece|catorce|quince',
  'dieciseis|dieciséis|diecisiete|dieciocho|diecinueve|veinte',
  'veintiuno|veintiún|veintiuna|veintidos|veintidós|veintitres|veintitrés|veinticuatro|veinticinco',
  'veintiseis|veintiséis|veintisiete|veintiocho|veintinueve',
  'treinta|cuarenta|cincuenta|sesenta|setenta|ochenta|noventa|cien|ciento',
  'doscientos|trescientos|cuatrocientos|quinientos|seiscientos|setecientos|ochocientos|novecientos',
  'doscientas|trescientas|cuatrocientas|quinientas|seiscientas|setecientas|ochocientas|novecientas|mil',
].join('|')
/** Las mismas, sin «un/uno/una»: sueltas son artículos («dejó un encargo»). */
const NUMERO_SIN_UNO = NUMERO.split('|')
  .filter((w) => w !== 'un' && w !== 'uno' && w !== 'una')
  .join('|')
/** Una cifra dictada: «150», «1.250,50» o «ciento cincuenta». */
const CIFRA = `\\d+(?:[.,]\\d+)*|(?:${NUMERO})(?:\\s+(?:y\\s+)?(?:${NUMERO}))*`

const PISTA_PROFORMA = palabra('cot[ií]z\\p{L}*|proforma\\p{L}*|presupuest\\p{L}*')
const PISTA_ABONO = palabra(
  'abon\\p{L}*|a\\s+cuenta\\s+de\\s+(?:su|la)\\s+deuda|pag[oó]\\s+(?:su|la|parte\\s+de\\s+su)\\s+deuda|de\\s+lo\\s+que\\s+(?:me\\s+)?deb[ií]a' +
    '|(?:pag[oó]|cancel[oó])\\s+(?:el|su)\\s+saldo',
)
const PISTA_DEUDA_COBRAR = palabra('me\\s+debe|nos\\s+debe|(?:me\\s+)?qued[oó]\\s+debiendo|est[aá]\\s+debiendo')
const PISTA_DEUDA_PAGAR = palabra('le\\s+debo|le\\s+debemos|debo\\s+a|debemos\\s+a|le\\s+qued[eé]\\s+debiendo')
const PISTA_CREDITO = palabra('al\\s+cr[eé]dito|fiad[oa]|sin\\s+adelanto|no\\s+(?:pag[oó]|dej[oó])\\s+nada')
const PISTA_ADELANTO = palabra(
  `adelant\\p{L}*|a\\s+cuenta|saldo|el\\s+resto|dej(?:[oóa]|an|aron)\\s+(?:s\\/\\.?\\s*)?(?:\\d+|${NUMERO_SIN_UNO})`,
)
/** «Adelanto de sueldo» es un gasto de planilla, no el adelanto de un pedido. */
const ADELANTO_DE_SUELDO = palabra('adelanto\\s+de\\s+(?:sueldo|quincena|planilla|pago\\s+al\\s+personal)')
/**
 * La cifra pegada a su palabra: «adelanto de 100», «adelantó 100», «100 a
 * cuenta», «pagó 80 y el resto a la entrega», «dejó 50», «deja 20».
 */
const ADELANTO_CON_CIFRA = new RegExp(
  `(?<![\\p{L}\\d])(?:adelant\\p{L}*|a\\s+cuenta)\\s+(?:de\\s+)?(?:s\\/\\.?\\s*)?(${CIFRA})(?![\\p{L}\\d])` +
    `|(?<![\\p{L}\\d])(${CIFRA})\\s+(?:soles?\\s+)?(?:de\\s+adelanto|a\\s+cuenta)(?![\\p{L}\\d])` +
    `|(?<![\\p{L}\\d])pag[oó]\\s+(?:s\\/\\.?\\s*)?(${CIFRA})\\s+(?:soles?\\s+)?y\\s+el\\s+resto(?![\\p{L}])` +
    `|(?<![\\p{L}\\d])dej(?:[oóa]|an|aron)\\s+(?:s\\/\\.?\\s*)?(${CIFRA})(?![\\p{L}\\d])`,
  'iu',
)
const PREGUNTA = new RegExp(
  `^(?:[¿\\s,]|oye|eh|este|a\\s+ver)*(?:qui[eé]n(?:es)?|cu[aá]nt[oa]s?|cu[aá]l(?:es)?|qu[eé]|c[oó]mo|d[oó]nde)(?![\\p{L}])`,
  'iu',
)
/** Celular peruano: nueve cifras que empiezan por 9, juntas o en grupos. */
const CELULAR = /(?<!\d)9\d{2}[\s-]?\d{3}[\s-]?\d{3}(?!\d)/

const esCategoria = (c: string | null): c is Categoria =>
  c !== null && (CATEGORIAS as readonly string[]).includes(c)

const valorDe = (cifra: string): number | null => cifrasDeLaFrase(cifra)[0]?.valor ?? null

/** «2 por 1», «tres por uno», «40 x 60»: medidas, no precios. */
const MEDIDA = new RegExp(
  `(?<![\\p{L}\\d])(\\d+(?:[.,]\\d+)?|${NUMERO})\\s*(?:x|por)\\s*(\\d+(?:[.,]\\d+)?|${NUMERO})(?![\\p{L}\\d])(?!\\s*(?:soles?|lucas|s\\/))`,
  'giu',
)

/**
 * Los precios que la frase dice además del de la línea. Aparta lo que no es un
 * precio de trabajo: cantidades, medidas, el celular, el adelanto y el precio
 * por unidad del que sale la línea. Si queda alguno, la frase habla de varios
 * trabajos con su precio cada uno («95 por el empastado y 15 por el
 * anillado») y una sola línea no puede llevar solo uno.
 */
function otrosPrecios(texto: string, precio: number, adelanto: number | null): number[] {
  const medidas = new Set<number>()
  for (const m of texto.matchAll(MEDIDA)) {
    for (const lado of [m[1], m[2]]) {
      const v = valorDe(lado) ?? Number(lado.replace(',', '.'))
      if (Number.isFinite(v)) medidas.add(v)
    }
  }
  const celular = new Set((texto.match(CELULAR)?.[0].match(/\d+/g) ?? []).map(Number))
  const unitario = hayPrecioUnitario(texto)
  const otros = new Set<number>()
  for (const c of cifrasDeLaFrase(texto)) {
    if (c.descartada || c.cantidad || c.valor === precio || c.valor === adelanto) continue
    if (medidas.has(c.valor) || celular.has(c.valor)) continue
    // «3 sellos a 35 cada uno»: la línea vale 105 y el 35 es de donde sale.
    if (unitario && (c.palabraAntes === 'a' || Number.isInteger(Math.round((precio / c.valor) * 1000) / 1000))) continue
    otros.add(c.valor)
  }
  return [...otros]
}

/**
 * «dejó 50» es un adelanto; «dejan dos millares de volantes», un encargo: lo
 * que sigue a «deja» tiene que ser dinero, no una cantidad de algo.
 */
const DEJA_ALGO = /(?<![\p{L}\d])dej(?:[oóa]|an|aron)\s+/iu
function hayAdelanto(texto: string): boolean {
  if (!PISTA_ADELANTO.test(texto)) return false
  if (palabra('adelant\\p{L}*|a\\s+cuenta|saldo|el\\s+resto').test(texto)) return true
  const m = DEJA_ALGO.exec(texto)
  if (!m) return true
  // Lo que viene justo detrás: «dos millares de…» cuenta cosas, «50 nomás» es dinero.
  const detras = texto.slice((m.index ?? 0) + m[0].length).split(/\s+/).slice(0, 3).join(' ')
  return !cifrasDeLaFrase(detras).some((c) => c.cantidad)
}

function intencion(texto: string, hayContenido: boolean): Intencion {
  if (texto.includes('?') || PREGUNTA.test(texto)) return 'consulta'
  if (PISTA_PROFORMA.test(texto)) return 'proforma'
  if (PISTA_ABONO.test(texto)) return 'abono'
  if (PISTA_DEUDA_COBRAR.test(texto) || PISTA_DEUDA_PAGAR.test(texto)) return 'deuda'
  if (ADELANTO_DE_SUELDO.test(texto)) return 'egreso'
  if (PISTA_CREDITO.test(texto) || hayAdelanto(texto)) return 'pedido'
  const tipo = tipoExplicito(texto)
  if (tipo === 'Egreso') return 'egreso'
  if (tipo === 'Ingreso' || hayContenido) return 'ingreso'
  return 'desconocido'
}

/** «quince días», «dos semanas», «un mes» → 15 / 15 / 30. */
function vigencia(texto: string): Vigencia | 'otra' | null {
  if (palabra('una\\s+semana|(?:7|siete)\\s+d[ií]as').test(texto)) return 7
  if (palabra('dos\\s+semanas|(?:15|quince)\\s+d[ií]as|quincena').test(texto)) return 15
  if (palabra('un\\s+mes|(?:30|treinta)\\s+d[ií]as').test(texto)) return 30
  if (palabra(`(?:${CIFRA})\\s+d[ií]as`).test(texto)) return 'otra'
  return null
}

function vacia(intent: Intencion): Extraccion {
  return {
    intent,
    pedido: null,
    proforma: null,
    abono: null,
    deuda: null,
    consulta: null,
    faltantes: [],
    supuestos: [],
    ambiguedades: [],
    origen: 'reglas',
    esquema: 1,
  }
}

export function desdeReglas(texto: string, hoy: string = hoyEnLima()): Extraccion {
  const limpio = normalizarDictado(texto)
  const p = parseVoiceEntry(limpio)
  const tipo = tipoExplicito(limpio)
  const categoria = categoriaExplicita(limpio)
  const intent = intencion(limpio, Boolean(p.amount ?? p.party ?? p.payment ?? categoria))
  const r = vacia(intent)
  const falta = (campo: string) => r.faltantes.push(campo)
  // «2 millares a 180»: 180 o 360. Se ofrecen las dos para que elija la persona.
  const dosLecturas = colectivoAmbiguo(limpio)
  const opcionesColectivo = dosLecturas
    ? [dosLecturas.precio, Math.round(dosLecturas.precio * dosLecturas.cantidad * 100) / 100].map(String)
    : null

  switch (intent) {
    case 'consulta':
      r.consulta = { pregunta: limpio }
      return r

    case 'desconocido':
      return r

    case 'proforma': {
      const v = vigencia(limpio)
      r.proforma = {
        cliente: p.party,
        detalle: p.concept,
        total: p.amount,
        vigenciaDias: v === 'otra' ? null : v,
      }
      if (!p.party) falta(CAMPOS.cliente)
      if (opcionesColectivo) r.ambiguedades.push({ campo: CAMPOS.total, opciones: opcionesColectivo })
      else if (p.amount === null) falta(CAMPOS.total)
      if (v === 'otra') {
        // Dijo un plazo que el formulario no admite: que elija la persona.
        r.ambiguedades.push({ campo: CAMPOS.vigencia, opciones: ['7', '15', '30'] })
      } else if (v === null) {
        falta(CAMPOS.vigencia)
      }
      return r
    }

    case 'abono':
      r.abono = { parte: p.party, monto: p.amount, pago: p.payment }
      if (!p.party) falta(CAMPOS.parte)
      if (p.amount === null) falta(CAMPOS.monto)
      if (!p.payment) falta(CAMPOS.pago)
      return r

    case 'deuda':
      r.deuda = {
        kind: PISTA_DEUDA_PAGAR.test(limpio) ? 'PAGAR' : 'COBRAR',
        parte: p.party,
        concepto: p.concept,
        total: p.amount,
        vence: null,
      }
      if (!p.party) falta(CAMPOS.parte)
      if (p.amount === null) falta(CAMPOS.total)
      return r
  }

  // Ingreso, egreso o pedido: todo va al libro.
  let precio = p.amount
  let adelanto: Cobro
  let cobroSupuesto = false

  if (PISTA_CREDITO.test(limpio)) {
    adelanto = { tipo: 'credito', monto: 0 }
  } else if (hayAdelanto(limpio) && !ADELANTO_DE_SUELDO.test(limpio)) {
    const m = limpio.match(ADELANTO_CON_CIFRA)
    const cifra = m ? (m[1] ?? m[2] ?? m[3] ?? m[4]) : undefined
    if (m && cifra) {
      // El precio se busca en el resto de la frase, sin la cifra del adelanto.
      const inicio = m.index ?? 0
      const resto = `${limpio.slice(0, inicio)} ${limpio.slice(inicio + m[0].length)}`
      precio = parseVoiceEntry(resto).amount
      adelanto = { tipo: 'parcial', monto: valorDe(cifra) }
    } else {
      adelanto = { tipo: 'parcial', monto: null }
      // Hay un adelanto sin cifra identificable: si la frase trae más de una
      // cifra, cualquiera de ellas podría ser el adelanto y no el precio.
      const vivas = new Set(cifrasDeLaFrase(limpio).filter((c) => !c.descartada).map((c) => c.valor))
      if (vivas.size > 1) precio = null
    }
  } else {
    adelanto = { tipo: 'total', monto: p.amount }
    // "Cobré", "ingreso", "vendí"… dicen que el dinero entró. Sin esas palabras,
    // que pagó todo es una suposición.
    cobroSupuesto = tipo === null
  }

  // Dos trabajos con su precio cada uno no caben en una línea: quedarse con uno
  // registraría de menos. Se ofrecen los precios dichos y su suma.
  let opcionesVarios: string[] | null = null
  if (precio !== null) {
    const otros = otrosPrecios(limpio, precio, adelanto.tipo === 'parcial' ? adelanto.monto : null)
    if (otros.length) {
      const todos = [precio, ...otros]
      const suma = Math.round(todos.reduce((a, b) => a + b, 0) * 100) / 100
      opcionesVarios = [...new Set([...todos, suma])].sort((a, b) => a - b).map(String)
      precio = null
    }
  }

  const kind = tipo ?? (intent === 'egreso' ? 'Egreso' : 'Ingreso')
  // Con el tipo ya decidido: el vinil que se compra es material, no una venta.
  const categoriaDelRegistro = categoriaExplicita(limpio, kind)
  r.pedido = {
    kind,
    parte: p.party,
    telefono: limpio.match(CELULAR)?.[0].replace(/\D/g, '') ?? null,
    categoria: esCategoria(categoriaDelRegistro) ? categoriaDelRegistro : kind === 'Ingreso' ? 'Ventas' : 'Otros',
    pago: p.payment,
    items: [{ descripcion: p.concept, monto: precio }],
    adelanto: adelanto.tipo === 'total' ? { tipo: 'total', monto: precio } : adelanto,
    notas: null,
    entrega: fechaDeEntrega(limpio, hoy),
  }

  if (!tipo) r.supuestos.push(CAMPOS.kind)
  if (!esCategoria(categoriaDelRegistro)) r.supuestos.push(CAMPOS.categoria)
  if (cobroSupuesto) r.supuestos.push(CAMPOS.cobro)

  if (!p.party) falta(CAMPOS.parte)
  if (opcionesColectivo && precio === null) r.ambiguedades.push({ campo: montoDeItem(0), opciones: opcionesColectivo })
  else if (opcionesVarios) r.ambiguedades.push({ campo: montoDeItem(0), opciones: opcionesVarios })
  else if (precio === null) falta(montoDeItem(0))
  if (!p.payment && adelanto.tipo !== 'credito') falta(CAMPOS.pago)
  if (adelanto.tipo === 'parcial' && adelanto.monto === null) falta(CAMPOS.adelanto)

  return r
}
