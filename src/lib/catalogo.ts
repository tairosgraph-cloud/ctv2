/**
 * El catálogo de precios: cuánto vale una cantidad de un producto, y cómo
 * reconocer un producto en lo dictado. Puro, para probarlo en smoke.
 */
import { normalizar } from '@/lib/partes'
import { cifrasDeLaFrase } from '@/lib/voiceParser'
import type { Producto, Unidad } from '@/types'

const NOMBRE_UNIDAD: Record<Unidad, [string, string]> = {
  unidad: ['unidad', 'unidades'],
  ciento: ['ciento', 'cientos'],
  millar: ['millar', 'millares'],
  m2: ['m²', 'm²'],
  metro: ['metro', 'metros'],
  hoja: ['hoja', 'hojas'],
  juego: ['juego', 'juegos'],
}

export const unidadEn = (unidad: Unidad, cantidad: number) => NOMBRE_UNIDAD[unidad][cantidad === 1 ? 0 : 1]

const redondear = (n: number) => Math.round(n * 100) / 100
const cifra = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0+$/, '').replace(/\.$/, ''))

/**
 * El precio por unidad que toca a esa cantidad: el del tramo con el mayor
 * «desde» que no la supera. Por debajo del primer tramo, el del primero (un
 * pedido chico paga al menos la tarifa base).
 */
export function precioPorUnidad(producto: Producto, cantidad: number): number | null {
  if (!(cantidad > 0) || !producto.precios.length) return null
  const tramos = [...producto.precios].sort((a, b) => a.desde - b.desde)
  let precio = tramos[0].precio
  for (const t of tramos) if (cantidad + 1e-9 >= t.desde) precio = t.precio
  return precio
}

export function totalDe(producto: Producto, cantidad: number): number | null {
  const unitario = precioPorUnidad(producto, cantidad)
  return unitario === null ? null : redondear(unitario * cantidad)
}

/** «2 millares de Volantes A5», «3 Sellos automáticos». */
export function describirLinea(producto: Producto, cantidad: number): string {
  return producto.unidad === 'unidad'
    ? `${cifra(cantidad)} ${producto.nombre}`
    : `${cifra(cantidad)} ${unidadEn(producto.unidad, cantidad)} de ${producto.nombre}`
}

/** Cuántas piezas cuenta la palabra: «millares» ×1000, «cientos» ×100, «docenas» ×12. */
function piezas(valor: number, palabra: string): number {
  const p = normalizar(palabra)
  if (p.startsWith('millar')) return valor * 1000
  if (p.startsWith('cien')) return valor * 100
  if (p.startsWith('docena')) return valor * 12
  return valor
}

/**
 * El producto del catálogo que nombra una línea dictada, y cuánto pide en la
 * unidad del producto: «2 millares de volantes A5» → Volantes A5, 2 (millares).
 * null si no encaja ningún producto o no se sabe la cantidad (en m² o metros
 * no se adivina).
 */
export function productoEnDescripcion(
  descripcion: string,
  productos: ReadonlyArray<Producto>,
): { producto: Producto; cantidad: number } | null {
  const d = ` ${normalizar(descripcion)} `
  const candidatos = productos
    .filter((p) => p.activo && p.precios.length)
    .filter((p) => normalizar(p.nombre).split(' ').every((w) => d.includes(` ${w} `) || d.includes(` ${w}`)))
    .sort((a, b) => b.nombre.length - a.nombre.length)
  const producto = candidatos[0]
  if (!producto) return null

  const cuenta = cifrasDeLaFrase(descripcion).find((c) => c.cantidad)
  if (!cuenta) return null
  const n = piezas(cuenta.valor, cuenta.palabraUnidad)
  const cantidad =
    producto.unidad === 'millar'
      ? n / 1000
      : producto.unidad === 'ciento'
        ? n / 100
        : producto.unidad === 'unidad' || producto.unidad === 'hoja' || producto.unidad === 'juego'
          ? n
          : 0
  return cantidad > 0 ? { producto, cantidad } : null
}
