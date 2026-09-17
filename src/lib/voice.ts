/**
 * Motor de voz.
 *
 * El prototipo HTML llamaba a la API de Gemini para TTS con `apiKey = ""`,
 * asi que cada frase lanzaba un fetch condenado a fallar antes de caer en la
 * voz del navegador. Aqui usamos directamente Web Speech API: sin clave, sin
 * latencia y sin exponer credenciales en el cliente.
 *
 * Si mas adelante quieres voces neuronales, crea un endpoint propio (Supabase
 * Edge Function) que guarde la clave del lado servidor y reemplaza `speak()`.
 */

type SpeechRecognitionCtor = new () => SpeechRecognitionLike

interface SpeechRecognitionLike {
  lang: string
  continuous: boolean
  interimResults: boolean
  start: () => void
  stop: () => void
  abort: () => void
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null
  onerror: ((event: { error: string }) => void) | null
  onend: (() => void) | null
}

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionCtor
    webkitSpeechRecognition?: SpeechRecognitionCtor
  }
}

export const speechSynthesisSupported =
  typeof window !== 'undefined' && 'speechSynthesis' in window

export const speechRecognitionSupported =
  typeof window !== 'undefined' &&
  Boolean(window.SpeechRecognition || window.webkitSpeechRecognition)

/** Prefiere una voz en español; cae a la voz por defecto del sistema. */
function pickSpanishVoice(): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis.getVoices()
  if (!voices.length) return null
  return (
    voices.find((v) => v.lang === 'es-PE') ??
    voices.find((v) => v.lang.startsWith('es-')) ??
    voices.find((v) => v.lang.startsWith('es')) ??
    null
  )
}

/** Habla el texto. Resuelve cuando termina (o inmediatamente si no hay soporte). */
export function speak(text: string): Promise<void> {
  if (!speechSynthesisSupported || !text.trim()) return Promise.resolve()

  return new Promise((resolve) => {
    window.speechSynthesis.cancel()

    const utterance = new SpeechSynthesisUtterance(text)
    utterance.lang = 'es-PE'
    utterance.rate = 1.05
    utterance.pitch = 1

    const voice = pickSpanishVoice()
    if (voice) utterance.voice = voice

    let settled = false
    let guard = 0

    const finish = () => {
      if (settled) return
      settled = true
      window.clearTimeout(guard)
      resolve()
    }

    utterance.onend = finish
    utterance.onerror = finish

    // Chrome corta enunciados largos si la pestaña pierde foco; red de seguridad.
    guard = window.setTimeout(finish, Math.max(4000, text.length * 90))

    window.speechSynthesis.speak(utterance)
  })
}

export function cancelSpeech(): void {
  if (speechSynthesisSupported) window.speechSynthesis.cancel()
}

/** Crea un reconocedor de voz en es-PE, o null si el navegador no lo soporta. */
export function createRecognizer(): SpeechRecognitionLike | null {
  const Ctor = window.SpeechRecognition ?? window.webkitSpeechRecognition
  if (!Ctor) return null
  const recognition = new Ctor()
  recognition.lang = 'es-PE'
  recognition.continuous = false
  recognition.interimResults = false
  return recognition
}

export type { SpeechRecognitionLike }
