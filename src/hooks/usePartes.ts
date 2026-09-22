import { useMemo } from 'react'
import { catalogoDePartes, type Parte } from '@/lib/partes'
import { useData } from '@/store/DataProvider'

/**
 * Los clientes y proveedores que ya aparecen en los libros, uno por persona,
 * para emparejar el nombre dictado con el que ya existe.
 */
export function usePartes(): Parte[] {
  const { transactions, debts, workOrders, proformas } = useData()
  return useMemo(
    () =>
      catalogoDePartes([
        ...transactions.map((t) => ({ nombre: t.party, fecha: t.occurredAt })),
        ...debts.map((d) => ({ nombre: d.party, fecha: d.createdAt })),
        ...workOrders.map((w) => ({ nombre: w.party, fecha: w.createdAt })),
        ...proformas.map((p) => ({ nombre: p.client, fecha: p.issuedAt })),
      ]),
    [transactions, debts, workOrders, proformas],
  )
}
