import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type { Session } from '@supabase/supabase-js'
import { definirAutorDeAsientos, isSupabaseConfigured, supabase } from '@/lib/supabase'

/**
 * 'cargando' solo dura lo que tarda el cliente en leer la sesión guardada.
 * Sin ese estado intermedio la app enseñaría la pantalla de acceso durante un
 * parpadeo a alguien que ya tiene sesión, y eso se ve como un fallo.
 */
export type EstadoSesion = 'cargando' | 'sin-sesion' | 'con-sesion'

interface AuthApi {
  estado: EstadoSesion
  session: Session | null
  /** Correo de quien está trabajando, o null en modo local. */
  correo: string | null
  /**
   * false en modo local (localStorage): ahí no hay backend ni usuarios contra
   * los que validar, así que pedir contraseña solo dejaría la demo inservible.
   */
  requiereSesion: boolean
  /** Devuelve null si entró bien, o el motivo en español si no. */
  iniciarSesion: (correo: string, contrasena: string) => Promise<string | null>
  cerrarSesion: () => Promise<void>
}

const AuthContext = createContext<AuthApi | null>(null)

/**
 * Supabase responde en inglés y de forma telegráfica («Invalid login
 * credentials»). En un taller de imprenta eso no se entiende y encima asusta,
 * así que cada caso se traduce a algo que diga qué hacer a continuación.
 */
function mensajeDeError(error: { message?: string; code?: string; status?: number }): string {
  const code = error.code ?? ''
  const message = error.message ?? ''

  if (code === 'invalid_credentials' || /invalid login credentials/i.test(message)) {
    return 'Correo o contraseña incorrectos. Revisa que no tengas activadas las mayúsculas y que no se haya colado un espacio.'
  }
  if (code === 'email_not_confirmed' || /email not confirmed/i.test(message)) {
    return 'Esta cuenta todavía no confirmó su correo. Busca el mensaje de confirmación en la bandeja de entrada (mira también el correo no deseado).'
  }
  if (code === 'user_banned' || /user is banned/i.test(message)) {
    return 'Esta cuenta está bloqueada. Pide al administrador del negocio que la reactive.'
  }
  if (
    code === 'over_request_rate_limit' ||
    error.status === 429 ||
    /rate limit|too many requests/i.test(message)
  ) {
    return 'Demasiados intentos seguidos. Espera un minuto antes de volver a probar.'
  }
  if (
    code === 'email_provider_disabled' ||
    code === 'signup_disabled' ||
    /disabled/i.test(message)
  ) {
    return 'El acceso por correo y contraseña está desactivado en el servidor. Habilítalo en Supabase → Authentication → Providers.'
  }
  if (code === 'validation_failed' || /missing email|invalid email/i.test(message)) {
    return 'Escribe un correo válido y su contraseña.'
  }
  // «Failed to fetch» es lo que sale sin internet o con la URL mal escrita.
  if (/failed to fetch|network|networkerror/i.test(message)) {
    return 'No se pudo conectar con el servidor. Revisa tu conexión a internet y vuelve a intentarlo.'
  }
  return 'No se pudo iniciar sesión. Inténtalo de nuevo en unos segundos; si sigue igual, avisa al administrador del negocio.'
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  // En modo local nunca se espera a nadie: se arranca ya resuelto.
  const [estado, setEstado] = useState<EstadoSesion>(
    isSupabaseConfigured ? 'cargando' : 'sin-sesion',
  )

  useEffect(() => {
    const cliente = supabase
    if (!cliente) return

    let montado = true
    const aplicar = (nueva: Session | null) => {
      if (!montado) return
      setSession(nueva)
      setEstado(nueva ? 'con-sesion' : 'sin-sesion')
    }

    // La sesión guardada se lee del localStorage, no de la red, pero la
    // promesa igual resuelve en otro tick: hasta entonces seguimos en
    // 'cargando'.
    void cliente.auth.getSession().then(({ data }) => aplicar(data.session))

    // Cubre el resto de la vida de la sesión: login, logout, token renovado y
    // también el cierre de sesión hecho desde otra pestaña.
    const { data } = cliente.auth.onAuthStateChange((_evento, nueva) => aplicar(nueva))

    return () => {
      montado = false
      data.subscription.unsubscribe()
    }
  }, [])

  const correo = session?.user.email ?? null

  // Los asientos se firman con quien está trabajando, no con un nombre fijo.
  useEffect(() => {
    definirAutorDeAsientos(correo)
  }, [correo])

  const iniciarSesion = useCallback(async (correoEntrada: string, contrasena: string) => {
    const cliente = supabase
    if (!cliente) return 'Esta copia funciona sin servidor, no hace falta iniciar sesión.'

    try {
      const { error } = await cliente.auth.signInWithPassword({
        // Supabase distingue mayúsculas en el correo guardado; normalizarlo
        // evita el «no existe» de quien escribe con el móvil en automático.
        email: correoEntrada.trim().toLowerCase(),
        password: contrasena,
      })
      if (error) return mensajeDeError(error)
      // No hace falta guardar nada aquí: onAuthStateChange ya trae la sesión.
      return null
    } catch (err) {
      return mensajeDeError({ message: err instanceof Error ? err.message : '' })
    }
  }, [])

  const cerrarSesion = useCallback(async () => {
    const cliente = supabase
    if (!cliente) return
    // Si el servidor no contesta, se limpia igual lo que hay en este
    // navegador: dejar la pantalla abierta con sesión sería peor.
    await cliente.auth.signOut().catch(() => undefined)
    setSession(null)
    setEstado('sin-sesion')
  }, [])

  const valor = useMemo<AuthApi>(
    () => ({
      estado,
      session,
      correo,
      requiereSesion: isSupabaseConfigured,
      iniciarSesion,
      cerrarSesion,
    }),
    [estado, session, correo, iniciarSesion, cerrarSesion],
  )

  return <AuthContext.Provider value={valor}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthApi {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth debe usarse dentro de <AuthProvider>')
  return ctx
}
