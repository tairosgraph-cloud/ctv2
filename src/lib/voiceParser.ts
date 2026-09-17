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
  /^(?:volante|afiche|banner|folleto|tarjeta|millar|ciento|unidad|copia|hoja|pliego|sticker|stiker|gigantograf|vinil|talonario|juego|paquete|caja|bolsa|metro|kilo|litro|docena|p[áa]gina|impresion|impresión|d[íi]ptic|tr[íi]ptic|sobre|etiqueta|banderol|polo|taco|block|bloc)/i

/** "el 15 de mayo" es la fecha de entrega, no un importe. */
const FECHA_DESPUES =
  /^\s*de\s+(?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|se[tp]tiembre|octubre|noviembre|diciembre)\b/i

interface Candidato {
  value: number
  /** 3 = pegado a la moneda, 2 = tras palabra de precio, 1 = suelto. */
  peso: number
  descartado: boolean
}

function clasificar(
  lower: string,
  inicio: number,
  fin: number,
  value: number,
  digitos: number,
  /** true cuando el propio texto capturado ya trae el "S/" delante. */
  monedaPegada = false,
) {
  const antes = lower.slice(0, inicio)
  const despues = lower.slice(fin)
  const moneda = monedaPegada || MONEDA_ANTES.test(antes) || MONEDA_DESPUES.test(despues)
  const palabraAntes = antes.match(/(\p{L}+)[\s,]*$/u)?.[1] ?? ''
  const palabraDespues = despues.match(/^\s*(\p{L}+)/u)?.[1] ?? ''

  const peso = moneda ? 3 : PRECIO_ANTES.has(palabraAntes) ? 2 : 1
  // Sin moneda que lo respalde, un número largo es un teléfono o un DNI, y
  // "mil volantes" es una cantidad: ninguno de los dos es el importe.
  const descartado =
    !moneda &&
    (digitos >= 7 || UNIDAD_DESPUES.test(palabraDespues) || FECHA_DESPUES.test(despues))

  return { value, peso, descartado } satisfies Candidato
}

/** Todos los números de la frase —en dígitos y en palabras— ya puntuados. */
function candidatosDeMonto(lower: string): Candidato[] {
  const candidatos: Candidato[] = []

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
  let texto = ''
  const cerrarRacha = () => {
    if (inicio < 0) return
    // "una gigantografía" no es un monto de S/ 1: un "un/una" suelto se ignora.
    const soloUno = /^(?:un|uno|una)$/i.test(texto.trim())
    const value = soloUno ? null : wordsToNumber(texto)
    if (value !== null && value > 0) {
      candidatos.push(clasificar(lower, inicio, fin, value, String(value).length))
    }
    inicio = -1
    texto = ''
  }
  for (const m of lower.matchAll(/\p{L}+/gu)) {
    const palabra = m[0]
    const esNumero = palabra in NUMBER_WORDS
    const esEnlace = palabra === 'y' && inicio >= 0
    if (esNumero || esEnlace) {
      if (inicio < 0) inicio = m.index ?? 0
      fin = (m.index ?? 0) + palabra.length
      texto += ` ${palabra}`
    } else {
      cerrarRacha()
    }
  }
  cerrarRacha()

  return candidatos
}

function deducirMonto(lower: string): number | null {
  const vivos = candidatosDeMonto(lower).filter((c) => !c.descartado)
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
  if (/\b(?:yape|plin)\b/.test(lower)) return 'Yape/Plin'
  if (/\b(?:efectivo|cash|contado)\b/.test(lower)) return 'Efectivo'
  if (/\b(?:transferencia|transferencias|dep[óo]sito|banco|bcp|interbank|bbva)\b/.test(lower)) {
    return 'Transferencia'
  }
  if (/\b(?:visa|mastercard|pos)\b/.test(lower)) return 'Tarjeta'
  if (TARJETA_PAGO.test(lower)) return 'Tarjeta'
  if (TARJETA_MEDIO.test(lower) && !TARJETA_PRODUCTO.test(lower)) return 'Tarjeta'
  return null
}

// --- nombre -----------------------------------------------------------------
// "de" no puede cortar el nombre: media agenda peruana lo lleva dentro
// ("Rosa de la Cruz", "Distribuidora de Tintas"). Se corta en las preposiciones
// que sí abren otro dato, en la puntuación o al llegar a una cifra.
const NOMBRE =
  /\b(?:cliente|clienta|proveedor|proveedora|se[ñn]or(?:a)?|empresa)\s+([^,.;]+?)(?=\s+(?:por|en|con|para|mediante|v[ií]a|via|soles?)\b|\s+(?:s\/|\d)|[,.;]|$)/i

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
 * Interpreta un dictado como "ingreso 500 soles cliente Juan por volantes en Yape"
 * y devuelve los campos que puede rellenar en el formulario. Los campos que no
 * logra deducir vuelven en null a propósito: el formulario los marca para que el
 * usuario los revise en vez de dar por buena una suposición.
 */
export function parseVoiceEntry(raw: string): ParsedEntry {
  const text = raw.trim()
  const lower = text.toLowerCase()

  const isEgreso = EGRESO_HINTS.some((h) => lower.includes(h))
  const isIngreso = INGRESO_HINTS.some((h) => lower.includes(h))
  const type: TxType = isEgreso && !isIngreso ? 'Egreso' : 'Ingreso'

  const amount = deducirMonto(lower)
  const payment = deducirPago(lower)
  const party = deducirNombre(text)

  let category: string | null = null
  for (const [pattern, name] of CATEGORY_HINTS) {
    if (pattern.test(lower)) {
      category = name
      break
    }
  }
  if (!category) category = type === 'Ingreso' ? 'Ventas' : 'Otros'

  // Concepto: lo que sigue a "por" / "concepto de", si existe.
  let concept = text
  const conceptMatch = text.match(/\b(?:por|concepto de)\s+(.+)$/i)
  if (conceptMatch) {
    const trozo = conceptMatch[1]
      .replace(/\s+(?:en|con|mediante|via|vía)\s+(?:yape|plin|efectivo|transferencia|tarjeta).*$/i, '')
      .trim()
    // "por 240 soles" es el precio, no el trabajo: si al quitar el importe no
    // queda nada, el concepto honesto es la frase entera.
    const sinImporte = trozo
      .replace(/^(?:s\/\.?\s*)?[\d.,]+\s*(?:nuevos\s+)?(?:soles?)?\.?$/i, '')
      .trim()
    concept = sinImporte ? trozo : text
  }

  return { type, amount, payment, party, category, concept: concept || text }
}
