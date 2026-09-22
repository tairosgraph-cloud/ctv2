/**
 * Emparejar el nombre dictado con los clientes y proveedores que ya existen.
 *
 * El dictado trae «Rosa»; en los libros está «Rosa de la Cruz». Si el
 * formulario guardara «Rosa», la misma persona quedaría partida en dos y sus
 * deudas no se sumarían. Pero adivinar también es peligroso: con dos Rosas,
 * elegir una es inventar. De ahí las salidas:
 * - el mismo nombre, o una sola que empieza igual → se usa, marcada para revisar;
 * - una sola que solo se parece (palabra interna, prefijo, una letra) → se
 *   deja lo dicho y se sugiere la candidata: puede ser otra persona;
 * - varias igual de buenas → se ofrecen y elige la persona;
 * - ninguna → lo dicho, como parte nueva.
 *
 * Puro: sin React ni datos globales, para probarlo en smoke.
 */

/** Tratamientos y rótulos que no forman parte del nombre. */
const TRATAMIENTOS = new Set([
  'el', 'la', 'los', 'las', 'al', 'a',
  'senor', 'senora', 'senorita', 'sr', 'sra', 'srta', 'don', 'dona', 'do',
  'cliente', 'clienta', 'proveedor', 'proveedora', 'empresa', 'tio', 'tia',
])

/** Palabras que no distinguen a nadie: no cuentan para emparejar. */
const VACIAS = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'y', 'e', 'sac', 'sa', 'eirl', 'srl'])

/** Sin tildes, en minúsculas, sin puntuación y sin tratamientos al principio. */
export function normalizar(nombre: string): string {
  const palabras = nombre
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)
  let i = 0
  while (i < palabras.length - 1 && TRATAMIENTOS.has(palabras[i])) i++
  return palabras.slice(i).join(' ')
}

const significativas = (normalizado: string) => normalizado.split(' ').filter((p) => p && !VACIAS.has(p))

export interface Parte {
  /** Como está escrito en los libros (la escritura más reciente). */
  nombre: string
  /** ISO de la última vez que aparece: desempata a favor de lo reciente. */
  ultimaVez: string
}

/**
 * Un nombre por persona: «Rosa de la Cruz» y «rosa de la cruz» son la misma.
 * Se queda la escritura más reciente.
 */
export function catalogoDePartes(apariciones: ReadonlyArray<{ nombre: string; fecha: string }>): Parte[] {
  const porClave = new Map<string, Parte>()
  for (const { nombre, fecha } of apariciones) {
    const limpio = nombre.trim()
    const clave = normalizar(limpio)
    if (!clave) continue
    const actual = porClave.get(clave)
    if (!actual || fecha > actual.ultimaVez) porClave.set(clave, { nombre: limpio, ultimaVez: fecha })
  }
  return [...porClave.values()]
}

function distancia(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 1) return 2
  let previa = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const fila = [i]
    for (let j = 1; j <= b.length; j++) {
      fila[j] = Math.min(previa[j] + 1, fila[j - 1] + 1, previa[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
    previa = fila
  }
  return previa[b.length]
}

/** Qué tan bien encaja lo dicho en un nombre del catálogo; 0 = nada. */
function puntuar(dicho: string, candidato: string): number {
  if (dicho === candidato) return 100
  const d = significativas(dicho)
  const c = significativas(candidato)
  if (!d.length || !c.length) return 0
  if (d.every((p) => c.includes(p))) return c[0] === d[0] ? 80 : 60
  if (d.every((p) => p.length >= 3 && c.some((q) => q.startsWith(p)))) return 40
  // Ruido del reconocedor: «Mamany» por «Mamani». Solo en palabras largas,
  // donde una letra de diferencia no convierte un nombre en otro.
  const parecida = (p: string) => c.some((q) => q === p || (p.length >= 5 && q.length >= 5 && distancia(p, q) <= 1))
  return d.every(parecida) ? 30 : 0
}

export type Resolucion =
  | { tipo: 'exacta'; nombre: string }
  | { tipo: 'unica'; nombre: string }
  | { tipo: 'parecida'; nombre: string; dicho: string }
  | { tipo: 'varias'; opciones: string[] }
  | { tipo: 'nueva'; nombre: string }

/** Desde aquí una candidata única se usa sin preguntar: empieza igual. */
const CLARA = 80

/** Cuántas candidatas se ofrecen como mucho: más no se leen de un vistazo. */
const MAX_OPCIONES = 4

export function buscarParte(dicho: string, catalogo: ReadonlyArray<Parte>): Resolucion {
  const limpio = dicho.trim()
  const clave = normalizar(limpio)
  if (!clave) return { tipo: 'nueva', nombre: limpio }

  const candidatas = catalogo
    .map((parte) => ({ parte, puntos: puntuar(clave, normalizar(parte.nombre)) }))
    .filter((c) => c.puntos > 0)
    .sort((a, b) => b.puntos - a.puntos || b.parte.ultimaVez.localeCompare(a.parte.ultimaVez))

  if (!candidatas.length) return { tipo: 'nueva', nombre: limpio }
  const mejor = candidatas[0]
  if (mejor.puntos === 100) return { tipo: 'exacta', nombre: mejor.parte.nombre }
  const empatadas = candidatas.filter((c) => c.puntos === mejor.puntos)
  if (empatadas.length === 1) {
    return mejor.puntos >= CLARA
      ? { tipo: 'unica', nombre: mejor.parte.nombre }
      : { tipo: 'parecida', nombre: mejor.parte.nombre, dicho: limpio }
  }
  return { tipo: 'varias', opciones: empatadas.slice(0, MAX_OPCIONES).map((c) => c.parte.nombre) }
}
