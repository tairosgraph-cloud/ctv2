/**
 * El dictado en la app: la lógica está en ./dictado/extraer (pura y probada
 * en smoke); aquí solo se conecta con la Edge Function extraer-dictado.
 *
 * Sin Supabase configurado (modo local) o sin sesión iniciada no hay a quién
 * preguntar y se usan las reglas. La función exige una sesión real: la clave
 * pública sola no llama al modelo.
 */
import { isSupabaseConfigured, supabase } from '@/lib/supabase'
import { extraerCon, type Invocar, type ResultadoDictado } from '@/lib/dictado/extraer'

export type { ResultadoDictado }

const invocarFuncion: Invocar | null =
  isSupabaseConfigured && supabase
    ? (cuerpo, signal) => supabase!.functions.invoke('extraer-dictado', { body: cuerpo, signal })
    : null

export function extraerDictado(texto: string, conSesion: boolean): Promise<ResultadoDictado> {
  return extraerCon(texto, conSesion ? invocarFuncion : null)
}
