import { useEffect, useMemo, useState } from 'react'

export const FILAS_POR_PAGINA = 25

export interface Paginacion<T> {
  /** Las filas de la página actual. */
  visibles: T[]
  pagina: number
  paginas: number
  total: number
  /** Índices humanos del tramo mostrado: «Mostrando 26–50 de 348». */
  desde: number
  hasta: number
  irA: (pagina: number) => void
}

/**
 * Pagina una lista ya filtrada, en el cliente.
 *
 * Los datos se cargan enteros a propósito: los totales de cabecera y los pies
 * de tabla se calculan sobre todo el conjunto, no sobre la página visible, así
 * que trocear la carga los dejaría mal.
 *
 * `firma` identifica el filtro activo: al cambiar (otra búsqueda, otro filtro)
 * se vuelve a la primera página, que es lo que se espera al reordenar la lista.
 */
export function usePagination<T>(
  items: T[],
  opciones: { porPagina?: number; firma?: string } = {},
): Paginacion<T> {
  const { porPagina = FILAS_POR_PAGINA, firma = '' } = opciones
  const [pagina, setPagina] = useState(1)

  const total = items.length
  const paginas = Math.max(1, Math.ceil(total / porPagina))

  useEffect(() => {
    setPagina(1)
  }, [firma])

  // Si la lista encoge (se cobró algo, cambió un filtro), no quedarse en una
  // página que ya no existe.
  useEffect(() => {
    if (pagina > paginas) setPagina(paginas)
  }, [pagina, paginas])

  const paginaSegura = Math.min(pagina, paginas)

  const visibles = useMemo(
    () => items.slice((paginaSegura - 1) * porPagina, paginaSegura * porPagina),
    [items, paginaSegura, porPagina],
  )

  return {
    visibles,
    pagina: paginaSegura,
    paginas,
    total,
    desde: total === 0 ? 0 : (paginaSegura - 1) * porPagina + 1,
    hasta: Math.min(paginaSegura * porPagina, total),
    irA: (destino: number) => setPagina(Math.min(Math.max(1, destino), paginas)),
  }
}

/**
 * Números a mostrar en los controles, con huecos.
 * Con 14 páginas estando en la 7 devuelve: 1 … 6 7 8 … 14
 */
export function numerosDePagina(actual: number, paginas: number): (number | 'hueco')[] {
  if (paginas <= 7) return Array.from({ length: paginas }, (_, i) => i + 1)

  const cerca = new Set([1, paginas, actual, actual - 1, actual + 1])
  const salida: (number | 'hueco')[] = []
  let anterior = 0

  for (let n = 1; n <= paginas; n++) {
    if (!cerca.has(n)) continue
    if (anterior && n - anterior > 1) salida.push('hueco')
    salida.push(n)
    anterior = n
  }
  return salida
}
