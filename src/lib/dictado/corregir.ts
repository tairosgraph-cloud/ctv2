/**
 * El segundo filtro: cuando el intérprete se equivoca, se le escribe el arreglo
 * («eran 280 y dejó 100 en yape») y vuelve a pasar con el borrador delante.
 *
 * Lo que devuelve el modelo no reemplaza al borrador a ciegas: se fusiona campo
 * por campo. Un arreglo solo puede **cambiar** lo que nombra; lo que no nombra
 * se queda como estaba, y lo que nadie dijo sigue vacío. Así una corrección no
 * puede borrar en silencio un dato que ya estaba bien, que es el riesgo de
 * dejar que el modelo reescriba la extracción entera.
 *
 * Después, quien llama vuelve a pasar la fusión por validarExtraccion contra el
 * dictado y el arreglo juntos: la guarda de cifras sigue mandando, con las
 * cifras del arreglo contando como dichas (las escribió una persona).
 */
import {
  CAMPOS,
  montoDeItem,
  rutaDe,
  type Extraccion,
} from '../../../supabase/functions/_shared/dictado/tipos.ts'

export interface Fusion {
  extraccion: Extraccion
  /** Los campos que el arreglo cambió de verdad, con los nombres de CAMPOS. */
  cambios: string[]
}

const igual = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

/**
 * Lo que el intérprete dejó sin resolver, para que el arreglo sepa qué mirar.
 * Son los mismos nombres de campo que ve la persona en la franja ámbar.
 */
export function problemasDe(ex: Extraccion): string[] {
  return [
    ...ex.ambiguedades.map((a) => `${a.campo}: ¿${a.opciones.join(' o ')}?`),
    ...ex.faltantes.map((c) => `${c}: no se dijo`),
  ]
    .map((p) => p.slice(0, 100))
    .slice(0, 12)
}

export function fusionarCorreccion(borrador: Extraccion, corregido: Extraccion): Fusion {
  // El arreglo puede decir «no era una venta, era una cotización»: entonces el
  // bloque nuevo manda entero y del anterior no queda nada que conservar.
  if (rutaDe(corregido.intent) !== rutaDe(borrador.intent)) {
    return { extraccion: corregido, cambios: ['todo'] }
  }

  const ex: Extraccion = structuredClone(corregido)
  const cambios: string[] = []
  const anota = (campo: string, antes: unknown, ahora: unknown) => {
    if (!igual(antes, ahora)) cambios.push(campo)
  }

  switch (rutaDe(ex.intent)) {
    case 'registro': {
      const antes = borrador.pedido
      const ahora = ex.pedido
      if (!antes || !ahora) break
      ahora.kind ??= antes.kind
      ahora.parte ??= antes.parte
      ahora.telefono ??= antes.telefono
      ahora.categoria ??= antes.categoria
      ahora.pago ??= antes.pago
      ahora.notas ??= antes.notas
      ahora.entrega ??= antes.entrega
      // Sin líneas, el arreglo no hablaba de los trabajos. Con las mismas, cada
      // una conserva lo que el arreglo no cambió. Con otras —partió, juntó o
      // quitó un trabajo— manda lo que devolvió.
      if (!ahora.items.length) ahora.items = structuredClone(antes.items)
      else if (ahora.items.length === antes.items.length) {
        ahora.items = ahora.items.map((it, i) => ({
          descripcion: it.descripcion?.trim() || antes.items[i].descripcion,
          monto: it.monto ?? antes.items[i].monto,
        }))
      }
      if (ahora.adelanto.tipo === null) ahora.adelanto = structuredClone(antes.adelanto)
      else if (ahora.adelanto.tipo === antes.adelanto.tipo) ahora.adelanto.monto ??= antes.adelanto.monto

      anota(CAMPOS.kind, antes.kind, ahora.kind)
      anota(CAMPOS.parte, antes.parte, ahora.parte)
      anota(CAMPOS.telefono, antes.telefono, ahora.telefono)
      anota(CAMPOS.categoria, antes.categoria, ahora.categoria)
      anota(CAMPOS.pago, antes.pago, ahora.pago)
      anota(CAMPOS.entrega, antes.entrega, ahora.entrega)
      anota(
        CAMPOS.items,
        antes.items.map((it) => it.descripcion),
        ahora.items.map((it) => it.descripcion),
      )
      for (let i = 0; i < Math.max(antes.items.length, ahora.items.length); i++) {
        anota(montoDeItem(i), antes.items[i]?.monto, ahora.items[i]?.monto)
      }
      anota(CAMPOS.cobro, antes.adelanto.tipo, ahora.adelanto.tipo)
      anota(CAMPOS.adelanto, antes.adelanto.monto, ahora.adelanto.monto)
      break
    }

    case 'proforma': {
      const antes = borrador.proforma
      const ahora = ex.proforma
      if (!antes || !ahora) break
      ahora.cliente ??= antes.cliente
      ahora.detalle ??= antes.detalle
      ahora.total ??= antes.total
      ahora.vigenciaDias ??= antes.vigenciaDias
      anota(CAMPOS.cliente, antes.cliente, ahora.cliente)
      anota(CAMPOS.detalle, antes.detalle, ahora.detalle)
      anota(CAMPOS.total, antes.total, ahora.total)
      anota(CAMPOS.vigencia, antes.vigenciaDias, ahora.vigenciaDias)
      break
    }

    case 'abono': {
      const antes = borrador.abono
      const ahora = ex.abono
      if (!antes || !ahora) break
      ahora.parte ??= antes.parte
      ahora.monto ??= antes.monto
      ahora.pago ??= antes.pago
      anota(CAMPOS.parte, antes.parte, ahora.parte)
      anota(CAMPOS.monto, antes.monto, ahora.monto)
      anota(CAMPOS.pago, antes.pago, ahora.pago)
      break
    }

    case 'deuda': {
      const antes = borrador.deuda
      const ahora = ex.deuda
      if (!antes || !ahora) break
      ahora.kind ??= antes.kind
      ahora.parte ??= antes.parte
      ahora.concepto ??= antes.concepto
      ahora.total ??= antes.total
      ahora.vence ??= antes.vence
      anota(CAMPOS.kind, antes.kind, ahora.kind)
      anota(CAMPOS.parte, antes.parte, ahora.parte)
      anota(CAMPOS.concepto, antes.concepto, ahora.concepto)
      anota(CAMPOS.total, antes.total, ahora.total)
      anota(CAMPOS.vence, antes.vence, ahora.vence)
      break
    }

    default:
      break
  }

  return { extraccion: ex, cambios: [...new Set(cambios)] }
}
