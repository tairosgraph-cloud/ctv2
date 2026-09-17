/**
 * Días de calendario entre fechas.
 *
 * Las columnas `date` de Postgres llegan como 'YYYY-MM-DD' y el adaptador local
 * guarda timestamps ISO completos, así que hay que aguantar las dos formas.
 *
 * El motivo de anclar las fechas sin hora al mediodía: `new Date('2026-09-17')`
 * se interpreta como medianoche UTC, que en Lima (UTC-5) son las 19:00 del día
 * anterior. Restando en crudo, a partir de las 19:00 una cuenta que vence hoy
 * se leía como «vencida hace 1 día». El mediodía deja 12 horas de margen a cada
 * lado, suficiente para cualquier zona horaria.
 */

const SOLO_FECHA = /^\d{4}-\d{2}-\d{2}$/

/** Fecha sin hora → mediodía local. Timestamp completo → tal cual. */
export function aFechaLocal(valor: string | null | undefined): Date | null {
  if (!valor) return null

  const solo = SOLO_FECHA.exec(valor.slice(0, 10))
  if (solo && valor.length <= 10) {
    const [anio, mes, dia] = valor.split('-').map(Number)
    return new Date(anio, mes - 1, dia, 12)
  }

  const d = new Date(valor)
  return Number.isNaN(d.getTime()) ? null : d
}

/** Medianoche local del día al que pertenece una fecha. */
function inicioDelDia(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

/**
 * Días de calendario transcurridos desde `valor` hasta `ahora`.
 *
 * Positivo si ya pasó, negativo si está por venir, 0 durante todo el día en
 * curso. Devuelve null si la fecha no es válida, para que quien llama pueda
 * distinguir «no hay fecha» de «vence hoy» — algo que el cálculo anterior
 * confundía devolviendo 0 en ambos casos.
 */
export function diasCalendario(valor: string | null | undefined, ahora: Date): number | null {
  const fecha = aFechaLocal(valor)
  if (!fecha) return null
  return Math.round((inicioDelDia(ahora) - inicioDelDia(fecha)) / 86_400_000)
}

/** Días que faltan para `valor`. Negativo si ya pasó. El espejo del anterior. */
export function diasParaVencer(valor: string | null | undefined, ahora: Date): number | null {
  const dias = diasCalendario(valor, ahora)
  return dias === null ? null : -dias
}

/** true si `valor` cae en el mismo día de calendario que `ahora`. */
export function esHoy(valor: string | null | undefined, ahora: Date): boolean {
  return diasCalendario(valor, ahora) === 0
}
