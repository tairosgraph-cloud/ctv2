import { numerosDePagina, type Paginacion } from '@/hooks/usePagination'

interface Props {
  /** Lo que devuelve usePagination. */
  paginacion: Paginacion<unknown>
  /** Cómo se llaman las filas: «movimientos», «proformas»… */
  etiqueta: string
}

/**
 * Controles de página bajo la tabla. Se oculta solo cuando todo cabe en una
 * página, para no meter ruido cuando hay cuatro filas.
 */
export function Pagination({ paginacion, etiqueta }: Props) {
  const { pagina, paginas, total, desde, hasta, irA } = paginacion
  if (paginas <= 1) return null

  const numeros = numerosDePagina(pagina, paginas)

  const flecha = (destino: number, deshabilitado: boolean, icono: string, texto: string) => (
    <button
      type="button"
      onClick={() => irA(destino)}
      disabled={deshabilitado}
      aria-label={texto}
      className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-500 dark:text-slate-400 transition-colors hover:bg-white dark:hover:bg-slate-900 hover:text-slate-900 dark:hover:text-slate-50 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent"
    >
      <i className={`fa-solid ${icono} text-[10px]`} aria-hidden="true" />
    </button>
  )

  return (
    <nav
      aria-label={`Paginación de ${etiqueta}`}
      className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/50 px-4 py-2.5"
    >
      <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
        Mostrando{' '}
        <span className="font-bold tabular-nums text-slate-700 dark:text-slate-200">
          {desde}–{hasta}
        </span>{' '}
        de <span className="font-bold tabular-nums text-slate-700 dark:text-slate-200">{total}</span> {etiqueta}
      </p>

      <div className="flex items-center gap-0.5">
        {flecha(1, pagina === 1, 'fa-angles-left', 'Primera página')}
        {flecha(pagina - 1, pagina === 1, 'fa-chevron-left', 'Página anterior')}

        {numeros.map((n, i) =>
          n === 'hueco' ? (
            <span key={`hueco-${i}`} className="px-1 text-[11px] text-slate-400 dark:text-slate-500">
              …
            </span>
          ) : (
            <button
              key={n}
              type="button"
              onClick={() => irA(n)}
              aria-current={n === pagina ? 'page' : undefined}
              aria-label={`Página ${n}`}
              className={`flex h-7 min-w-7 items-center justify-center rounded-lg px-2 text-[11px] font-bold tabular-nums transition-colors ${
                n === pagina
                  ? 'bg-brand-800 dark:bg-brand-600 text-white shadow-sm'
                  : 'text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-900 hover:text-slate-900 dark:hover:text-slate-50'
              }`}
            >
              {n}
            </button>
          ),
        )}

        {flecha(pagina + 1, pagina === paginas, 'fa-chevron-right', 'Página siguiente')}
        {flecha(paginas, pagina === paginas, 'fa-angles-right', 'Última página')}
      </div>
    </nav>
  )
}
