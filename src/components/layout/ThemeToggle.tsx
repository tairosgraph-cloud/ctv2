import { useEffect, useRef, useState } from 'react'
import { useTheme, type Tema } from '@/hooks/useTheme'

const OPCIONES: { valor: Tema; etiqueta: string; icono: string }[] = [
  { valor: 'claro', etiqueta: 'Claro', icono: 'fa-sun' },
  { valor: 'oscuro', etiqueta: 'Oscuro', icono: 'fa-moon' },
  { valor: 'sistema', etiqueta: 'Como el sistema', icono: 'fa-desktop' },
]

/** Selector de tema. El icono del botón muestra el tema que se está pintando. */
export function ThemeToggle() {
  const { tema, efectivo, elegir } = useTheme()
  const [abierto, setAbierto] = useState(false)
  const contenedor = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!abierto) return
    const fuera = (e: MouseEvent) => {
      if (!contenedor.current?.contains(e.target as Node)) setAbierto(false)
    }
    const escape = (e: KeyboardEvent) => e.key === 'Escape' && setAbierto(false)
    document.addEventListener('mousedown', fuera)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('mousedown', fuera)
      document.removeEventListener('keydown', escape)
    }
  }, [abierto])

  const iconoActual = efectivo === 'oscuro' ? 'fa-moon' : 'fa-sun'

  return (
    <div ref={contenedor} className="relative">
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        aria-expanded={abierto}
        aria-label={`Tema: ${OPCIONES.find((o) => o.valor === tema)?.etiqueta}`}
        title="Cambiar entre claro y oscuro"
        className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
      >
        <i className={`fa-solid ${iconoActual} text-sm`} aria-hidden="true" />
      </button>

      {abierto && (
        <div
          role="menu"
          className="absolute right-0 top-11 z-40 w-52 overflow-hidden rounded-2xl border border-slate-200 bg-white p-1 shadow-2xl dark:border-slate-800 dark:bg-slate-900"
        >
          {OPCIONES.map((opcion) => (
            <button
              key={opcion.valor}
              type="button"
              role="menuitemradio"
              aria-checked={tema === opcion.valor}
              onClick={() => {
                elegir(opcion.valor)
                setAbierto(false)
              }}
              className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-xs font-semibold transition-colors ${
                tema === opcion.valor
                  ? 'bg-brand-50 text-brand-800 dark:bg-brand-500/15 dark:text-brand-300'
                  : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
              }`}
            >
              <i className={`fa-solid ${opcion.icono} w-4 text-xs`} aria-hidden="true" />
              <span className="flex-1">{opcion.etiqueta}</span>
              {tema === opcion.valor && (
                <i className="fa-solid fa-check text-[10px]" aria-hidden="true" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
