import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { MicButton } from '@/components/ui/MicButton'
import { useRecognizer, useSpeaker } from '@/hooks/useSpeech'
import { useToast } from '@/hooks/useToast'
import { buildDebtBriefing } from '@/lib/debtAlerts'
import { useData } from '@/store/DataProvider'
import { BrainCanvas } from './BrainCanvas'
import { GREETING, TOPICS, answerQuestion } from './knowledge'

const IDLE_MESSAGE =
  'Haz clic en el cerebro o elige un módulo para conocer proformas, deudas, abonos y tu resumen contable.'

export function WelcomeGateway({ onEnter }: { onEnter: () => void }) {
  const { speaking, say, stop } = useSpeaker()
  const toast = useToast()
  const { debts } = useData()

  // El cerebro solo saca cifras reales si le preguntas por deudas o cobros.
  const briefing = useMemo(() => buildDebtBriefing(debts), [debts])
  const [subtitle, setSubtitle] = useState(IDLE_MESSAGE)
  const [question, setQuestion] = useState('')

  const respond = (text: string) => {
    setSubtitle(text)
    void say(text)
  }

  const { listening, toggle } = useRecognizer({
    onResult: (transcript) => {
      setQuestion(transcript)
      respond(answerQuestion(transcript, briefing))
    },
    onError: (message) => toast.error(message),
  })

  useEffect(() => () => stop(), [stop])

  const submitQuestion = (event: FormEvent) => {
    event.preventDefault()
    const q = question.trim()
    if (!q) return
    respond(answerQuestion(q, briefing))
    setQuestion('')
  }

  const enter = () => {
    stop()
    onEnter()
  }

  return (
    <div className="flex h-full flex-col justify-between overflow-y-auto bg-slate-950 p-4 text-slate-100 md:p-8">
      <header className="mx-auto flex w-full max-w-7xl items-center justify-between gap-3 py-2">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-brand-500/40 bg-brand-800 text-xl shadow-lg shadow-brand-900/40">
            <i className="fa-solid fa-brain text-brand-400" aria-hidden="true" />
          </div>
          <div>
            <h1 className="font-display text-xl font-bold tracking-wide text-white">
              tairos<span className="text-brand-400">.rc</span>
            </h1>
            <p className="text-[11px] font-medium text-brand-300/70">Asistente Virtual por Voz</p>
          </div>
        </div>

        <button
          type="button"
          onClick={enter}
          className="group flex items-center gap-2 rounded-2xl border border-brand-500/30 bg-brand-800 px-5 py-2.5 text-xs font-semibold text-white shadow-lg shadow-brand-900/50 transition-all hover:bg-brand-700 md:text-sm"
        >
          <span>Ingresar a la Plataforma</span>
          <i
            className="fa-solid fa-arrow-right text-brand-300 transition-transform group-hover:translate-x-1"
            aria-hidden="true"
          />
        </button>
      </header>

      <main className="mx-auto my-auto flex w-full max-w-5xl flex-col items-center space-y-8 py-8 text-center">
        <div className="relative flex h-64 w-64 items-center justify-center md:h-80 md:w-80">
          <div className="brain-glow absolute inset-0 animate-pulse-slow rounded-full bg-brand-600/20 blur-3xl" />
          <BrainCanvas speaking={speaking} />
          <div
            className={`pointer-events-none absolute inset-0 rounded-full border-2 transition-all duration-300 ${
              speaking ? 'scale-110 border-brand-400' : 'scale-100 border-brand-500/30'
            }`}
          />
          <button
            type="button"
            onClick={() => (speaking ? stop() : respond(GREETING))}
            aria-label={speaking ? 'Detener la voz' : 'Escuchar la bienvenida'}
            className="absolute z-20 flex h-16 w-16 items-center justify-center rounded-full border-2 border-brand-400 bg-brand-800/90 text-xl text-brand-200 shadow-2xl shadow-brand-500/40 transition-all hover:scale-105 hover:bg-brand-700 hover:text-white"
          >
            <i
              className={`fa-solid ${speaking ? 'fa-stop' : 'fa-volume-high'}`}
              aria-hidden="true"
            />
          </button>
        </div>

        <div className="max-w-2xl space-y-4">
          <div className="inline-flex items-center gap-2 rounded-full border border-brand-500/30 bg-brand-900/60 px-3.5 py-1.5 text-xs font-semibold uppercase tracking-wide text-brand-300">
            <span className="h-2 w-2 animate-ping rounded-full bg-brand-400" />
            <span>Asistente activo</span>
          </div>

          <h2 className="font-display text-2xl font-bold leading-tight md:text-4xl">
            Tu <span className="gradient-text">contabilidad diaria</span>, dictada y ordenada
          </h2>

          <div
            className="relative flex min-h-[100px] items-center justify-center rounded-3xl border border-slate-800/90 bg-slate-900/90 p-5 text-sm leading-relaxed text-slate-300 shadow-2xl md:p-6 md:text-base"
            aria-live="polite"
          >
            <p className="text-center font-medium italic text-brand-100/90">« {subtitle} »</p>
          </div>
        </div>

        <div className="grid w-full max-w-3xl grid-cols-2 gap-2.5 md:grid-cols-3">
          {TOPICS.map((topic) => (
            <button
              key={topic.key}
              type="button"
              onClick={() =>
                respond(topic.key === 'deudas' ? answerQuestion('deudas', briefing) : topic.answer)
              }
              className="flex items-center gap-2.5 rounded-2xl border border-slate-800 bg-slate-900/70 px-3.5 py-3 text-left text-xs font-semibold text-slate-300 transition-all hover:border-brand-500/50 hover:bg-slate-800/80 hover:text-white"
            >
              <i className={`fa-solid ${topic.icon} text-brand-400`} aria-hidden="true" />
              <span>{topic.label}</span>
            </button>
          ))}
        </div>

        <form onSubmit={submitQuestion} className="flex w-full max-w-2xl items-center gap-2">
          <div className="relative flex-1">
            <input
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder="Pregúntale algo al asistente…"
              aria-label="Pregunta para el asistente"
              className="w-full rounded-2xl border border-slate-800 bg-slate-900/80 py-3 pl-4 pr-11 text-xs text-slate-200 outline-none transition-colors placeholder:text-slate-500 focus:border-brand-500"
            />
            <div className="absolute right-2 top-1/2 -translate-y-1/2">
              <MicButton listening={listening} onToggle={toggle} label="Preguntar por voz" />
            </div>
          </div>
          <button
            type="submit"
            className="rounded-2xl border border-brand-500/30 bg-brand-800 px-5 py-3 text-xs font-bold text-white transition-colors hover:bg-brand-700"
          >
            Preguntar
          </button>
        </form>
      </main>

      <footer className="mx-auto w-full max-w-7xl py-3 text-center text-[11px] text-slate-500">
        Tairos.rc · Registro contable, proformas, deudas y arqueo de caja
      </footer>
    </div>
  )
}
