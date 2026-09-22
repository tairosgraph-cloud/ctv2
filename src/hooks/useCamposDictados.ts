import { useCallback, useRef, useState } from 'react'

const AMBAR = ' border-amber-400 bg-amber-50 dark:border-amber-500/60 dark:bg-amber-500/10'

/**
 * Los campos que rellenó el dictado. El intérprete puede fallar, así que lo
 * que escribe queda en ámbar hasta que alguien lo toca: «esto lo puso la
 * máquina, revísalo».
 *
 * Además recuerda qué campos dictados cambió la persona. Eso es la medida del
 * acierto en el mostrador (voice_extractions.campos_editados): «Ya lo revisé»
 * quita el ámbar pero no cuenta como corrección.
 */
export function useCamposDictados(inicial: Iterable<string> = []) {
  const [marcados, setMarcados] = useState<ReadonlySet<string>>(() => new Set(inicial))
  /** Todo lo que llegó a rellenar el dictado, revisado o no. */
  const dictados = useRef<Set<string> | null>(null)
  if (!dictados.current) dictados.current = new Set(marcados)
  const editados = useRef(new Set<string>())

  const marcar = useCallback((campos: Iterable<string>) => {
    const lista = [...campos]
    for (const c of lista) dictados.current!.add(c)
    // Se suman a las anteriores: un campo dictado antes y sin revisar no
    // pierde el aviso porque el segundo dictado no lo mencione.
    setMarcados((actual) => new Set([...actual, ...lista]))
  }, [])

  const quitar = useCallback(
    (campo: string) =>
      setMarcados((actual) => {
        if (!actual.has(campo)) return actual
        const siguiente = new Set(actual)
        siguiente.delete(campo)
        return siguiente
      }),
    [],
  )

  /** La persona cambió el valor a mano. */
  const editar = useCallback(
    (campo: string) => {
      if (dictados.current!.has(campo)) editados.current.add(campo)
      quitar(campo)
    },
    [quitar],
  )

  /** «Ya lo revisé»: fuera el ámbar, sin contar correcciones. */
  const revisar = useCallback(() => setMarcados(new Set()), [])

  const limpiar = useCallback(() => {
    setMarcados(new Set())
    dictados.current = new Set()
    editados.current = new Set()
  }, [])

  const clase = (campo: string) => (marcados.has(campo) ? AMBAR : '')
  const describe = (campo: string) => (marcados.has(campo) ? { 'aria-describedby': 'aviso-dictado' } : {})
  const camposEditados = useCallback(() => [...editados.current], [])

  return { marcados, marcar, quitar, editar, revisar, limpiar, clase, describe, camposEditados }
}
