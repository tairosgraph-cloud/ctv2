import { fechaDeCaducidad } from '@/lib/proformas'

const soles = new Intl.NumberFormat('es-PE', {
  style: 'currency',
  currency: 'PEN',
  minimumFractionDigits: 2,
})

/** "S/ 1,234.50" */
export function money(value: number): string {
  return soles.format(value ?? 0).replace(/ /g, ' ')
}

/** Igual que money() pero con signo explicito: "+ S/ 500.00" / "- S/ 350.00" */
export function signedMoney(value: number, type: 'Ingreso' | 'Egreso'): string {
  return `${type === 'Ingreso' ? '+' : '-'} ${money(Math.abs(value))}`
}

const timeFmt = new Intl.DateTimeFormat('es-PE', { hour: '2-digit', minute: '2-digit' })
const dateFmt = new Intl.DateTimeFormat('es-PE', { day: '2-digit', month: 'short' })
const longFmt = new Intl.DateTimeFormat('es-PE', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
})

function isToday(d: Date): boolean {
  const now = new Date()
  return (
    d.getDate() === now.getDate() &&
    d.getMonth() === now.getMonth() &&
    d.getFullYear() === now.getFullYear()
  )
}

/** "Hoy 09:15" o "12 ago 09:15" */
export function shortDateTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return isToday(d) ? `Hoy ${timeFmt.format(d)}` : `${dateFmt.format(d)} ${timeFmt.format(d)}`
}

/** "sábado, 22 de agosto" — capitalizado */
export function todayLong(): string {
  const s = longFmt.format(new Date())
  return s.charAt(0).toUpperCase() + s.slice(1)
}

export function isoDate(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('es-PE')
}

/**
 * Fecha de caducidad de una cotización, legible.
 *
 * El cálculo vive en lib/proformas para que la fecha que se pinta y la que
 * decide si está caducada salgan siempre del mismo sitio.
 */
export function expiryDate(issuedAt: string, days: number): string {
  const vence = fechaDeCaducidad(issuedAt, days)
  return vence ? vence.toLocaleDateString('es-PE') : '—'
}

/**
 * Interpreta montos escritos a mano en formato peruano o anglosajon:
 * "1.234,50" y "1,234.50" dan 1234.50; "1.500" da 1500 (separador de miles).
 * Devuelve 0 si no hay un importe positivo valido.
 */
export function parseAmount(raw: string): number {
  if (!raw) return 0

  let s = raw.replace(/[^\d.,-]/g, '')
  if (!s) return 0

  const lastComma = s.lastIndexOf(',')
  const lastDot = s.lastIndexOf('.')

  let decimalSep = ''
  if (lastComma !== -1 && lastDot !== -1) {
    // El separador decimal es el que aparece mas a la derecha.
    decimalSep = lastComma > lastDot ? ',' : '.'
  } else if (lastComma !== -1) {
    decimalSep = /,\d{1,2}$/.test(s) ? ',' : ''
  } else if (lastDot !== -1) {
    // Un grupo final de 3 digitos es separador de miles, no decimales.
    decimalSep = /\.\d{3}$/.test(s) ? '' : '.'
  }

  if (decimalSep) {
    const index = s.lastIndexOf(decimalSep)
    const integer = s.slice(0, index).replace(/[.,]/g, '')
    const decimals = s.slice(index + 1).replace(/[.,]/g, '')
    s = `${integer}.${decimals}`
  } else {
    s = s.replace(/[.,]/g, '')
  }

  const value = Number.parseFloat(s)
  return Number.isFinite(value) && value > 0 ? Math.round(value * 100) / 100 : 0
}

/** Sello de tiempo apto para nombres de archivo: 2026-08-29_1435 */
export function fileStamp(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}`
}
