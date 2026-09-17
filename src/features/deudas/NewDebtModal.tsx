import { useState, type FormEvent } from 'react'
import { Modal } from '@/components/ui/Modal'
import { useToast } from '@/hooks/useToast'
import { parseAmount } from '@/lib/format'
import { useData } from '@/store/DataProvider'
import type { Debt, DebtKind } from '@/types'

interface Props {
  open: boolean
  onClose: () => void
  /** Si viene, el modal corrige esa cuenta en vez de crear una nueva. */
  editing?: Debt | null
}

export function NewDebtModal({ open, onClose, editing = null }: Props) {
  const { addDebt, editDebt } = useData()
  const toast = useToast()
  const [kind, setKind] = useState<DebtKind>(editing?.kind ?? 'COBRAR')
  const [party, setParty] = useState(editing?.party ?? '')
  const [concept, setConcept] = useState(editing?.concept ?? '')
  const [total, setTotal] = useState(editing ? String(editing.total) : '')
  const [dueDate, setDueDate] = useState(editing?.dueDate ?? '')
  const [saving, setSaving] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const amount = parseAmount(total)
    if (!party.trim()) return toast.error('Indica el cliente o proveedor')
    if (!concept.trim()) return toast.error('Describe el concepto de la cuenta')
    if (amount <= 0) return toast.error('El monto debe ser mayor a cero')

    setSaving(true)
    try {
      const payload = {
        party: party.trim(),
        concept: concept.trim(),
        total: amount,
        dueDate: dueDate || null,
      }

      if (editing) {
        await editDebt(editing.id, payload)
        toast.success(`Cuenta de ${payload.party} corregida`)
      } else {
        await addDebt({ kind, ...payload })
        toast.success(`Cuenta registrada para ${payload.party}`)
        setParty('')
        setConcept('')
        setTotal('')
        setDueDate('')
      }
      onClose()
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : `No se pudo ${editing ? 'corregir' : 'registrar'} la cuenta`,
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? 'Corregir cuenta' : 'Nueva cuenta pendiente'}
      subtitle={
        editing
          ? `Ya abonado: ${editing.paid.toFixed(2)} — el total no puede quedar por debajo`
          : 'Por cobrar a un cliente o por pagar a un proveedor'
      }
      icon={editing ? 'fa-pen' : 'fa-hand-holding-dollar'}
    >
      <form onSubmit={submit} className="space-y-3">
        <div
          role="radiogroup"
          aria-label="Tipo de cuenta"
          className="grid grid-cols-2 gap-2 rounded-xl bg-slate-100 dark:bg-slate-800 p-1"
        >
          {(['COBRAR', 'PAGAR'] as DebtKind[]).map((k) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={kind === k}
              onClick={() => !editing && setKind(k)}
              disabled={Boolean(editing)}
              className={`rounded-lg py-2 text-xs font-bold transition-all ${
                kind === k
                  ? k === 'COBRAR'
                    ? 'bg-amber-500 text-white shadow'
                    : 'bg-rose-600 text-white shadow'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-100'
              }`}
            >
              {k === 'COBRAR' ? 'Por cobrar' : 'Por pagar'}
            </button>
          ))}
        </div>

        <div>
          <label className="field-label" htmlFor="debt-party">
            {kind === 'COBRAR' ? 'Cliente' : 'Proveedor'}
          </label>
          <input
            id="debt-party"
            value={party}
            onChange={(event) => setParty(event.target.value)}
            placeholder={kind === 'COBRAR' ? 'Ej: Constructora del Centro' : 'Ej: Papelera Lima S.A.'}
            className="field"
          />
        </div>

        <div>
          <label className="field-label" htmlFor="debt-concept">
            Concepto
          </label>
          <textarea
            id="debt-concept"
            rows={2}
            value={concept}
            onChange={(event) => setConcept(event.target.value)}
            placeholder="Ej: Saldo pendiente por impresión de planos"
            className="field resize-none"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="field-label" htmlFor="debt-total">
              Monto total (S/)
            </label>
            <input
              id="debt-total"
              inputMode="decimal"
              value={total}
              onChange={(event) => setTotal(event.target.value)}
              placeholder="0.00"
              className="field font-bold"
            />
          </div>
          <div>
            <label className="field-label" htmlFor="debt-due">
              Vencimiento <span className="font-normal text-slate-400 dark:text-slate-500">(opcional)</span>
            </label>
            <input
              id="debt-due"
              type="date"
              value={dueDate}
              onChange={(event) => setDueDate(event.target.value)}
              className="field"
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="btn-ghost">
            Cancelar
          </button>
          <button type="submit" disabled={saving} className="btn-primary px-5">
            {saving ? 'Guardando…' : editing ? 'Guardar cambios' : 'Registrar cuenta'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
