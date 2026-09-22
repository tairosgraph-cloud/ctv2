import { useEffect, useState } from 'react'
import { DictadoHost } from '@/components/dictado/DictadoHost'
import { DashboardLayout } from '@/components/layout/DashboardLayout'
import { WelcomeGateway } from '@/components/gateway/WelcomeGateway'
import { ArqueoView } from '@/features/arqueo/ArqueoView'
import { LoginView } from '@/features/auth/LoginView'
import { ConfiguracionView } from '@/features/configuracion/ConfiguracionView'
import { DeudasView } from '@/features/deudas/DeudasView'
import { MovimientosView } from '@/features/movimientos/MovimientosView'
import { ProformasView } from '@/features/proformas/ProformasView'
import { RegistroView } from '@/features/registro/RegistroView'
import { TrabajosView } from '@/features/trabajos/TrabajosView'
import { useAuth } from '@/hooks/useAuth'
import { useCuentaActiva } from '@/hooks/useCuentaActiva'
import { DictadoProvider, useDictado } from '@/hooks/useDictado'
import { isSupabaseConfigured } from '@/lib/supabase'
import { DataProvider, useData } from '@/store/DataProvider'
import type { TabKey } from '@/types'
import { rutaDe, type Ruta } from '../supabase/functions/_shared/dictado/tipos.ts'

/** Dónde queda lo dictado: se abre esa pestaña para verlo al guardar. */
const PESTANA_DE_RUTA: Partial<Record<Ruta, TabKey>> = {
  registro: 'registro',
  proforma: 'proformas',
  deuda: 'deudas',
  abono: 'deudas',
}

/**
 * Vite incrusta import.meta.env al compilar, así que esto se resuelve una sola
 * vez: en `npm run dev` PROD es false y el aviso no llega ni a montarse — el
 * modo local es el flujo normal mientras se desarrolla. Solo molesta cuando la
 * app ya está publicada y compilada sin credenciales.
 */
const sinBaseDeDatosEnProduccion = import.meta.env.PROD && !isSupabaseConfigured

function LocalDataBanner() {
  if (!sinBaseDeDatosEnProduccion) return null

  return (
    <div
      role="alert"
      className="rounded-2xl border-2 border-amber-300 dark:border-amber-500/40 bg-amber-50 dark:bg-amber-500/10 p-4 text-amber-900 dark:text-amber-200 md:p-5"
    >
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-200 dark:bg-amber-500/25 text-amber-800 dark:text-amber-300">
          <i className="fa-solid fa-hard-drive" aria-hidden="true" />
        </span>
        <div className="space-y-2">
          <h3 className="font-display text-sm font-bold tracking-tight md:text-base">
            Esta copia no está guardando nada en un servidor
          </h3>
          <p className="text-xs leading-relaxed md:text-sm">
            Lo que registres aquí —ventas, proformas, deudas y arqueos— se queda dentro de este
            navegador y de este equipo. Nadie más de la imprenta lo ve, no se sincroniza con otro
            celular ni computadora, y desaparece si se limpian los datos del navegador. Lo que ves
            ahora son datos de demostración.
          </p>
          <p className="text-xs leading-relaxed md:text-sm">
            <span className="font-bold">Para trabajar de verdad:</span> configura{' '}
            <code className="rounded bg-amber-200/70 dark:bg-amber-500/20 px-1.5 py-0.5 font-mono text-[11px] font-semibold">
              VITE_SUPABASE_URL
            </code>{' '}
            y{' '}
            <code className="rounded bg-amber-200/70 dark:bg-amber-500/20 px-1.5 py-0.5 font-mono text-[11px] font-semibold">
              VITE_SUPABASE_ANON_KEY
            </code>{' '}
            en el servicio donde está publicada la app y{' '}
            <span className="font-bold">vuelve a compilar y publicar</span>. Estas claves se graban
            dentro de la app al compilarla: agregarlas después, sin volver a compilar, no cambia
            nada.
          </p>
        </div>
      </div>
    </div>
  )
}

function ConnectionBanner() {
  const { error, refresh } = useData()
  if (!error) return null

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-rose-200 dark:border-rose-500/30 bg-rose-50 dark:bg-rose-500/10 p-4 text-xs text-rose-800 dark:text-rose-300">
      <div className="flex items-start gap-2.5">
        <i className="fa-solid fa-triangle-exclamation mt-0.5 text-rose-500 dark:text-rose-400" aria-hidden="true" />
        <p className="max-w-3xl font-medium">{error}</p>
      </div>
      <button type="button" onClick={() => void refresh()} className="btn-ghost shrink-0">
        <i className="fa-solid fa-rotate-right" aria-hidden="true" />
        Reintentar
      </button>
    </div>
  )
}

function Panel() {
  const [showGateway, setShowGateway] = useState(true)
  const [tab, setTab] = useState<TabKey>('registro')
  const [search, setSearch] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const { borrador } = useDictado()

  useEffect(() => {
    if (!borrador) return
    const destino = PESTANA_DE_RUTA[rutaDe(borrador.resultado.extraccion.intent)]
    if (destino) {
      setTab(destino)
      setSearch('')
    }
  }, [borrador])

  if (showGateway) {
    return <WelcomeGateway onEnter={() => setShowGateway(false)} />
  }

  return (
    <DashboardLayout
      active={tab}
      onSelect={(next) => {
        setTab(next)
        setSearch('')
      }}
      onOpenGateway={() => setShowGateway(true)}
      search={search}
      onSearchChange={setSearch}
      menuOpen={menuOpen}
      onMenuOpenChange={setMenuOpen}
    >
      <LocalDataBanner />
      <ConnectionBanner />

      {tab === 'registro' && <RegistroView search={search} />}
      {tab === 'trabajos' && <TrabajosView search={search} />}
      {tab === 'movimientos' && <MovimientosView search={search} />}
      {tab === 'proformas' && <ProformasView search={search} />}
      {tab === 'deudas' && <DeudasView search={search} />}
      {tab === 'arqueo' && <ArqueoView />}
      {tab === 'configuracion' && <ConfiguracionView />}

      <DictadoHost />
    </DashboardLayout>
  )
}

/** Espera corta mientras el cliente de Supabase lee la sesión guardada. */
function PantallaCargando({ texto = 'Comprobando tu sesión…' }: { texto?: string }) {
  return (
    <div className="flex h-full w-full items-center justify-center bg-slate-100 dark:bg-slate-950">
      <div className="flex flex-col items-center gap-3 text-slate-500 dark:text-slate-400">
        <i
          className="fa-solid fa-spinner fa-spin text-2xl text-brand-600 dark:text-brand-400"
          aria-hidden="true"
        />
        <p className="text-xs font-semibold">{texto}</p>
      </div>
    </div>
  )
}

/**
 * Una cuenta nueva nace sin permisos (0009): hasta que un gerente la activa,
 * la base no le enseña nada. Mejor decirlo que mostrar unos libros vacíos.
 */
function CuentaInactiva() {
  const { correo, cerrarSesion } = useAuth()
  return (
    <div className="flex h-full w-full items-center justify-center bg-slate-100 p-4 dark:bg-slate-950">
      <div className="w-full max-w-md space-y-4 rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-100 text-lg text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
          <i className="fa-solid fa-user-clock" aria-hidden="true" />
        </span>
        <div className="space-y-1.5">
          <h1 className="font-display text-lg font-bold text-slate-900 dark:text-slate-50">
            Tu cuenta todavía no está activada
          </h1>
          <p className="text-xs leading-relaxed text-slate-500 dark:text-slate-400">
            Entraste como <span className="font-semibold text-slate-700 dark:text-slate-200">{correo}</span>,
            pero nadie del negocio te ha dado acceso aún. Pide al gerente que active tu cuenta y
            vuelve a entrar.
          </p>
        </div>
        <button type="button" onClick={() => void cerrarSesion()} className="btn-ghost mx-auto">
          <i className="fa-solid fa-right-from-bracket" aria-hidden="true" />
          Cerrar sesión
        </button>
      </div>
    </div>
  )
}

export default function App() {
  const { requiereSesion, estado, session } = useAuth()
  const cuenta = useCuentaActiva(requiereSesion && estado === 'con-sesion' ? session : null)

  if (requiereSesion && estado === 'cargando') return <PantallaCargando />
  if (requiereSesion && estado !== 'con-sesion') return <LoginView />
  if (cuenta === 'comprobando') return <PantallaCargando texto="Comprobando tu cuenta…" />
  if (cuenta === 'inactiva') return <CuentaInactiva />

  // El proveedor de datos se monta DESPUÉS de la sesión a propósito: si
  // cargara antes, su primera lectura saldría sin token —y con las políticas
  // RLS cerradas eso es un error de permisos en la cara del usuario—, y al
  // entrar no volvería a intentarlo. Al cerrar sesión se desmonta y la
  // contabilidad que había en memoria se va con él.
  return (
    <DataProvider>
      <DictadoProvider>
        <Panel />
      </DictadoProvider>
    </DataProvider>
  )
}
