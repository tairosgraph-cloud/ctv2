/**
 * La petición al modelo y la lectura de su respuesta.
 *
 * Puro: no importa el SDK, porque lo usan la Edge Function (Deno, `npm:`) y el
 * evaluador (Node). Cada lado crea su cliente y hace una sola llamada:
 *   cliente.beta.messages.create(construirPeticion(texto, hoy))
 * src/lib/dictado/contrato.ts comprueba al compilar que la petición encaja en
 * los tipos del SDK.
 */
import { INTENCIONES, type Extraccion } from './tipos.ts'
import { ESQUEMA_EXTRACCION, ESQUEMA_VERSION, type ExtraccionModelo } from './esquema.ts'
import { PROMPT_SISTEMA } from './prompt.ts'

export const MODELO = 'claude-opus-5'

/** Esfuerzo de razonamiento: «low» por latencia; el evaluador puede comparar. */
export type Esfuerzo = 'low' | 'medium' | 'high'

const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']

/** «2026-09-18» → «viernes», sin depender de la zona horaria de quien llama. */
function diaDeLaSemana(hoy: string): string {
  const [a, m, d] = hoy.split('-').map(Number)
  return DIAS[new Date(Date.UTC(a, m - 1, d)).getUTCDay()]
}

export function construirPeticion(dictado: string, hoy: string, esfuerzo: Esfuerzo = 'low') {
  return {
    model: MODELO,
    max_tokens: 4096,
    // Si el modelo rechazara el dictado, el servidor lo reintenta con otro
    // modelo en vez de devolver el rechazo.
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default' as const,
    system: [
      {
        type: 'text' as const,
        text: PROMPT_SISTEMA,
        cache_control: { type: 'ephemeral' as const, ttl: '1h' as const },
      },
    ],
    messages: [
      {
        role: 'user' as const,
        // La fecha va aquí y no en el sistema: allí rompería la caché.
        content: `Hoy es ${hoy} (${diaDeLaSemana(hoy)}).\nDictado: «${dictado}»`,
      },
    ],
    output_config: {
      effort: esfuerzo,
      format: { type: 'json_schema' as const, schema: ESQUEMA_EXTRACCION },
    },
  }
}

/** Lo mínimo que se lee de la respuesta, sin atarse a los tipos del SDK. */
export interface RespuestaModelo {
  stop_reason: string | null
  content: ReadonlyArray<{ type: string; text?: string }>
}

const BLOQUES = ['pedido', 'proforma', 'abono', 'deuda', 'consulta'] as const
const esObjeto = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/**
 * La forma mínima que el validador da por hecha. El esquema ya la garantiza;
 * esto es por si algún día no (un rechazo que se cuela, un cambio de API).
 */
export function tieneForma(d: unknown): d is ExtraccionModelo {
  if (!esObjeto(d) || !(INTENCIONES as readonly unknown[]).includes(d.intent)) return false
  if (!BLOQUES.every((b) => d[b] === null || esObjeto(d[b]))) return false
  if (![d.faltantes, d.supuestos, d.ambiguedades].every(Array.isArray)) return false
  const pedido = d.pedido
  return pedido === null || (esObjeto(pedido) && Array.isArray(pedido.items) && esObjeto(pedido.adelanto))
}

/**
 * La extracción, o null si la respuesta no sirve: rechazo, corte por
 * `max_tokens` o un JSON que no tiene la forma del esquema. Null significa
 * «usa las reglas», nunca «no había nada que extraer».
 */
export function leerRespuesta(respuesta: RespuestaModelo): Extraccion | null {
  if (respuesta.stop_reason === 'refusal' || respuesta.stop_reason === 'max_tokens') return null
  const texto = respuesta.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text ?? '')
    .join('')
  let datos: unknown
  try {
    datos = JSON.parse(texto)
  } catch {
    return null
  }
  return tieneForma(datos) ? { ...datos, origen: 'llm', esquema: ESQUEMA_VERSION } : null
}
