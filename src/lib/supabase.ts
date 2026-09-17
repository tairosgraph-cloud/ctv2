import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL?.trim()
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim()

/**
 * true cuando .env.local trae credenciales. Si es false la app usa el
 * adaptador local (localStorage) para que puedas trabajar sin backend.
 */
export const isSupabaseConfigured = Boolean(url && anonKey)

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(url!, anonKey!, { auth: { persistSession: false } })
  : null

/** Nombre que se guarda como autor de cada asiento. */
export const APP_USER = import.meta.env.VITE_APP_USER?.trim() || 'Operador'
