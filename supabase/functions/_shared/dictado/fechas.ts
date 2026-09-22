/**
 * Fechas dichas en el mostrador: «para el viernes», «para mañana», «para el
 * 25», «recoge el lunes», «entrega dentro de 3 días».
 *
 * Solo cuenta si la frase dice que es la entrega (para, entrega, recoge,
 * listo…): «entrega 20» son soles y «el saldo el lunes» es cuándo paga, no
 * cuándo se lleva el trabajo. Sin esa señal, null: una fecha inventada acaba
 * en el tablero como un compromiso que nadie hizo.
 *
 * Puro y sin zona horaria: `hoy` llega como 'AAAA-MM-DD' (el de Lima) y todo
 * se cuenta en días de calendario.
 */

/** Hoy en Lima, que es donde se dicta: «vence el 30» se cuenta desde aquí. */
export const hoyEnLima = (ahora = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima' }).format(ahora)

const DIAS_SEMANA: Record<string, number> = {
  domingo: 0, lunes: 1, martes: 2, miercoles: 3, jueves: 4, viernes: 5, sabado: 6,
}
const MESES: Record<string, number> = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8,
  setiembre: 9, septiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
}
const CUANTOS: Record<string, number> = { un: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, diez: 10, quince: 15 }

/** Lo que dice que la fecha es la de entrega. */
const PISTA =
  '(?:para|entrega|entregar(?:lo|la|los|las)?|recoge|recoger(?:lo|la|los|las)?|recojo|pasa(?:ra|rá)?\\s+a\\s+recoger|listo|lista|listos|listas|sale|saldr[ií]a)'

const sinTildes = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

function aDia(hoy: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(hoy)
  return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null
}
const DIA_MS = 86_400_000
const aTexto = (ms: number) => new Date(ms).toISOString().slice(0, 10)
const diasDelMes = (anio: number, mes: number) => new Date(Date.UTC(anio, mes, 0)).getUTCDate()

/**
 * La fecha de entrega que dice la frase, como 'AAAA-MM-DD', o null si no dice
 * ninguna (o no queda claro que sea la de entrega).
 */
export function fechaDeEntrega(texto: string, hoy: string): string | null {
  const base = aDia(hoy)
  if (base === null) return null
  const t = sinTildes(texto)
  const hoyDate = new Date(base)

  // «para hoy», «para mañana», «para pasado mañana».
  const relativo = new RegExp(`${PISTA}\\s+(?:el\\s+|este\\s+)?(pasado\\s+manana|manana|hoy)(?![\\p{L}\\d])`, 'u').exec(t)
  if (relativo) {
    const cual = relativo[1].replace(/\s+/g, ' ')
    return aTexto(base + (cual === 'hoy' ? 0 : cual === 'manana' ? 1 : 2) * DIA_MS)
  }

  // «para el viernes», «recoge el lunes»: el próximo, nunca hoy (hoy se dice «hoy»).
  const semana = new RegExp(
    `${PISTA}\\s+(?:el\\s+|este\\s+|el\\s+proximo\\s+|el\\s+otro\\s+)?(domingo|lunes|martes|miercoles|jueves|viernes|sabado)(?![\\p{L}])`,
    'u',
  ).exec(t)
  if (semana) {
    const objetivo = DIAS_SEMANA[semana[1]]
    const faltan = ((objetivo - hoyDate.getUTCDay() + 7) % 7) || 7
    return aTexto(base + faltan * DIA_MS)
  }

  // «para el 25», «para el 5 de octubre». Con «el» delante: «entrega 20» son soles.
  const numero = new RegExp(
    `${PISTA}\\s+(?:el|hasta\\s+el)\\s+(\\d{1,2})(?:\\s+de\\s+(${Object.keys(MESES).join('|')}))?(?![\\p{L}\\d])(?!\\s*(?:soles?|lucas|%|por|x))`,
    'u',
  ).exec(t)
  if (numero) {
    const dia = Number(numero[1])
    let anio = hoyDate.getUTCFullYear()
    let mes = numero[2] ? MESES[numero[2]] : hoyDate.getUTCMonth() + 1
    if (!numero[2] && dia < hoyDate.getUTCDate()) mes += 1
    if (mes > 12) {
      mes = 1
      anio += 1
    }
    if (numero[2] && Date.UTC(anio, mes - 1, dia) < base) anio += 1
    if (dia < 1 || dia > diasDelMes(anio, mes)) return null
    return aTexto(Date.UTC(anio, mes - 1, dia))
  }

  // «dentro de 3 días», «en dos días».
  const plazo = new RegExp(
    `${PISTA}\\s+(?:dentro\\s+de|en)\\s+(\\d{1,2}|${Object.keys(CUANTOS).join('|')})\\s+dias?(?![\\p{L}])`,
    'u',
  ).exec(t)
  if (plazo) {
    const n = /^\d+$/.test(plazo[1]) ? Number(plazo[1]) : CUANTOS[plazo[1]]
    if (n >= 1 && n <= 60) return aTexto(base + n * DIA_MS)
  }
  return null
}

/** ¿Dice la frase una fecha de entrega? Para no aceptar la que el modelo suponga. */
export const hayFechaDeEntrega = (texto: string) => fechaDeEntrega(texto, '2026-01-01') !== null

/** Una fecha 'AAAA-MM-DD' razonable para entregar: de hoy a un año. */
export function fechaDeEntregaValida(fecha: unknown, hoy: string): fecha is string {
  if (typeof fecha !== 'string') return false
  const f = aDia(fecha)
  const h = aDia(hoy)
  if (f === null || h === null || aTexto(f) !== fecha) return false
  return f >= h && f <= h + 366 * DIA_MS
}
