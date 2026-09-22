import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'

export type EstadoCuenta = 'comprobando' | 'activa' | 'inactiva'

/**
 * ¿La cuenta con sesión está activada por un gerente (0009)? Sin eso la base no
 * le enseña nada, y sin este aviso la persona vería la app vacía sin saber por
 * qué. Si la comprobación falla (red, base antigua) no se bloquea nada: quien
 * protege los datos es la base, esto solo explica.
 *
 * La respuesta se guarda junto al usuario al que corresponde: mientras no haya
 * respuesta para el usuario de ahora, es «comprobando». Así el panel no llega a
 * montarse (y a cargar los libros) antes de saberlo.
 */
export function useCuentaActiva(session: Session | null): EstadoCuenta {
  const usuario = session?.user.id ?? null
  const [respuesta, setRespuesta] = useState<{ usuario: string; estado: 'activa' | 'inactiva' } | null>(null)

  useEffect(() => {
    const cliente = supabase
    if (!cliente || !usuario) return
    let vivo = true
    const responder = (estado: 'activa' | 'inactiva') => {
      if (vivo) setRespuesta({ usuario, estado })
    }
    void Promise.resolve(cliente.rpc('puede_ver'))
      .then(({ data, error }) => responder(!error && data === false ? 'inactiva' : 'activa'))
      .catch(() => responder('activa'))
    return () => {
      vivo = false
    }
  }, [usuario])

  if (!supabase || !usuario) return 'activa'
  return respuesta?.usuario === usuario ? respuesta.estado : 'comprobando'
}
