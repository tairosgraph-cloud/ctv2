/**
 * Caducidad de las cotizaciones.
 *
 * Una proforma nace con un plazo (`validityDays`) y nadie la cierra cuando ese
 * plazo se acaba: el estado sigue siendo 'Vigente' para siempre. Hasta ahora la
 * fecha de caducidad solo se pintaba en la tabla, sin compararla nunca con hoy,
 * así que una cotización podía llevar meses muerta contando como dinero vivo.
 */
import { aFechaLocal, diasCalendario } from '@/lib/fechas'
import type { Proforma } from '@/types'

/** A cuántos días de caducar una cotización ya pide que la persigan. */
export const DIAS_AVISO_CADUCIDAD = 3

/** El día en que la cotización deja de valer. */
export function fechaDeCaducidad(issuedAt: string, validityDays: number): Date | null {
  const emitida = aFechaLocal(issuedAt)
  if (!emitida) return null
  const vence = new Date(emitida)
  vence.setDate(vence.getDate() + validityDays)
  return vence
}

/**
 * Días que le quedan a la cotización: 0 el día en que caduca, negativo si ya
 * pasó. null si la fecha de emisión no es legible.
 */
export function diasParaCaducar(
  issuedAt: string,
  validityDays: number,
  ahora: Date,
): number | null {
  const vence = fechaDeCaducidad(issuedAt, validityDays)
  if (!vence) return null
  const transcurridos = diasCalendario(vence.toISOString(), ahora)
  return transcurridos === null ? null : -transcurridos
}

/** Vigente en el papel pero fuera de plazo. */
export function estaCaducada(p: Proforma, ahora: Date): boolean {
  if (p.status !== 'Vigente') return false
  const dias = diasParaCaducar(p.issuedAt, p.validityDays, ahora)
  return dias !== null && dias < 0
}

export interface ProformaBriefing {
  /** Vigentes y todavía en plazo: el dinero que de verdad sigue en juego. */
  vivas: Proforma[]
  /** En plazo pero a punto de caducar. Las únicas que aún se pueden salvar. */
  porCaducar: Proforma[]
  /** Vigentes en el papel, muertas en la práctica. */
  caducadas: Proforma[]
  montoVivas: number
  montoCaducadas: number
}

const sumar = (list: Proforma[]) =>
  Math.round(list.reduce((total, p) => total + p.total, 0) * 100) / 100

export function buildProformaBriefing(proformas: Proforma[], ahora = new Date()): ProformaBriefing {
  const vivas: Proforma[] = []
  const caducadas: Proforma[] = []
  const porCaducar: Array<{ p: Proforma; dias: number }> = []

  for (const p of proformas) {
    if (p.status !== 'Vigente') continue

    const dias = diasParaCaducar(p.issuedAt, p.validityDays, ahora)
    if (dias === null) {
      vivas.push(p)
      continue
    }

    if (dias < 0) {
      caducadas.push(p)
      continue
    }

    vivas.push(p)
    if (dias <= DIAS_AVISO_CADUCIDAD) porCaducar.push({ p, dias })
  }

  // Lo que antes caduca, primero; a igualdad, lo que más dinero mueve.
  porCaducar.sort((a, b) => a.dias - b.dias || b.p.total - a.p.total)
  // Entre las muertas manda el importe: es lo que se dejó de cobrar.
  caducadas.sort((a, b) => b.total - a.total)

  return {
    vivas,
    porCaducar: porCaducar.map((x) => x.p),
    caducadas,
    montoVivas: sumar(vivas),
    montoCaducadas: sumar(caducadas),
  }
}
