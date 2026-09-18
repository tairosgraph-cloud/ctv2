/**
 * Contrato del dictado: lo que devuelve el intérprete, sea el modelo o las reglas.
 *
 * Vive fuera de src/ porque lo importan la app, las pruebas y la Edge Function,
 * que corre en Deno: no puede usar el alias `@/` ni importar nada de la app.
 * src/lib/dictado/contrato.ts comprueba al compilar que estas enumeraciones
 * siguen siendo las de src/types, para que no se separen en silencio.
 *
 * La honestidad es estructural, no un número de confianza: lo que no se sabe
 * va en `null` y en `faltantes`; lo que se rellenó por defecto, en `supuestos`;
 * y lo que admite dos lecturas, en `ambiguedades`, para que elija una persona.
 */

export const INTENCIONES = [
  'ingreso',
  'egreso',
  'pedido',
  'proforma',
  'abono',
  'deuda',
  'consulta',
  'desconocido',
] as const
export type Intencion = (typeof INTENCIONES)[number]

/**
 * Ingreso, egreso y pedido acaban en el mismo formulario (el del libro): se
 * distinguen por `pedido.kind` y por cómo se cobró. Medir la intención a este
 * nivel evita castigar como error lo que para el usuario es el mismo destino.
 */
export type Ruta = 'registro' | 'proforma' | 'abono' | 'deuda' | 'consulta' | 'desconocido'

export function rutaDe(intent: Intencion): Ruta {
  return intent === 'ingreso' || intent === 'egreso' || intent === 'pedido' ? 'registro' : intent
}

export const PAGOS = ['Efectivo', 'Yape/Plin', 'Transferencia', 'Tarjeta'] as const
export type Pago = (typeof PAGOS)[number]

export const CATEGORIAS = [
  'Ventas',
  'Servicios',
  'Materiales',
  'Servicios Básicos',
  'Planilla',
  'Alquiler',
  'Otros',
] as const
export type Categoria = (typeof CATEGORIAS)[number]

/** Las únicas vigencias que acepta el formulario de proformas. */
export const VIGENCIAS = [7, 15, 30] as const
export type Vigencia = (typeof VIGENCIAS)[number]

export interface ItemDictado {
  descripcion: string
  monto: number | null
}

/**
 * Cómo se cobró. `total`: pagó todo; `parcial`: dejó un adelanto; `credito`:
 * se llevó el trabajo sin pagar nada. `null` si la frase no lo dice: dar por
 * hecho el pago total también es adivinar.
 */
export interface Cobro {
  tipo: 'total' | 'parcial' | 'credito' | null
  monto: number | null
}

/** Ingreso, egreso o pedido: todo lo que se registra en el libro. */
export interface PedidoDictado {
  kind: 'Ingreso' | 'Egreso' | null
  parte: string | null
  telefono: string | null
  categoria: Categoria | null
  pago: Pago | null
  items: ItemDictado[]
  adelanto: Cobro
  notas: string | null
}

export interface ProformaDictada {
  cliente: string | null
  detalle: string | null
  total: number | null
  vigenciaDias: Vigencia | null
}

export interface AbonoDictado {
  parte: string | null
  monto: number | null
  pago: Pago | null
}

export interface DeudaDictada {
  kind: 'COBRAR' | 'PAGAR' | null
  parte: string | null
  concepto: string | null
  total: number | null
  /** Fecha de vencimiento como 'AAAA-MM-DD'. */
  vence: string | null
}

export interface ConsultaDictada {
  pregunta: string
}

export interface Ambiguedad {
  /** El mismo nombre de campo que usan `faltantes` y `supuestos`. */
  campo: string
  opciones: string[]
}

export interface Extraccion {
  intent: Intencion
  /** Lleno cuando la ruta es 'registro'. */
  pedido: PedidoDictado | null
  proforma: ProformaDictada | null
  abono: AbonoDictado | null
  deuda: DeudaDictada | null
  consulta: ConsultaDictada | null
  /** Campos que la frase no dice y el formulario necesita. */
  faltantes: string[]
  /** Campos rellenados con un valor por defecto, no deducidos de la frase. */
  supuestos: string[]
  ambiguedades: Ambiguedad[]
  origen: 'llm' | 'reglas'
  esquema: 1
}

/**
 * Nombres de campo que comparten `faltantes`, `supuestos` y `ambiguedades`.
 * Son relativos al bloque de la intención: 'parte' es `pedido.parte` en un
 * registro y `abono.parte` en un abono. Los montos de cada trabajo son
 * 'items.0.monto', 'items.1.monto'…
 */
export const CAMPOS = {
  kind: 'kind',
  parte: 'parte',
  telefono: 'telefono',
  categoria: 'categoria',
  pago: 'pago',
  items: 'items',
  cobro: 'cobro',
  adelanto: 'adelanto',
  cliente: 'cliente',
  detalle: 'detalle',
  total: 'total',
  vigencia: 'vigenciaDias',
  monto: 'monto',
  concepto: 'concepto',
  vence: 'vence',
} as const

export const montoDeItem = (i: number) => `items.${i}.monto`
