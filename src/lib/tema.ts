/**
 * Lo mínimo compartido del tema claro/oscuro.
 *
 * Vive aparte de `useTheme` porque hay tres sitios que necesitan la misma clave
 * y la misma regla, y si se separan el usuario ve destellos o pantallas con el
 * tema equivocado:
 *
 *  1. `useTheme`        — el estado de la app mientras corre.
 *  2. `ErrorBoundary`   — la pantalla de recuperación, que puede pintarse antes
 *                         de que el proveedor de tema llegue a montarse.
 *  3. `index.html`      — un script síncrono que se adelanta al primer pintado
 *                         para que no haya fogonazo blanco. Ese NO puede
 *                         importar de aquí (corre antes que los módulos), así
 *                         que repite la clave a mano: si cambias `CLAVE_TEMA`,
 *                         cámbiala también ahí.
 *
 * Este módulo no importa nada, ni siquiera React, para que sea seguro usarlo
 * desde el ErrorBoundary.
 */

export type Tema = 'sistema' | 'claro' | 'oscuro'

export const CLAVE_TEMA = 'tairos.rc.tema'

export const prefiereOscuro = (): boolean => {
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  } catch {
    return false
  }
}

/** Lee la preferencia guardada. Cualquier valor raro cuenta como «sistema». */
export function leerTemaGuardado(): Tema {
  try {
    const guardado = localStorage.getItem(CLAVE_TEMA)
    if (guardado === 'claro' || guardado === 'oscuro') return guardado
  } catch {
    /* modo privado o almacenamiento bloqueado */
  }
  return 'sistema'
}

/** Traduce la elección a lo que hay que pintar de verdad. */
export function resolverTema(tema: Tema): 'claro' | 'oscuro' {
  if (tema !== 'sistema') return tema
  return prefiereOscuro() ? 'oscuro' : 'claro'
}

/** Aplica el tema al documento: la clase que lee Tailwind y el color-scheme. */
export function aplicarTema(resuelto: 'claro' | 'oscuro'): void {
  const raiz = document.documentElement
  raiz.classList.toggle('dark', resuelto === 'oscuro')
  raiz.style.colorScheme = resuelto === 'oscuro' ? 'dark' : 'light'
}
