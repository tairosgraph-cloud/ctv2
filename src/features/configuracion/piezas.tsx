import type { ReactNode } from 'react'

/**
 * Marca lo que todavía no está conectado.
 *
 * Se prefirió esto a mostrar controles que no hacen nada: una pantalla de
 * ajustes llena de botones muertos confunde más que ayuda.
 */
export function Proximamente({ nota }: { nota?: string }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800 dark:bg-amber-500/15 dark:text-amber-300"
      title={nota}
    >
      <i className="fa-solid fa-clock text-[9px]" aria-hidden="true" />
      Próximamente
    </span>
  )
}

export function Activo() {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300">
      <i className="fa-solid fa-circle-check text-[9px]" aria-hidden="true" />
      Funcionando
    </span>
  )
}

interface SeccionProps {
  titulo: string
  descripcion: string
  icono: string
  estado?: ReactNode
  children: ReactNode
  /** Atenúa el contenido de las secciones que aún no están conectadas. */
  inactiva?: boolean
}

export function Seccion({
  titulo,
  descripcion,
  icono,
  estado,
  children,
  inactiva = false,
}: SeccionProps) {
  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm dark:border-slate-800/80 dark:bg-slate-900">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 p-4 dark:border-slate-800">
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-sm text-brand-800 dark:bg-brand-500/10 dark:text-brand-300">
            <i className={`fa-solid ${icono}`} aria-hidden="true" />
          </span>
          <div>
            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-50">{titulo}</h3>
            <p className="text-[11px] text-slate-400 dark:text-slate-500">{descripcion}</p>
          </div>
        </div>
        {estado}
      </header>

      <div className={`p-4 ${inactiva ? 'pointer-events-none select-none opacity-55' : ''}`}>
        {children}
      </div>
    </section>
  )
}

/** Campo de solo lectura, para las secciones que aún no guardan nada. */
export function CampoMuestra({
  etiqueta,
  valor,
  ancho = '',
}: {
  etiqueta: string
  valor: string
  ancho?: string
}) {
  return (
    <div className={ancho}>
      <span className="field-label">{etiqueta}</span>
      <p className="field text-slate-400 dark:text-slate-500">{valor}</p>
    </div>
  )
}
