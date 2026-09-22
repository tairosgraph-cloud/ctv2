/**
 * Activa el intérprete inteligente del dictado, de principio a fin:
 *
 *   npm run voz:activar                 medir → puerta → secreto → desplegar → comprobar
 *   npm run voz:activar -- --solo-medir medir y decir si pasa la puerta, sin desplegar
 *   npm run voz:activar -- --sin-medir  volver a desplegar sin medir (ya se midió)
 *   npm run voz:activar -- --forzar     desplegar aunque no pase la puerta (con motivo)
 *
 * Necesita:
 * - .env.anthropic con UNA línea ANTHROPIC_API_KEY=sk-ant-… (git lo ignora).
 * - Sesión en la CLI de Supabase: `npx supabase login` (una vez).
 *
 * La app no necesita nada más: pregunta a la función si está lista y, desde
 * que responde que sí, la usa sola.
 *
 * Medir cuesta dinero de verdad (unos US$ 3 los dos corpus); el resumen dice
 * cuánto. La clave nunca se imprime ni se pasa por la línea de órdenes.
 */
import { spawnSync, type SpawnSyncOptions } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { puerta, type Criterio, type Medicion } from '@/lib/dictado/puerta'

const PROYECTO = 'uzimdlkildejgkflkpxi'
const URL_FUNCION = `https://${PROYECTO}.supabase.co/functions/v1/extraer-dictado`
/** Versión fija de la CLI oficial: la misma en cada despliegue. */
const CLI = 'supabase@2.116.0'
const CORPUS = [
  { nombre: 'corpus principal', ruta: 'scripts/corpus-dictado.jsonl' },
  { nombre: 'control 2 (nunca visto)', ruta: 'scripts/corpus-dictado-control-2.jsonl' },
]

const args = process.argv.slice(2)
const soloMedir = args.includes('--solo-medir')
const sinMedir = args.includes('--sin-medir')
const forzar = args.includes('--forzar')

const paso = (texto: string) => console.log(`\n▸ ${texto}`)
const bien = (texto: string) => console.log(`  ✓ ${texto}`)
const fallar = (texto: string, codigo = 1): never => {
  console.error(`\n✗ ${texto}`)
  process.exit(codigo)
}

function correr(orden: string, argumentos: string[], opciones: SpawnSyncOptions = {}) {
  return spawnSync(orden, argumentos, { stdio: 'inherit', encoding: 'utf8', ...opciones })
}

// --- 1. la clave ----------------------------------------------------------------

paso('Clave de Anthropic')
if (!existsSync('.env.anthropic')) {
  fallar(
    'No existe .env.anthropic. Créalo en la raíz del proyecto con una sola línea:\n' +
      '    ANTHROPIC_API_KEY=sk-ant-…\n' +
      '  La clave se crea en console.anthropic.com → API Keys (ponle un límite de gasto mensual).\n' +
      '  No la pegues en ningún chat.',
  )
}
const ignorado = spawnSync('git', ['check-ignore', '-q', '.env.anthropic']).status === 0
if (!ignorado) fallar('.env.anthropic no está ignorado por git: no sigo, la clave acabaría en el repositorio.')

const variables = readFileSync('.env.anthropic', 'utf8')
  .split('\n')
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith('#'))
  .map((l) => l.replace(/^export\s+/, ''))
const nombres = variables.map((l) => l.split('=')[0].trim())
// `secrets set --env-file` sube TODO lo que haya en el archivo: nada de sorpresas.
const otras = nombres.filter((n) => n !== 'ANTHROPIC_API_KEY')
if (otras.length) fallar(`.env.anthropic tiene más variables (${otras.join(', ')}). Déjalo solo con ANTHROPIC_API_KEY.`)
const linea = variables.find((l) => l.startsWith('ANTHROPIC_API_KEY'))
const valor = linea?.slice(linea.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '') ?? ''
if (!/^sk-ant-[\w-]{20,}$/.test(valor)) {
  fallar('La línea ANTHROPIC_API_KEY no parece una clave de Anthropic (empiezan por sk-ant-). Revisa que esté completa y sin espacios.')
}
bien('encontrada, ignorada por git y con buen formato (no se muestra)')

// --- 2. la sesión de Supabase ------------------------------------------------------

if (!soloMedir) {
  paso('Sesión en la CLI de Supabase')
  const sesion = correr('npx', ['--yes', CLI, 'projects', 'list'], { stdio: 'pipe' })
  if (sesion.status !== 0) {
    fallar('La CLI de Supabase no tiene sesión. Ejecuta una vez:\n    npx supabase login\n  y vuelve a lanzar npm run voz:activar.')
  }
  if (!String(sesion.stdout).includes(PROYECTO)) {
    fallar(`La cuenta con sesión no ve el proyecto ${PROYECTO}. Entra con la cuenta dueña del proyecto.`)
  }
  bien(`sesión abierta y con acceso al proyecto ${PROYECTO}`)
}

// --- 3. medir y la puerta ----------------------------------------------------------

function medir(motor: 'reglas' | 'llm', corpus: string, carpeta: string): Medicion & { costo: number } {
  const salida = join(carpeta, `${motor}-${corpus.replace(/\W+/g, '_')}.json`)
  const r = correr('npm', ['run', '-s', 'voz:evaluar', '--', '--motor', motor, '--corpus', corpus, '--resumen', salida], {
    // Las reglas no cuestan ni tardan: su detalle no hace falta en pantalla.
    stdio: motor === 'reglas' ? 'pipe' : 'inherit',
  })
  if (r.status !== 0 || !existsSync(salida)) {
    if (motor === 'reglas') console.error(r.stderr || r.stdout)
    fallar(`La medición con ${motor} sobre ${corpus} falló.`)
  }
  const datos = JSON.parse(readFileSync(salida, 'utf8'))
  return { resumen: datos.resumen, caidas: datos.caidas, costo: datos.costo }
}

if (!sinMedir) {
  const carpeta = mkdtempSync(join(tmpdir(), 'tairos-dictado-'))
  const criterios: Array<{ corpus: string } & Criterio> = []
  let costo = 0
  try {
    for (const c of CORPUS) {
      paso(`Midiendo: ${c.nombre}`)
      const reglas = medir('reglas', c.ruta, carpeta)
      const modelo = medir('llm', c.ruta, carpeta)
      costo += modelo.costo
      criterios.push(...puerta(reglas, modelo).map((x) => ({ corpus: c.nombre, ...x })))
    }
  } finally {
    rmSync(carpeta, { recursive: true, force: true })
  }

  paso(`La puerta (costo de la medición: US$ ${costo.toFixed(2)})`)
  for (const c of criterios) console.log(`  ${c.cumple ? '✓' : '✗'} [${c.corpus}] ${c.nombre}: ${c.detalle}`)
  const fallidos = criterios.filter((c) => !c.cumple)
  if (fallidos.length && !forzar) {
    fallar(
      `No pasa la puerta (${fallidos.length} criterio${fallidos.length > 1 ? 's' : ''}): no se despliega.\n` +
        '  El dictado sigue con el intérprete básico. Revisa el detalle con\n' +
        '    npm run voz:evaluar -- --motor llm --detalle\n' +
        '  y, si decides desplegar igual, npm run voz:activar -- --sin-medir --forzar',
      2,
    )
  }
  bien(fallidos.length ? 'no pasa, pero se fuerza el despliegue (--forzar)' : 'pasa la puerta')
}

if (soloMedir) process.exit(0)

// --- 4. secreto y despliegue ---------------------------------------------------------

paso('Subiendo la clave como secreto de la función')
if (correr('npx', ['--yes', CLI, 'secrets', 'set', '--env-file', '.env.anthropic', '--project-ref', PROYECTO]).status !== 0) {
  fallar('No se pudo subir el secreto.')
}
bien('secreto ANTHROPIC_API_KEY guardado en Supabase')

paso('Desplegando la función extraer-dictado')
// --no-verify-jwt: la función comprueba la sesión ella misma (ver
// supabase/config.toml). --use-api: sin Docker.
const despliegue = correr('npx', [
  '--yes', CLI, 'functions', 'deploy', 'extraer-dictado',
  '--project-ref', PROYECTO, '--no-verify-jwt', '--use-api',
])
if (despliegue.status !== 0) fallar('El despliegue falló (el detalle está arriba).')
bien('desplegada')

// --- 5. comprobar -----------------------------------------------------------------

paso('Comprobando la función desplegada')
/** La clave pública de la app, la misma que ya va dentro del JavaScript publicado. */
function clavePublica(): string {
  if (!existsSync('.env.local')) return ''
  const m = readFileSync('.env.local', 'utf8').match(/^\s*VITE_SUPABASE_ANON_KEY\s*=\s*["']?([^"'\s#]+)/m)
  return m?.[1] ?? ''
}
const cabeceras: Record<string, string> = {}
const publica = clavePublica()
if (publica) cabeceras.apikey = publica

let listo = false
// Recién desplegada puede tardar unos segundos en responder.
for (let intento = 1; intento <= 5 && !listo; intento++) {
  try {
    const r = await fetch(URL_FUNCION, { headers: cabeceras })
    const datos = (await r.json().catch(() => null)) as { disponible?: boolean } | null
    listo = r.ok && datos?.disponible === true
  } catch {
    /* todavía no responde */
  }
  if (!listo) await new Promise((resolver) => setTimeout(resolver, 3_000))
}
if (!listo) fallar('La función no responde «disponible» tras el despliegue. Mira los registros en Supabase → Edge Functions.')
bien('responde y tiene la clave')

const sinSesion = await fetch(URL_FUNCION, {
  method: 'POST',
  headers: { ...cabeceras, 'Content-Type': 'application/json' },
  body: JSON.stringify({ texto: 'prueba' }),
}).catch(() => null)
if (sinSesion?.status !== 401) {
  fallar(`Sin sesión debería responder 401 y respondió ${sinSesion?.status ?? 'nada'}: revisa la función antes de usarla.`)
}
bien('sin sesión no llama al modelo (401)')

console.log(
  '\n✅ Listo. La app usará el intérprete inteligente sola: basta con recargar la página.\n' +
    '   Configuración → Dictado por voz muestra su estado y permite apagarlo.',
)
