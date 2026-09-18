import { parseAmount } from '@/lib/format'
import type { PaymentMethod, TxType } from '@/types'

export interface ParsedEntry {
  type: TxType
  amount: number | null
  payment: PaymentMethod | null
  party: string | null
  category: string | null
  concept: string
}

const NUMBER_WORDS: Record<string, number> = {
  cero: 0, un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5,
  seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12,
  trece: 13, catorce: 14, quince: 15, veinte: 20, treinta: 30, cuarenta: 40,
  cincuenta: 50, sesenta: 60, setenta: 70, ochenta: 80, noventa: 90,
  cien: 100, ciento: 100, doscientos: 200, trescientos: 300,
  cuatrocientos: 400, quinientos: 500, seiscientos: 600, setecientos: 700,
  ochocientos: 800, novecientos: 900, mil: 1000,
}

const EGRESO_HINTS = ['egreso', 'gasto', 'gaste', 'gasté', 'compra', 'compre', 'compré', 'pago de', 'pagué', 'pague', 'salida']
const INGRESO_HINTS = ['ingreso', 'venta', 'vendi', 'vendí', 'cobre', 'cobré', 'cobro', 'entrada', 'me pagaron']

const CATEGORY_HINTS: Array<[RegExp, string]> = [
  [/\b(volante|afiche|banner|folleto|tarjeta|impres|gigantograf|vinil|millar)/i, 'Ventas'],
  [/\b(dise|logo|marca|anillado|empastado|servicio)/i, 'Servicios'],
  [/\b(papel|cartulina|tinta|toner|insumo|material|couche|bond)/i, 'Materiales'],
  [/\b(luz|agua|internet|telefon|recibo)/i, 'Servicios Básicos'],
  [/\b(sueldo|planilla|salario|trabajador)/i, 'Planilla'],
  [/\b(alquiler|renta|local)/i, 'Alquiler'],
]

/** Convierte "quinientos" o "mil doscientos" en 500 / 1200. */
function wordsToNumber(text: string): number | null {
  const tokens = text.split(/\s+/).filter((t) => t in NUMBER_WORDS)
  if (!tokens.length) return null

  let total = 0
  let current = 0
  for (const token of tokens) {
    const value = NUMBER_WORDS[token]
    if (value === 1000) {
      current = (current || 1) * 1000
      total += current
      current = 0
    } else if (value >= 100) {
      current += value
    } else {
      current += value
    }
  }
  const result = total + current
  return result > 0 ? result : null
}

// --- monto ------------------------------------------------------------------
// En mostrador se dictan dos cifras en la misma frase: la cantidad del trabajo
// ("mil volantes") y el precio ("por 240 soles"). Quedarse con la primera mete
// cifras falsas en los libros, así que cada número se puntúa por su contexto y
// sólo gana si no hay empate: ante duda real, null (el usuario lo escribe).

/** "240 soles" / "S/ 240": el número va pegado a la moneda, es el precio. */
const MONEDA_ANTES = /(?:s\/\.?|soles?)\s*$/i
const MONEDA_DESPUES = /^[\s,]*(?:nuevos\s+)?soles?\b/i

/** "por 240", "a 240", "son 240": la palabra previa anuncia un precio. */
const PRECIO_ANTES = new Set([
  'por', 'a', 'son', 'es', 'cuesta', 'cuestan', 'costo', 'costó', 'cobré', 'cobre',
  'vale', 'valen', 'total', 'precio', 'sale', 'salen', 'pagaron', 'pagó', 'pago',
])

/** "mil volantes", "3 millares": el número cuenta unidades, no soles. */
const UNIDAD_DESPUES =
  /^(?:volante|afiche|banner|folleto|tarjeta|millar|ciento|unidad|copia|hoja|pliego|sticker|stiker|gigantograf|vinil|talonario|juego|paquete|caja|bolsa|metro|kilo|litro|docena|p[áa]gina|impresion|impresión|d[íi]ptic|tr[íi]ptic|sobre|etiqueta|banderol|polo|taco|block|bloc|resma|tesis|sello|certificad|taza|carta|invitaci|agenda|calendario|plano|llavero|gorra|rollo|gramo)/i

const PALABRA_NUMERO = Object.keys(NUMBER_WORDS).join('|')
const NUMERO_DICHO = `\\d+(?:[.,]\\d+)?|(?:${PALABRA_NUMERO})(?:\\s+(?:y\\s+)?(?:${PALABRA_NUMERO}))*`

/** Lo que se vende por docenas, cientos o millares: cuántas unidades trae cada uno. */
const COLECTIVOS: Record<string, number> = { docena: 12, ciento: 100, millar: 1000 }
/** «docenas» → «docena», «millares» → «millar», «resmas» → «resma». */
const raizDeUnidad = (palabra: string) => palabra.toLowerCase().replace(/(?:es|s)$/u, '')

/**
 * Un precio que no es el de la línea: «a 70 soles cada una» (de una unidad),
 * «a 30 cada docena», «a 24 la resma». La forma «la/el …» solo cuenta cuando
 * nombra una unidad: «150 el diseño» es el precio del diseño.
 */
const PRECIO_UNITARIO_DICHO = new RegExp(
  `(?<![\\p{L}\\d])(?:s\\/\\.?\\s*)?(${NUMERO_DICHO})\\s*(?:nuevos\\s+)?(?:soles?\\s+)?` +
    `(?:(cada\\s+un[oa]|cada\\s+pieza|c\\/u|por\\s+unidad|la\\s+unidad)|(?:cada|la|el)\\s+(\\p{L}+))(?![\\p{L}])`,
  'giu',
)

interface PrecioUnitario {
  precio: number
  /** La unidad a la que se refiere el precio; null si es la de una sola pieza. */
  porUnidad: string | null
}

function precioUnitarioDicho(lower: string): PrecioUnitario | null {
  for (const m of lower.matchAll(PRECIO_UNITARIO_DICHO)) {
    const precio = candidatosDeMonto(m[1])[0]?.value
    if (!precio) continue
    if (m[2]) return { precio, porUnidad: null }
    const raiz = raizDeUnidad(m[3])
    if (raiz in COLECTIVOS || UNIDAD_DESPUES.test(m[3])) return { precio, porUnidad: raiz }
  }
  return null
}

/** Si la frase dice un precio por unidad: la guarda del validador lo necesita saber. */
export const hayPrecioUnitario = (texto: string) => precioUnitarioDicho(texto.toLowerCase()) !== null

/** "el 15 de mayo" es la fecha de entrega, no un importe. */
const FECHA_DESPUES =
  /^\s*de\s+(?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|se[tp]tiembre|octubre|noviembre|diciembre)\b/i

interface Candidato {
  value: number
  /** 3 = pegado a la moneda, 2 = tras palabra de precio, 1 = suelto. */
  peso: number
  descartado: boolean
  /** Cuenta unidades de un trabajo: «mil volantes», «3 banderolas». */
  unidad: boolean
  /** La palabra que cuenta, si es una cantidad: «banderolas», «docenas». */
  palabraUnidad: string
}

/**
 * Palabras en plural que no son cosas: tras una cifra no la convierten en
 * cantidad («240 los volantes» es un precio).
 */
const NO_SON_COSAS = new Set([
  'pues', 'unos', 'unas', 'ellos', 'ellas', 'después', 'despues', 'antes', 'además', 'ademas',
  'menos', 'entonces', 'todos', 'todas', 'ambos', 'ambas', 'cuantos', 'cuantas', 'varios', 'varias',
  'demás', 'demas', 'mismos', 'mismas', 'otros', 'otras', 'estos', 'estas', 'esos', 'esas',
  'aquellos', 'aquellas', 'nuestros', 'nuestras', 'ustedes', 'nosotros', 'nosotras', 'cuales',
  'mientras', 'nomás', 'nomas', 'soles', 'solos', 'solas',
])

/**
 * «8 planchas», «5 resmas», «15 días»: una cifra seguida de un sustantivo en
 * plural cuenta cosas, no soles. La lista de productos de UNIDAD_DESPUES nunca
 * estará completa; esta regla cubre lo que falte, y cuando se equivoca deja un
 * hueco, no una cifra falsa.
 */
const esPluralDeCosa = (palabra: string) =>
  palabra.length >= 4 && /s$/u.test(palabra) && !NO_SON_COSAS.has(palabra)

function clasificar(
  lower: string,
  inicio: number,
  fin: number,
  value: number,
  digitos: number,
  /** true cuando el propio texto capturado ya trae el "S/" delante. */
  monedaPegada = false,
  /** «un ciento»: la propia cifra ya es un colectivo de unidades. */
  colectivo: string | null = null,
) {
  const antes = lower.slice(0, inicio)
  const despues = lower.slice(fin)
  const moneda = monedaPegada || MONEDA_ANTES.test(antes) || MONEDA_DESPUES.test(despues)
  const palabraAntes = antes.match(/(\p{L}+)[\s,]*$/u)?.[1] ?? ''
  const palabraDespues = despues.match(/^\s*(\p{L}+)/u)?.[1] ?? ''

  const peso = moneda ? 3 : PRECIO_ANTES.has(palabraAntes) ? 2 : 1
  const unidad = !moneda && (colectivo !== null || UNIDAD_DESPUES.test(palabraDespues) || esPluralDeCosa(palabraDespues))
  // Sin moneda que lo respalde, un número largo es un teléfono o un DNI, y
  // "mil volantes" es una cantidad: ninguno de los dos es el importe.
  const descartado = !moneda && (digitos >= 7 || unidad || FECHA_DESPUES.test(despues))
  const palabraUnidad = unidad ? (colectivo ?? palabraDespues) : ''

  return { value, peso, descartado, unidad, palabraUnidad } satisfies Candidato
}

/** Todos los números de la frase —en dígitos y en palabras— ya puntuados. */
function candidatosDeMonto(texto: string): Candidato[] {
  const candidatos: Candidato[] = []
  // «5 mil volantes» son 5000: el reconocedor escribe la cifra y deja «mil» en letra.
  const lower = texto.replace(/(?<![\p{L}\d])(\d+(?:[.,]\d+)?)\s+mil(?![\p{L}])/gu, (_, n: string) =>
    String(Math.round(parseAmount(n) * 1000 * 100) / 100),
  )

  // Se exige que no haya letra pegada para que "A6" o "L200" no sean montos.
  const RE_DIGITOS = /(?<![\p{L}\d])(?:s\/\.?\s*)?(\d+(?:[.,]\d{3})*(?:[.,]\d{1,2})?)(?![\p{L}\d])/gu
  for (const m of lower.matchAll(RE_DIGITOS)) {
    const value = parseAmount(m[1])
    if (value <= 0) continue
    const inicio = m.index ?? 0
    candidatos.push(
      clasificar(
        lower,
        inicio,
        inicio + m[0].length,
        value,
        m[1].replace(/\D/g, '').length,
        m[0].trimStart().toLowerCase().startsWith('s/'),
      ),
    )
  }

  // Números dictados en palabras: "quinientos cincuenta", "mil doscientos".
  let inicio = -1
  let fin = -1
  let racha = ''
  const cerrarRacha = () => {
    if (inicio < 0) return
    const palabras = racha.trim().split(/\s+/).filter((p) => p !== 'y')
    // "un ciento de tarjetas" son cien tarjetas, no 101: "ciento" al final de
    // la racha es el colectivo, porque como número siempre lleva algo detrás
    // ("ciento veinte").
    if (palabras.at(-1) === 'ciento') {
      const cuantos = palabras.length > 1 ? (wordsToNumber(palabras.slice(0, -1).join(' ')) ?? 1) : 1
      candidatos.push(clasificar(lower, inicio, fin, cuantos * 100, 3, false, 'ciento'))
    } else {
      // "una gigantografía" no es un monto de S/ 1: un "un/una" suelto se ignora.
      const soloUno = /^(?:un|uno|una)$/i.test(racha.trim())
      const value = soloUno ? null : wordsToNumber(racha)
      if (value !== null && value > 0) {
        candidatos.push(clasificar(lower, inicio, fin, value, String(value).length))
      }
    }
    inicio = -1
    racha = ''
  }
  for (const m of lower.matchAll(/\p{L}+/gu)) {
    const palabra = m[0]
    const esNumero = palabra in NUMBER_WORDS
    const esEnlace = palabra === 'y' && inicio >= 0
    if (esNumero || esEnlace) {
      if (inicio < 0) inicio = m.index ?? 0
      fin = (m.index ?? 0) + palabra.length
      racha += ` ${palabra}`
    } else {
      cerrarRacha()
    }
  }
  cerrarRacha()

  return candidatos
}

/**
 * Todas las cifras que aparecen en la frase y si su contexto las descarta como
 * importe (teléfono, cantidad de unidades, fecha). Es la base de la guarda que
 * impide que un intérprete ponga en los libros una cifra que nadie dijo.
 */
export function cifrasDeLaFrase(texto: string): Array<{ valor: number; descartada: boolean }> {
  return candidatosDeMonto(texto.toLowerCase()).map((c) => ({
    valor: c.value,
    descartada: c.descartado,
  }))
}

/** «4500 más igv»: ¿se registra 4500 o 5310? La frase no lo dice. */
const MAS_IGV = /(?:m[aá]s|\+)\s*(?:el\s+)?igv(?![\p{L}])/iu

function deducirMonto(lower: string): number | null {
  const candidatos = candidatosDeMonto(lower)
  if (MAS_IGV.test(lower)) return null

  const unitario = precioUnitarioDicho(lower)
  if (unitario) {
    // «3 banderolas a 70 soles cada una»: la línea vale 210. Quedarse con el 70
    // registraría la venta por la tercera parte de lo cobrado. Solo se
    // multiplica si la cantidad es inequívoca; si no, el monto queda en blanco.
    const cantidades = candidatos.filter((c) => c.unidad)
    let cantidad: number | null = null
    if (unitario.porUnidad === null) {
      // Precio de una pieza: «3 docenas de llaveros a 2.50 cada uno» son 36.
      const [unica] = cantidades
      if (cantidades.length === 1) cantidad = unica.value * (COLECTIVOS[raizDeUnidad(unica.palabraUnidad)] ?? 1)
    } else {
      // Precio de la unidad nombrada: «5 resmas a 24 la resma» son 5 resmas.
      const mismas = cantidades.filter((c) => raizDeUnidad(c.palabraUnidad) === unitario.porUnidad)
      if (mismas.length === 1) cantidad = mismas[0].value
    }
    return cantidad === null ? null : Math.round(cantidad * unitario.precio * 100) / 100
  }

  const vivos = candidatos.filter((c) => !c.descartado)
  if (!vivos.length) return null

  const mejor = Math.max(...vivos.map((c) => c.peso))
  const valores = new Set(vivos.filter((c) => c.peso === mejor).map((c) => c.value))
  // Dos precios distintos con el mismo respaldo ("300 soles y 500 soles"):
  // adivinar uno sería inventar un asiento.
  return valores.size === 1 ? [...valores][0] : null
}

// --- método de pago ---------------------------------------------------------
// En una alternancia, \b sólo ata al primer y último término: /\btarjeta|pos\b/
// dejaba que "pos" casara dentro de "tipos" y "visa" dentro de "avisa".

/** "tarjetas de presentación" es un trabajo de imprenta, no una forma de pago. */
const TARJETA_PRODUCTO = /\btarjetas\b|\btarjeta\s+de\s+(?:presentaci|visita|invitaci|navidad|boda)/i
const TARJETA_PAGO = /\btarjeta\s+de\s+(?:cr[ée]dito|d[ée]bito)\b/i
const TARJETA_MEDIO = /\b(?:con|en|v[ií]a|via|mediante)\s+tarjeta\b/i

function deducirPago(lower: string): PaymentMethod | null {
  const metodos = new Set<PaymentMethod>()
  if (/\b(?:yape|plin)\b/.test(lower)) metodos.add('Yape/Plin')
  if (/\b(?:efectivo|cash|contado)\b/.test(lower)) metodos.add('Efectivo')
  if (/\b(?:transferencia|transferencias|dep[óo]sito|banco|bcp|interbank|bbva)\b/.test(lower)) {
    metodos.add('Transferencia')
  }
  if (
    /\b(?:visa|mastercard|pos)\b/.test(lower) ||
    TARJETA_PAGO.test(lower) ||
    (TARJETA_MEDIO.test(lower) && !TARJETA_PRODUCTO.test(lower))
  ) {
    metodos.add('Tarjeta')
  }
  // Dos métodos en la misma frase («la mitad en efectivo y la otra por
  // transferencia»): quedarse con uno sería inventar cómo se pagó.
  return metodos.size === 1 ? [...metodos][0] : null
}

// --- nombre -----------------------------------------------------------------
// "de" no puede cortar el nombre: media agenda peruana lo lleva dentro
// ("Rosa de la Cruz", "Distribuidora de Tintas"). Se corta en lo que abre otro
// dato: una preposición, la puntuación, una cifra, el método de pago dicho sin
// preposición ("cliente Mario yape"), lo que hizo la persona ("María abonó",
// "Beto me debe"), cómo se cobró ("Rosa al crédito") o un "de" que abre una
// cantidad ("señora María de mil volantes").
const FIN_DE_NOMBRE = [
  'por', 'en', 'con', 'para', 'mediante', 'v[ií]a', 'via', 'soles?',
  'yape', 'plin', 'efectivo', 'transferencias?', 'dep[oó]sito', 'bcp', 'interbank', 'bbva',
  'tarjeta', 'visa', 'mastercard', 'contado',
  'me', 'le', 'nos', 'les', 'pag[oó]', 'pagaron', 'abon[oó]', 'abonaron', 'dej[oó]', 'dejaron',
  'debe', 'deb[ií]a', 'cancel[oó]', 'adelant[oó]', 'qued[oó]',
  'al\\s+cr[eé]dito', 'fiad[oa]', 'sin\\s+adelanto', 'a\\s+cuenta',
  `de\\s+(?:\\d+|${PALABRA_NUMERO})`,
].join('|')

// Sin \b: solo conoce letras ASCII, y con él "pagó" no cortaría (la «ó» no
// cuenta como letra). Los límites se escriben con \p{L}.
const NOMBRE = new RegExp(
  `(?<![\\p{L}])(?:cliente|clienta|proveedor|proveedora|se[ñn]or(?:a)?|empresa)(?:\\s*:\\s*|\\s+)([^,.;:]+?)` +
    `(?=\\s+(?:${FIN_DE_NOMBRE})(?![\\p{L}\\d])|\\s+(?:s\\/|\\d)|[,.;:]|$)`,
  'iu',
)

// --- concepto ---------------------------------------------------------------
// "por" abre el trabajo en "ingreso 500 soles por volantes", pero en "mil
// volantes por 240 soles" abre el precio, en "por transferencia" el método, en
// "3 por 2" una medida y en "por un mes" la vigencia. El concepto es lo que
// sigue al primer "por" que no abre ninguna de esas cosas; si no lo hay, lo
// que se dijo antes, sin el verbo de la operación.

const METODO_AL_INICIO = /^(?:yape|plin|efectivo|transferencias?|dep[oó]sito|tarjeta|visa)(?![\p{L}])/iu
const VIGENCIA_AL_INICIO = /^(?:un\s+mes|una\s+semana|dos\s+semanas|\d+\s+d[ií]as)(?![\p{L}])/iu
const COLA_DE_PAGO = /\s+(?:en|con|mediante|via|vía)\s+(?:yape|plin|efectivo|transferencia|tarjeta).*$/iu
/** El verbo de la operación y el relleno de quien habla: no son el trabajo. */
const VERBO_INICIAL =
  /^(?:(?:ingreso|egreso|venta|vend[ií]|cobr[eé]|cobro|compr[eé]|compra|pagu[eé]|gast[eé]|gasto|salida|pedido|orden\s+de\s+trabajo|encargo|encargu[eé]|cotizaci[oó]n|cot[ií]za(?:me|le)?|proforma|presupuesto|hazme|me\s+pagaron|anota|necesito|son|tambi[eé]n|incluye|adem[aá]s|m[aá]s|todo|y|una?|de|del|el|la|los|las)\s+)+/iu
const IMPORTE_INICIAL = /^(?:s\/\.?\s*)?\d[\d.,]*\s*(?:nuevos\s+)?soles?(?:\s+(?:de\s+|del\s+|en\s+)?|$)/iu
const IMPORTE_FINAL = /\s+(?:s\/\.?\s*)?\d[\d.,]*\s*(?:nuevos\s+)?soles?$/iu
const FORMA_DE_COBRO = /\s+(?:al\s+cr[eé]dito|fiad[oa]|sin\s+adelanto)(?![\p{L}])/giu
/** Comas, dos puntos y puntos de fin de frase separan datos distintos. */
const PARTIR_TRAMOS = /\s*(?:[,;:]|\.(?=\s|$))\s*/u
/** Lo que nombra un trabajo o un gasto: sirve para elegir el tramo que lo describe. */
const PALABRA_DE_TRABAJO =
  /(?<![\p{L}])(?:volante|afiche|banner|folleto|tarjeta|impres|gigantograf|vinil|millar|dise[ñn]o|logo|anillado|empastado|sticker|talonario|sello|certificad|taza|carta|invitaci|agenda|calendario|plano|llavero|gorra|polo|banderol|tr[ií]ptic|d[ií]ptic|etiqueta|bolsa|fotocopia|copia|papel|cartulina|tinta|t[oó]ner|lona|resma|plancha|mantenimiento|alquiler|luz|agua|internet|sueldo|movilidad|pasaje)/iu

const NUMEROS_SIN_UNO = Object.keys(NUMBER_WORDS)
  .filter((w) => w !== 'un' && w !== 'uno' && w !== 'una')
  .join('|')
/** Una cifra al empezar: «240», «ciento cincuenta». «Un/una» sueltos son artículos. */
const CIFRA_AL_INICIO = new RegExp(
  `^(?:s\\/\\.?\\s*)?(?:\\d+(?:[.,]\\d+)?|(?:${NUMEROS_SIN_UNO})(?:\\s+(?:y\\s+)?(?:${PALABRA_NUMERO}))*)(?![\\p{L}\\d])`,
  'iu',
)
const CIFRA_AL_FINAL = new RegExp(`(?:\\d|(?<![\\p{L}])(?:${NUMEROS_SIN_UNO}))\\s*$`, 'iu')
const CIFRA_SIN_UNO_AL_INICIO = new RegExp(`^(?:\\d+(?:[.,]\\d+)?|(?:${NUMEROS_SIN_UNO})(?![\\p{L}]))`, 'iu')

/**
 * "4 por 2 metros": el "por" de una medida va entre dos cifras. Pero "cobré 350
 * por 2 gigantografías" también, y ahí abre el trabajo: es medida solo si lo
 * que sigue a la segunda cifra no es un producto (metros y centímetros sí).
 */
function esMedida(antes: string, despues: string): boolean {
  if (!CIFRA_AL_FINAL.test(antes)) return false
  const cifra = despues.match(CIFRA_SIN_UNO_AL_INICIO)
  if (!cifra) return false
  const siguiente = despues.slice(cifra[0].length).match(/^\s*(\p{L}+)/u)?.[1] ?? ''
  return /^(?:m|cm|mts?|metros?)$/iu.test(siguiente) || !UNIDAD_DESPUES.test(siguiente)
}

function abreOtroDato(trozo: string): boolean {
  if (METODO_AL_INICIO.test(trozo) || VIGENCIA_AL_INICIO.test(trozo)) return true
  const cifra = trozo.match(CIFRA_AL_INICIO)
  if (!cifra) return false
  // "por mil volantes" sí es el trabajo: esa cifra cuenta unidades.
  const siguiente = trozo.slice(cifra[0].length).match(/^\s*(\p{L}+)/u)?.[1] ?? ''
  return !UNIDAD_DESPUES.test(siguiente)
}

const limpiarTramo = (tramo: string) =>
  tramo
    .trim()
    .replace(VERBO_INICIAL, '')
    .replace(IMPORTE_INICIAL, '')
    .replace(IMPORTE_FINAL, '')
    .replace(FORMA_DE_COBRO, '')
    .replace(COLA_DE_PAGO, '')
    .trim()

function deducirConcepto(text: string): string {
  // Quien encarga no es el trabajo: "para el cliente Rosa" sale del concepto.
  const nombre = text.match(NOMBRE)
  const inicio = nombre?.index ?? 0
  const sinParte = nombre
    ? `${text.slice(0, inicio).replace(/(?:^|\s+)(?:para|a|al|de)(?:\s+(?:el|la))?\s*$/iu, '')} ${text.slice(inicio + nombre[0].length)}`
    : text

  let primerPor = -1
  for (const m of sinParte.matchAll(/(?<![\p{L}])(?:por\s+|concepto\s*(?:de\s+|:\s*))/giu)) {
    const posicion = m.index ?? 0
    const despues = sinParte.slice(posicion + m[0].length)
    const esPor = /^por/i.test(m[0])
    if (esPor && primerPor < 0) primerPor = posicion
    if (esPor && esMedida(sinParte.slice(0, posicion), despues)) continue
    const trozo = despues.replace(COLA_DE_PAGO, '').split(PARTIR_TRAMOS)[0].replace(/\s+/g, ' ').trim()
    if (trozo && !abreOtroDato(trozo)) return trozo
  }

  // Ningún "por" abre el trabajo: vale lo dicho antes, y de ello los tramos que
  // nombran un trabajo ("proforma para X: 10 gigantografías…", "son mil
  // volantes, también incluye el diseño").
  const antes = primerPor > 0 ? sinParte.slice(0, primerPor) : sinParte
  const tramos = antes.split(PARTIR_TRAMOS).map(limpiarTramo).filter(Boolean)
  const deTrabajo = tramos.filter((t) => PALABRA_DE_TRABAJO.test(t))
  return ((deTrabajo.length ? deTrabajo.join(' + ') : tramos[0]) || text).replace(/\s+/g, ' ')
}

function deducirNombre(text: string): string | null {
  const match = text.match(NOMBRE)
  if (!match) return null
  const nombre = match[1]
    .trim()
    // "proveedor de Tintas Perú": el conector no forma parte del nombre.
    .replace(/^(?:de|del|la|el|los|las)\s+/i, '')
    // Si el corte cayó justo tras el conector, no lo dejamos colgando.
    .replace(/\s+(?:de|del|y)$/i, '')
    .trim()
  return nombre || null
}

/**
 * Ingreso o Egreso sólo si la frase lo dice sin contradecirse; null si no trae
 * pistas o trae de los dos tipos. Quien necesite un valor decide el defecto, y
 * así puede declararlo como suposición.
 */
export function tipoExplicito(texto: string): TxType | null {
  const lower = texto.toLowerCase()
  const isEgreso = EGRESO_HINTS.some((h) => lower.includes(h))
  const isIngreso = INGRESO_HINTS.some((h) => lower.includes(h))
  if (isEgreso && !isIngreso) return 'Egreso'
  if (isIngreso && !isEgreso) return 'Ingreso'
  return null
}

/**
 * La categoría que nombra la frase, o null si no nombra ninguna.
 *
 * Las palabras del oficio (vinil, banner, volantes) dicen «venta» cuando entra
 * dinero y «material comprado» cuando sale. Y la tarjeta con la que se paga
 * no es una tarjeta de presentación.
 */
export function categoriaExplicita(texto: string, tipo: TxType | null = null): string | null {
  let lower = texto.toLowerCase()
  if (!TARJETA_PRODUCTO.test(lower)) lower = lower.replace(TARJETA_PAGO, ' ').replace(TARJETA_MEDIO, ' ')
  for (const [pattern, name] of CATEGORY_HINTS) {
    if (pattern.test(lower)) return name === 'Ventas' && tipo === 'Egreso' ? 'Materiales' : name
  }
  return null
}

/**
 * Interpreta un dictado como "ingreso 500 soles cliente Juan por volantes en Yape"
 * y devuelve los campos que puede rellenar en el formulario. Los campos que no
 * logra deducir vuelven en null a propósito: el formulario los marca para que el
 * usuario los revise en vez de dar por buena una suposición.
 */
export function parseVoiceEntry(raw: string): ParsedEntry {
  const text = raw.trim()
  const lower = text.toLowerCase()

  const type: TxType = tipoExplicito(text) ?? 'Ingreso'

  const amount = deducirMonto(lower)
  const payment = deducirPago(lower)
  const party = deducirNombre(text)

  const category = categoriaExplicita(text, type) ?? (type === 'Ingreso' ? 'Ventas' : 'Otros')

  return { type, amount, payment, party, category, concept: deducirConcepto(text) }
}
