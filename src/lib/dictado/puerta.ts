/**
 * La puerta de la Fase 2: el modelo se despliega solo si, sobre el mismo
 * corpus, es al menos tan honesto como las reglas y claramente más útil, y
 * responde a tiempo. Puro: lo usa scripts/activar-dictado.ts y lo prueba smoke.
 */
import type { Resumen } from './puntuar'

export interface Medicion {
  resumen: Resumen
  /** Llamadas en las que el modelo falló o tardó y se usaron las reglas. */
  caidas: number
}

export interface Criterio {
  nombre: string
  cumple: boolean
  detalle: string
}

export const LIMITE_P50_MS = 3_000
export const LIMITE_P95_MS = 6_000
/** Más caídas que esto y el «intérprete inteligente» sería casi siempre el básico. */
export const MAX_CAIDAS = 0.05

export function puerta(reglas: Medicion, modelo: Medicion): Criterio[] {
  const r = reglas.resumen
  const m = modelo.resumen
  return [
    {
      nombre: 'No afirma más cosas falsas que las reglas',
      cumple: m.afirmacionesFalsas <= r.afirmacionesFalsas,
      detalle: `modelo ${m.afirmacionesFalsas} · reglas ${r.afirmacionesFalsas}`,
    },
    {
      nombre: 'Ninguna cifra fuera de la frase',
      cumple: m.cifrasFuera === 0,
      detalle: `${m.cifrasFuera}`,
    },
    {
      nombre: 'Acierta el destino al menos como las reglas',
      cumple: m.rutaCorrecta >= r.rutaCorrecta,
      detalle: `modelo ${m.rutaCorrecta}/${m.frases} · reglas ${r.rutaCorrecta}/${r.frases}`,
    },
    {
      nombre: 'Más frases que no hay que tocar',
      cumple: m.aceptables > r.aceptables,
      detalle: `modelo ${m.aceptables}/${m.frases} · reglas ${r.aceptables}/${r.frases}`,
    },
    {
      nombre: `Mediana de respuesta ≤ ${LIMITE_P50_MS / 1000} s`,
      cumple: m.msP50 <= LIMITE_P50_MS,
      detalle: `${m.msP50} ms`,
    },
    {
      nombre: `95 % de respuestas ≤ ${LIMITE_P95_MS / 1000} s`,
      cumple: m.msP95 <= LIMITE_P95_MS,
      detalle: `${m.msP95} ms`,
    },
    {
      nombre: `Cae a las reglas como mucho el ${MAX_CAIDAS * 100} % de las veces`,
      cumple: modelo.caidas <= m.frases * MAX_CAIDAS,
      detalle: `${modelo.caidas}/${m.frases}`,
    },
  ]
}
