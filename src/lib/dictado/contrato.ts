/**
 * El contrato del dictado vive en supabase/functions/_shared para que la Edge
 * Function (Deno) pueda importarlo, y por eso repite las enumeraciones de
 * src/types en vez de importarlas. Este archivo no ejecuta nada: si las dos
 * copias se separan, `npm run typecheck` falla aquí.
 */
import type { Categoria, Pago } from '../../../supabase/functions/_shared/dictado/tipos.ts'
import type { CATEGORIES, PaymentMethod } from '@/types'

type Iguales<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false

true satisfies Iguales<Pago, PaymentMethod>
true satisfies Iguales<Categoria, (typeof CATEGORIES)[number]>
