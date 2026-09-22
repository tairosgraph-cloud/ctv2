import { useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import { useToast } from '@/hooks/useToast'
import { expiryDate, money } from '@/lib/format'
import { estaCaducada } from '@/lib/proformas'
import { useData } from '@/store/DataProvider'
import { PAYMENT_METHODS, type PaymentMethod, type Proforma } from '@/types'

interface Props {
  proforma: Proforma | null
  onClose: () => void
}

/**
 * El prototipo convertia la proforma en venta asumiendo siempre Yape/Plin.
 * Aqui se pregunta el metodo real, que es lo que despues alimenta el arqueo.
 */
export function CobrarProformaModal({ proforma, onClose }: Props) {
  const { cobrarProforma } = useData()
  const toast = useToast()
  const [payment, setPayment] = useState<PaymentMethod>('Yape/Plin')
  const [saving, setSaving] = useState(false)

  if (!proforma) return null
  const vencida = estaCaducada(proforma, new Date())

  const confirm = async () => {
    setSaving(true)
    try {
      await cobrarProforma(proforma.id, payment)
      toast.success(`Proforma ${proforma.code} cobrada y registrada en el libro`)
      onClose()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo cobrar la proforma')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Cobrar ${proforma.code}`}
      subtitle={proforma.client}
      icon="fa-cart-arrow-down"
      footer={
        <>
          <button type="button" onClick={onClose} className="btn-ghost">
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => void confirm()}
            disabled={saving}
            className="btn-primary px-5"
          >
            {saving ? 'Procesando…' : `Registrar ingreso de ${money(proforma.total)}`}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        {vencida && (
          // No se bloquea: a veces el cliente acepta tarde y el negocio
          // decide respetar el precio. Pero que se sepa antes de cobrar.
          <div
            role="note"
            className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] font-semibold text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300"
          >
            <i className="fa-solid fa-clock-rotate-left mr-1.5" aria-hidden="true" />
            Esta cotización venció el {expiryDate(proforma.issuedAt, proforma.validityDays)}. Si
            respetas el precio de entonces, puedes cobrarla igual; si no, corrígela antes.
          </div>
        )}

        <div className="rounded-2xl border border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-3.5">
          <p className="text-[11px] font-medium text-slate-400 dark:text-slate-500">Detalle cotizado</p>
          <p className="text-xs font-semibold text-slate-800 dark:text-slate-100">{proforma.detail}</p>
          <p className="mt-2 text-lg font-extrabold tabular-nums text-brand-800 dark:text-brand-300">
            {money(proforma.total)}
          </p>
        </div>

        <div>
          <label className="field-label" htmlFor="pf-payment">
            ¿Cómo pagó el cliente?
          </label>
          <select
            id="pf-payment"
            value={payment}
            onChange={(event) => setPayment(event.target.value as PaymentMethod)}
            className="field"
          >
            {PAYMENT_METHODS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
          <p className="mt-1.5 text-[11px] text-slate-400 dark:text-slate-500">
            Se creará un asiento de ingreso por este monto y la proforma quedará como convertida.
          </p>
        </div>
      </div>
    </Modal>
  )
}
