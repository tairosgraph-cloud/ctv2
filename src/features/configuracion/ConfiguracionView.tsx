import { useState } from 'react'
import { resetLocalStore } from '@/data'
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

/** Los accesos que tendría el sistema cuando exista el login. */
const ROLES = [
  {
    nombre: 'Administrador',
    icono: 'fa-user-shield',
    puede: 'Todo: registrar, corregir, anular, cerrar caja y ver los informes.',
  },
  {
    nombre: 'Cajero',
    icono: 'fa-user',
    puede: 'Registrar órdenes y cobrar. No puede anular ni eliminar asientos.',
  },
  {
    nombre: 'Solo lectura',
    icono: 'fa-eye',
    puede: 'Consultar e imprimir. No modifica nada. Útil para tu contador.',
  },
]

/**
 * Ejemplo de cómo se vería la lista cuando exista el inicio de sesión.
 * Los correos van en blanco a propósito: un correo inventado aquí parecería
 * una cuenta de verdad.
 */
const USUARIOS_MUESTRA = [
  { nombre: 'Administrador del negocio', correo: 'Sin asignar', rol: 'Administrador', activo: true },
  { nombre: 'Sin asignar', correo: 'Sin asignar', rol: 'Cajero', activo: false },
]

export function ConfiguracionView() {
  const { tema, elegir } = useTheme()
  const { mode, transactions, workOrders, debts, proformas, closings } = useData()
  const informe = useInformeGeneral()
  const toast = useToast()
  const [reiniciando, setReiniciando] = useState(false)

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

      {/* ---------- Usuarios: visual ---------- */}
      <Seccion
        titulo="Usuarios y accesos"
        descripcion="Quién entra al sistema y qué puede hacer"
        icono="fa-users"
        estado={<Proximamente nota="Necesita el inicio de sesión, que aún no existe" />}
      >
        <div className="mb-3 flex items-start gap-2.5 rounded-xl border border-amber-100 bg-amber-50 p-3 text-xs dark:border-amber-500/25 dark:bg-amber-500/10">
          <i
            className="fa-solid fa-triangle-exclamation mt-0.5 text-amber-600 dark:text-amber-400"
            aria-hidden="true"
          />
          <p className="text-amber-900 dark:text-amber-200">
            <span className="font-bold">Hoy el sistema no pide contraseña.</span> Cualquiera que
            abra la dirección entra con todos los permisos. Esta sección queda lista para cuando se
            active el inicio de sesión.
          </p>
        </div>

        <div className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 dark:bg-slate-800/60">
              <tr>
                <th className="p-2.5 font-semibold text-slate-500 dark:text-slate-400">Persona</th>
                <th className="p-2.5 font-semibold text-slate-500 dark:text-slate-400">Rol</th>
                <th className="p-2.5 font-semibold text-slate-500 dark:text-slate-400">Estado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {USUARIOS_MUESTRA.map((u) => (
                <tr key={u.nombre}>
                  <td className="p-2.5">
                    <p className="font-bold text-slate-800 dark:text-slate-100">{u.nombre}</p>
                    <p className="text-[10px] text-slate-400 dark:text-slate-500">{u.correo}</p>
                  </td>
                  <td className="p-2.5 text-slate-600 dark:text-slate-300">{u.rol}</td>
                  <td className="p-2.5">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                        u.activo
                          ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300'
                          : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
                      }`}
                    >
                      {u.activo ? 'Activo' : 'Sin usar'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="mb-2 mt-4 text-[11px] font-bold uppercase tracking-wide text-slate-400 dark:text-slate-500">
          Roles previstos
        </p>
        <ul className="space-y-2">
          {ROLES.map((rol) => (
            <li key={rol.nombre} className="flex items-start gap-2.5 text-xs">
              <i
                className={`fa-solid ${rol.icono} mt-0.5 w-4 text-slate-400 dark:text-slate-500`}
                aria-hidden="true"
              />
              <span>
                <span className="font-bold text-slate-800 dark:text-slate-100">{rol.nombre}</span>
                <span className="text-slate-500 dark:text-slate-400"> — {rol.puede}</span>
              </span>
            </li>
          ))}
        </ul>
      </Seccion>

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
