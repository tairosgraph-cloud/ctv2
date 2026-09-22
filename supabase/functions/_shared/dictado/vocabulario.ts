/**
 * Vocabulario de mostrador: cómo transcribe el reconocedor del navegador las
 * palabras de una imprenta peruana, y a qué equivalen.
 *
 * Compartido entre las reglas (que lo aplican antes de interpretar) y el
 * prompt del modelo. Cada corrección es conservadora a propósito: lo que se
 * reescribe aquí también acaba en el concepto que el usuario lee, así que solo
 * se corrigen errores de transcripción, nunca palabras válidas.
 */

/**
 * Patrón con límites de palabra que entienden de tildes. `\b` solo conoce
 * letras ASCII: con él, la «é» final de «yapé» no cuenta como letra y el
 * patrón no casa. Sin 'g' por defecto: un regex global guarda estado entre
 * llamadas a `.test()`.
 */
export const palabra = (patron: string, flags = 'iu') =>
  new RegExp(`(?<![\\p{L}\\d])(?:${patron})(?![\\p{L}\\d])`, flags)

const NUMERO_EN_PALABRAS =
  'un|uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|trece|catorce|quince|' +
  'dieciseis|dieciséis|diecisiete|dieciocho|diecinueve|veinte|veinticinco|treinta|cuarenta|cincuenta|' +
  'sesenta|setenta|ochenta|noventa|cien|ciento|doscientos|trescientos|cuatrocientos|quinientos|' +
  'seiscientos|setecientos|ochocientos|novecientos|mil'

export const CORRECCIONES_STT: ReadonlyArray<readonly [RegExp, string]> = [
  // El reconocedor no conoce la billetera: la escribe como suena.
  [palabra('llape|llapé|yapé|iape', 'giu'), 'yape'],
  [palabra('plín', 'giu'), 'plin'],
  // Una palabra larga del oficio que suele llegar partida o sin tilde.
  [palabra('(?:gigant[oe]|jigant[oe])\\s*graf[ií]as', 'giu'), 'gigantografías'],
  [palabra('(?:gigant[oe]|jigant[oe])\\s*graf[ií]a', 'giu'), 'gigantografía'],
  [palabra('trans\\s+ferencia|transfe', 'giu'), 'transferencia'],
  // El reconocedor junta lo que se dice de corrido.
  [palabra('acuenta', 'giu'), 'a cuenta'],
  // "cincuenta lucas" son cincuenta soles en Lima. Solo tras una cifra: sin
  // ella, "Lucas" es un nombre.
  [palabra(`(\\d+(?:[.,]\\d+)?|${NUMERO_EN_PALABRAS})\\s+(?:lucas|luquitas)`, 'giu'), '$1 soles'],
]

/**
 * Las mismas correcciones, dichas para una persona (o para el modelo): el
 * prompt las lista tal cual. smoke comprueba que cada una la corrige de verdad
 * CORRECCIONES_STT, para que las dos listas no se separen.
 */
export const ERRORES_FRECUENTES: ReadonlyArray<readonly [dichos: readonly string[], correcto: string]> = [
  [['llape', 'yapé'], 'yape'],
  [['plín'], 'plin'],
  [['giganto grafía'], 'gigantografía'],
  [['acuenta'], 'a cuenta'],
  [['transfe'], 'transferencia'],
  [['cincuenta lucas'], 'cincuenta soles'],
]

/** Aplica las correcciones de transcripción y compacta los espacios. */
export function normalizarDictado(texto: string): string {
  let limpio = texto
  for (const [patron, reemplazo] of CORRECCIONES_STT) {
    limpio = limpio.replace(patron, reemplazo)
  }
  return limpio.replace(/\s+/g, ' ').trim()
}
