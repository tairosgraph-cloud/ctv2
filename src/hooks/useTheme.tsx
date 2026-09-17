import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

import {
  CLAVE_TEMA,
  aplicarTema,
  leerTemaGuardado,
  prefiereOscuro,
  resolverTema,
  type Tema,
} from '@/lib/tema'

export type { Tema }

interface TemaApi {
  /** Lo que eligió el usuario. */
  tema: Tema
  /** Lo que se está pintando de verdad, ya resuelto «sistema». */
  efectivo: 'claro' | 'oscuro'
  elegir: (tema: Tema) => void
}

const TemaContext = createContext<TemaApi | null>(null)

/**
 * Tema claro/oscuro.
 *
 * «sistema» sigue la preferencia del navegador y reacciona si cambia sola (por
 * ejemplo al anochecer); «claro» y «oscuro» la ignoran. La elección se guarda
 * en localStorage por dispositivo, no en la base: es una preferencia de esta
 * pantalla, no del negocio.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [tema, setTema] = useState<Tema>(leerTemaGuardado)
  const [efectivo, setEfectivo] = useState<'claro' | 'oscuro'>(() => resolverTema(leerTemaGuardado()))

  // Aplica la clase que lee Tailwind y avisa al navegador para que los
  // controles nativos (selects, calendarios, barras) también se oscurezcan.
  useEffect(() => {
    const resuelto = resolverTema(tema)
    setEfectivo(resuelto)

    aplicarTema(resuelto)

    try {
      localStorage.setItem(CLAVE_TEMA, tema)
    } catch {
      /* sin persistencia: el tema dura lo que la pestaña */
    }
  }, [tema])

  // Solo en modo «sistema» seguimos los cambios del sistema operativo.
  useEffect(() => {
    if (tema !== 'sistema') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')

    const alCambiar = () => {
      const resuelto = prefiereOscuro() ? 'oscuro' : 'claro'
      setEfectivo(resuelto)
      aplicarTema(resuelto)
    }

    mq.addEventListener('change', alCambiar)
    return () => mq.removeEventListener('change', alCambiar)
  }, [tema])

  const elegir = useCallback((siguiente: Tema) => setTema(siguiente), [])

  const valor = useMemo<TemaApi>(() => ({ tema, efectivo, elegir }), [tema, efectivo, elegir])

  return <TemaContext.Provider value={valor}>{children}</TemaContext.Provider>
}

export function useTheme(): TemaApi {
  const ctx = useContext(TemaContext)
  if (!ctx) throw new Error('useTheme debe usarse dentro de <ThemeProvider>')
  return ctx
}
