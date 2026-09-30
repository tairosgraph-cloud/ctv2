/**
 * El filtro que parte la frase en los trabajos que nombra, antes de creerse
 * ningún precio.
 *
 * Una frase de mostrador mete varias cosas de corrido: «500 tarjetas a 85 y
 * mil volantes a 240, dejó 100 en efectivo». Sin partirla, el precio de un
 * trabajo puede acabar en el otro, y eso no lo ve ninguna guarda que mire la
 * frase entera: las dos cifras están dichas, así que las dos «cuadran». El
 * error no es una cifra inventada, es una cifra en la línea equivocada.
 *
 * Aquí se separa lo que habla de cada trabajo de lo que vale para todo el
 * pedido (quién lo encarga, cómo pagó, para cuándo es), y con eso:
 *   - las reglas sacan una línea por trabajo, en vez de rendirse (reglas.ts);
 *   - el validador exige que el precio de cada línea esté dicho EN SU trozo,
 *     venga del modelo o de las reglas (validar.ts);
 *   - y el modelo recibe la misma instrucción en su prompt (prompt.ts).
 *
 * Solo parte cuando **al menos dos trabajos traen su propio precio**. Un precio
 * para varias cosas («60 soles por fotocopias y anillado») es una sola línea:
 * repartirlo sería inventar. Y partir donde no toca es peor que no partir,
 * porque deja cada precio fuera de su sitio.
 */
import { cifrasDeLaFrase, hayPalabraDeTrabajo } from '@/lib/voiceParser'
import { hayFechaDeEntrega } from '../../../supabase/functions/_shared/dictado/fechas.ts'
import { palabra } from '../../../supabase/functions/_shared/dictado/vocabulario.ts'

/**
 * Lo que separa dos datos dichos de corrido. «y» también une cifras
 * («cincuenta y dos»), pero eso se arregla al clasificar: el trozo que queda
 * detrás no nombra ningún trabajo, así que vuelve a pegarse al anterior.
 */
const CORTE = /\s*(?:[,;:]|(?<![\p{L}\d])(?:y|e|m[aá]s|tambi[eé]n|adem[aá]s|asimismo)(?![\p{L}\d]))\s*/giu

/** Cómo se pagó: nunca es un trabajo, aunque lleve cifra. */
const MARCA_PAGO = palabra('efectivo|yape|plin|transferencia|dep[oó]sito|tarjeta|visa|pos|bcp|interbank|bbva')
/** Cuánto se cobró ahora: tampoco es un trabajo. */
const MARCA_COBRO = palabra(
  'adelant\\p{L}*|a\\s+cuenta|saldo|el\\s+resto|dej(?:[oóa]|an|aron)|fiad[oa]|al\\s+cr[eé]dito' +
    '|sin\\s+adelanto|la\\s+mitad|pag[oó]|pagu[eé]|cancel[oó]|abon[oó]|vuelto|debe',
)

interface Trozo {
  texto: string
  /** Lo que lo separaba del anterior, para volver a pegarlo tal cual. */
  separador: string
}

function trocear(texto: string): Trozo[] {
  const trozos: Trozo[] = []
  let desde = 0
  let separador = ''
  for (const m of texto.matchAll(CORTE)) {
    const inicio = m.index ?? 0
    trozos.push({ texto: texto.slice(desde, inicio).trim(), separador })
    separador = m[0]
    desde = inicio + m[0].length
  }
  trozos.push({ texto: texto.slice(desde).trim(), separador })
  return trozos.filter((t) => t.texto !== '')
}

/**
 * - `trabajo`: nombra algo que se hace o se compra («500 tarjetas», «el
 *   anillado»): abre una línea.
 * - `precio`: solo una cifra de dinero («85 soles»): es el precio del trabajo
 *   que tiene al lado, no otro trabajo.
 * - `comun`: lo que vale para todo el pedido, o nada que registrar.
 */
type Clase = 'trabajo' | 'precio' | 'comun'

function clasificar(trozo: string): Clase {
  const cifras = cifrasDeLaFrase(trozo)
  // Una cantidad de cosas («mil volantes») abre trabajo igual que la palabra
  // del oficio: la lista de productos nunca estará completa.
  if (hayPalabraDeTrabajo(trozo) || cifras.some((c) => c.cantidad)) return 'trabajo'
  if (!cifras.some((c) => !c.descartada)) return 'comun'
  if (MARCA_PAGO.test(trozo) || MARCA_COBRO.test(trozo) || hayFechaDeEntrega(trozo)) return 'comun'
  return 'precio'
}

/** ¿El trozo dice una cifra de dinero suya? (una cantidad de cosas no lo es). */
const tienePrecio = (texto: string) => cifrasDeLaFrase(texto).some((c) => !c.descartada)

export interface Linea {
  /** Todo lo que se dijo de ese trabajo, en el orden en que se dijo. */
  texto: string
  /** El trozo que lo nombra, del que sale la descripción: «mil volantes». */
  nombra: string
}

export interface Segmentos {
  /** Un trozo por trabajo con precio propio. Siempre al menos uno. */
  lineas: Linea[]
  /** Lo que se dijo una vez y vale para todo: quién, cómo pagó, para cuándo. */
  comun: string
  /** true solo si la frase nombra más de un trabajo con su precio. */
  varios: boolean
}

/** Palabras que no distinguen un trabajo de otro: no sirven para emparejar. */
const VACIAS = new Set([
  'para', 'por', 'con', 'del', 'las', 'los', 'una', 'uno', 'unos', 'unas', 'soles', 'sol',
  'cada', 'mas', 'que', 'sus', 'este', 'esta', 'estos', 'estas', 'son', 'mil', 'cien', 'ciento',
  'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve', 'diez', 'veinte', 'treinta',
  'cuarenta', 'cincuenta', 'sesenta', 'setenta', 'ochenta', 'noventa', 'doscientos', 'trescientos',
  'cuatrocientos', 'quinientos', 'seiscientos', 'setecientos', 'ochocientos', 'novecientos',
  'quinientas', 'doscientas', 'trescientas', 'cliente', 'proveedor', 'senor', 'senora', 'senorita',
  'vendi', 'compre', 'cobre', 'ingreso', 'egreso', 'pedido', 'encargo', 'orden', 'trabajo',
])

const claves = (texto: string): string[] => [
  ...new Set(
    (texto.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().match(/\p{L}{3,}/gu) ?? []).filter(
      (p) => !VACIAS.has(p),
    ),
  ),
]

const comparten = (a: string, b: string): number => {
  const suyas = new Set(claves(b))
  return claves(a).filter((p) => suyas.has(p)).length
}

interface Grupo {
  /** Los trozos que hablan del mismo trabajo, en el orden en que se dijeron. */
  partes: string[]
  precio: boolean
}

export function segmentar(texto: string): Segmentos {
  const grupos: Grupo[] = []
  const comun: string[] = []
  /** Un precio dicho antes de nombrar el trabajo: «60 soles por fotocopias». */
  let adelantado = ''

  for (const trozo of trocear(texto)) {
    switch (clasificar(trozo.texto)) {
      case 'trabajo': {
        const partes = adelantado ? [adelantado, trozo.texto] : [trozo.texto]
        adelantado = ''
        grupos.push({ partes, precio: partes.some(tienePrecio) })
        break
      }
      case 'precio':
        // Detrás del trabajo es su precio; delante, espera al trabajo.
        if (grupos.length) {
          const ultimo = grupos[grupos.length - 1]
          ultimo.partes[ultimo.partes.length - 1] += `${trozo.separador}${trozo.texto}`
          ultimo.precio = true
        } else {
          adelantado = trozo.texto
        }
        break
      default:
        comun.push(trozo.texto)
    }
  }
  if (adelantado) comun.push(adelantado)

  const conPrecio = grupos.filter((g) => g.precio)
  // Un trabajo sin precio propio no es una línea aparte: su precio lo dice otro
  // trozo («mil volantes … 240 los volantes») o lo comparte con el de al lado
  // («60 soles por fotocopias y anillado»). Se junta con el que más se le
  // parece, y si no se parece a ninguno, con el de al lado.
  if (conPrecio.length >= 2) {
    for (const grupo of grupos) {
      if (grupo.precio) continue
      const suyo = grupo.partes.join(' ')
      const parecidos = conPrecio
        .map((g) => ({ g, puntos: comparten(suyo, g.partes.join(' ')) }))
        .filter((x) => x.puntos > 0)
        .sort((a, b) => b.puntos - a.puntos)
      const destino = parecidos[0]?.g ?? vecinoConPrecio(grupos, grupo)
      if (!destino) continue
      // El orden es el de la frase: el trozo que nombra el trabajo va primero
      // si se dijo primero.
      if (grupos.indexOf(grupo) < grupos.indexOf(destino)) destino.partes.unshift(...grupo.partes)
      else destino.partes.push(...grupo.partes)
      grupo.partes = []
    }
  }

  const lineas = grupos
    .filter((g) => g.precio && g.partes.length)
    .map<Linea>((g) => ({ texto: g.partes.join(' '), nombra: g.partes[0] }))
  const sueltos = grupos.filter((g) => !g.precio && g.partes.length).map((g) => g.partes.join(' '))

  if (lineas.length < 2) return { lineas: [{ texto, nombra: texto }], comun: texto, varios: false }
  return { lineas, comun: [...sueltos, ...comun].join(' '), varios: true }
}

/** El grupo con precio más cercano: primero el de antes, luego el de después. */
function vecinoConPrecio(grupos: Grupo[], grupo: Grupo): Grupo | null {
  const i = grupos.indexOf(grupo)
  for (let d = 1; d < grupos.length; d++) {
    const antes = grupos[i - d]
    if (antes?.precio) return antes
    const despues = grupos[i + d]
    if (despues?.precio) return despues
  }
  return null
}

/**
 * De qué trozo salió cada línea de la extracción.
 *
 * Primero por las palabras que comparten la descripción y el trozo (el modelo
 * puede devolverlas en otro orden); si eso no reparte todas, por el orden en
 * que se dijeron, que es el que el prompt exige. Si tampoco cuadra —el modelo
 * juntó o partió los trabajos de otra manera— devuelve null en todas: el
 * validador vuelve a mirar la frase entera y no se afirma nada de más.
 */
export function alinear(descripciones: readonly string[], lineas: readonly Linea[]): (string | null)[] {
  const sinPareja = descripciones.map(() => null as string | null)
  if (!descripciones.length || !lineas.length) return sinPareja

  const parecidos: { i: number; j: number; puntos: number }[] = []
  descripciones.forEach((d, i) => {
    lineas.forEach((l, j) => {
      const puntos = comparten(d, l.texto)
      if (puntos > 0) parecidos.push({ i, j, puntos })
    })
  })
  // El mejor parecido primero; a igualdad, el orden en que se dijeron.
  parecidos.sort((a, b) => b.puntos - a.puntos || a.i - b.i || a.j - b.j)

  const porPalabras = [...sinPareja]
  const usadas = new Set<number>()
  for (const { i, j } of parecidos) {
    if (porPalabras[i] !== null || usadas.has(j)) continue
    porPalabras[i] = lineas[j].texto
    usadas.add(j)
  }
  if (porPalabras.every((p) => p !== null)) return porPalabras
  // Ninguna palabra en común no significa que no haya orden: «el diseño» puede
  // no repetir nada del trozo. Con tantas líneas como trozos, manda el orden.
  if (descripciones.length === lineas.length) return lineas.map((l) => l.texto)
  return sinPareja
}
