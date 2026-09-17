import { useCallback, useState } from 'react'
import { db } from '@/data'
import { useToast } from '@/hooks/useToast'
import { descargarLibro } from '@/lib/excel'
import { fileStamp } from '@/lib/format'
import { libroInformeGeneral } from '@/lib/reports'
import { useData } from '@/store/DataProvider'

/**
 * Descarga el informe general en Excel: un libro con una hoja por cada parte
 * del negocio. Los abonos no están en el estado global, así que se piden al
 * vuelo justo antes de generar el archivo.
 */
export function useInformeGeneral() {
  const { stats, transactions, workOrders, proformas, debts, closings } = useData()
  const toast = useToast()
  const [generando, setGenerando] = useState(false)

  const descargar = useCallback(async () => {
    setGenerando(true)
    try {
      const payments = await db.listAllDebtPayments()
      const wb = await libroInformeGeneral({
        stats,
        transactions,
        workOrders,
        proformas,
        debts,
        payments,
        closings,
      })
      await descargarLibro(wb, `informe_tairos_${fileStamp()}`)
      toast.success('Informe general descargado')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo generar el informe')
    } finally {
      setGenerando(false)
    }
  }, [stats, transactions, workOrders, proformas, debts, closings, toast])

  return { descargar, generando }
}
