import { useEffect, useMemo, useRef, useState } from 'react'
import {
  buildBotMessages,
  buildDebtBriefing,
  type BotChunk,
  type BotChunkKind,
  type BotMessage,
} from '@/lib/debtAlerts'
import { useData } from '@/store/DataProvider'
import { RobotAvatar } from './RobotAvatar'

/** Cuántos avisos cuenta antes de irse. El primero es siempre el resumen. */
const MAX_AVISOS = 4
/** Velocidad a la que "escribe" cada letra. */
const MS_POR_LETRA = 26
/** Cuánto deja el mensaje en pantalla antes de pasar al siguiente. */
const PAUSA_MS = 2600
/** Lo que dura el desvanecido final. */
const SALIDA_MS = 600

/** El marco degradado del globo: un color por urgencia, en movimiento lento. */
const MARCO = {
  resumen: 'from-cyan-400 via-brand-400 to-lime-400',
  vencida: 'from-rose-500 via-orange-400 to-amber-400',
  antigua: 'from-amber-400 via-yellow-400 to-lime-400',
  reciente: 'from-brand-300 via-sky-300 to-emerald-300',
} as const

/** El fondo interior, apenas teñido para no pelearse con el texto. */
const FONDO = {
  resumen: 'bg-white dark:bg-slate-900',
  vencida: 'bg-rose-50 dark:bg-rose-500/10',
  antigua: 'bg-amber-50 dark:bg-amber-500/10',
  reciente: 'bg-white dark:bg-slate-900',
} as const

/** Cada tipo de dato con su color, para que el mensaje se lea de un vistazo. */
const COLOR: Record<BotChunkKind, string> = {
  texto: 'text-slate-500 dark:text-slate-400',
  nombre: 'font-bold text-slate-900 dark:text-slate-50',
  cobro: 'font-extrabold text-emerald-600 dark:text-emerald-400',
  pago: 'font-extrabold text-rose-600 dark:text-rose-400',
  tiempo: 'font-semibold text-amber-600 dark:text-amber-400',
}

/** Va destapando los trozos hasta la letra `visibles`. */
function pintar(chunks: BotChunk[], visibles: number) {
  let restante = visibles
  return chunks.map((chunk, i) => {
    if (restante <= 0) return null
    const porcion = chunk.text.slice(0, restante)
    restante -= chunk.text.length
    return (
      <span key={i} className={COLOR[chunk.kind]}>
        {porcion}
      </span>
    )
  })
}

/**
 * Recordatorio de deudas: el robotcito aparece al entrar, cuenta sus avisos
 * uno tras otro como si hablara, y se va solo al terminar.
 *
 * No tiene ningún control: ni voz, ni botones, ni enlaces. Es un recordatorio
 * que pasa y se va; el detalle sigue estando en la campana de la cabecera.
 */
export function DebtBot() {
  const { debts, loading } = useData()
  const disponibles = useMemo(
    () => buildBotMessages(buildDebtBriefing(debts)).slice(0, MAX_AVISOS),
    [debts],
  )

  /** Se congela al arrancar: si cobras algo a media frase, no se corta. */
  const guion = useRef<BotMessage[] | null>(null)
  const [indice, setIndice] = useState(0)
  const [visibles, setVisibles] = useState(0)
  const [hablando, setHablando] = useState(false)
  const [saliendo, setSaliendo] = useState(false)
  const [oculto, setOculto] = useState(false)

  if (guion.current === null && !loading && disponibles.length > 0) {
    guion.current = disponibles
  }
  const avisos = guion.current

  useEffect(() => {
    if (!avisos || oculto) return

    // Terminó el guion: desaparece.
    if (indice >= avisos.length) {
      setSaliendo(true)
      const fin = window.setTimeout(() => setOculto(true), SALIDA_MS)
      return () => window.clearTimeout(fin)
    }

    const texto = avisos[indice].text
    const sinMovimiento = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    let siguiente = 0

    // Sin animación, el mensaje aparece entero y solo se respeta la pausa.
    if (sinMovimiento) {
      setVisibles(texto.length)
      setHablando(false)
      siguiente = window.setTimeout(() => setIndice((n) => n + 1), PAUSA_MS)
      return () => window.clearTimeout(siguiente)
    }

    setVisibles(0)
    setHablando(true)

    let letra = 0
    const maquina = window.setInterval(() => {
      letra += 1
      setVisibles(letra)
      if (letra >= texto.length) {
        window.clearInterval(maquina)
        setHablando(false)
        siguiente = window.setTimeout(() => setIndice((n) => n + 1), PAUSA_MS)
      }
    }, MS_POR_LETRA)

    return () => {
      window.clearInterval(maquina)
      window.clearTimeout(siguiente)
    }
  }, [avisos, indice, oculto])

  if (!avisos || oculto) return null

  const aviso = avisos[Math.min(indice, avisos.length - 1)]

  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none fixed bottom-4 right-4 z-40 flex flex-col items-end gap-2 transition-all duration-500 md:bottom-6 md:right-6 ${
        saliendo ? 'translate-y-3 opacity-0' : 'opacity-100'
      }`}
    >
      {/* Marco degradado: un div exterior con el degradado y otro interior
          con el fondo, que es como se consigue un borde multicolor. */}
      <div
        className={`w-[min(19rem,calc(100vw-2.5rem))] animate-toast-in rounded-2xl rounded-br-sm bg-gradient-to-r bg-[length:200%_200%] p-[2px] shadow-xl ${MARCO[aviso.tone]} animate-gradient-shift`}
      >
        <div className={`rounded-[14px] rounded-br-[3px] p-3.5 ${FONDO[aviso.tone]}`}>
          <p className="text-xs leading-relaxed">
            {pintar(aviso.chunks, visibles)}
            {hablando && (
              <span className="ml-0.5 inline-block h-3 w-0.5 animate-pulse bg-brand-500 align-middle" />
            )}
          </p>
        </div>
      </div>

      <RobotAvatar talking={hablando} className="h-20 w-20 animate-float drop-shadow-lg" />
    </div>
  )
}
