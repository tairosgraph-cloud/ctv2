import { useMemo } from 'react'
import { catalogoDePartes, type Parte } from '@/lib/partes'
import { useData } from '@/store/DataProvider'

/**
 * Los clientes y proveedores que ya aparecen en los libros, uno por persona,
 * para emparejar el nombre dictado con el que ya existe.
 *
 * Los clientes guardados van primero y con la fecha de su último movimiento:
 * así su nombre (el que alguien corrigió a mano) gana a otras escrituras del
 * mismo nombre, sin perder el orden por actividad reciente que desempata.
 */
export function usePartes(): Parte[] {
  const { transactions, debts, workOrders, proformas, clientes } = useData()
  return useMemo(() => {
    const ultimo = new Map<string, string>()
    const ver = (id: string | null, fecha: string) => {
      if (id && fecha > (ultimo.get(id) ?? '')) ultimo.set(id, fecha)
    }
    for (const w of workOrders) ver(w.clienteId, w.createdAt)
    for (const d of debts) ver(d.clienteId, d.createdAt)
    for (const p of proformas) ver(p.clienteId, p.issuedAt)
    return catalogoDePartes([
      // El prefijo los pone por delante de cualquier otra escritura de su
      // nombre; entre ellos siguen ordenados por su fecha real.
      ...clientes.map((c) => ({ nombre: c.nombre, fecha: `9999-${ultimo.get(c.id) ?? c.createdAt}` })),
      ...transactions.map((t) => ({ nombre: t.party, fecha: t.occurredAt })),
      ...debts.map((d) => ({ nombre: d.party, fecha: d.createdAt })),
      ...workOrders.map((w) => ({ nombre: w.party, fecha: w.createdAt })),
      ...proformas.map((p) => ({ nombre: p.client, fecha: p.issuedAt })),
    ])
  }, [transactions, debts, workOrders, proformas, clientes])
}
