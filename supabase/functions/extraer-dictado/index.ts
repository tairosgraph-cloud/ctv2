/**
 * Edge Function: una frase dictada → la extracción estructurada, con Claude.
 *
 * Sin estado: no escribe en la base. Exige una sesión real, llama al modelo con
 * el prompt y el esquema compartidos (../_shared/dictado) y devuelve lo que
 * extrajo. Ante cualquier fallo responde con un error y el cliente sigue con
 * las reglas (src/lib/extractor.ts): el dictado nunca se queda sin respuesta.
 *
 * Secreto: ANTHROPIC_API_KEY, que nunca va en una variable VITE_:
 *   npx supabase secrets set --env-file .env.anthropic
 * Despliegue:
 *   npx supabase functions deploy extraer-dictado
 */
import Anthropic from 'npm:@anthropic-ai/sdk@0.127.0'
import { createClient } from 'npm:@supabase/supabase-js@2.112.3'
import { construirPeticion, leerRespuesta } from '../_shared/dictado/peticion.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const responder = (estado: number, cuerpo: unknown) =>
  new Response(JSON.stringify(cuerpo), {
    status: estado,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })

const FECHA = /^\d{4}-\d{2}-\d{2}$/
/** Una frase de mostrador; más que esto no es un dictado. */
const MAX_CARACTERES = 1000

/**
 * Hoy en Lima, que es donde se dicta. En UTC, a partir de las 19:00 de Lima ya
 * es mañana, y «vence el 30» se calcularía desde el día equivocado.
 */
const hoyEnLima = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima' }).format(new Date())

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return responder(405, { error: 'Solo POST' })

  const url = Deno.env.get('SUPABASE_URL')
  const clave = Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_PUBLISHABLE_KEY')
  const claveModelo = Deno.env.get('ANTHROPIC_API_KEY')
  if (!url || !clave || !claveModelo) return responder(500, { error: 'La función no está configurada' })

  const jwt = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ?? ''
  if (!jwt) return responder(401, { error: 'Falta la sesión' })

  const supabase = createClient(url, clave, { auth: { persistSession: false } })
  const { data: sesion, error: errorDeSesion } = await supabase.auth.getClaims(jwt)
  // La clave pública también es un token válido, pero su rol es «anon»: sin
  // sesión iniciada no se llama al modelo.
  if (errorDeSesion || !sesion || sesion.claims.role !== 'authenticated') {
    return responder(401, { error: 'Sesión no válida' })
  }

  const cuerpo = await req.json().catch(() => null)
  const texto = typeof cuerpo?.texto === 'string' ? cuerpo.texto.trim() : ''
  if (!texto || texto.length > MAX_CARACTERES) {
    return responder(400, { error: 'Dictado vacío o demasiado largo' })
  }
  const hoy = typeof cuerpo?.hoy === 'string' && FECHA.test(cuerpo.hoy) ? cuerpo.hoy : hoyEnLima()

  // Sin reintentos: el cliente corta a los 6 s y cae a las reglas; un reintento
  // aquí solo gastaría el tiempo que ya no hay.
  const modelo = new Anthropic({ apiKey: claveModelo, timeout: 5_000, maxRetries: 0 })
  const inicio = performance.now()
  try {
    const respuesta = await modelo.beta.messages.create(construirPeticion(texto, hoy))
    const ms = Math.round(performance.now() - inicio)
    const extraccion = leerRespuesta(respuesta)
    if (!extraccion) {
      return responder(502, { error: 'Respuesta del modelo ilegible', stop_reason: respuesta.stop_reason, ms })
    }
    return responder(200, {
      extraccion,
      modelo: respuesta.model,
      ms,
      uso: {
        entrada: respuesta.usage.input_tokens,
        cacheLectura: respuesta.usage.cache_read_input_tokens ?? 0,
        salida: respuesta.usage.output_tokens,
      },
    })
  } catch (error) {
    return responder(502, {
      error: error instanceof Error ? error.message : 'Fallo al llamar al modelo',
      ms: Math.round(performance.now() - inicio),
    })
  }
})
