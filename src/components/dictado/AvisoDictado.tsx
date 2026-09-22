import type { Duda } from '@/lib/dictado/formulario'

/** "cliente, monto y método de pago" */
export function listar(partes: string[]): string {
  if (partes.length < 2) return partes.join('')
  return `${partes.slice(0, -1).join(', ')} y ${partes[partes.length - 1]}`
}

interface Props {
  /** Quién interpretó la frase: el modelo o las reglas. */
  origen: 'llm' | 'reglas'
  /** Por qué no se usó el modelo, si se intentó y falló. */
  aviso: string | null
  /** Cuántos campos siguen en ámbar. */
  marcados: number
  dudas: Duda[]
  faltantes: string[]
  supuestos: string[]
  onElegir: (campo: string, valor: string) => void
  onRevisado: () => void
}

/**
 * La franja que acompaña a un formulario dictado. Nunca dice que lo dictado
 * esté bien: dice qué rellenó la máquina, qué no dijo la frase y, cuando hay
 * dos lecturas, pregunta cuál.
 */
export function AvisoDictado({ origen, aviso, marcados, dudas, faltantes, supuestos, onElegir, onRevisado }: Props) {
  if (!marcados && !dudas.length && !faltantes.length) return null

  return (
    <div
      id="aviso-dictado"
      className="space-y-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] font-semibold text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300"
    >
      <div className="flex items-start justify-between gap-2">
        <p>
          <i className="fa-solid fa-triangle-exclamation mr-1.5" aria-hidden="true" />
          Lo marcado en ámbar lo escribió el dictado, no está verificado: confírmalo antes de guardar.
          <span className="ml-1.5 inline-flex items-center gap-1 rounded-md bg-amber-200/60 px-1.5 py-0.5 text-[10px] font-bold text-amber-900 dark:bg-amber-500/20 dark:text-amber-200">
            <i className={`fa-solid ${origen === 'llm' ? 'fa-wand-magic-sparkles' : 'fa-list-check'}`} aria-hidden="true" />
            {origen === 'llm' ? 'Intérprete inteligente' : 'Intérprete básico'}
          </span>
        </p>
        {(marcados > 0 || faltantes.length > 0 || supuestos.length > 0) && (
          <button
            type="button"
            onClick={onRevisado}
            className="shrink-0 rounded-lg px-2 py-0.5 text-[11px] font-bold text-amber-900 transition-colors hover:bg-amber-200/60 dark:text-amber-200 dark:hover:bg-amber-500/20"
          >
            Ya lo revisé
          </button>
        )}
      </div>

      {aviso && <p className="font-medium opacity-90">{aviso}</p>}

      {dudas.map((duda) => (
        <div key={duda.campo} role="group" aria-label={duda.pregunta} className="flex flex-wrap items-center gap-1.5">
          <span className="font-bold text-amber-900 dark:text-amber-200">{duda.pregunta}</span>
          {duda.opciones.map((opcion) => (
            <button
              key={opcion.valor}
              type="button"
              onClick={() => onElegir(duda.campo, opcion.valor)}
              className="rounded-lg border border-amber-400 bg-white px-2 py-0.5 text-[11px] font-bold text-amber-900 transition-colors hover:bg-amber-100 dark:border-amber-500/50 dark:bg-slate-900 dark:text-amber-200 dark:hover:bg-amber-500/20"
            >
              {opcion.texto}
            </button>
          ))}
        </div>
      ))}

      {faltantes.length > 0 && (
        <p className="font-medium">
          <span className="font-bold">La frase no dice</span> {listar(faltantes)}: complétalo a mano.
        </p>
      )}
      {supuestos.length > 0 && (
        <p className="font-medium">
          <span className="font-bold">Supuse</span> {listar(supuestos)}: cámbialo si no es así.
        </p>
      )}
    </div>
  )
}
