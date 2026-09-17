import { Component, type ErrorInfo, type ReactNode } from 'react'
import { aplicarTema, leerTemaGuardado, resolverTema } from '@/lib/tema'

interface ErrorBoundaryProps {
  children: ReactNode
}

interface ErrorBoundaryState {
  error: Error | null
  /** Árbol de componentes donde reventó; solo sirve para diagnosticar. */
  componentStack: string
  copiado: boolean
}

/**
 * Reaplica la clase `dark` que Tailwind lee de <html>. Hace falta porque si el
 * fallo ocurre en el primer render, el ThemeProvider nunca llegó a montarse y
 * la pantalla de recuperación saldría siempre en claro, incluso de noche.
 */
function aplicarTemaGuardado() {
  try {
    aplicarTema(resolverTema(leerTemaGuardado()))
  } catch {
    /* almacenamiento bloqueado: se queda con el tema que ya hubiera puesto */
  }
}

/**
 * Red de seguridad de toda la app.
 *
 * Sin esto, cualquier excepción de renderizado deja la página en blanco: React
 * desmonta el árbol entero y el usuario no ve ni mensaje ni salida. Va montado
 * por fuera de los proveedores (ver main.tsx) para cazar también los fallos de
 * los propios proveedores, así que aquí dentro NO se puede usar ningún hook ni
 * contexto de la app: cuando esto pinta, puede que nada de eso exista todavía.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null, componentStack: '', copiado: false }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { error, copiado: false }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    aplicarTemaGuardado()
    this.setState({ componentStack: info.componentStack ?? '' })
    // Queda en la consola por si alguien revisa la pestaña de desarrollo.
    console.error('[Tairos.rc] Error no controlado:', error, info.componentStack)
  }

  /** Texto plano que el usuario puede copiar y pegar en un mensaje de ayuda. */
  private detalleTecnico(): string {
    const { error, componentStack } = this.state
    if (!error) return ''
    return [
      `${error.name}: ${error.message}`,
      error.stack ?? '',
      componentStack && `Componentes:${componentStack}`,
    ]
      .filter(Boolean)
      .join('\n\n')
  }

  private copiarDetalle = () => {
    void navigator.clipboard
      ?.writeText(this.detalleTecnico())
      .then(() => this.setState({ copiado: true }))
      .catch(() => {
        /* portapapeles bloqueado: siempre queda seleccionar el texto a mano */
      })
  }

  render() {
    const { error, copiado } = this.state
    if (!error) return this.props.children

    return (
      <div className="flex min-h-full w-full items-center justify-center bg-slate-50 dark:bg-slate-950 p-4">
        <div
          role="alert"
          className="w-full max-w-xl rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-xl md:p-8"
        >
          <div className="flex items-start gap-4">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-rose-100 dark:bg-rose-500/15 text-lg text-rose-600 dark:text-rose-400">
              <i className="fa-solid fa-triangle-exclamation" aria-hidden="true" />
            </span>
            <div>
              <h1 className="font-display text-lg font-bold tracking-tight text-slate-900 dark:text-slate-50 md:text-xl">
                La pantalla se detuvo
              </h1>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 md:text-sm">
                Tairos.rc encontró un problema y no pudo seguir mostrando esta sección.
              </p>
            </div>
          </div>

          <div className="mt-5 space-y-2 text-xs text-slate-600 dark:text-slate-300 md:text-sm">
            <p>
              Tus datos no se han perdido: todo lo que ya habías guardado sigue donde estaba.
              Lo que falló es la pantalla, no el registro.
            </p>
            <p>
              Vuelve a cargar la página para continuar. Si vuelve a pasar en el mismo sitio,
              copia el detalle técnico de abajo y envíaselo a quien te da soporte: con eso se
              encuentra la causa mucho más rápido.
            </p>
          </div>

          <div className="mt-5 flex flex-wrap gap-2">
            <button type="button" onClick={() => window.location.reload()} className="btn-primary">
              <i className="fa-solid fa-rotate-right" aria-hidden="true" />
              Recargar la página
            </button>
            <button type="button" onClick={this.copiarDetalle} className="btn-ghost">
              <i className={`fa-solid ${copiado ? 'fa-check' : 'fa-copy'}`} aria-hidden="true" />
              {copiado ? 'Detalle copiado' : 'Copiar detalle'}
            </button>
          </div>

          <details className="mt-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 p-3">
            <summary className="cursor-pointer select-none text-xs font-semibold text-slate-600 dark:text-slate-300">
              Detalle técnico
            </summary>
            <pre className="mt-3 max-h-56 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
              {this.detalleTecnico()}
            </pre>
          </details>
        </div>
      </div>
    )
  }
}
