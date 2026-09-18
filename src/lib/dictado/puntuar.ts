/**
 * Medidor del dictado: compara lo que extrae un intérprete con lo que debió
 * extraer. Lo usan scripts/evaluar-dictado.ts y scripts/smoke.ts; vive en src/
 * para que `npm run typecheck` lo revise, pero la app no lo importa.
 *
 * La métrica que manda no es el acierto sino la afirmación falsa: un campo
 * con un valor distinto al verdadero (erróneo) o con un valor cuando la frase
 * no decía nada (inventado). Un hueco se rellena a mano; una cifra falsa que
 * parece verdadera acaba en los libros.
 */
import { respaldo, type ClaseDeImporte } from '@/lib/dictado/validar'
import {
  montoDeItem,
  rutaDe,
  type Extraccion,
  type Intencion,
} from '../../../supabase/functions/_shared/dictado/tipos.ts'
import { normalizarDictado } from '../../../supabase/functions/_shared/dictado/vocabulario.ts'

// --- corpus ------------------------------------------------------------------

type Parcial<T> = { [K in keyof T]?: T[K] }

/** Lo esperado es parcial: solo se puntúa lo que la entrada del corpus dice. */
export interface Esperado {
  intent: Intencion
  pedido?: Parcial<{
    kind: 'Ingreso' | 'Egreso' | null
    parte: string | null
    telefono: string | null
    categoria: string | null
    pago: string | null
    items: Array<Parcial<{ descripcion: string; monto: number | null }>>
    adelanto: Parcial<{ tipo: 'total' | 'parcial' | 'credito' | null; monto: number | null }>
  }>
  proforma?: Parcial<{ cliente: string | null; detalle: string | null; total: number | null; vigenciaDias: number | null }>
  abono?: Parcial<{ parte: string | null; monto: number | null; pago: string | null }>
  deuda?: Parcial<{ kind: 'COBRAR' | 'PAGAR' | null; parte: string | null; concepto: string | null; total: number | null; vence: string | null }>
  /** Campos que el intérprete debe declarar como no dichos (hueco o elección). */
  faltantes?: string[]
  /** Campos con dos lecturas posibles: no se puede afirmar ninguna. */
  ambiguedades?: string[]
}

export interface EntradaCorpus {
  id: string
  frase: string
  etiquetas: string[]
  esperado: Esperado
  nota?: string
}

export function leerCorpus(jsonl: string): EntradaCorpus[] {
  return jsonl
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('//'))
    .map((l, i) => {
      try {
        return JSON.parse(l) as EntradaCorpus
      } catch (error) {
        throw new Error(`Corpus, línea ${i + 1}: ${error instanceof Error ? error.message : error}`)
      }
    })
}

// --- comparación -------------------------------------------------------------

export type Veredicto = 'acierto' | 'rehuso' | 'falta' | 'supuestoFallido' | 'erroneo' | 'inventado'

export interface ResultadoCampo {
  campo: string
  veredicto: Veredicto
  esperado: unknown
  obtenido: unknown
}

const plano = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()

const HONORIFICOS = /^(?:(?:el|la|los|las|al|a)\s+)?(?:(?:senor|senora|sr|sra|don|dona|cliente|clienta|proveedor|proveedora|empresa|la|el)\s+)*/

/** «la señora María» y «María» son la misma persona. */
const mismoNombre = (a: string, b: string) => plano(a).replace(HONORIFICOS, '') === plano(b).replace(HONORIFICOS, '')

/** Todas las palabras esperadas aparecen en lo obtenido. */
const contienePalabras = (esperado: string, obtenido: string) => {
  const hay = new Set(plano(obtenido).split(' '))
  return plano(esperado)
    .split(' ')
    .every((p) => !p || hay.has(p))
}

type Comparador = (esperado: unknown, obtenido: unknown) => boolean
const exacto: Comparador = (e, o) => e === o
const numero: Comparador = (e, o) => typeof e === 'number' && typeof o === 'number' && Math.abs(e - o) < 0.005
const nombre: Comparador = (e, o) => typeof e === 'string' && typeof o === 'string' && mismoNombre(e, o)
const texto: Comparador = (e, o) => typeof e === 'string' && typeof o === 'string' && contienePalabras(e, o)
const telefono: Comparador = (e, o) =>
  typeof e === 'string' && typeof o === 'string' && e.replace(/\D/g, '') === o.replace(/\D/g, '')

const vacio = (v: unknown) => v === null || v === undefined || (typeof v === 'string' && !v.trim())

function veredicto(esperado: unknown, obtenido: unknown, igual: Comparador, supuesto: boolean): Veredicto {
  const e = vacio(esperado)
  const o = vacio(obtenido)
  if (e && o) return 'rehuso'
  if (!e && o) return 'falta'
  if (!e && igual(esperado, obtenido)) return 'acierto'
  // Un valor por defecto que el intérprete declaró como suposición no es una
  // mentira: la pantalla lo marca para revisar. Pero hay que corregirlo.
  if (supuesto) return 'supuestoFallido'
  return e ? 'inventado' : 'erroneo'
}

// --- una frase -------------------------------------------------------------

export interface ResultadoFrase {
  id: string
  frase: string
  etiquetas: string[]
  intentEsperado: Intencion
  intentObtenido: Intencion
  rutaCorrecta: boolean
  intentExacto: boolean
  campos: ResultadoCampo[]
  /** Faltantes o ambigüedades esperados que el intérprete no declaró. */
  sinDeclarar: string[]
  /** Importes que no están en la frase (debería ser siempre 0 tras validar). */
  cifrasFuera: number
  aceptable: boolean
  segura: boolean
  ms: number
}

/** Todos los importes de la extracción, sea cual sea su bloque, con su clase. */
function importes(ex: Extraccion): Array<[number, ClaseDeImporte]> {
  const n: Array<[number | null | undefined, ClaseDeImporte]> = [
    ...(ex.pedido?.items.map((i): [number | null, ClaseDeImporte] => [i.monto, 'precio']) ?? []),
    [ex.pedido?.adelanto.tipo === 'parcial' ? ex.pedido.adelanto.monto : null, 'adelanto'],
    [ex.proforma?.total, 'total'],
    [ex.abono?.monto, 'abono'],
    [ex.deuda?.total, 'total'],
  ]
  return n.filter((par): par is [number, ClaseDeImporte] => typeof par[0] === 'number' && par[0] > 0)
}

export function puntuarFrase(entrada: EntradaCorpus, obtenida: Extraccion, ms = 0): ResultadoFrase {
  const { esperado } = entrada
  const campos: ResultadoCampo[] = []
  const supuestos = new Set(obtenida.supuestos)
  // Si «pagó todo» es una suposición, el monto que sale de ella también lo es.
  if (supuestos.has('cobro')) supuestos.add('adelanto')
  const mirar = (campo: string, e: unknown, o: unknown, igual: Comparador) =>
    campos.push({ campo, veredicto: veredicto(e, o, igual, supuestos.has(campo)), esperado: e, obtenido: o })
  const tiene = <T extends object>(obj: T | undefined, k: keyof T) => obj !== undefined && k in obj

  const ep = esperado.pedido
  if (ep) {
    const op = obtenida.pedido
    if (tiene(ep, 'kind')) mirar('kind', ep.kind, op?.kind, exacto)
    if (tiene(ep, 'parte')) mirar('parte', ep.parte, op?.parte, nombre)
    if (tiene(ep, 'telefono')) mirar('telefono', ep.telefono, op?.telefono, telefono)
    if (tiene(ep, 'categoria')) mirar('categoria', ep.categoria, op?.categoria, exacto)
    if (tiene(ep, 'pago')) mirar('pago', ep.pago, op?.pago, exacto)
    if (ep.items) {
      const obtenidos = op?.items ?? []
      const n = ep.items.length
      campos.push({
        campo: 'items',
        veredicto: obtenidos.length === n ? 'acierto' : obtenidos.length < n ? 'falta' : 'erroneo',
        esperado: n,
        obtenido: obtenidos.length,
      })
      // Con otra cantidad de trabajos no hay correspondencia uno a uno.
      if (obtenidos.length === n) {
        ep.items.forEach((it, i) => {
          if ('monto' in it) mirar(montoDeItem(i), it.monto, obtenidos[i].monto, numero)
          if ('descripcion' in it) mirar(`items.${i}.descripcion`, it.descripcion, obtenidos[i].descripcion, texto)
        })
      }
    }
    if (ep.adelanto) {
      if ('tipo' in ep.adelanto) mirar('cobro', ep.adelanto.tipo, op?.adelanto.tipo, exacto)
      if ('monto' in ep.adelanto) mirar('adelanto', ep.adelanto.monto, op?.adelanto.monto, numero)
    }
  }

  const ef = esperado.proforma
  if (ef) {
    const of = obtenida.proforma
    if (tiene(ef, 'cliente')) mirar('cliente', ef.cliente, of?.cliente, nombre)
    if (tiene(ef, 'detalle')) mirar('detalle', ef.detalle, of?.detalle, texto)
    if (tiene(ef, 'total')) mirar('total', ef.total, of?.total, numero)
    if (tiene(ef, 'vigenciaDias')) mirar('vigenciaDias', ef.vigenciaDias, of?.vigenciaDias, exacto)
  }

  const eb = esperado.abono
  if (eb) {
    const ob = obtenida.abono
    if (tiene(eb, 'parte')) mirar('parte', eb.parte, ob?.parte, nombre)
    if (tiene(eb, 'monto')) mirar('monto', eb.monto, ob?.monto, numero)
    if (tiene(eb, 'pago')) mirar('pago', eb.pago, ob?.pago, exacto)
  }

  const ed = esperado.deuda
  if (ed) {
    const od = obtenida.deuda
    if (tiene(ed, 'kind')) mirar('kind', ed.kind, od?.kind, exacto)
    if (tiene(ed, 'parte')) mirar('parte', ed.parte, od?.parte, nombre)
    if (tiene(ed, 'concepto')) mirar('concepto', ed.concepto, od?.concepto, texto)
    if (tiene(ed, 'total')) mirar('total', ed.total, od?.total, numero)
    if (tiene(ed, 'vence')) mirar('vence', ed.vence, od?.vence, exacto)
  }

  // Un campo ambiguo queda bien declarado como elección o, al menos, como
  // hueco: lo que importa es que no se afirme ninguna de las dos lecturas.
  const declarados = new Set([...obtenida.faltantes, ...obtenida.ambiguedades.map((a) => a.campo)])
  const sinDeclarar = [...(esperado.faltantes ?? []), ...(esperado.ambiguedades ?? [])].filter(
    (c) => !declarados.has(c),
  )

  // Con la misma regla que la guarda del validador: una línea «a 70 cada una»
  // puede valer 210 sin que nadie haya dicho 210.
  const normal = normalizarDictado(entrada.frase)
  const cifrasFuera = importes(obtenida).filter(([v, clase]) => respaldo(v, normal, clase) !== 'respaldada').length

  const rutaCorrecta = rutaDe(esperado.intent) === rutaDe(obtenida.intent)
  const falsas = campos.some((c) => c.veredicto === 'erroneo' || c.veredicto === 'inventado')
  return {
    id: entrada.id,
    frase: entrada.frase,
    etiquetas: entrada.etiquetas,
    intentEsperado: esperado.intent,
    intentObtenido: obtenida.intent,
    rutaCorrecta,
    intentExacto: esperado.intent === obtenida.intent,
    campos,
    sinDeclarar,
    cifrasFuera,
    aceptable:
      rutaCorrecta &&
      campos.every((c) => c.veredicto === 'acierto' || c.veredicto === 'rehuso') &&
      sinDeclarar.length === 0,
    segura: !falsas && cifrasFuera === 0,
    ms,
  }
}

// --- resumen -----------------------------------------------------------------

export interface Resumen {
  frases: number
  rutaCorrecta: number
  intentExacto: number
  campos: Record<Veredicto, number>
  /** erróneos + inventados */
  afirmacionesFalsas: number
  sinDeclarar: number
  cifrasFuera: number
  aceptables: number
  seguras: number
  porEtiqueta: Record<string, { frases: number; aceptables: number; falsas: number }>
  msP50: number
  msP95: number
}

const percentil = (valores: number[], p: number) => {
  if (!valores.length) return 0
  const orden = [...valores].sort((a, b) => a - b)
  return orden[Math.min(orden.length - 1, Math.ceil((p / 100) * orden.length) - 1)]
}

export function resumir(resultados: ResultadoFrase[]): Resumen {
  const campos: Record<Veredicto, number> = {
    acierto: 0,
    rehuso: 0,
    falta: 0,
    supuestoFallido: 0,
    erroneo: 0,
    inventado: 0,
  }
  const porEtiqueta: Resumen['porEtiqueta'] = {}
  for (const r of resultados) {
    for (const c of r.campos) campos[c.veredicto]++
    const falsas = r.campos.filter((c) => c.veredicto === 'erroneo' || c.veredicto === 'inventado').length
    for (const e of r.etiquetas) {
      const g = (porEtiqueta[e] ??= { frases: 0, aceptables: 0, falsas: 0 })
      g.frases++
      if (r.aceptable) g.aceptables++
      g.falsas += falsas
    }
  }
  return {
    frases: resultados.length,
    rutaCorrecta: resultados.filter((r) => r.rutaCorrecta).length,
    intentExacto: resultados.filter((r) => r.intentExacto).length,
    campos,
    afirmacionesFalsas: campos.erroneo + campos.inventado,
    sinDeclarar: resultados.reduce((s, r) => s + r.sinDeclarar.length, 0),
    cifrasFuera: resultados.reduce((s, r) => s + r.cifrasFuera, 0),
    aceptables: resultados.filter((r) => r.aceptable).length,
    seguras: resultados.filter((r) => r.segura).length,
    porEtiqueta,
    msP50: percentil(resultados.map((r) => r.ms), 50),
    msP95: percentil(resultados.map((r) => r.ms), 95),
  }
}

const pct = (n: number, de: number) => (de ? `${((100 * n) / de).toFixed(1)} %` : '—')

export function formatearResumen(r: Resumen, motor: string): string {
  const puntuados = Object.values(r.campos).reduce((s, n) => s + n, 0)
  const lineas = [
    `Motor: ${motor} · ${r.frases} frases · ${puntuados} campos puntuados`,
    '',
    `  Ruta correcta ............ ${r.rutaCorrecta}/${r.frases}  (${pct(r.rutaCorrecta, r.frases)})`,
    `  Intención exacta ......... ${r.intentExacto}/${r.frases}  (${pct(r.intentExacto, r.frases)})`,
    `  Frases aceptables ........ ${r.aceptables}/${r.frases}  (${pct(r.aceptables, r.frases)})   todo correcto, nada que corregir`,
    `  Frases seguras ........... ${r.seguras}/${r.frases}  (${pct(r.seguras, r.frases)})   ninguna afirmación falsa`,
    '',
    `  AFIRMACIONES FALSAS ...... ${r.afirmacionesFalsas}   (erróneos ${r.campos.erroneo} + inventados ${r.campos.inventado})`,
    `  Cifras fuera de la frase . ${r.cifrasFuera}`,
    `  Faltas ................... ${r.campos.falta}   (el usuario rellena el hueco)`,
    `  Supuestos fallidos ....... ${r.campos.supuestoFallido}   (declarados como suposición, pero mal)`,
    `  Sin declarar ............. ${r.sinDeclarar}   (huecos o dudas esperados que no se avisaron)`,
    `  Aciertos ................. ${r.campos.acierto}   · rehúsos correctos ${r.campos.rehuso}`,
  ]
  if (r.msP50) lineas.push('', `  Latencia ................. p50 ${r.msP50} ms · p95 ${r.msP95} ms`)
  lineas.push('', '  Por etiqueta (aceptables · afirmaciones falsas):')
  for (const [e, g] of Object.entries(r.porEtiqueta).sort()) {
    lineas.push(`    ${e.padEnd(22)} ${String(g.aceptables).padStart(3)}/${String(g.frases).padEnd(3)} ${pct(g.aceptables, g.frases).padStart(8)} · ${g.falsas}`)
  }
  return lineas.join('\n')
}
