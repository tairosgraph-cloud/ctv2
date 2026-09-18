/**
 * Segunda opinión sobre los importes del modelo.
 *
 * Las reglas son conservadoras: cuando dudan, dejan el hueco. Así que si sí
 * dan una cifra y el modelo da otra para el mismo campo, uno de los dos leyó
 * mal y el formulario no puede saber cuál: se ofrecen las dos y elige quien
 * registra. Y si las reglas vieron dos lecturas de un importe («2 millares a
 * 180»: ¿180 o 360?) y el modelo se quedó con una, eso también es adivinar:
 * se ofrecen todas. Si el modelo dejó ese hueco sin opciones, se le ponen las
 * de las reglas, que ahorran teclear.
 *
 * Solo se comparan campos con la misma forma (una línea contra una línea); si
 * el modelo partió el trabajo en varias líneas y las reglas no, no hay nada
 * que cruzar.
 */
import { rutaDe, type Ambiguedad, type Extraccion } from '../../../supabase/functions/_shared/dictado/tipos.ts'

interface Importe {
  campo: string
  /** undefined: esta lectura no tiene el campo con esta forma. */
  leer: (ex: Extraccion) => number | null | undefined
  anular: (ex: Extraccion) => void
}

/** Los importes que las dos lecturas pueden tener en común. */
const IMPORTES: Importe[] = [
  {
    campo: 'items.0.monto',
    leer: (ex) => (ex.pedido?.items.length === 1 ? ex.pedido.items[0].monto : undefined),
    anular: (ex) => void (ex.pedido!.items[0].monto = null),
  },
  {
    campo: 'adelanto',
    leer: (ex) =>
      ex.pedido?.items.length === 1 && ex.pedido.adelanto.tipo === 'parcial' ? ex.pedido.adelanto.monto : undefined,
    anular: (ex) => void (ex.pedido!.adelanto.monto = null),
  },
  { campo: 'total', leer: (ex) => ex.proforma?.total, anular: (ex) => void (ex.proforma!.total = null) },
  { campo: 'monto', leer: (ex) => ex.abono?.monto, anular: (ex) => void (ex.abono!.monto = null) },
  { campo: 'total', leer: (ex) => ex.deuda?.total, anular: (ex) => void (ex.deuda!.total = null) },
]

const esCifra = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
/** Sin repetidas (al céntimo) y de menor a mayor. */
const opciones = (cifras: number[]) => [...new Set(cifras.map((c) => Math.round(c * 100) / 100))].sort((a, b) => a - b)

export function cruzarConReglas(modelo: Extraccion, reglas: Extraccion): Extraccion {
  if (rutaDe(modelo.intent) !== rutaDe(reglas.intent)) return modelo

  const ex: Extraccion = structuredClone(modelo)
  const nuevas: Ambiguedad[] = []

  for (const { campo, leer, anular } of IMPORTES) {
    const delModelo = leer(ex)
    const deReglas = leer(reglas)
    if (delModelo === undefined || deReglas === undefined) continue
    const lecturas = (reglas.ambiguedades.find((a) => a.campo === campo)?.opciones ?? []).map(Number).filter(esCifra)

    let cifras: number[] = []
    if (esCifra(delModelo) && esCifra(deReglas)) cifras = [delModelo, deReglas]
    else if (esCifra(delModelo) && lecturas.length >= 2) cifras = [delModelo, ...lecturas]
    else if (delModelo === null && lecturas.length >= 2 && !ex.ambiguedades.some((a) => a.campo === campo)) {
      cifras = lecturas
    }
    const distintas = opciones(cifras)
    if (distintas.length < 2) continue
    anular(ex)
    nuevas.push({ campo, opciones: distintas.map(String) })
  }

  if (!nuevas.length) return modelo
  const conOpciones = new Set(nuevas.map((a) => a.campo))
  ex.ambiguedades = [...ex.ambiguedades.filter((a) => !conOpciones.has(a.campo)), ...nuevas]
  ex.faltantes = ex.faltantes.filter((c) => !conOpciones.has(c))
  return ex
}
