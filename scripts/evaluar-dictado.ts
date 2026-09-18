/**
 * Evaluador del dictado: pasa el corpus por un intérprete y lo mide.
 *
 *   npm run voz:evaluar                        reglas, resumen
 *   npm run voz:evaluar -- --detalle           y cada frase que no quedó perfecta
 *   npm run voz:evaluar -- --etiqueta pedido   solo las frases con esa etiqueta
 *   npm run voz:evaluar -- --corpus RUTA       otro corpus (p. ej. un control)
 *   npm run voz:evaluar -- --json salida.json  el detalle completo, para comparar corridas
 *
 *   npm run voz:evaluar -- --motor llm         el modelo, contrastado con las reglas
 *                                              (lo que verá el formulario)
 *   npm run voz:evaluar -- --motor llm-solo    el modelo sin la segunda opinión
 *     --esfuerzo low|medium|high   (low)      razonamiento del modelo
 *     --hoy AAAA-MM-DD             (2026-09-18) la fecha con que se etiquetó el corpus
 *     --paralelo N                 (4)        llamadas simultáneas
 *     --limite MS                  (5000)     corte por llamada, como en la función
 *
 * Mide la tubería entera: intérprete + validarExtraccion (+ cruzarConReglas).
 * Con el modelo, una llamada que falla o tarda cae a las reglas, como en la
 * app, y se cuenta aparte. La clave sale de ANTHROPIC_API_KEY o del archivo
 * .env.anthropic (ignorado por git); nunca se imprime. Cada corrida con el
 * modelo cuesta dinero: el resumen dice cuánto.
 *
 * Convenciones del corpus (scripts/corpus-dictado.jsonl):
 * - `esperado` es parcial: solo se puntúa lo que trae. Un campo en null exige
 *   que el intérprete no afirme nada ahí.
 * - Nombres sin tratamiento («la señora María» → «María»).
 * - Descripciones y detalles: las palabras que tienen que aparecer, no el
 *   texto exacto.
 * - Una línea por trabajo con su precio; si se dijo un solo precio para varios
 *   trabajos, una sola línea.
 * - Precio unitario: la línea vale cantidad × precio.
 * - Etiqueta `sintetica`: frase escrita a mano. `real`: transcripción tal cual
 *   salió del micrófono en el mostrador. Las reales son las que valen.
 */
import type Anthropic from '@anthropic-ai/sdk'
import type { BetaUsage } from '@anthropic-ai/sdk/resources/beta/messages'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import { cruzarConReglas } from '@/lib/dictado/cruzar'
import { formatearResumen, leerCorpus, puntuarFrase, resumir } from '@/lib/dictado/puntuar'
import { desdeReglas } from '@/lib/dictado/reglas'
import { validarExtraccion } from '@/lib/dictado/validar'
import type { Extraccion } from '../supabase/functions/_shared/dictado/tipos.ts'
import {
  construirPeticion,
  leerRespuesta,
  MODELO,
  type Esfuerzo,
} from '../supabase/functions/_shared/dictado/peticion.ts'

const args = process.argv.slice(2)
const opcion = (nombre: string) => {
  const i = args.indexOf(nombre)
  return i >= 0 ? args[i + 1] : undefined
}
const salir = (mensaje: string): never => {
  console.error(mensaje)
  process.exit(2)
}
const entero = (nombre: string, porDefecto: number) => {
  const v = Number(opcion(nombre) ?? porDefecto)
  return Number.isInteger(v) && v > 0 ? v : salir(`${nombre} espera un entero positivo`)
}

const MOTORES = ['reglas', 'llm', 'llm-solo'] as const
type Motor = (typeof MOTORES)[number]
const motor = (opcion('--motor') ?? 'reglas') as Motor
if (!MOTORES.includes(motor)) salir(`Motor «${motor}» desconocido: ${MOTORES.join(', ')}`)

const esfuerzo = (opcion('--esfuerzo') ?? 'low') as Esfuerzo
if (!['low', 'medium', 'high'].includes(esfuerzo)) salir('--esfuerzo: low, medium o high')
const hoy = opcion('--hoy') ?? '2026-09-18'
if (!/^\d{4}-\d{2}-\d{2}$/.test(hoy)) salir('--hoy espera AAAA-MM-DD')
const paralelo = entero('--paralelo', 4)
const limite = entero('--limite', 5000)

const rutaCorpus = opcion('--corpus') ?? 'scripts/corpus-dictado.jsonl'
const etiqueta = opcion('--etiqueta')
const corpus = leerCorpus(readFileSync(rutaCorpus, 'utf8')).filter(
  (e) => !etiqueta || e.etiquetas.includes(etiqueta),
)
if (!corpus.length) salir('No hay frases que evaluar con ese filtro.')

// --- el modelo -----------------------------------------------------------------

/** La clave, sin imprimirla: del entorno o de .env.anthropic. */
function claveDelModelo(): string {
  const delEntorno = process.env.ANTHROPIC_API_KEY?.trim()
  if (delEntorno) return delEntorno
  if (existsSync('.env.anthropic')) {
    for (const linea of readFileSync('.env.anthropic', 'utf8').split('\n')) {
      const m = linea.match(/^\s*(?:export\s+)?ANTHROPIC_API_KEY\s*=\s*["']?([^"'\s#]+)/)
      if (m) return m[1]
    }
  }
  return salir(
    'Falta la clave del modelo. Crea el archivo .env.anthropic en la raíz del proyecto\n' +
      'con una línea ANTHROPIC_API_KEY=… (git lo ignora). No la pegues en el chat.',
  )
}

/** Precios de claude-opus-5 en dólares por millón de tokens. */
const PRECIO = { entrada: 5, salida: 25, cacheLectura: 0.5, cacheEscritura1h: 10 }

interface Uso {
  entrada: number
  cacheLectura: number
  cacheEscritura: number
  salida: number
}
const uso: Uso = { entrada: 0, cacheLectura: 0, cacheEscritura: 0, salida: 0 }
const sumarUso = (u: BetaUsage) => {
  uso.entrada += u.input_tokens
  uso.cacheLectura += u.cache_read_input_tokens ?? 0
  uso.cacheEscritura += u.cache_creation_input_tokens ?? 0
  uso.salida += u.output_tokens
}
const modelosQueRespondieron = new Map<string, number>()
const costo = (u: Uso) =>
  (u.entrada * PRECIO.entrada +
    u.salida * PRECIO.salida +
    u.cacheLectura * PRECIO.cacheLectura +
    u.cacheEscritura * PRECIO.cacheEscritura1h) /
  1_000_000

async function crearCliente(corte: number): Promise<Anthropic> {
  // Solo se carga si hace falta: el motor de reglas no necesita el SDK.
  const { default: SDK } = await import('@anthropic-ai/sdk')
  // Sin reintentos y con el mismo corte que la función: lo que aquí falla,
  // en la app cae a las reglas.
  return new SDK({ apiKey: claveDelModelo(), timeout: corte, maxRetries: 0 })
}

// --- una frase -----------------------------------------------------------------

interface Salida {
  extraida: Extraccion
  ms: number
  /** Por qué el modelo no sirvió y se usaron las reglas. */
  fallo?: string
}

const conReglas = (frase: string) => validarExtraccion(desdeReglas(frase), frase)

async function interpretar(frase: string, cliente: Anthropic | null): Promise<Salida> {
  const t0 = performance.now()
  const ms = () => Math.round(performance.now() - t0)
  if (!cliente) {
    const extraida = conReglas(frase)
    return { extraida, ms: ms() }
  }
  try {
    const respuesta = await cliente.beta.messages.create(construirPeticion(frase, hoy, esfuerzo))
    const tiempo = ms()
    sumarUso(respuesta.usage)
    modelosQueRespondieron.set(respuesta.model, (modelosQueRespondieron.get(respuesta.model) ?? 0) + 1)

    const delModelo = leerRespuesta(respuesta)
    if (!delModelo) return { extraida: conReglas(frase), ms: tiempo, fallo: `respuesta ilegible (${respuesta.stop_reason})` }
    const validada = validarExtraccion(delModelo, frase)
    return { extraida: motor === 'llm' ? cruzarConReglas(validada, conReglas(frase)) : validada, ms: tiempo }
  } catch (error) {
    const tiempo = ms()
    const motivo = error instanceof Error ? `${error.constructor.name}: ${error.message}` : String(error)
    return { extraida: conReglas(frase), ms: tiempo, fallo: motivo }
  }
}

/** Como Promise.all, pero con a lo sumo `n` en vuelo; conserva el orden. */
async function enParalelo<T, R>(elementos: T[], n: number, f: (e: T) => Promise<R>): Promise<R[]> {
  const salida = new Array<R>(elementos.length)
  let siguiente = 0
  const trabajador = async () => {
    while (siguiente < elementos.length) {
      const i = siguiente++
      salida[i] = await f(elementos[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(n, elementos.length) }, trabajador))
  return salida
}

// --- la corrida ------------------------------------------------------------------

const cliente = motor === 'reglas' ? null : await crearCliente(limite)
if (cliente) {
  console.log(`Modelo ${MODELO} · esfuerzo ${esfuerzo} · hoy ${hoy} · ${corpus.length} frases · ${paralelo} en paralelo`)
  // Calentamiento, fuera de la puntuación: la primera llamada con un esquema
  // nuevo lo compila (el servidor lo guarda 24 h) y escribe la caché del
  // prompt. Sin esto, el p95 mediría una vez al día y no cada dictado.
  const t0 = performance.now()
  try {
    const r = await (await crearCliente(60_000)).beta.messages.create(construirPeticion('cobré 20 soles de copias en efectivo', hoy, esfuerzo))
    sumarUso(r.usage)
    console.log(`Calentamiento: ${Math.round(performance.now() - t0)} ms (${r.stop_reason}), no se puntúa`)
  } catch (error) {
    salir(`El modelo no responde ni con 60 s de margen: ${error instanceof Error ? error.message : error}`)
  }
}

const salidas = await enParalelo(corpus, cliente ? paralelo : 1, (e) => interpretar(e.frase, cliente))

const resultados = corpus.map((entrada, i) => ({
  resultado: puntuarFrase(entrada, salidas[i].extraida, salidas[i].ms),
  extraida: salidas[i].extraida,
  fallo: salidas[i].fallo ?? null,
}))

console.log(formatearResumen(resumir(resultados.map((r) => r.resultado)), cliente ? `${motor} (${esfuerzo})` : motor))

const fallos = resultados.filter((r) => r.fallo)
if (cliente) {
  const llamadas = corpus.length
  console.log(
    '',
    `  Caídas a las reglas ...... ${fallos.length}/${llamadas}   (el modelo falló o tardó más de ${limite} ms)`,
    `\n  Tokens ................... entrada ${uso.entrada} · caché leída ${uso.cacheLectura} · caché escrita ${uso.cacheEscritura} · salida ${uso.salida}`,
    `\n  Costo aproximado ......... US$ ${costo(uso).toFixed(4)}  (US$ ${(costo(uso) / llamadas).toFixed(4)} por dictado)`,
    `\n  Respondió ................ ${[...modelosQueRespondieron].map(([m, n]) => `${m} ×${n}`).join(', ') || 'nadie'}`,
  )
  // Si la segunda llamada en adelante no lee la caché, algo del prompt cambia
  // entre llamadas y cada dictado paga el prompt entero.
  if (llamadas > 1 && uso.cacheLectura === 0 && fallos.length < llamadas) {
    console.log('\n  AVISO: ninguna llamada leyó la caché del prompt. El sistema no es estable byte a byte.')
  }
  for (const r of fallos) console.log(`    ✗ ${r.resultado.id}: ${r.fallo}`)
}

if (args.includes('--detalle')) {
  console.log('\nFrases que no quedaron perfectas:\n')
  for (const { resultado: r, extraida, fallo } of resultados) {
    if (r.aceptable) continue
    const marca = r.segura ? '·' : '✗'
    console.log(`${marca} ${r.id}  «${r.frase}»${fallo ? '  [reglas: el modelo falló]' : ''}`)
    if (!r.rutaCorrecta) console.log(`    ruta: esperaba ${r.intentEsperado}, salió ${r.intentObtenido}`)
    for (const c of r.campos) {
      if (c.veredicto === 'acierto' || c.veredicto === 'rehuso') continue
      console.log(`    ${c.veredicto.padEnd(15)} ${c.campo.padEnd(18)} esperaba ${JSON.stringify(c.esperado)}, salió ${JSON.stringify(c.obtenido)}`)
    }
    if (r.sinDeclarar.length) console.log(`    sin declarar     ${r.sinDeclarar.join(', ')}`)
    if (r.cifrasFuera) console.log(`    CIFRAS FUERA DE LA FRASE: ${r.cifrasFuera}`)
    if (extraida.ambiguedades.length) {
      console.log(`    dudas            ${extraida.ambiguedades.map((a) => `${a.campo}: ${a.opciones.join(' | ')}`).join(' · ')}`)
    }
  }
}

const salida = opcion('--json')
if (salida) {
  writeFileSync(salida, JSON.stringify({ motor, esfuerzo, hoy, uso, resultados }, null, 2))
  console.log(`\nDetalle en ${salida}`)
}
