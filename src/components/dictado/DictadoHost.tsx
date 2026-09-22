import { useEffect, useMemo, useRef, useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import { AbonoModal } from '@/features/deudas/AbonoModal'
import { NewDebtModal } from '@/features/deudas/NewDebtModal'
import { NewProformaModal } from '@/features/proformas/NewProformaModal'
import { NewOrderModal } from '@/features/registro/NewOrderModal'
import { useDictado, type Borrador } from '@/hooks/useDictado'
import { useToast } from '@/hooks/useToast'
import { destinoDelAbono } from '@/lib/dictado/formulario'
import { money } from '@/lib/format'
import { useData } from '@/store/DataProvider'
import type { Debt } from '@/types'
import { rutaDe } from '../../../supabase/functions/_shared/dictado/tipos.ts'

/**
 * Abre el formulario que corresponde a lo dictado con el micrófono de la
 * barra superior. Nada se guarda sin pasar por el formulario: el dictado
 * propone y la persona confirma.
 */
export function DictadoHost() {
  const { borrador, descartar } = useDictado()
  if (!borrador) return null
  // La key reinicia todo al llegar otro dictado con el formulario abierto.
  return <Formulario key={borrador.id} borrador={borrador} onClose={descartar} />
}

function Formulario({ borrador, onClose }: { borrador: Borrador; onClose: () => void }) {
  const ex = borrador.resultado.extraccion
  switch (rutaDe(ex.intent)) {
    case 'registro':
      return <NewOrderModal open dictado={borrador} onClose={onClose} />
    case 'proforma':
      return <NewProformaModal open dictado={borrador} onClose={onClose} />
    case 'deuda':
      return <NewDebtModal open dictado={borrador} onClose={onClose} />
    case 'abono':
      return <Abono borrador={borrador} onClose={onClose} />
    default:
      return null
  }
}

/**
 * Un abono va a una cuenta que ya existe. Si el nombre deja una sola, se abre;
 * si deja varias, se pregunta; si ninguna, se avisa y no se toca nada.
 */
function Abono({ borrador, onClose }: { borrador: Borrador; onClose: () => void }) {
  const { debts, error } = useData()
  const toast = useToast()
  // Se decide una vez: si la lista de cuentas cambia con el formulario
  // abierto (otro dispositivo, un refresco), no cambia de cuenta por debajo.
  const [destino] = useState(() => destinoDelAbono(borrador.resultado.extraccion, debts))
  const [elegida, setElegida] = useState<Debt | null>(destino.tipo === 'una' ? destino.deuda : null)

  const avisado = useRef(false)
  useEffect(() => {
    // El ref evita el aviso doble del modo estricto de React en desarrollo.
    if (destino.tipo !== 'ninguna' || avisado.current) return
    avisado.current = true
    if (error) {
      // Sin poder leer las cuentas, «no la encontré» sería falso.
      toast.error('No pude leer las cuentas pendientes (falla la conexión con la base). Inténtalo de nuevo.')
    } else {
      toast.info(
        destino.parte
          ? `No encontré cuentas pendientes de «${destino.parte}». Revisa el nombre en Deudas o regístralo como cuenta nueva.`
          : 'No hay cuentas pendientes a las que abonar.',
      )
    }
    onClose()
  }, [destino, error, onClose, toast])

  if (elegida) return <AbonoModal debt={elegida} dictado={borrador} onClose={onClose} />
  if (destino.tipo !== 'varias') return null
  return <ElegirCuenta deudas={destino.deudas} frase={borrador.texto} onElegir={setElegida} onClose={onClose} />
}

function ElegirCuenta({
  deudas,
  frase,
  onElegir,
  onClose,
}: {
  deudas: Debt[]
  frase: string
  onElegir: (deuda: Debt) => void
  onClose: () => void
}) {
  const ordenadas = useMemo(() => [...deudas].sort((a, b) => a.party.localeCompare(b.party)), [deudas])
  return (
    <Modal open onClose={onClose} title="¿A qué cuenta va el abono?" subtitle={`«${frase}»`} icon="fa-hand-holding-dollar">
      <ul className="space-y-2">
        {ordenadas.map((d) => (
          <li key={d.id}>
            <button
              type="button"
              onClick={() => onElegir(d)}
              className="flex w-full items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-left transition-colors hover:border-brand-400 hover:bg-brand-50 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-brand-500/50 dark:hover:bg-brand-500/10"
            >
              <span className="min-w-0">
                <span className="block truncate text-xs font-bold text-slate-800 dark:text-slate-100">{d.party}</span>
                <span className="block truncate text-[11px] text-slate-500 dark:text-slate-400">{d.concept}</span>
              </span>
              <span className="shrink-0 text-right">
                <span
                  className={`block text-xs font-extrabold tabular-nums ${
                    d.kind === 'COBRAR' ? 'text-amber-700 dark:text-amber-300' : 'text-rose-700 dark:text-rose-300'
                  }`}
                >
                  {money(d.balance)}
                </span>
                <span className="block text-[10px] text-slate-400 dark:text-slate-500">
                  {d.kind === 'COBRAR' ? 'por cobrar' : 'por pagar'}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </Modal>
  )
}
