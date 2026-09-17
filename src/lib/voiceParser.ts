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

/**
 * Interpreta un dictado como "ingreso 500 soles cliente Juan por volantes en Yape"
 * y devuelve los campos que puede rellenar en el formulario.
 */
export function parseVoiceEntry(raw: string): ParsedEntry {
  const text = raw.trim()
  const lower = text.toLowerCase()

  const isEgreso = EGRESO_HINTS.some((h) => lower.includes(h))
  const isIngreso = INGRESO_HINTS.some((h) => lower.includes(h))
  const type: TxType = isEgreso && !isIngreso ? 'Egreso' : 'Ingreso'

  // Monto: primero digitos ("500", "1,250.50"), luego numeros en palabras.
  let amount: number | null = null
  const digits = lower.match(/(\d+(?:[.,]\d{3})*(?:[.,]\d{1,2})?)/)
  if (digits) {
    const parsed = parseAmount(digits[1])
    if (parsed > 0) amount = parsed
  }
  if (amount === null) amount = wordsToNumber(lower)

  let payment: PaymentMethod | null = null
  if (/\b(yape|plin)\b/.test(lower)) payment = 'Yape/Plin'
  else if (/\befectivo|cash|contado\b/.test(lower)) payment = 'Efectivo'
  else if (/\btransferencia|banco|bcp|interbank|bbva\b/.test(lower)) payment = 'Transferencia'
  else if (/\btarjeta|visa|mastercard|pos\b/.test(lower)) payment = 'Tarjeta'

  // Nombre tras "cliente" / "proveedor" / "señor": hasta la siguiente palabra clave.
  let party: string | null = null
  const partyMatch = text.match(
    /\b(?:cliente|clienta|proveedor|proveedora|se[ñn]or(?:a)?|empresa)\s+([^,.]+?)(?=\s+(?:por|de|en|con|para|mediante|via|vía)\b|[,.]|$)/i,
  )
  if (partyMatch) party = partyMatch[1].trim()

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
    concept = conceptMatch[1]
      .replace(/\s+(?:en|con|mediante|via|vía)\s+(?:yape|plin|efectivo|transferencia|tarjeta).*$/i, '')
      .trim()
  }

  return { type, amount, payment, party, category, concept: concept || text }
}
