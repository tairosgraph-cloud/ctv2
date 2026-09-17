import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL?.trim()
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim()

/**
 * true cuando .env.local trae credenciales. Si es false la app usa el
 * adaptador local (localStorage) para que puedas trabajar sin backend.
 */
export const isSupabaseConfigured = Boolean(url && anonKey)

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(url!, anonKey!, {
      auth: {
        // La sesión se guarda en localStorage y se renueva sola: sin esto,
        // cada recarga (o cada vez que caduca el token) devolvería al taller a
        // la pantalla de acceso en mitad de un registro.
        persistSession: true,
        autoRefreshToken: true,
        // La app no usa enlaces mágicos ni OAuth, así que nadie tiene que
        // hurgar en la URL buscando tokens.
        detectSessionInUrl: false,
      },
    })
  : null

/** Nombre con el que se firma cada asiento cuando no hay sesión iniciada. */
const AUTOR_POR_DEFECTO = import.meta.env.VITE_APP_USER?.trim() || 'Operador'

/**
 * Nombre que se guarda como autor de cada asiento.
 *
 * Es `let` a propósito: quien importa este módulo recibe un enlace vivo al
 * valor, así que al iniciar o cerrar sesión el autor cambia solo y los
 * asientos quedan firmados con el correo de quien está trabajando de verdad,
 * en vez de con un 'Operador' fijo para toda la imprenta.
 */
export let APP_USER = AUTOR_POR_DEFECTO

/** La llama el proveedor de sesión; `null` vuelve al nombre por defecto. */
export function definirAutorDeAsientos(correo: string | null | undefined) {
  APP_USER = correo?.trim() || AUTOR_POR_DEFECTO
}
