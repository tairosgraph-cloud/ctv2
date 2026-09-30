import { useCallback, useState } from 'react'
import { useDictado, type Borrador } from '@/hooks/useDictado'
import { useToast } from '@/hooks/useToast'

/**
 * El arreglo escrito en un formulario que abrió el dictado desde la barra.
 *
 * Se lo pide al intérprete con lo que ya había entendido y, si cambia algo,
 * deja que el dictado vuelva a abrir el formulario que toque con lo corregido
 * —que puede no ser el mismo: «no era una venta, era una cotización»—. Si no
 * cambió nada, no se toca la pantalla y el aviso dice por qué.
 *
 * El formulario del libro no usa esto: allí el arreglo se aplica encima sin
 * volver a montar, para no perder lo que alguien haya tecleado mientras.
 */
export function useArreglo(borrador: Borrador | null) {
  const { arreglar, puedeArreglar, reemplazar } = useDictado()
  const toast = useToast()
  const [arreglando, setArreglando] = useState(false)

  const pedir = useCallback(
    async (escrito: string) => {
      if (!borrador) return
      setArreglando(true)
      try {
        const nuevo = await arreglar(borrador, escrito)
        if (nuevo.resultado.aviso) toast.info(nuevo.resultado.aviso)
        // Mismo objeto = el intérprete no pudo: el borrador sigue como estaba.
        if (nuevo.resultado.extraccion === borrador.resultado.extraccion) return
        reemplazar(nuevo)
      } finally {
        setArreglando(false)
      }
    },
    [arreglar, borrador, reemplazar, toast],
  )

  return { arreglando, pedir: borrador && puedeArreglar ? pedir : undefined }
}
