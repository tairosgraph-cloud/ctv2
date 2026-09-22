import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { answerQuestion } from '@/components/gateway/knowledge'
import { db } from '@/data'
import { useAuth } from '@/hooks/useAuth'
import { useRecognizer, useSpeaker } from '@/hooks/useSpeech'
import { useToast } from '@/hooks/useToast'
import { buildDebtBriefing } from '@/lib/debtAlerts'
import { comprobarInterprete, extraerDictado, type ResultadoDictado } from '@/lib/extractor'
import { useData } from '@/store/DataProvider'
import type { ConfirmacionDictado } from '@/types'
import { rutaDe } from '../../supabase/functions/_shared/dictado/tipos.ts'

/** Una frase ya interpretada, esperando a que alguien la revise y la guarde. */
export interface Borrador {
  /** Local, para las `key` de React: cada dictado abre un formulario limpio. */
  id: number
  texto: string
  resultado: ResultadoDictado
  /** El id en voice_extractions; llega después y puede no llegar nunca. */
  auditoria: Promise<string | null>
}

export type EstadoDictado = 'inactivo' | 'escuchando' | 'extrayendo'

interface DictadoApi {
  estado: EstadoDictado
  soportado: boolean
  /** El micrófono de la barra superior: escucha, interpreta y abre el formulario. */
  alternar: () => void
  /** Interpreta una frase ya transcrita (el micrófono de un formulario). */
  interpretar: (texto: string) => Promise<Borrador>
  /** Lo que espera formulario; null si no hay nada pendiente. */
  borrador: Borrador | null
  /** Se cerró el formulario sin guardar. */
  descartar: () => void
  /** Se guardó: deja constancia de qué hubo que corregir. Nunca falla. */
  confirmar: (borrador: Borrador, confirmacion: ConfirmacionDictado) => void
}

const DictadoContext = createContext<DictadoApi | null>(null)

let siguienteId = 1

export function DictadoProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth()
  const { debts, loading } = useData()
  const toast = useToast()
  const { say } = useSpeaker()
  const [extrayendo, setExtrayendo] = useState(false)
  const [borrador, setBorrador] = useState<Borrador | null>(null)
  const conSesion = Boolean(session)
  const deudasRef = useRef(debts)
  deudasRef.current = debts

  // Al entrar se pregunta si el intérprete inteligente está listo. Además de
  // saberlo antes del primer dictado, despierta la función.
  useEffect(() => {
    if (conSesion) void comprobarInterprete()
  }, [conSesion])

  const interpretar = useCallback(
    async (texto: string): Promise<Borrador> => {
      const resultado = await extraerDictado(texto, conSesion)
      const { extraccion } = resultado
      // La auditoría nunca frena el dictado: va aparte y, si falla, se pierde
      // la medición, no el registro.
      const auditoria = db
        .registrarDictado({
          transcripcion: texto,
          extraccion,
          intent: extraccion.intent,
          origen: extraccion.origen,
          modelo: resultado.modelo,
          aviso: resultado.aviso,
          ms: resultado.ms,
          uso: resultado.uso,
        })
        .catch(() => null)
      return { id: siguienteId++, texto, resultado, auditoria }
    },
    [conSesion],
  )

  const alRecibir = useCallback(
    async (texto: string) => {
      setExtrayendo(true)
      try {
        const nuevo = await interpretar(texto)
        const { extraccion } = nuevo.resultado
        switch (rutaDe(extraccion.intent)) {
          case 'desconocido':
            toast.info(`No entendí qué registrar en «${texto}». Prueba diciendo, por ejemplo: «mil volantes para Rosa, 240 soles, pagó con Yape».`)
            return
          case 'consulta': {
            const respuesta = answerQuestion(extraccion.consulta?.pregunta ?? texto, buildDebtBriefing(deudasRef.current))
            toast.info(respuesta)
            void say(respuesta)
            return
          }
          default:
            setBorrador(nuevo)
        }
      } catch {
        // extraerDictado no lanza; esto cubre un fallo de programación, que
        // no debe dejar el micrófono colgado en «extrayendo».
        toast.error('No pude interpretar el dictado. Inténtalo otra vez o escríbelo a mano.')
      } finally {
        setExtrayendo(false)
      }
    },
    [interpretar, say, toast],
  )

  const { listening, toggle, supported } = useRecognizer({
    onResult: (texto) => void alRecibir(texto),
    onError: (mensaje) => toast.error(mensaje),
  })

  const descartar = useCallback(() => setBorrador(null), [])

  const confirmar = useCallback((b: Borrador, confirmacion: ConfirmacionDictado) => {
    void b.auditoria
      .then((id) => (id ? db.confirmarDictado(id, confirmacion) : undefined))
      .catch(() => undefined)
    setBorrador((actual) => (actual?.id === b.id ? null : actual))
  }, [])

  const estado: EstadoDictado = extrayendo ? 'extrayendo' : listening ? 'escuchando' : 'inactivo'

  const valor = useMemo<DictadoApi>(
    () => ({
      estado,
      soportado: supported,
      alternar: () => {
        if (extrayendo) return
        // Sin los libros cargados no se puede emparejar el nombre ni encontrar
        // la cuenta de un abono: mejor esperar que contestar mal.
        if (loading && !listening) {
          toast.info('Todavía estoy cargando tus datos: dicta en un momento.')
          return
        }
        toggle()
      },
      interpretar,
      borrador,
      descartar,
      confirmar,
    }),
    [estado, supported, extrayendo, loading, listening, toast, toggle, interpretar, borrador, descartar, confirmar],
  )

  return <DictadoContext.Provider value={valor}>{children}</DictadoContext.Provider>
}

export function useDictado(): DictadoApi {
  const ctx = useContext(DictadoContext)
  if (!ctx) throw new Error('useDictado debe usarse dentro de <DictadoProvider>')
  return ctx
}
