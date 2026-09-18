/**
 * El intérprete de reglas con el contrato del dictado.
 *
 * Envuelve a parseVoiceEntry (cuyas aserciones en smoke.ts son la especificación
 * de «no miente») y le añade lo mínimo para hablar el mismo
 * idioma que el modelo: la intención, los faltantes y los supuestos. Es el
 * respaldo cuando no hay modelo —modo local, sin conexión, error— así que su
 * única obligación es no inventar nada, aunque deje muchos campos vacíos.
 */
import { categoriaExplicita, cifrasDeLaFrase, parseVoiceEntry, tipoExplicito } from '@/lib/voiceParser'
import {
  CAMPOS,
  CATEGORIAS,
  montoDeItem,
  type Categoria,
  type Cobro,
  type Extraccion,
  type Intencion,
  type Vigencia,
} from '../../../supabase/functions/_shared/dictado/tipos.ts'
import { normalizarDictado, palabra } from '../../../supabase/functions/_shared/dictado/vocabulario.ts'

const NUMERO =
  'un|uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|trece|catorce|quince|veinte|treinta|cuarenta|cincuenta|sesenta|setenta|ochenta|noventa|cien|ciento|doscientos|trescientos|cuatrocientos|quinientos|seiscientos|setecientos|ochocientos|novecientos|mil'
/** Las mismas, sin «un/uno/una»: sueltas son artículos («dejó un encargo»). */
const NUMERO_SIN_UNO = NUMERO.split('|')
  .filter((w) => w !== 'un' && w !== 'uno' && w !== 'una')
  .join('|')
/** Una cifra dictada: «150», «1.250,50» o «ciento cincuenta». */
const CIFRA = `\\d+(?:[.,]\\d+)*|(?:${NUMERO})(?:\\s+(?:y\\s+)?(?:${NUMERO}))*`

const PISTA_PROFORMA = palabra('cot[ií]z\\p{L}*|proforma\\p{L}*|presupuest\\p{L}*')
const PISTA_ABONO = palabra(
  'abon\\p{L}*|a\\s+cuenta\\s+de\\s+(?:su|la)\\s+deuda|pag[oó]\\s+(?:su|la|parte\\s+de\\s+su)\\s+deuda|de\\s+lo\\s+que\\s+(?:me\\s+)?deb[ií]a' +
    '|(?:pag[oó]|cancel[oó])\\s+(?:el|su)\\s+saldo',
)
const PISTA_DEUDA_COBRAR = palabra('me\\s+debe|nos\\s+debe|(?:me\\s+)?qued[oó]\\s+debiendo|est[aá]\\s+debiendo')
const PISTA_DEUDA_PAGAR = palabra('le\\s+debo|le\\s+debemos|debo\\s+a|debemos\\s+a|le\\s+qued[eé]\\s+debiendo')
const PISTA_CREDITO = palabra('al\\s+cr[eé]dito|fiad[oa]|sin\\s+adelanto|no\\s+(?:pag[oó]|dej[oó])\\s+nada')
const PISTA_ADELANTO = palabra(
  `adelant\\p{L}*|a\\s+cuenta|saldo|el\\s+resto|dej[oó]\\s+(?:s\\/\\.?\\s*)?(?:\\d+|${NUMERO_SIN_UNO})`,
)
/** «Adelanto de sueldo» es un gasto de planilla, no el adelanto de un pedido. */
const ADELANTO_DE_SUELDO = palabra('adelanto\\s+de\\s+(?:sueldo|quincena|planilla|pago\\s+al\\s+personal)')
/**
 * La cifra pegada a su palabra: «adelanto de 100», «adelantó 100», «100 a
 * cuenta», «pagó 80 y el resto a la entrega», «dejó 50».
 */
const ADELANTO_CON_CIFRA = new RegExp(
  `(?<![\\p{L}\\d])(?:adelant\\p{L}*|a\\s+cuenta)\\s+(?:de\\s+)?(?:s\\/\\.?\\s*)?(${CIFRA})(?![\\p{L}\\d])` +
    `|(?<![\\p{L}\\d])(${CIFRA})\\s+(?:soles?\\s+)?(?:de\\s+adelanto|a\\s+cuenta)(?![\\p{L}\\d])` +
    `|(?<![\\p{L}\\d])pag[oó]\\s+(?:s\\/\\.?\\s*)?(${CIFRA})\\s+(?:soles?\\s+)?y\\s+el\\s+resto(?![\\p{L}])` +
    `|(?<![\\p{L}\\d])dej[oó]\\s+(?:s\\/\\.?\\s*)?(${CIFRA})(?![\\p{L}\\d])`,
  'iu',
)
const PREGUNTA = new RegExp(
  `^(?:[¿\\s,]|oye|eh|este|a\\s+ver)*(?:qui[eé]n(?:es)?|cu[aá]nt[oa]s?|cu[aá]l(?:es)?|qu[eé]|c[oó]mo|d[oó]nde)(?![\\p{L}])`,
  'iu',
)
/** Celular peruano: nueve cifras que empiezan por 9, juntas o en grupos. */
const CELULAR = /(?<!\d)9\d{2}[\s-]?\d{3}[\s-]?\d{3}(?!\d)/

const esCategoria = (c: string | null): c is Categoria =>
  c !== null && (CATEGORIAS as readonly string[]).includes(c)

const valorDe = (cifra: string): number | null => cifrasDeLaFrase(cifra)[0]?.valor ?? null

function intencion(texto: string, hayContenido: boolean): Intencion {
  if (texto.includes('?') || PREGUNTA.test(texto)) return 'consulta'
  if (PISTA_PROFORMA.test(texto)) return 'proforma'
  if (PISTA_ABONO.test(texto)) return 'abono'
  if (PISTA_DEUDA_COBRAR.test(texto) || PISTA_DEUDA_PAGAR.test(texto)) return 'deuda'
  if (ADELANTO_DE_SUELDO.test(texto)) return 'egreso'
  if (PISTA_CREDITO.test(texto) || PISTA_ADELANTO.test(texto)) return 'pedido'
  const tipo = tipoExplicito(texto)
  if (tipo === 'Egreso') return 'egreso'
  if (tipo === 'Ingreso' || hayContenido) return 'ingreso'
  return 'desconocido'
}

/** «quince días», «dos semanas», «un mes» → 15 / 15 / 30. */
function vigencia(texto: string): Vigencia | 'otra' | null {
  if (palabra('una\\s+semana|(?:7|siete)\\s+d[ií]as').test(texto)) return 7
  if (palabra('dos\\s+semanas|(?:15|quince)\\s+d[ií]as|quincena').test(texto)) return 15
  if (palabra('un\\s+mes|(?:30|treinta)\\s+d[ií]as').test(texto)) return 30
  if (palabra(`(?:${CIFRA})\\s+d[ií]as`).test(texto)) return 'otra'
  return null
}

function vacia(intent: Intencion): Extraccion {
  return {
    intent,
    pedido: null,
    proforma: null,
    abono: null,
    deuda: null,
    consulta: null,
    faltantes: [],
    supuestos: [],
    ambiguedades: [],
    origen: 'reglas',
    esquema: 1,
  }
}

export function desdeReglas(texto: string): Extraccion {
  const limpio = normalizarDictado(texto)
  const p = parseVoiceEntry(limpio)
  const tipo = tipoExplicito(limpio)
  const categoria = categoriaExplicita(limpio)
  const intent = intencion(limpio, Boolean(p.amount ?? p.party ?? p.payment ?? categoria))
  const r = vacia(intent)
  const falta = (campo: string) => r.faltantes.push(campo)

  switch (intent) {
    case 'consulta':
      r.consulta = { pregunta: limpio }
      return r

    case 'desconocido':
      return r

    case 'proforma': {
      const v = vigencia(limpio)
      r.proforma = {
        cliente: p.party,
        detalle: p.concept,
        total: p.amount,
        vigenciaDias: v === 'otra' ? null : v,
      }
      if (!p.party) falta(CAMPOS.cliente)
      if (p.amount === null) falta(CAMPOS.total)
      if (v === 'otra') {
        // Dijo un plazo que el formulario no admite: que elija la persona.
        r.ambiguedades.push({ campo: CAMPOS.vigencia, opciones: ['7', '15', '30'] })
      } else if (v === null) {
        falta(CAMPOS.vigencia)
      }
      return r
    }

    case 'abono':
      r.abono = { parte: p.party, monto: p.amount, pago: p.payment }
      if (!p.party) falta(CAMPOS.parte)
      if (p.amount === null) falta(CAMPOS.monto)
      if (!p.payment) falta(CAMPOS.pago)
      return r

    case 'deuda':
      r.deuda = {
        kind: PISTA_DEUDA_PAGAR.test(limpio) ? 'PAGAR' : 'COBRAR',
        parte: p.party,
        concepto: p.concept,
        total: p.amount,
        vence: null,
      }
      if (!p.party) falta(CAMPOS.parte)
      if (p.amount === null) falta(CAMPOS.total)
      return r
  }

  // Ingreso, egreso o pedido: todo va al libro.
  let precio = p.amount
  let adelanto: Cobro
  let cobroSupuesto = false

  if (PISTA_CREDITO.test(limpio)) {
    adelanto = { tipo: 'credito', monto: 0 }
  } else if (PISTA_ADELANTO.test(limpio) && !ADELANTO_DE_SUELDO.test(limpio)) {
    const m = limpio.match(ADELANTO_CON_CIFRA)
    const cifra = m ? (m[1] ?? m[2] ?? m[3] ?? m[4]) : undefined
    if (m && cifra) {
      // El precio se busca en el resto de la frase, sin la cifra del adelanto.
      const inicio = m.index ?? 0
      const resto = `${limpio.slice(0, inicio)} ${limpio.slice(inicio + m[0].length)}`
      precio = parseVoiceEntry(resto).amount
      adelanto = { tipo: 'parcial', monto: valorDe(cifra) }
    } else {
      adelanto = { tipo: 'parcial', monto: null }
      // Hay un adelanto sin cifra identificable: si la frase trae más de una
      // cifra, cualquiera de ellas podría ser el adelanto y no el precio.
      const vivas = new Set(cifrasDeLaFrase(limpio).filter((c) => !c.descartada).map((c) => c.valor))
      if (vivas.size > 1) precio = null
    }
  } else {
    adelanto = { tipo: 'total', monto: p.amount }
    // "Cobré", "ingreso", "vendí"… dicen que el dinero entró. Sin esas palabras,
    // que pagó todo es una suposición.
    cobroSupuesto = tipo === null
  }

  const kind = tipo ?? (intent === 'egreso' ? 'Egreso' : 'Ingreso')
  // Con el tipo ya decidido: el vinil que se compra es material, no una venta.
  const categoriaDelRegistro = categoriaExplicita(limpio, kind)
  r.pedido = {
    kind,
    parte: p.party,
    telefono: limpio.match(CELULAR)?.[0].replace(/\D/g, '') ?? null,
    categoria: esCategoria(categoriaDelRegistro) ? categoriaDelRegistro : kind === 'Ingreso' ? 'Ventas' : 'Otros',
    pago: p.payment,
    items: [{ descripcion: p.concept, monto: precio }],
    adelanto: adelanto.tipo === 'total' ? { tipo: 'total', monto: precio } : adelanto,
    notas: null,
  }

  if (!tipo) r.supuestos.push(CAMPOS.kind)
  if (!esCategoria(categoriaDelRegistro)) r.supuestos.push(CAMPOS.categoria)
  if (cobroSupuesto) r.supuestos.push(CAMPOS.cobro)

  if (!p.party) falta(CAMPOS.parte)
  if (precio === null) falta(montoDeItem(0))
  if (!p.payment && adelanto.tipo !== 'credito') falta(CAMPOS.pago)
  if (adelanto.tipo === 'parcial' && adelanto.monto === null) falta(CAMPOS.adelanto)

  return r
}
