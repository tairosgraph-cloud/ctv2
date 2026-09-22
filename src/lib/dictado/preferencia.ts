/**
 * Interruptor del intérprete inteligente, por navegador.
 *
 * Encendido por defecto: si la función está desplegada, se usa. Apagarlo deja
 * el dictado con las reglas sin tocar el servidor (sin coste, sin enviar la
 * frase fuera). localStorage puede fallar (modo privado, almacenamiento
 * bloqueado): entonces vale el valor por defecto.
 */
const CLAVE = 'tairos.dictado.inteligente'

export function interpreteActivado(): boolean {
  try {
    return localStorage.getItem(CLAVE) !== 'no'
  } catch {
    return true
  }
}

export function guardarInterpreteActivado(activado: boolean): void {
  try {
    if (activado) localStorage.removeItem(CLAVE)
    else localStorage.setItem(CLAVE, 'no')
  } catch {
    /* sin almacenamiento: vale para esta pestaña, nada más */
  }
}
