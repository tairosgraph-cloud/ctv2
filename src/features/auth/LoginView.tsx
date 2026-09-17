import { useState, type FormEvent } from 'react'
import { useAuth } from '@/hooks/useAuth'

/**
 * Pantalla de acceso. Vive fuera del panel: mientras no haya sesión no se
 * monta ni el proveedor de datos, así que nadie llega a pedirle nada a la base
 * sin estar identificado.
 */
export function LoginView() {
  const { iniciarSesion } = useAuth()
  const [correo, setCorreo] = useState('')
  const [contrasena, setContrasena] = useState('')
  const [verContrasena, setVerContrasena] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [entrando, setEntrando] = useState(false)

  const enviar = async (evento: FormEvent) => {
    evento.preventDefault()
    if (entrando) return

    // Se valida aquí lo evidente para no gastar un viaje al servidor —y una
    // espera— en un formulario a medio llenar.
    if (!correo.trim() || !contrasena) {
      setError('Escribe tu correo y tu contraseña para entrar.')
      return
    }

    setError(null)
    setEntrando(true)
    const motivo = await iniciarSesion(correo, contrasena)
    if (motivo) {
      setError(motivo)
      setContrasena('')
      setEntrando(false)
      return
    }
    // Si entró bien no se apaga `entrando`: el árbol se reemplaza por el panel
    // y apagarlo solo provocaría un aviso de React sobre un componente muerto.
  }

  return (
    <div className="flex h-full w-full items-center justify-center overflow-y-auto bg-slate-100 p-4 dark:bg-slate-950">
      <div className="w-full max-w-sm py-8">
        <div className="mb-7 flex flex-col items-center text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-800 text-2xl shadow-lg shadow-brand-900/30 dark:bg-brand-600">
            <i className="fa-solid fa-microphone-lines text-brand-300" aria-hidden="true" />
          </div>
          <h1 className="mt-3.5 font-display text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-50">
            tairos<span className="text-brand-700 dark:text-brand-300">.rc</span>
          </h1>
          <p className="mt-1 text-xs font-medium text-slate-500 dark:text-slate-400">
            Registro contable de la imprenta
          </p>
        </div>

        <form
          onSubmit={(evento) => void enviar(evento)}
          className="space-y-4 rounded-2xl border border-slate-200/80 bg-white p-6 shadow-sm dark:border-slate-800/80 dark:bg-slate-900"
        >
          <div>
            <h2 className="font-display text-base font-bold text-slate-900 dark:text-slate-50">
              Iniciar sesión
            </h2>
            <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
              Entra con el correo que te dio el administrador del negocio.
            </p>
          </div>

          {error && (
            <div
              role="alert"
              className="flex items-start gap-2.5 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs leading-relaxed text-rose-800 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300"
            >
              <i
                className="fa-solid fa-circle-exclamation mt-0.5 shrink-0 text-rose-500 dark:text-rose-400"
                aria-hidden="true"
              />
              <p>{error}</p>
            </div>
          )}

          <div>
            <label className="field-label" htmlFor="correo">
              Correo
            </label>
            <input
              id="correo"
              type="email"
              value={correo}
              onChange={(evento) => setCorreo(evento.target.value)}
              autoComplete="username"
              autoFocus
              inputMode="email"
              placeholder="nombre@imprenta.pe"
              disabled={entrando}
              className="field"
            />
          </div>

          <div>
            <label className="field-label" htmlFor="contrasena">
              Contraseña
            </label>
            <div className="relative">
              <input
                id="contrasena"
                type={verContrasena ? 'text' : 'password'}
                value={contrasena}
                onChange={(evento) => setContrasena(evento.target.value)}
                autoComplete="current-password"
                placeholder="••••••••"
                disabled={entrando}
                className="field pr-10"
              />
              {/* Ver lo escrito evita el intento fallido por una tecla mal dada. */}
              <button
                type="button"
                onClick={() => setVerContrasena((visible) => !visible)}
                aria-label={verContrasena ? 'Ocultar la contraseña' : 'Mostrar la contraseña'}
                className="absolute right-1 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-slate-400 transition-colors hover:text-slate-700 dark:text-slate-500 dark:hover:text-slate-200"
              >
                <i
                  className={`fa-solid ${verContrasena ? 'fa-eye-slash' : 'fa-eye'} text-xs`}
                  aria-hidden="true"
                />
              </button>
            </div>
          </div>

          <button type="submit" disabled={entrando} className="btn-primary w-full py-2.5">
            <i
              className={`fa-solid ${entrando ? 'fa-spinner fa-spin' : 'fa-right-to-bracket'}`}
              aria-hidden="true"
            />
            {entrando ? 'Entrando…' : 'Entrar'}
          </button>

          <p className="border-t border-slate-100 pt-3.5 text-[11px] leading-relaxed text-slate-400 dark:border-slate-800 dark:text-slate-500">
            ¿Olvidaste la contraseña o necesitas una cuenta nueva? Pídesela al administrador del
            negocio: las cuentas se crean desde Supabase → Authentication → Users.
          </p>
        </form>

        <p className="mt-5 text-center text-[11px] text-slate-400 dark:text-slate-600">
          Tairos.rc · Registro contable, proformas, deudas y arqueo de caja
        </p>
      </div>
    </div>
  )
}
