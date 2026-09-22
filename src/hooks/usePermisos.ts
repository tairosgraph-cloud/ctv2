import { useEffect, useState } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { supabase } from '@/lib/supabase'

export type Rol = 'gerente' | 'cajero' | 'contador'

/** Una sola consulta por sesión: el papel no cambia mientras se trabaja. */
let consulta: Promise<Rol | null> | null = null

/**
 * Qué puede hacer esta cuenta (0009), para no enseñar botones que la base va a
 * rechazar. Mientras no se sabe (o en modo local) se muestra todo: quien
 * decide es la base, esto solo evita el viaje en balde.
 */
export function usePermisos() {
  const { requiereSesion } = useAuth()
  const [rol, setRol] = useState<Rol | null>(null)

  useEffect(() => {
    const cliente = supabase
    if (!requiereSesion || !cliente) return
    let vivo = true
    consulta ??= Promise.resolve(cliente.rpc('mi_rol'))
      .then(({ data, error }) => (!error && typeof data === 'string' ? (data as Rol) : null))
      .catch(() => null)
    void consulta.then((r) => vivo && setRol(r))
    return () => {
      vivo = false
    }
  }, [requiereSesion])

  return {
    rol,
    /** Corregir, anular, borrar, cerrar caja y tocar el catálogo. */
    esGerente: rol === null || rol === 'gerente',
    /** Registrar, cobrar y mover trabajos. */
    puedeRegistrar: rol === null || rol !== 'contador',
  }
}
