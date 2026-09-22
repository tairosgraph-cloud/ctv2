interface MicButtonProps {
  listening: boolean
  onToggle: () => void
  label?: string
  className?: string
  /** Interpretando lo dictado: no se puede volver a pulsar todavía. */
  busy?: boolean
}

export function MicButton({
  listening,
  onToggle,
  label = 'Dictar por voz',
  className = '',
  busy = false,
}: MicButtonProps) {
  const titulo = busy ? 'Interpretando lo dictado…' : listening ? 'Detener dictado' : label
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={busy}
      aria-pressed={listening}
      aria-busy={busy}
      aria-label={titulo}
      title={titulo}
      className={`flex h-8 w-8 items-center justify-center rounded-xl border text-xs transition-all ${
        listening
          ? 'animate-mic-pulse border-rose-300 bg-rose-500 text-white'
          : 'border-brand-200 dark:border-brand-500/30 bg-brand-50 dark:bg-brand-500/10 text-brand-700 dark:text-brand-300 hover:bg-brand-100 dark:hover:bg-brand-500/20'
      } ${className}`}
    >
      <i
        className={`fa-solid ${busy ? 'fa-spinner fa-spin' : listening ? 'fa-stop' : 'fa-microphone'}`}
        aria-hidden="true"
      />
    </button>
  )
}
