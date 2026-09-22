/**
 * El dictado en la app: la lógica está en ./dictado/extraer (pura y probada
 * en smoke); aquí solo se conecta con la Edge Function extraer-dictado.
 *
 * El modelo se usa solo si se cumplen las cuatro cosas: hay Supabase, hay
 * sesión, el interruptor de Configuración está encendido y la función
 * responde que tiene clave. Así, antes de desplegarla, la app funciona con las
 * reglas sin avisos, y el día que se despliega empieza a usarla sin tocar el
 * código. La función exige una sesión real: la clave pública sola no llama al
 * modelo.
 */
import { isSupabaseConfigured, supabase } from '@/lib/supabase'
import { extraerCon, type Invocar, type ResultadoDictado } from '@/lib/dictado/extraer'
import { interpreteActivado } from '@/lib/dictado/preferencia'

export type { ResultadoDictado }

const FUNCION = 'extraer-dictado'

const invocarFuncion: Invocar | null =
  isSupabaseConfigured && supabase
    ? async (cuerpo, signal) => {
        const { data, error } = await supabase!.functions.invoke(FUNCION, { body: cuerpo, signal })
        // Con un error HTTP, supabase-js deja la respuesta en `context`.
        const contexto = (error as { context?: unknown } | null)?.context
        const estado = contexto instanceof Response ? contexto.status : undefined
        return { data, error, estado }
      }
    : null

export type EstadoInterprete = 'sin-servidor' | 'no-desplegado' | 'disponible'

/** Un «no» se vuelve a comprobar pasado este rato: pudo ser la red. */
const REINTENTAR_NO_MS = 60_000
const LIMITE_SONDA_MS = 4_000

interface Sonda {
  cuando: number
  resultado: Promise<EstadoInterprete>
  /** Lo que respondió, cuando ya respondió. */
  final?: EstadoInterprete
}
let sonda: Sonda | null = null

async function sondear(): Promise<EstadoInterprete> {
  if (!supabase) return 'sin-servidor'
  const control = new AbortController()
  const plazo = setTimeout(() => control.abort(), LIMITE_SONDA_MS)
  try {
    const { data, error } = await supabase.functions.invoke<{ disponible?: boolean }>(FUNCION, {
      method: 'GET',
      signal: control.signal,
    })
    return !error && data?.disponible === true ? 'disponible' : 'no-desplegado'
  } catch {
    return 'no-desplegado'
  } finally {
    clearTimeout(plazo)
  }
}

/**
 * ¿Está la función desplegada y con clave? Nunca lanza. El «sí» se recuerda
 * toda la sesión; el «no», un minuto. La primera sonda también despierta la
 * función, así el primer dictado no paga el arranque en frío.
 */
export function comprobarInterprete(): Promise<EstadoInterprete> {
  if (!isSupabaseConfigured || !supabase) return Promise.resolve('sin-servidor')
  const ahora = Date.now()
  const caducada = sonda?.final === 'no-desplegado' && ahora - sonda.cuando >= REINTENTAR_NO_MS
  if (!sonda || caducada) {
    const nueva: Sonda = { cuando: ahora, resultado: sondear() }
    void nueva.resultado.then((r) => (nueva.final = r))
    sonda = nueva
  }
  return sonda.resultado
}

export async function extraerDictado(texto: string, conSesion: boolean): Promise<ResultadoDictado> {
  const usarModelo = conSesion && interpreteActivado() && (await comprobarInterprete()) === 'disponible'
  return extraerCon(texto, usarModelo ? invocarFuncion : null)
}
