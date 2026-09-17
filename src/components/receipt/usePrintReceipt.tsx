import { useCallback, useState } from 'react'
import type { LedgerRow } from '@/lib/ledgerRows'
import { OrderReceipt } from './OrderReceipt'

/**
 * Imprime el comprobante de una fila del libro.
 *
 * Monta el comprobante en #print-root, abre el diálogo del navegador y lo
 * desmonta. Lo usan el libro (icono de impresora en la fila) y la ficha de
 * Movimientos, para que el comprobante salga igual desde los dos sitios.
 */
export function usePrintReceipt() {
  const [row, setRow] = useState<LedgerRow | null>(null)

  const print = useCallback((target: LedgerRow) => {
    setRow(target)
    // Un tick para que el comprobante esté en el DOM antes de imprimir.
    window.setTimeout(() => {
      window.print()
      setRow(null)
    }, 60)
  }, [])

  return { print, receipt: row ? <OrderReceipt row={row} /> : null }
}
