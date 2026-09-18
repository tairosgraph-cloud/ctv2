/**
 * Evaluador del dictado: pasa el corpus por un intérprete y lo mide.
 *
 *   npm run voz:evaluar                        reglas, resumen
 *   npm run voz:evaluar -- --detalle           y cada frase que no quedó perfecta
 *   npm run voz:evaluar -- --etiqueta pedido   solo las frases con esa etiqueta
 *   npm run voz:evaluar -- --json salida.json  el detalle completo, para comparar corridas
 *   npm run voz:evaluar -- --motor llm         el modelo (Fase 2)
 *
 * Mide la tubería entera que verá el formulario: intérprete + validarExtraccion.
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
import { readFileSync, writeFileSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import { formatearResumen, leerCorpus, puntuarFrase, resumir } from '@/lib/dictado/puntuar'
import { desdeReglas } from '@/lib/dictado/reglas'
import { validarExtraccion } from '@/lib/dictado/validar'

const args = process.argv.slice(2)
const opcion = (nombre: string) => {
  const i = args.indexOf(nombre)
  return i >= 0 ? args[i + 1] : undefined
}

const motor = opcion('--motor') ?? 'reglas'
const rutaCorpus = opcion('--corpus') ?? 'scripts/corpus-dictado.jsonl'
const etiqueta = opcion('--etiqueta')

if (motor !== 'reglas') {
  console.error(`El motor «${motor}» todavía no existe: el extractor con el modelo llega en la Fase 2.`)
  process.exit(2)
}

const corpus = leerCorpus(readFileSync(rutaCorpus, 'utf8')).filter(
  (e) => !etiqueta || e.etiquetas.includes(etiqueta),
)

const resultados = corpus.map((entrada) => {
  const t0 = performance.now()
  const extraida = validarExtraccion(desdeReglas(entrada.frase), entrada.frase)
  const ms = Math.round(performance.now() - t0)
  return { resultado: puntuarFrase(entrada, extraida, ms), extraida }
})

console.log(formatearResumen(resumir(resultados.map((r) => r.resultado)), motor))

if (args.includes('--detalle')) {
  console.log('\nFrases que no quedaron perfectas:\n')
  for (const { resultado: r } of resultados) {
    if (r.aceptable) continue
    const marca = r.segura ? '·' : '✗'
    console.log(`${marca} ${r.id}  «${r.frase}»`)
    if (!r.rutaCorrecta) console.log(`    ruta: esperaba ${r.intentEsperado}, salió ${r.intentObtenido}`)
    for (const c of r.campos) {
      if (c.veredicto === 'acierto' || c.veredicto === 'rehuso') continue
      console.log(`    ${c.veredicto.padEnd(15)} ${c.campo.padEnd(18)} esperaba ${JSON.stringify(c.esperado)}, salió ${JSON.stringify(c.obtenido)}`)
    }
    if (r.sinDeclarar.length) console.log(`    sin declarar     ${r.sinDeclarar.join(', ')}`)
    if (r.cifrasFuera) console.log(`    CIFRAS FUERA DE LA FRASE: ${r.cifrasFuera}`)
  }
}

const salida = opcion('--json')
if (salida) {
  writeFileSync(salida, JSON.stringify(resultados, null, 2))
  console.log(`\nDetalle en ${salida}`)
}
