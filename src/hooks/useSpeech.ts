import { useCallback, useEffect, useRef, useState } from 'react'
import {
  cancelSpeech,
  createRecognizer,
  speak,
  speechRecognitionSupported,
  speechSynthesisSupported,
  type SpeechRecognitionLike,
} from '@/lib/voice'

/** Sintesis de voz con estado `speaking` para animar la UI. */
export function useSpeaker() {
  const [speaking, setSpeaking] = useState(false)
  const tokenRef = useRef(0)

  const say = useCallback(async (text: string) => {
    const token = ++tokenRef.current
    setSpeaking(true)
    await speak(text)
    if (tokenRef.current === token) setSpeaking(false)
  }, [])

  const stop = useCallback(() => {
    tokenRef.current++
    cancelSpeech()
    setSpeaking(false)
  }, [])

  useEffect(() => () => cancelSpeech(), [])

  return { speaking, say, stop, supported: speechSynthesisSupported }
}

interface RecognitionOptions {
  onResult: (transcript: string) => void
  onError?: (message: string) => void
}

/**
 * Dictado por voz con toggle real: el prototipo solo sabia arrancar, y volver
 * a pulsar lanzaba InvalidStateError dentro de un catch vacio.
 */
export function useRecognizer({ onResult, onError }: RecognitionOptions) {
  const [listening, setListening] = useState(false)
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)
  const onResultRef = useRef(onResult)
  const onErrorRef = useRef(onError)

  onResultRef.current = onResult
  onErrorRef.current = onError

  useEffect(() => {
    if (!speechRecognitionSupported) return

    const recognition = createRecognizer()
    if (!recognition) return

    recognition.onresult = (event) => {
      const transcript = event.results?.[0]?.[0]?.transcript ?? ''
      if (transcript.trim()) onResultRef.current(transcript.trim())
    }
    recognition.onerror = (event) => {
      const messages: Record<string, string> = {
        'not-allowed': 'Permiso de micrófono denegado por el navegador.',
        'no-speech': 'No se detectó voz. Intenta de nuevo.',
        'audio-capture': 'No se encontró ningún micrófono.',
        network: 'El reconocimiento de voz necesita conexión a internet.',
      }
      onErrorRef.current?.(messages[event.error] ?? `Error de dictado: ${event.error}`)
    }
    recognition.onend = () => setListening(false)

    recognitionRef.current = recognition
    return () => {
      recognition.onresult = null
      recognition.onerror = null
      recognition.onend = null
      try {
        recognition.abort()
      } catch {
        /* ya estaba detenido */
      }
      recognitionRef.current = null
    }
  }, [])

  const toggle = useCallback(() => {
    const recognition = recognitionRef.current
    if (!recognition) {
      onErrorRef.current?.('Tu navegador no soporta dictado por voz. Usa Chrome o Edge.')
      return
    }

    if (listening) {
      recognition.stop()
      setListening(false)
      return
    }

    try {
      recognition.start()
      setListening(true)
    } catch {
      // start() sobre un reconocedor ya activo: lo reiniciamos.
      recognition.stop()
      setListening(false)
    }
  }, [listening])

  return { listening, toggle, supported: speechRecognitionSupported }
}
