import { isSupabaseConfigured } from '@/lib/supabase'
import type { DataAdapter } from './adapter'
import { localAdapter } from './localAdapter'
import { supabaseAdapter } from './supabaseAdapter'

/**
 * Punto unico de eleccion del backend. Si hay credenciales de Supabase se usa
 * Supabase; si no, localStorage. La UI importa solo `db`.
 */
export const db: DataAdapter = isSupabaseConfigured ? supabaseAdapter : localAdapter

export { resetLocalStore } from './localAdapter'
export type { DataAdapter } from './adapter'
