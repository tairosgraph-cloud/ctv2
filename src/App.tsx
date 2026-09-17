import { useState } from 'react'
import { DashboardLayout } from '@/components/layout/DashboardLayout'
import { WelcomeGateway } from '@/components/gateway/WelcomeGateway'
import { ArqueoView } from '@/features/arqueo/ArqueoView'
import { ConfiguracionView } from '@/features/configuracion/ConfiguracionView'
import { DeudasView } from '@/features/deudas/DeudasView'
import { MovimientosView } from '@/features/movimientos/MovimientosView'
import { ProformasView } from '@/features/proformas/ProformasView'
import { RegistroView } from '@/features/registro/RegistroView'
import { isSupabaseConfigured } from '@/lib/supabase'
import { useData } from '@/store/DataProvider'
import type { TabKey } from '@/types'

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

export default function App() {
  const [showGateway, setShowGateway] = useState(true)
  const [tab, setTab] = useState<TabKey>('registro')
  const [search, setSearch] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)

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
      {tab === 'movimientos' && <MovimientosView search={search} />}
      {tab === 'proformas' && <ProformasView search={search} />}
      {tab === 'deudas' && <DeudasView search={search} />}
      {tab === 'arqueo' && <ArqueoView />}
      {tab === 'configuracion' && <ConfiguracionView />}
    </DashboardLayout>
  )
}
