/**
 * Última puerta antes del formulario, para cualquier intérprete.
 *
 * Normaliza lo que devuelve el modelo o las reglas contra lo que el formulario
 * acepta, recalcula los faltantes desde los datos (no se fía de la lista del
 * intérprete) y aplica la guarda de cifras: todo importe tiene que estar en la
 * frase. Un número que nadie dijo es el error más caro de un libro contable, y
 * el modelo puede producirlo aunque el esquema sea perfecto.
 */
import { cifrasDeLaFrase, hayPrecioUnitario } from '@/lib/voiceParser'
import {
  CAMPOS,
  CATEGORIAS,
  PAGOS,
  VIGENCIAS,
  montoDeItem,
  rutaDe,
  type Ambiguedad,
  type Extraccion,
  type Ruta,
} from '../../../supabase/functions/_shared/dictado/tipos.ts'
import { normalizarDictado } from '../../../supabase/functions/_shared/dictado/vocabulario.ts'

const iguales = (a: number, b: number) => Math.abs(a - b) < 0.005

export type Respaldo = 'respaldada' | 'dudosa' | 'ausente'

/**
 * Qué cuentas se le permiten a cada importe para no ser literal:
 * - precio de una línea: cantidad × precio unitario, si la frase lo anuncia
 *   («3 banderolas a 70 soles cada una» → 210);
 * - adelanto: la mitad de una cifra, si la frase dice «la mitad» o «50 %»;
 * - total de proforma o deuda: además, la suma de precios dichos por separado.
 * El abono tiene que ser literal. Todo lo demás, también.
 */
export type ClaseDeImporte = 'precio' | 'adelanto' | 'total' | 'abono'

const MITAD = /(?<![\p{L}])(?:la\s+mitad|mitad|50\s*%|cincuenta\s+por\s+ciento)(?![\p{L}])/iu

/**
 * `dudosa`: la cifra está en la frase, pero su contexto dice que no es un
 * importe («mil volantes», un teléfono, una fecha).
 */
export function respaldo(valor: number, textoNormalizado: string, clase: ClaseDeImporte): Respaldo {
  const cifras = cifrasDeLaFrase(textoNormalizado)
  const todas = cifras.map((c) => c.valor)
  const vivas = cifras.filter((c) => !c.descartada).map((c) => c.valor)
  if (vivas.some((v) => iguales(v, valor))) return 'respaldada'

  const productos = (clase === 'precio' || clase === 'total') && hayPrecioUnitario(textoNormalizado)
  if (productos) {
    // «3 docenas a 2.50 cada uno»: la cantidad va en docenas y el precio por pieza.
    const tamaños = [1]
    if (/docena/iu.test(textoNormalizado)) tamaños.push(12)
    if (/ciento/iu.test(textoNormalizado)) tamaños.push(100)
    if (/millar/iu.test(textoNormalizado)) tamaños.push(1000)
    for (let i = 0; i < todas.length; i++) {
      for (let j = 0; j < todas.length; j++) {
        if (i === j || todas[i] <= 1) continue
        if (tamaños.some((t) => iguales(todas[i] * todas[j] * t, valor))) return 'respaldada'
      }
    }
  }

  if (clase === 'adelanto' && MITAD.test(textoNormalizado) && vivas.some((v) => iguales(v / 2, valor))) {
    return 'respaldada'
  }

  // Un total puede ser la suma de precios dichos por separado ("200 y 150").
  if (clase === 'total' && vivas.length >= 2 && vivas.length <= 8) {
    for (let mascara = 1; mascara < 1 << vivas.length; mascara++) {
      if ((mascara & (mascara - 1)) === 0) continue // un solo sumando ya se miró
      let suma = 0
      vivas.forEach((v, i) => {
        if (mascara & (1 << i)) suma += v
      })
      if (iguales(suma, valor)) return 'respaldada'
    }
  }
  return todas.some((v) => iguales(v, valor)) ? 'dudosa' : 'ausente'
}

const esPositivo = (n: number | null | undefined): n is number =>
  typeof n === 'number' && Number.isFinite(n) && n > 0

export function validarExtraccion(entrada: Extraccion, texto: string): Extraccion {
  const ex: Extraccion = structuredClone(entrada)
  const ruta: Ruta = rutaDe(ex.intent)
  const normal = normalizarDictado(texto)
  const cifras = cifrasDeLaFrase(normal)
  const opcionesDeMonto = [
    ...new Set(cifras.filter((c) => !c.descartada).map((c) => c.valor)),
  ]
    .sort((a, b) => a - b)
    .map(String)

  const ambiguedades: Ambiguedad[] = [...ex.ambiguedades]
  const ambiguo = (campo: string, opciones: string[]) => {
    if (opciones.length >= 2) ambiguedades.push({ campo, opciones })
  }

  /** Devuelve el monto si es válido y está en la frase; si no, null y el porqué. */
  const guardar = (campo: string, valor: number | null, clase: ClaseDeImporte): number | null => {
    if (!esPositivo(valor)) return null
    if (respaldo(valor, normal, clase) === 'respaldada') return valor
    ambiguo(campo, opcionesDeMonto)
    return null
  }

  // Solo sobrevive el bloque de la intención: si el intérprete rellenó otros,
  // el formulario no sabría cuál creer.
  if (ruta !== 'registro') ex.pedido = null
  if (ruta !== 'proforma') ex.proforma = null
  if (ruta !== 'abono') ex.abono = null
  if (ruta !== 'deuda') ex.deuda = null
  if (ruta !== 'consulta') ex.consulta = null

  const faltantes: string[] = []

  switch (ruta) {
    case 'registro': {
      const p = (ex.pedido ??= {
        kind: null,
        parte: null,
        telefono: null,
        categoria: null,
        pago: null,
        items: [],
        adelanto: { tipo: null, monto: null },
        notas: null,
      })
      if (p.kind !== 'Ingreso' && p.kind !== 'Egreso') p.kind = null
      // «ingreso» y «egreso» ya dicen el tipo; si el bloque lo contradice, no
      // hay forma de saber cuál de los dos se equivocó.
      const kindDeIntencion = ex.intent === 'ingreso' ? 'Ingreso' : ex.intent === 'egreso' ? 'Egreso' : null
      if (kindDeIntencion && p.kind && p.kind !== kindDeIntencion) {
        ambiguo(CAMPOS.kind, ['Ingreso', 'Egreso'])
        p.kind = null
      } else if (kindDeIntencion) {
        p.kind = kindDeIntencion
      }
      if (p.categoria !== null && !(CATEGORIAS as readonly string[]).includes(p.categoria)) p.categoria = null
      if (p.pago !== null && !(PAGOS as readonly string[]).includes(p.pago)) p.pago = null
      if (p.telefono !== null) {
        const digitos = p.telefono.replace(/\D/g, '')
        p.telefono = digitos.length >= 7 ? digitos : null
      }

      p.items = p.items
        .filter((it) => it.descripcion?.trim() || it.monto !== null)
        .map((it, i) => ({ descripcion: it.descripcion.trim(), monto: guardar(montoDeItem(i), it.monto, 'precio') }))

      // El total solo se conoce si todos los trabajos tienen precio.
      const precios = p.items.map((it) => it.monto)
      const total =
        precios.length > 0 && precios.every(esPositivo)
          ? Math.round(precios.reduce<number>((s, m) => s + (m ?? 0), 0) * 100) / 100
          : null

      switch (p.adelanto.tipo) {
        case 'credito':
          p.adelanto.monto = 0
          break
        case 'total':
          p.adelanto.monto = total
          break
        case 'parcial': {
          const monto = guardar(CAMPOS.adelanto, p.adelanto.monto, 'adelanto')
          // Un adelanto igual al total es un pago completo; uno mayor no puede ser.
          if (monto !== null && total !== null && iguales(monto, total)) {
            p.adelanto = { tipo: 'total', monto: total }
          } else if (monto !== null && total !== null && monto > total) {
            ambiguo(CAMPOS.adelanto, opcionesDeMonto)
            p.adelanto.monto = null
          } else {
            p.adelanto.monto = monto
          }
          break
        }
        default:
          p.adelanto = { tipo: null, monto: null }
      }

      if (!p.kind) faltantes.push(CAMPOS.kind)
      if (!p.parte?.trim()) faltantes.push(CAMPOS.parte)
      if (!p.items.length) faltantes.push(CAMPOS.items)
      p.items.forEach((it, i) => {
        if (it.monto === null) faltantes.push(montoDeItem(i))
      })
      if (p.adelanto.tipo === null) faltantes.push(CAMPOS.cobro)
      if (p.adelanto.tipo === 'parcial' && p.adelanto.monto === null) faltantes.push(CAMPOS.adelanto)
      if (!p.pago && p.adelanto.tipo !== 'credito') faltantes.push(CAMPOS.pago)
      break
    }

    case 'proforma': {
      const f = (ex.proforma ??= { cliente: null, detalle: null, total: null, vigenciaDias: null })
      f.total = guardar(CAMPOS.total, f.total, 'total')
      if (f.vigenciaDias !== null && !(VIGENCIAS as readonly number[]).includes(f.vigenciaDias)) {
        ambiguo(CAMPOS.vigencia, VIGENCIAS.map(String))
        f.vigenciaDias = null
      }
      if (!f.cliente?.trim()) faltantes.push(CAMPOS.cliente)
      if (!f.detalle?.trim()) faltantes.push(CAMPOS.detalle)
      if (f.total === null) faltantes.push(CAMPOS.total)
      if (f.vigenciaDias === null) faltantes.push(CAMPOS.vigencia)
      break
    }

    case 'abono': {
      const b = (ex.abono ??= { parte: null, monto: null, pago: null })
      b.monto = guardar(CAMPOS.monto, b.monto, 'abono')
      if (b.pago !== null && !(PAGOS as readonly string[]).includes(b.pago)) b.pago = null
      if (!b.parte?.trim()) faltantes.push(CAMPOS.parte)
      if (b.monto === null) faltantes.push(CAMPOS.monto)
      if (!b.pago) faltantes.push(CAMPOS.pago)
      break
    }

    case 'deuda': {
      const d = (ex.deuda ??= { kind: null, parte: null, concepto: null, total: null, vence: null })
      d.total = guardar(CAMPOS.total, d.total, 'total')
      if (d.kind !== 'COBRAR' && d.kind !== 'PAGAR') d.kind = null
      if (d.vence !== null && !/^\d{4}-\d{2}-\d{2}$/.test(d.vence)) d.vence = null
      if (!d.kind) faltantes.push(CAMPOS.kind)
      if (!d.parte?.trim()) faltantes.push(CAMPOS.parte)
      if (!d.concepto?.trim()) faltantes.push(CAMPOS.concepto)
      if (d.total === null) faltantes.push(CAMPOS.total)
      break
    }

    case 'consulta':
      ex.consulta ??= { pregunta: normalizarDictado(texto) }
      break

    case 'desconocido':
      break
  }

  // Un campo que ahora es ambiguo no es un simple faltante: la persona tiene
  // opciones que elegir, no un hueco que llenar.
  const conOpciones = new Set(ambiguedades.map((a) => a.campo))
  ex.faltantes = [...new Set(faltantes)].filter((c) => !conOpciones.has(c))
  ex.ambiguedades = [...new Map(ambiguedades.map((a) => [a.campo, a])).values()]
  ex.supuestos = [...new Set(ex.supuestos)]
  return ex
}
