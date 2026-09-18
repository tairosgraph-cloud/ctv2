/**
 * El JSON Schema que el modelo está obligado a cumplir (salida estructurada).
 *
 * Restricciones de la API: todo objeto lleva `additionalProperties: false`,
 * todas sus propiedades en `required`, y lo que puede faltar se declara como
 * «o null» con `anyOf`. No admite mínimos, máximos ni longitudes: esas reglas
 * viven en src/lib/dictado/validar.ts, que corre siempre después.
 *
 * Congelado y versionado: cambiarlo invalida la caché del prompt y obliga a la
 * API a recompilar la gramática. Si cambia, sube ESQUEMA_VERSION.
 */
import { CATEGORIAS, INTENCIONES, PAGOS, VIGENCIAS, type Extraccion } from './tipos.ts'

export const ESQUEMA_VERSION = 1

/** Lo que devuelve el modelo: `origen` y `esquema` los pone el código, no él. */
export type ExtraccionModelo = Omit<Extraccion, 'origen' | 'esquema'>

type Esquema = Record<string, unknown>

const oNulo = (esquema: Esquema): Esquema => ({ anyOf: [esquema, { type: 'null' }] })
const texto: Esquema = { type: 'string' }
const numero: Esquema = { type: 'number' }

const objeto = (propiedades: Record<string, Esquema>): Esquema => ({
  type: 'object',
  additionalProperties: false,
  required: Object.keys(propiedades),
  properties: propiedades,
})

const PEDIDO = objeto({
  kind: oNulo({ type: 'string', enum: ['Ingreso', 'Egreso'] }),
  parte: oNulo(texto),
  telefono: oNulo(texto),
  categoria: oNulo({ type: 'string', enum: [...CATEGORIAS] }),
  pago: oNulo({ type: 'string', enum: [...PAGOS] }),
  items: { type: 'array', items: objeto({ descripcion: texto, monto: oNulo(numero) }) },
  adelanto: objeto({
    tipo: oNulo({ type: 'string', enum: ['total', 'parcial', 'credito'] }),
    monto: oNulo(numero),
  }),
  notas: oNulo(texto),
})

const PROFORMA = objeto({
  cliente: oNulo(texto),
  detalle: oNulo(texto),
  total: oNulo(numero),
  vigenciaDias: oNulo({ type: 'integer', enum: [...VIGENCIAS] }),
})

const ABONO = objeto({
  parte: oNulo(texto),
  monto: oNulo(numero),
  pago: oNulo({ type: 'string', enum: [...PAGOS] }),
})

const DEUDA = objeto({
  kind: oNulo({ type: 'string', enum: ['COBRAR', 'PAGAR'] }),
  parte: oNulo(texto),
  concepto: oNulo(texto),
  total: oNulo(numero),
  vence: oNulo({ type: 'string', format: 'date' }),
})

export const ESQUEMA_EXTRACCION: Esquema = objeto({
  intent: { type: 'string', enum: [...INTENCIONES] },
  pedido: oNulo(PEDIDO),
  proforma: oNulo(PROFORMA),
  abono: oNulo(ABONO),
  deuda: oNulo(DEUDA),
  consulta: oNulo(objeto({ pregunta: texto })),
  faltantes: { type: 'array', items: texto },
  supuestos: { type: 'array', items: texto },
  ambiguedades: {
    type: 'array',
    items: objeto({ campo: texto, opciones: { type: 'array', items: texto } }),
  },
})
