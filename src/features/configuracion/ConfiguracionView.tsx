import { useEffect, useState } from 'react'
import { resetLocalStore } from '@/data'
import { guardarInterpreteActivado, interpreteActivado } from '@/lib/dictado/preferencia'
import { comprobarInterprete, type EstadoInterprete } from '@/lib/extractor'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { useInformeGeneral } from '@/hooks/useInformeGeneral'
import { useTheme, type Tema } from '@/hooks/useTheme'
import { useToast } from '@/hooks/useToast'
import { useData } from '@/store/DataProvider'
import { Activo, CampoMuestra, Proximamente, Seccion } from './piezas'

const TEMAS: { valor: Tema; etiqueta: string; icono: string; nota: string }[] = [
  { valor: 'claro', etiqueta: 'Claro', icono: 'fa-sun', nota: 'Siempre en claro' },
  { valor: 'oscuro', etiqueta: 'Oscuro', icono: 'fa-moon', nota: 'Siempre en oscuro' },
  {
    valor: 'sistema',
    etiqueta: 'Como el sistema',
    icono: 'fa-desktop',
    nota: 'Sigue a tu dispositivo',
  },
]

/**
 * Los papeles que aplica la base (0009). La pantalla todavía enseña todos los
 * botones a todos; lo que un papel no permite, la base lo rechaza.
 */
const ROLES = [
  {
    clave: 'gerente',
    nombre: 'Gerente',
    icono: 'fa-user-shield',
    puede: 'Todo: registrar, corregir, anular, borrar y cerrar caja.',
  },
  {
    clave: 'cajero',
    nombre: 'Cajero',
    icono: 'fa-user',
    puede: 'Registra órdenes, gastos, abonos y cobra proformas. No corrige, anula, borra ni cierra caja.',
  },
  {
    clave: 'contador',
    nombre: 'Contador',
    icono: 'fa-eye',
    puede: 'Consulta y exporta. No modifica nada.',
  },
] as const

/** El papel de la cuenta con sesión (mi_rol, 0009); null en modo local o si no se sabe. */
function useMiRol(activo: boolean): string | null {
  const [rol, setRol] = useState<string | null>(null)
  useEffect(() => {
    const cliente = supabase
    if (!activo || !cliente) return
    let vivo = true
    void Promise.resolve(cliente.rpc('mi_rol'))
      .then(({ data, error }) => {
        if (vivo && !error && typeof data === 'string') setRol(data)
      })
      .catch(() => undefined)
    return () => {
      vivo = false
    }
  }, [activo])
  return rol
}

const ESTADO_DEL_INTERPRETE: Record<EstadoInterprete | 'comprobando', string> = {
  comprobando: 'Comprobando si está listo…',
  disponible: 'Listo en el servidor.',
  'no-desplegado': 'Todavía no está activado en el servidor: el dictado usa el intérprete básico.',
  'sin-servidor': 'Sin servidor no hay intérprete inteligente: el dictado usa el básico.',
}

/**
 * El dictado por voz: el interruptor del intérprete inteligente, su estado
 * real y qué sale del equipo cuando se dicta.
 */
function SeccionDictado() {
  const [activado, setActivado] = useState(interpreteActivado)
  const [estado, setEstado] = useState<EstadoInterprete | 'comprobando'>('comprobando')

  useEffect(() => {
    let vivo = true
    void comprobarInterprete().then((e) => {
      if (vivo) setEstado(e)
    })
    return () => {
      vivo = false
    }
  }, [])

  const alternar = () => {
    guardarInterpreteActivado(!activado)
    setActivado(!activado)
  }

  const listo = estado === 'disponible'

  return (
    <Seccion
      titulo="Dictado por voz"
      descripcion="Cómo se interpreta lo que dictas"
      icono="fa-microphone"
      estado={<Activo />}
    >
      <div className="flex items-start justify-between gap-3 rounded-xl border border-slate-200 p-3 dark:border-slate-800">
        <div className="text-xs">
          <p className="font-bold text-slate-800 dark:text-slate-100">Intérprete inteligente</p>
          <p className="mt-0.5 text-slate-500 dark:text-slate-400">
            Entiende frases dichas de cualquier manera y varios trabajos a la vez. Si falla o tarda,
            el dictado sigue con el intérprete básico.
          </p>
          <p
            className={`mt-1 font-semibold ${
              listo && activado ? 'text-emerald-700 dark:text-emerald-300' : 'text-slate-500 dark:text-slate-400'
            }`}
          >
            {activado ? ESTADO_DEL_INTERPRETE[estado] : 'Apagado en este navegador: el dictado usa el básico.'}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={activado}
          aria-label="Intérprete inteligente"
          onClick={alternar}
          className={`relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition-colors ${
            activado ? 'bg-brand-600' : 'bg-slate-300 dark:bg-slate-700'
          }`}
        >
          <span
            className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${
              activado ? 'left-[1.375rem]' : 'left-0.5'
            }`}
          />
        </button>
      </div>

      <p className="mt-3 text-[11px] font-bold uppercase tracking-wide text-slate-400 dark:text-slate-500">
        Qué sale de este equipo
      </p>
      <ul className="mt-1.5 space-y-1.5 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
        <li>
          <i className="fa-solid fa-microphone mr-1.5 w-3 text-slate-400" aria-hidden="true" />
          La voz la convierte en texto el navegador; en Chrome, con los servidores de Google.
        </li>
        <li>
          <i className="fa-solid fa-wand-magic-sparkles mr-1.5 w-3 text-slate-400" aria-hidden="true" />
          Con el intérprete inteligente, ese texto (nunca el audio) se envía a Anthropic (Claude) para
          entenderlo. Apagado, no sale nada más.
        </li>
        <li>
          <i className="fa-solid fa-database mr-1.5 w-3 text-slate-400" aria-hidden="true" />
          Cada dictado queda guardado como texto en tu base, con lo que hubo que corregir, para medir
          cuánto acierta. El audio no se guarda.
        </li>
      </ul>
    </Seccion>
  )
}

export function ConfiguracionView() {
  const { tema, elegir } = useTheme()
  const { correo, requiereSesion, cerrarSesion } = useAuth()
  const { mode, transactions, workOrders, debts, proformas, closings } = useData()
  const informe = useInformeGeneral()
  const toast = useToast()
  const [reiniciando, setReiniciando] = useState(false)
  const miRol = useMiRol(requiereSesion)

  const restablecer = () => {
    if (
      !window.confirm(
        'Se borrarán todos los datos de este navegador y volverán los de demostración. ¿Continuar?',
      )
    )
      return
    setReiniciando(true)
    resetLocalStore()
    toast.success('Datos restablecidos. Recargando…')
    window.setTimeout(() => window.location.reload(), 700)
  }

  const registros =
    transactions.length + workOrders.length + debts.length + proformas.length + closings.length

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {/* ---------- Apariencia: funciona hoy ---------- */}
      <Seccion
        titulo="Apariencia"
        descripcion="Cómo se ve el sistema en este dispositivo"
        icono="fa-palette"
        estado={<Activo />}
      >
        <span className="field-label">Tema</span>
        <div className="grid gap-2 sm:grid-cols-3">
          {TEMAS.map((opcion) => (
            <button
              key={opcion.valor}
              type="button"
              onClick={() => elegir(opcion.valor)}
              aria-pressed={tema === opcion.valor}
              className={`flex flex-col items-center gap-1.5 rounded-xl border p-3 transition-all ${
                tema === opcion.valor
                  ? 'border-brand-500 bg-brand-50 text-brand-800 dark:bg-brand-500/10 dark:text-brand-300'
                  : 'border-slate-200 text-slate-500 hover:border-slate-300 dark:border-slate-700 dark:text-slate-400 dark:hover:border-slate-600'
              }`}
            >
              <i className={`fa-solid ${opcion.icono} text-base`} aria-hidden="true" />
              <span className="text-xs font-bold">{opcion.etiqueta}</span>
              <span className="text-center text-[10px] leading-tight opacity-70">
                {opcion.nota}
              </span>
            </button>
          ))}
        </div>
        <p className="mt-2.5 text-[11px] text-slate-400 dark:text-slate-500">
          Se guarda en este navegador. Otro dispositivo puede tener otro tema.
        </p>
      </Seccion>

      {/* ---------- Datos: parcialmente real ---------- */}
      <Seccion
        titulo="Datos y respaldo"
        descripcion="Dónde se guarda tu información"
        icono="fa-database"
        estado={<Activo />}
      >
        <div
          className={`mb-3 flex items-start gap-2.5 rounded-xl border p-3 ${
            mode === 'supabase'
              ? 'border-emerald-100 bg-emerald-50 dark:border-emerald-500/25 dark:bg-emerald-500/10'
              : 'border-amber-100 bg-amber-50 dark:border-amber-500/25 dark:bg-amber-500/10'
          }`}
        >
          <i
            className={`fa-solid ${mode === 'supabase' ? 'fa-database text-emerald-600 dark:text-emerald-400' : 'fa-hard-drive text-amber-600 dark:text-amber-400'} mt-0.5`}
            aria-hidden="true"
          />
          <div className="text-xs">
            <p className="font-bold text-slate-800 dark:text-slate-100">
              {mode === 'supabase' ? 'Conectado a Supabase' : 'Modo local (este navegador)'}
            </p>
            <p className="mt-0.5 text-slate-500 dark:text-slate-400">
              {mode === 'supabase'
                ? 'Tus datos viven en la nube y se comparten entre dispositivos.'
                : 'Los datos están solo aquí. Si borras los datos del navegador, se pierden.'}
            </p>
            <p className="mt-1 font-semibold text-slate-600 dark:text-slate-300">
              {registros} registros guardados
            </p>
          </div>
        </div>

        <div className="space-y-2">
          <button
            type="button"
            onClick={() => void informe.descargar()}
            disabled={informe.generando}
            className="btn-ghost w-full justify-start"
          >
            <i
              className={`fa-solid ${informe.generando ? 'fa-spinner fa-spin' : 'fa-file-excel'} w-4`}
              aria-hidden="true"
            />
            {informe.generando ? 'Generando…' : 'Descargar informe general en Excel'}
          </button>

          <div className="flex items-center justify-between gap-2 rounded-xl bg-slate-50 px-3 py-2 dark:bg-slate-800/60">
            <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">
              Copia de seguridad automática
            </span>
            <Proximamente nota="Requiere Supabase con plan de pago" />
          </div>

          {mode === 'local' && (
            <button
              type="button"
              onClick={restablecer}
              disabled={reiniciando}
              className="w-full justify-start rounded-xl bg-rose-50 px-4 py-2 text-left text-xs font-semibold text-rose-700 transition-colors hover:bg-rose-100 dark:bg-rose-500/10 dark:text-rose-300 dark:hover:bg-rose-500/20"
            >
              <i className="fa-solid fa-rotate-left mr-2 w-4" aria-hidden="true" />
              Restablecer a los datos de demostración
            </button>
          )}
        </div>
      </Seccion>

      {/* ---------- Usuarios: real cuando hay Supabase ---------- */}
      <Seccion
        titulo="Usuarios y accesos"
        descripcion="Quién entra al sistema y qué puede hacer"
        icono="fa-users"
        estado={
          requiereSesion ? (
            <Activo />
          ) : (
            <Proximamente nota="Sin servidor no hay cuentas que validar" />
          )
        }
      >
        {requiereSesion ? (
          <>
            <div className="mb-3 flex items-start gap-2.5 rounded-xl border border-emerald-100 bg-emerald-50 p-3 text-xs dark:border-emerald-500/25 dark:bg-emerald-500/10">
              <i
                className="fa-solid fa-lock mt-0.5 text-emerald-600 dark:text-emerald-400"
                aria-hidden="true"
              />
              <p className="text-emerald-900 dark:text-emerald-200">
                <span className="font-bold">El sistema pide correo y contraseña.</span> Quien abra
                la dirección sin una cuenta válida solo ve la pantalla de acceso; los datos se piden
                al servidor ya identificado.
              </p>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 p-3 dark:border-slate-800">
              <div className="flex min-w-0 items-center gap-2.5">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-sm text-brand-800 dark:bg-brand-500/10 dark:text-brand-300">
                  <i className="fa-solid fa-user" aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  <p className="truncate text-xs font-bold text-slate-800 dark:text-slate-100">
                    {correo ?? 'Sin identificar'}
                  </p>
                  <p className="text-[10px] text-slate-400 dark:text-slate-500">
                    Es el nombre que queda firmando cada asiento que registres.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => void cerrarSesion()}
                className="shrink-0 rounded-xl bg-rose-50 px-4 py-2 text-xs font-semibold text-rose-700 transition-colors hover:bg-rose-100 dark:bg-rose-500/10 dark:text-rose-300 dark:hover:bg-rose-500/20"
              >
                <i className="fa-solid fa-right-from-bracket mr-1.5" aria-hidden="true" />
                Cerrar sesión
              </button>
            </div>

            <p className="mt-3 text-[11px] leading-relaxed text-slate-400 dark:text-slate-500">
              Las cuentas se crean desde Supabase → Authentication → Users y se activan, con su
              papel, desde el SQL Editor (el README explica cómo). Todavía no se pueden
              administrar desde aquí.
            </p>
          </>
        ) : (
          <div className="flex items-start gap-2.5 rounded-xl border border-amber-100 bg-amber-50 p-3 text-xs dark:border-amber-500/25 dark:bg-amber-500/10">
            <i
              className="fa-solid fa-triangle-exclamation mt-0.5 text-amber-600 dark:text-amber-400"
              aria-hidden="true"
            />
            <p className="text-amber-900 dark:text-amber-200">
              <span className="font-bold">Esta copia no pide contraseña.</span> Funciona solo con el
              almacenamiento de este navegador, sin servidor ni cuentas: no hay nada que un inicio
              de sesión pudiera proteger. Conecta Supabase y el acceso se activa solo.
            </p>
          </div>
        )}

        <div className="mb-2 mt-4 flex items-center justify-between gap-2">
          <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400 dark:text-slate-500">
            Papeles
          </p>
          {requiereSesion ? <Activo /> : <Proximamente nota="Sin servidor no hay cuentas" />}
        </div>
        <ul className="space-y-2">
          {ROLES.map((rol) => (
            <li key={rol.clave} className="flex items-start gap-2.5 text-xs">
              <i
                className={`fa-solid ${rol.icono} mt-0.5 w-4 text-slate-400 dark:text-slate-500`}
                aria-hidden="true"
              />
              <span>
                <span className="font-bold text-slate-800 dark:text-slate-100">{rol.nombre}</span>
                {miRol === rol.clave && (
                  <span className="ml-1.5 rounded-md bg-brand-50 px-1.5 py-0.5 text-[10px] font-bold text-brand-800 dark:bg-brand-500/10 dark:text-brand-300">
                    tu papel
                  </span>
                )}
                <span className="text-slate-500 dark:text-slate-400"> — {rol.puede}</span>
              </span>
            </li>
          ))}
        </ul>
        {requiereSesion && (
          <p className="mt-3 text-[11px] leading-relaxed text-slate-400 dark:text-slate-500">
            Los permisos los aplica la base: una cuenta nueva no ve nada hasta que un gerente la
            activa. La pantalla todavía muestra todos los botones; lo que tu papel no permite, el
            servidor lo rechaza con un aviso.
          </p>
        )}
      </Seccion>

      {/* ---------- Dictado: funciona hoy ---------- */}
      <SeccionDictado />

      {/* ---------- Negocio: visual ---------- */}
      <Seccion
        titulo="Datos del negocio"
        descripcion="Lo que aparece en comprobantes e informes"
        icono="fa-store"
        estado={<Proximamente />}
        inactiva
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <CampoMuestra etiqueta="Nombre comercial" valor="Tairos.rc" />
          <CampoMuestra etiqueta="RUC" valor="20•••••••••" />
          <CampoMuestra etiqueta="Dirección" valor="Sin registrar" ancho="sm:col-span-2" />
          <CampoMuestra etiqueta="Teléfono" valor="Sin registrar" />
          <CampoMuestra etiqueta="Correo" valor="Sin registrar" />
        </div>
      </Seccion>

      {/* ---------- Comprobantes: visual ---------- */}
      <Seccion
        titulo="Comprobantes y tributación"
        descripcion="Series, correlativos e IGV"
        icono="fa-file-invoice-dollar"
        estado={<Proximamente nota="Depende de tu régimen tributario" />}
        inactiva
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <CampoMuestra etiqueta="Serie de boleta" valor="B001" />
          <CampoMuestra etiqueta="Correlativo actual" valor="—" />
          <CampoMuestra etiqueta="Régimen tributario" valor="Sin definir" />
          <CampoMuestra etiqueta="IGV aplicable" valor="No se calcula" />
          <CampoMuestra
            etiqueta="Pie del comprobante"
            valor="Gracias por su preferencia"
            ancho="sm:col-span-2"
          />
        </div>
      </Seccion>

      {/* ---------- Caja: visual ---------- */}
      <Seccion
        titulo="Caja y contabilidad"
        descripcion="Valores por defecto al registrar"
        icono="fa-cash-register"
        estado={<Proximamente />}
        inactiva
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <CampoMuestra etiqueta="Fondo de apertura habitual" valor="S/ 0.00" />
          <CampoMuestra etiqueta="Método de pago por defecto" valor="Efectivo" />
          <CampoMuestra etiqueta="Filas por página en las tablas" valor="25" />
          <CampoMuestra etiqueta="Aviso de deuda antigua" valor="A los 15 días" />
        </div>
        <p className="mt-3 text-[11px] text-slate-400 dark:text-slate-500">
          Las categorías de gasto e ingreso también se podrán editar desde aquí.
        </p>
      </Seccion>
    </div>
  )
}
