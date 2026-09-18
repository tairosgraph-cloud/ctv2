/**
 * Comprobaciones que no ejecutan nada: si se rompen, `npm run typecheck` falla
 * aquí y no en producción.
 *
 * El contrato del dictado vive en supabase/functions/_shared para que la Edge
 * Function (Deno) pueda importarlo, así que repite las enumeraciones de
 * src/types en vez de importarlas, y arma la petición al modelo sin importar
 * el SDK (Deno y Node lo cargan de sitios distintos). Aquí se verifica que las
 * copias no se separen y que la petición encaje en los tipos reales del SDK.
 */
import type { BetaMessage, BetaOutputConfig, MessageCreateParamsNonStreaming } from '@anthropic-ai/sdk/resources/beta/messages'
import type { Categoria, Pago } from '../../../supabase/functions/_shared/dictado/tipos.ts'
import type { construirPeticion, RespuestaModelo } from '../../../supabase/functions/_shared/dictado/peticion.ts'
import type { CATEGORIES, PaymentMethod } from '@/types'

type Iguales<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false
type Encaja<A, B> = [A] extends [B] ? true : false
/** TypeScript acepta propiedades de más: un «output_confg» mal escrito pasaría. */
type SinClavesDeMas<A, B> = [Exclude<keyof A, keyof B>] extends [never] ? true : false
type Peticion = ReturnType<typeof construirPeticion>

true satisfies Iguales<Pago, PaymentMethod>
true satisfies Iguales<Categoria, (typeof CATEGORIES)[number]>
true satisfies Encaja<Peticion, MessageCreateParamsNonStreaming>
true satisfies SinClavesDeMas<Peticion, MessageCreateParamsNonStreaming>
true satisfies SinClavesDeMas<Peticion['output_config'], BetaOutputConfig>
true satisfies Encaja<BetaMessage, RespuestaModelo>
