/**
 * De frase a extracción, con el modelo si se puede y con las reglas si no.
 *
 * Puro respecto de la red: quien llama pasa `invocar` (en la app, la Edge
 * Function vía supabase-js; en las pruebas, un doble). Así cada salida de
 * emergencia se puede probar sin red:
 * - sin `invocar` (modo local o sin sesión) → reglas, sin aviso: no es un fallo;
 * - error, respuesta sin la forma del esquema o plazo vencido → reglas + aviso;
 * - y si hasta las reglas fallaran → «desconocido»: el formulario se abre vacío.
 * Nunca lanza.
 */
import { tieneForma } from '../../../supabase/functions/_shared/dictado/peticion.ts'
import type { Extraccion } from '../../../supabase/functions/_shared/dictado/tipos.ts'
import { cruzarConReglas } from './cruzar'
import { desdeReglas } from './reglas'
import { validarExtraccion } from './validar'

/** El dictado se corta aquí y sigue con las reglas; la función corta a los 5 s. */
export const LIMITE_MS = 6_000

export { hoyEnLima } from '../../../supabase/functions/_shared/dictado/fechas.ts'
import { hoyEnLima } from '../../../supabase/functions/_shared/dictado/fechas.ts'

export type Invocar = (
  cuerpo: { texto: string; hoy: string },
  signal: AbortSignal,
) => Promise<{ data: unknown; error: unknown; /** Estado HTTP de la respuesta, si lo hubo. */ estado?: number }>

export interface ResultadoDictado {
  extraccion: Extraccion
  /** Desde que se pidió hasta que llegó: la latencia que sufre quien dicta. */
  ms: number
  /** Por qué no se usó el modelo cuando se intentó; null si no hubo fallo. */
  aviso: string | null
  /** Qué modelo respondió (con fallback de servidor puede no ser el pedido). */
  modelo: string | null
  /** Tokens de la llamada, para la auditoría; null si no hubo modelo. */
  uso: { entrada: number; cacheLectura: number; salida: number } | null
}

const NO_RESPONDIO = 'El intérprete inteligente no respondió; usé el básico.'
const TARDO = 'El intérprete inteligente tardó demasiado; usé el básico.'
/** Lo que la función dice con su estado, cuando no es un fallo cualquiera. */
const POR_ESTADO: Record<number, string> = {
  403: 'Tu cuenta no tiene permiso para el intérprete inteligente; usé el básico.',
  429: 'Se acabó el cupo diario del intérprete inteligente; hasta mañana uso el básico.',
}

/** Lo que se devuelve si ni las reglas pueden: nada afirmado, nada tocado. */
const sinEntender = (): Extraccion => ({
  intent: 'desconocido',
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
})

const conReglas = (texto: string): Extraccion => {
  try {
    return validarExtraccion(desdeReglas(texto), texto)
  } catch {
    return sinEntender()
  }
}

const esObjeto = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null
const entero = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v) : 0)
const leerUso = (v: unknown): ResultadoDictado['uso'] =>
  esObjeto(v) ? { entrada: entero(v.entrada), cacheLectura: entero(v.cacheLectura), salida: entero(v.salida) } : null

export async function extraerCon(
  texto: string,
  invocar: Invocar | null,
  limiteMs = LIMITE_MS,
): Promise<ResultadoDictado> {
  const inicio = performance.now()
  const ms = () => Math.round(performance.now() - inicio)
  const reglas = (aviso: string | null): ResultadoDictado => ({
    extraccion: conReglas(texto),
    ms: ms(),
    aviso,
    modelo: null,
    uso: null,
  })

  if (!invocar) return reglas(null)

  const control = new AbortController()
  let plazo: ReturnType<typeof setTimeout> | undefined
  // La carrera no depende de que `invocar` respete la señal: si no la
  // respeta, el plazo gana igual y la respuesta tardía se ignora.
  const vencido = new Promise<'vencido'>((resolver) => {
    plazo = setTimeout(() => {
      control.abort()
      resolver('vencido')
    }, limiteMs)
  })
  try {
    const respuesta = await Promise.race([invocar({ texto, hoy: hoyEnLima() }, control.signal), vencido])
    if (respuesta === 'vencido') return reglas(TARDO)
    const datos = respuesta.data
    if (respuesta.error) return reglas(POR_ESTADO[respuesta.estado ?? 0] ?? NO_RESPONDIO)
    if (!esObjeto(datos) || !tieneForma(datos.extraccion)) return reglas(NO_RESPONDIO)

    const delModelo = validarExtraccion({ ...datos.extraccion, origen: 'llm', esquema: 1 }, texto)
    return {
      extraccion: cruzarConReglas(delModelo, conReglas(texto)),
      ms: ms(),
      aviso: null,
      modelo: typeof datos.modelo === 'string' ? datos.modelo : null,
      uso: leerUso(datos.uso),
    }
  } catch {
    return reglas(control.signal.aborted ? TARDO : NO_RESPONDIO)
  } finally {
    clearTimeout(plazo)
  }
}
