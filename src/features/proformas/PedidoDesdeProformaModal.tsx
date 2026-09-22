import { useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import { useToast } from '@/hooks/useToast'
import { hoyEnLima } from '@/lib/dictado/extraer'
import { money, parseAmount } from '@/lib/format'
import { useData } from '@/store/DataProvider'
import { PAYMENT_METHODS, type PaymentMethod, type Proforma } from '@/types'

type Cobro = 'todo' | 'parte' | 'credito'

/**
 * El cliente aceptó la cotización: pasa a pedido, con lo que deje ahora (todo,
 * una parte o nada) y para cuándo es. «Cobrar» sigue existiendo para el que
 * paga todo y se lo lleva; esto es para el encargo que se hace después.
 */
export function PedidoDesdeProformaModal({ proforma, onClose }: { proforma: Proforma; onClose: () => void }) {
  const { pedidoDesdeProforma } = useData()
  const toast = useToast()
  const [cobro, setCobro] = useState<Cobro>('parte')
  const [adelanto, setAdelanto] = useState('')
  const [metodo, setMetodo] = useState<PaymentMethod>('Efectivo')
  const [telefono, setTelefono] = useState('')
  const [entrega, setEntrega] = useState('')
  const [guardando, setGuardando] = useState(false)

  const monto = cobro === 'todo' ? proforma.total : cobro === 'credito' ? 0 : parseAmount(adelanto)
  const excede = monto > proforma.total + 0.001

  const guardar = async () => {
    if (cobro === 'parte' && monto <= 0) return toast.error('Escribe cuánto deja de adelanto, o elige «Al crédito»')
    if (excede) return toast.error(`El adelanto no puede pasar de ${money(proforma.total)}`)
    setGuardando(true)
    try {
      const { debt } = await pedidoDesdeProforma(proforma.id, {
        payment: metodo,
        advance: monto,
        phone: telefono.trim(),
        estado: 'recibido',
        entrega: entrega || null,
      })
      toast.success(
        debt ? `Pedido registrado · quedan ${money(debt.balance)} por cobrar` : `Pedido registrado y pagado`,
      )
      onClose()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo pasar a pedido')
    } finally {
      setGuardando(false)
    }
  }

  return (
    <Modal open onClose={onClose} title={`Pasar ${proforma.code} a pedido`} subtitle={proforma.client} icon="fa-file-circle-check">
      <div className="space-y-3">
        <div className="rounded-2xl border border-slate-100 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950">
          <p className="text-xs font-semibold text-slate-800 dark:text-slate-100">{proforma.detail}</p>
          <p className="mt-1 text-lg font-extrabold tabular-nums text-brand-800 dark:text-brand-300">{money(proforma.total)}</p>
        </div>

        <div role="radiogroup" aria-label="Cómo paga" className="grid grid-cols-3 gap-1.5">
          {(
            [
              ['todo', 'Paga todo'],
              ['parte', 'Deja una parte'],
              ['credito', 'Al crédito'],
            ] as const
          ).map(([valor, texto]) => (
            <button
              key={valor}
              type="button"
              role="radio"
              aria-checked={cobro === valor}
              onClick={() => setCobro(valor)}
              className={`rounded-lg border px-2 py-1.5 text-[11px] font-bold transition-colors ${
                cobro === valor
                  ? 'border-brand-500 bg-brand-50 text-brand-800 dark:bg-brand-500/10 dark:text-brand-300'
                  : 'border-slate-200 text-slate-500 dark:border-slate-700 dark:text-slate-400'
              }`}
            >
              {texto}
            </button>
          ))}
        </div>

        {cobro === 'parte' && (
          <div>
            <label className="field-label" htmlFor="pp-adelanto">
              Adelanto (S/)
            </label>
            <input
              id="pp-adelanto"
              inputMode="decimal"
              value={adelanto}
              onChange={(e) => setAdelanto(e.target.value)}
              placeholder="0.00"
              className={`field font-bold ${excede ? 'border-rose-400 bg-rose-50 dark:bg-rose-500/10' : ''}`}
            />
            <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
              Quedarán {money(Math.max(0, proforma.total - monto))} por cobrar.
            </p>
          </div>
        )}

        {cobro !== 'credito' && (
          <div>
            <label className="field-label" htmlFor="pp-metodo">
              ¿Con qué paga?
            </label>
            <select id="pp-metodo" value={metodo} onChange={(e) => setMetodo(e.target.value as PaymentMethod)} className="field">
              {PAYMENT_METHODS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="field-label" htmlFor="pp-entrega">
              Entrega <span className="font-normal text-slate-400">(opcional)</span>
            </label>
            <input id="pp-entrega" type="date" min={hoyEnLima()} value={entrega} onChange={(e) => setEntrega(e.target.value)} className="field" />
          </div>
          <div>
            <label className="field-label" htmlFor="pp-telefono">
              Teléfono <span className="font-normal text-slate-400">(para avisar)</span>
            </label>
            <input
              id="pp-telefono"
              type="tel"
              inputMode="tel"
              value={telefono}
              onChange={(e) => setTelefono(e.target.value)}
              placeholder="Ej: 987 654 321"
              className="field"
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="btn-ghost">
            Cancelar
          </button>
          <button type="button" disabled={guardando || excede} onClick={() => void guardar()} className="btn-primary px-4">
            {guardando ? 'Guardando…' : 'Registrar pedido'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
