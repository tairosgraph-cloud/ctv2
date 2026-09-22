/**
 * Edge Function: una frase dictada → la extracción estructurada, con Claude.
 *
 * Sin estado propio: no guarda la frase. Antes de gastar la clave comprueba
 * tres cosas: que hay una sesión real, que la cuenta está activa y puede
 * registrar (0009) y que no pasó su cupo del día (0010, contar_dictado). Ante
 * cualquier fallo responde con un error y el cliente sigue con las reglas
 * (src/lib/dictado/extraer.ts): el dictado nunca se queda sin respuesta.
 *
 * Al navegador solo le llegan mensajes genéricos; el detalle (tipo de error,
 * tiempos, tokens) queda en los registros de la función, nunca la frase.
 *
 * Secretos (nunca en una variable VITE_):
 *   ANTHROPIC_API_KEY       obligatoria
 *   LIMITE_DICTADOS_DIA     opcional, por cuenta y día (300)
 *   ORIGENES_PERMITIDOS     opcional, dominios extra separados por comas
 * Todo el alta la hace `npm run voz:activar`.
 */
import Anthropic from 'npm:@anthropic-ai/sdk@0.127.0'
import { createClient } from 'npm:@supabase/supabase-js@2.112.3'
import { construirPeticion, leerRespuesta, MODELO } from '../_shared/dictado/peticion.ts'
import { hoyEnLima } from '../_shared/dictado/fechas.ts'

/**
 * Producción (ctv2-tayros), cada despliegue (ctv2-<9 caracteres>-tayros), las
 * ramas (ctv2-git-<rama>-tayros) y local. CORS no es la barrera (lo es la
 * sesión en la cabecera Authorization, que un navegador nunca añade solo),
 * pero no hay por qué abrir más de lo que se usa.
 */
const ORIGENES = [
  /^https:\/\/ctv2(?:-[a-z0-9]{9}|-git-[a-z0-9-]+)?-tayros\.vercel\.app$/,
  /^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/,
]
const ORIGENES_EXTRA = (Deno.env.get('ORIGENES_PERMITIDOS') ?? '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean)

function cors(origen: string | null): Record<string, string> {
  const permitido = origen && (ORIGENES_EXTRA.includes(origen) || ORIGENES.some((r) => r.test(origen)))
  return {
    ...(permitido ? { 'Access-Control-Allow-Origin': origen } : {}),
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    Vary: 'Origin',
  }
}

const FECHA = /^\d{4}-\d{2}-\d{2}$/
/** Una frase de mostrador; más que esto no es un dictado. */
const MAX_CARACTERES = 1000
const LIMITE_DIA = Math.max(1, Number(Deno.env.get('LIMITE_DICTADOS_DIA')) || 300)


/**
 * La clave pública del proyecto. Según la versión de la plataforma llega con un
 * nombre u otro; en último caso sirve la que mandó el propio navegador.
 */
function clavePublica(req: Request): string | undefined {
  const directa = Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_PUBLISHABLE_KEY')
  if (directa) return directa
  try {
    const mapa = JSON.parse(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS') ?? '{}') as Record<string, string>
    const primera = mapa.default ?? Object.values(mapa)[0]
    if (primera) return primera
  } catch {
    /* formato inesperado: se prueba lo siguiente */
  }
  return req.headers.get('apikey') ?? undefined
}

/** Una línea por petición en los registros: qué pasó y cuánto tardó, sin la frase. */
function registrar(evento: string, datos: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ evento, ...datos }))
}

Deno.serve(async (req) => {
  const cabeceras = cors(req.headers.get('Origin'))
  const responder = (estado: number, cuerpo: unknown) =>
    new Response(JSON.stringify(cuerpo), { status: estado, headers: { ...cabeceras, 'Content-Type': 'application/json' } })

  if (req.method === 'OPTIONS') return new Response('ok', { headers: cabeceras })
  // Sonda sin sesión: la app pregunta si el intérprete está listo antes de
  // usarlo (y, de paso, despierta la función). Solo dice si hay clave, nunca
  // cuál; no llama al modelo.
  if (req.method === 'GET') {
    return responder(200, { disponible: Boolean(Deno.env.get('ANTHROPIC_API_KEY')), modelo: MODELO })
  }
  if (req.method !== 'POST') return responder(405, { error: 'Solo GET o POST' })

  const url = Deno.env.get('SUPABASE_URL')
  const clave = clavePublica(req)
  const claveModelo = Deno.env.get('ANTHROPIC_API_KEY')
  if (!url || !clave || !claveModelo) {
    registrar('sin-configurar', { url: Boolean(url), clave: Boolean(clave), modelo: Boolean(claveModelo) })
    return responder(500, { error: 'La función no está configurada' })
  }

  const jwt = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ?? ''
  if (!jwt) return responder(401, { error: 'Falta la sesión' })

  const anonimo = createClient(url, clave, { auth: { persistSession: false } })
  const { data: sesion, error: errorDeSesion } = await anonimo.auth.getClaims(jwt)
  // La clave pública también es un token válido, pero su rol es «anon»: sin
  // sesión iniciada no se llama al modelo.
  if (errorDeSesion || !sesion || sesion.claims.role !== 'authenticated') {
    return responder(401, { error: 'Sesión no válida' })
  }
  const usuario = sesion.claims.sub

  const cuerpo = await req.json().catch(() => null)
  const texto = typeof cuerpo?.texto === 'string' ? cuerpo.texto.trim() : ''
  if (!texto || texto.length > MAX_CARACTERES) {
    return responder(400, { error: 'Dictado vacío o demasiado largo' })
  }
  const hoy = typeof cuerpo?.hoy === 'string' && FECHA.test(cuerpo.hoy) ? cuerpo.hoy : hoyEnLima()

  // Permiso y cupo, en la base y con la sesión de quien dicta: una cuenta
  // inactiva o sin permiso de registrar no gasta la clave.
  const comoUsuario = createClient(url, clave, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  })
  const { data: llamadas, error: errorDeCupo } = await comoUsuario.rpc('contar_dictado')
  if (errorDeCupo) {
    const sinPermiso = errorDeCupo.code === '42501'
    registrar(sinPermiso ? 'sin-permiso' : 'cupo-no-disponible', { usuario, codigo: errorDeCupo.code })
    return sinPermiso
      ? responder(403, { error: 'Esta cuenta no tiene permiso para dictar' })
      : responder(503, { error: 'No se pudo comprobar el cupo' })
  }
  if (typeof llamadas !== 'number' || llamadas > LIMITE_DIA) {
    registrar('cupo-agotado', { usuario, llamadas, limite: LIMITE_DIA })
    return responder(429, { error: 'Cupo diario agotado' })
  }

  // Sin reintentos: el cliente corta a los 6 s y cae a las reglas; un reintento
  // aquí solo gastaría el tiempo que ya no hay.
  const modelo = new Anthropic({ apiKey: claveModelo, timeout: 5_000, maxRetries: 0 })
  const inicio = performance.now()
  try {
    const respuesta = await modelo.beta.messages.create(construirPeticion(texto, hoy))
    const ms = Math.round(performance.now() - inicio)
    const uso = {
      entrada: respuesta.usage.input_tokens,
      cacheLectura: respuesta.usage.cache_read_input_tokens ?? 0,
      salida: respuesta.usage.output_tokens,
    }
    const extraccion = leerRespuesta(respuesta)
    registrar(extraccion ? 'ok' : 'ilegible', { usuario, ms, stop: respuesta.stop_reason, modelo: respuesta.model, ...uso })
    if (!extraccion) return responder(502, { error: 'Respuesta del modelo ilegible' })
    return responder(200, { extraccion, modelo: respuesta.model, ms, uso })
  } catch (error) {
    const ms = Math.round(performance.now() - inicio)
    // El mensaje del SDK puede contar el estado de la cuenta (saldo, límites):
    // se queda en los registros; el navegador solo sabe que falló.
    registrar('fallo-modelo', {
      usuario,
      ms,
      tipo: error instanceof Error ? error.constructor.name : typeof error,
      estado: error instanceof Anthropic.APIError ? error.status : undefined,
    })
    return responder(502, { error: 'El modelo no respondió' })
  }
})
