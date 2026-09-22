/**
 * De la extracción a lo que cada formulario pone en pantalla.
 *
 * Puro (sin React), para probarlo en smoke. Cada formulario recibe:
 * - los valores a rellenar (null = no tocar ese campo);
 * - `marcas`: lo que rellenó el dictado, que se pinta en ámbar;
 * - `dudas`: campos con varias lecturas, que quedan vacíos hasta que la
 *   persona elige una opción;
 * - `faltantes` y `supuestos`, ya en palabras, para el aviso.
 *
 * Los nombres se emparejan con los que ya existen (src/lib/partes.ts).
 */
import { money } from '@/lib/format'
import { buscarParte, normalizar, type Parte } from '@/lib/partes'
import { CATEGORIES, PAYMENT_METHODS, type Debt, type DebtKind, type PaymentMethod, type TxType } from '@/types'
import { rutaDe, VIGENCIAS, type Ambiguedad, type Extraccion, type Vigencia } from '../../../supabase/functions/_shared/dictado/tipos.ts'

export interface Opcion {
  valor: string
  texto: string
}

export interface Duda {
  campo: string
  pregunta: string
  opciones: Opcion[]
}

/** Lo que todo formulario dictado comparte. */
export interface Dictado {
  marcas: string[]
  dudas: Duda[]
  faltantes: string[]
  supuestos: string[]
}

// --- piezas comunes ---------------------------------------------------------

const cifras = (a: Ambiguedad): Opcion[] =>
  a.opciones
    .map(Number)
    .filter((n) => Number.isFinite(n) && n > 0)
    .map((n) => ({ valor: String(n), texto: money(n) }))

const deLista = (a: Ambiguedad, lista: readonly string[], texto: (v: string) => string = (v) => v): Opcion[] =>
  a.opciones.filter((o) => lista.includes(o)).map((o) => ({ valor: o, texto: texto(o) }))

/** Una duda solo sirve con dos opciones o más; con menos, es un hueco. */
const duda = (campo: string, pregunta: string, opciones: Opcion[]): Duda[] =>
  opciones.length >= 2 ? [{ campo, pregunta, opciones }] : []

interface ParteResuelta {
  valor: string | null
  dudas: Duda[]
}

/**
 * El nombre dicho, contrastado con los que ya existen. Con varias candidatas
 * se pregunta; con una que solo se parece, se deja lo dicho y se sugiere.
 */
function resolverParte(dicha: string | null, catalogo: ReadonlyArray<Parte>, campo: string, quien: string): ParteResuelta {
  if (!dicha?.trim()) return { valor: null, dudas: [] }
  const r = buscarParte(dicha, catalogo)
  switch (r.tipo) {
    case 'exacta':
    case 'unica':
    case 'nueva':
      return { valor: r.nombre, dudas: [] }
    case 'parecida':
      return {
        valor: r.dicho,
        dudas: duda(campo, `¿Es el ${quien} «${r.nombre}»?`, [
          { valor: r.nombre, texto: r.nombre },
          { valor: r.dicho, texto: `${r.dicho} (nuevo)` },
        ]),
      }
    case 'varias':
      return {
        valor: null,
        dudas: duda(campo, `¿Qué ${quien}?`, [
          ...r.opciones.map((n) => ({ valor: n, texto: n })),
          { valor: dicha.trim(), texto: `${dicha.trim()} (nuevo)` },
        ]),
      }
  }
}

const SUPUESTOS: Record<string, string> = {
  kind: 'si es ingreso o egreso',
  categoria: 'la categoría',
  cobro: 'que se pagó todo',
}

const supuestosEnPalabras = (ex: Extraccion) => ex.supuestos.map((s) => SUPUESTOS[s]).filter(Boolean)

// --- libro: ingreso, egreso y pedido ------------------------------------------

export interface FormularioPedido extends Dictado {
  tipo: TxType | null
  parte: string | null
  telefono: string | null
  categoria: string | null
  pago: PaymentMethod | null
  /** Al menos una. El monto es texto, como en el campo. */
  lineas: { descripcion: string; monto: string }[]
  /** null: la frase no dice cómo se cobró; el formulario deja lo que tenga. */
  cobro: { parcial: boolean; adelanto: string } | null
  /** Para cuándo es ('AAAA-MM-DD'), si la frase lo dice. */
  entrega: string | null
}

export function formularioDePedido(ex: Extraccion, catalogo: ReadonlyArray<Parte>): FormularioPedido | null {
  const p = ex.pedido
  if (!p || rutaDe(ex.intent) !== 'registro') return null

  const tipo: TxType | null = p.kind
  const quien = tipo === 'Egreso' ? 'proveedor' : 'cliente'
  const marcas = new Set<string>()
  const dudas: Duda[] = []

  if (tipo) marcas.add('tipo')
  const parte = resolverParte(p.parte, catalogo, 'parte', quien)
  if (parte.valor) marcas.add('parte')
  dudas.push(...parte.dudas)
  if (p.telefono) marcas.add('telefono')
  if (p.categoria) marcas.add('categoria')
  if (p.pago) marcas.add('pago')
  if (p.entrega) marcas.add('entrega')

  const lineas = (p.items.length ? p.items : [{ descripcion: '', monto: null }]).map((item, i) => {
    if (item.descripcion) marcas.add(`descripcion-${i}`)
    if (item.monto !== null) marcas.add(`monto-${i}`)
    return { descripcion: item.descripcion ?? '', monto: item.monto !== null ? String(item.monto) : '' }
  })

  let cobro: FormularioPedido['cobro'] = null
  switch (p.adelanto.tipo) {
    case 'total':
      cobro = { parcial: false, adelanto: '' }
      break
    case 'parcial':
      cobro = { parcial: true, adelanto: p.adelanto.monto !== null ? String(p.adelanto.monto) : '' }
      if (p.adelanto.monto !== null) marcas.add('adelanto')
      break
    case 'credito':
      cobro = { parcial: true, adelanto: '0' }
      marcas.add('adelanto')
      break
  }
  // Dicho o no, lo que el formulario muestre sobre el cobro lo puso el dictado
  // (o su valor por defecto): hay que mirarlo.
  marcas.add('cobro')

  for (const a of ex.ambiguedades) {
    const linea = /^items\.(\d+)\.monto$/.exec(a.campo)
    if (linea) {
      const i = Number(linea[1])
      const que = lineas[i]?.descripcion || (lineas.length > 1 ? `el trabajo ${i + 1}` : 'el trabajo')
      dudas.push(...duda(a.campo, `¿Cuánto vale ${que}?`, cifras(a)))
    } else if (a.campo === 'adelanto') {
      dudas.push(...duda('adelanto', '¿Cuánto adelantó?', cifras(a)))
    } else if (a.campo === 'pago') {
      dudas.push(...duda('pago', '¿Con qué pagó?', deLista(a, PAYMENT_METHODS)))
    } else if (a.campo === 'kind') {
      dudas.push(...duda('kind', '¿Entra o sale dinero?', deLista(a, ['Ingreso', 'Egreso'])))
    } else if (a.campo === 'categoria') {
      dudas.push(...duda('categoria', '¿De qué categoría?', deLista(a, CATEGORIES)))
    }
  }

  const conDuda = new Set(dudas.map((d) => d.campo))
  const faltantes = ex.faltantes
    .filter((f) => !conDuda.has(f))
    .map((f) => {
      const linea = /^items\.(\d+)\.monto$/.exec(f)
      if (linea) return lineas.length > 1 ? `el monto del trabajo ${Number(linea[1]) + 1}` : 'el monto'
      return (
        {
          parte: `el ${quien}`,
          pago: 'el método de pago',
          cobro: 'si pagó todo o dejó un adelanto',
          adelanto: 'cuánto adelantó',
          categoria: 'la categoría',
          kind: 'si es ingreso o egreso',
          items: 'el trabajo',
        } as Record<string, string>
      )[f]
    })
    .filter((f): f is string => Boolean(f))

  return {
    tipo,
    parte: parte.valor,
    telefono: p.telefono,
    categoria: p.categoria,
    pago: p.pago,
    lineas,
    cobro,
    entrega: p.entrega ?? null,
    marcas: [...marcas],
    dudas,
    faltantes,
    supuestos: supuestosEnPalabras(ex),
  }
}

// --- proforma -------------------------------------------------------------------

export interface FormularioProforma extends Dictado {
  cliente: string | null
  detalle: string | null
  total: string | null
  vigencia: Vigencia | null
}

export function formularioDeProforma(ex: Extraccion, catalogo: ReadonlyArray<Parte>): FormularioProforma | null {
  const p = ex.proforma
  if (!p || ex.intent !== 'proforma') return null
  const marcas = new Set<string>()
  const cliente = resolverParte(p.cliente, catalogo, 'cliente', 'cliente')
  const dudas: Duda[] = [...cliente.dudas]
  if (cliente.valor) marcas.add('cliente')
  if (p.detalle) marcas.add('detalle')
  if (p.total !== null) marcas.add('total')
  if (p.vigenciaDias !== null) marcas.add('vigencia')

  for (const a of ex.ambiguedades) {
    if (a.campo === 'total') dudas.push(...duda('total', '¿Cuál es el total?', cifras(a)))
    if (a.campo === 'vigenciaDias') {
      dudas.push(...duda('vigenciaDias', '¿Por cuántos días vale?', deLista(a, VIGENCIAS.map(String), (v) => `${v} días`)))
    }
  }
  const conDuda = new Set(dudas.map((d) => d.campo))
  const PALABRAS: Record<string, string> = {
    cliente: 'el cliente',
    detalle: 'qué se cotiza',
    total: 'el monto',
    vigenciaDias: 'la vigencia',
  }
  return {
    cliente: cliente.valor,
    detalle: p.detalle,
    total: p.total !== null ? String(p.total) : null,
    vigencia: p.vigenciaDias,
    marcas: [...marcas],
    dudas,
    faltantes: ex.faltantes.filter((f) => !conDuda.has(f)).map((f) => PALABRAS[f]).filter(Boolean),
    supuestos: supuestosEnPalabras(ex),
  }
}

// --- deuda ------------------------------------------------------------------------

export interface FormularioDeuda extends Dictado {
  tipo: DebtKind | null
  parte: string | null
  concepto: string | null
  total: string | null
  vence: string | null
}

export function formularioDeDeuda(ex: Extraccion, catalogo: ReadonlyArray<Parte>): FormularioDeuda | null {
  const d = ex.deuda
  if (!d || ex.intent !== 'deuda') return null
  const marcas = new Set<string>()
  const quien = d.kind === 'PAGAR' ? 'proveedor' : 'cliente'
  const parte = resolverParte(d.parte, catalogo, 'parte', quien)
  const dudas: Duda[] = [...parte.dudas]
  if (d.kind) marcas.add('tipo')
  if (parte.valor) marcas.add('parte')
  if (d.concepto) marcas.add('concepto')
  if (d.total !== null) marcas.add('total')
  if (d.vence) marcas.add('vence')

  for (const a of ex.ambiguedades) {
    if (a.campo === 'total') dudas.push(...duda('total', '¿Cuánto es la deuda?', cifras(a)))
    if (a.campo === 'kind') {
      dudas.push(
        ...duda('kind', '¿Te deben o debes?', deLista(a, ['COBRAR', 'PAGAR'], (v) => (v === 'COBRAR' ? 'Me deben' : 'Debo'))),
      )
    }
  }
  const conDuda = new Set(dudas.map((x) => x.campo))
  const PALABRAS: Record<string, string> = {
    kind: 'si te deben o debes',
    parte: `el ${quien}`,
    concepto: 'de qué es la deuda',
    total: 'el monto',
  }
  return {
    tipo: d.kind,
    parte: parte.valor,
    concepto: d.concepto,
    total: d.total !== null ? String(d.total) : null,
    vence: d.vence,
    marcas: [...marcas],
    dudas,
    faltantes: ex.faltantes.filter((f) => !conDuda.has(f)).map((f) => PALABRAS[f]).filter(Boolean),
    supuestos: supuestosEnPalabras(ex),
  }
}

// --- abono --------------------------------------------------------------------------

export interface FormularioAbono extends Dictado {
  monto: string | null
  pago: PaymentMethod | null
}

export type DestinoAbono =
  | { tipo: 'una'; deuda: Debt }
  | { tipo: 'varias'; deudas: Debt[] }
  | { tipo: 'ninguna'; parte: string | null }

/** Cuántas cuentas se ofrecen como mucho cuando no se sabe cuál es. */
const MAX_CUENTAS = 8

/**
 * A qué cuenta va el abono. Solo cuentan las que tienen saldo. Si el nombre
 * no deja una sola, se ofrecen las posibles: abonar a la cuenta equivocada
 * es peor que preguntar.
 */
export function destinoDelAbono(ex: Extraccion, deudas: ReadonlyArray<Debt>): DestinoAbono {
  const vivas = deudas
    .filter((d) => d.balance > 0.004)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const dicha = ex.abono?.parte?.trim() || null
  if (!dicha) return vivas.length ? { tipo: 'varias', deudas: vivas.slice(0, MAX_CUENTAS) } : { tipo: 'ninguna', parte: null }

  const catalogo = vivas.map((d) => ({ nombre: d.party, ultimaVez: d.createdAt }))
  const r = buscarParte(dicha, catalogo)
  const nombres =
    r.tipo === 'exacta' || r.tipo === 'unica' || r.tipo === 'parecida'
      ? [r.nombre]
      : r.tipo === 'varias'
        ? r.opciones
        : []
  // Por nombre normalizado: «Rosa Pérez» y «Rosa Perez» son la misma persona y
  // sus dos cuentas tienen que salir juntas.
  const claves = new Set(nombres.map(normalizar))
  const suyas = vivas.filter((d) => claves.has(normalizar(d.party)))
  if (!suyas.length) return { tipo: 'ninguna', parte: dicha }
  // Un nombre solo parecido nunca se da por bueno sin que alguien lo elija.
  if (suyas.length === 1 && r.tipo !== 'parecida') return { tipo: 'una', deuda: suyas[0] }
  return { tipo: 'varias', deudas: suyas.slice(0, MAX_CUENTAS) }
}

export function formularioDeAbono(ex: Extraccion): FormularioAbono | null {
  const a = ex.abono
  if (!a || ex.intent !== 'abono') return null
  const marcas = new Set<string>()
  if (a.monto !== null) marcas.add('monto')
  if (a.pago) marcas.add('pago')
  const dudas: Duda[] = []
  for (const amb of ex.ambiguedades) {
    if (amb.campo === 'monto') dudas.push(...duda('monto', '¿Cuánto abonó?', cifras(amb)))
    if (amb.campo === 'pago') dudas.push(...duda('pago', '¿Con qué pagó?', deLista(amb, PAYMENT_METHODS)))
  }
  const conDuda = new Set(dudas.map((d) => d.campo))
  const PALABRAS: Record<string, string> = { monto: 'el monto', pago: 'el método de pago' }
  return {
    monto: a.monto !== null ? String(a.monto) : null,
    pago: a.pago,
    marcas: [...marcas],
    dudas,
    faltantes: ex.faltantes.filter((f) => !conDuda.has(f)).map((f) => PALABRAS[f]).filter(Boolean),
    supuestos: [],
  }
}
