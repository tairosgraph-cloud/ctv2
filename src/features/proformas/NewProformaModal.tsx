import { useState, type FormEvent } from 'react'
import { Modal } from '@/components/ui/Modal'
import { useToast } from '@/hooks/useToast'
import { parseAmount } from '@/lib/format'
import { useData } from '@/store/DataProvider'
import type { Proforma } from '@/types'

const VALIDITY_OPTIONS = [7, 15, 30]

interface Props {
  open: boolean
  onClose: () => void
  /** Si viene, el modal corrige esa cotización en vez de crear una nueva. */
  editing?: Proforma | null
}

export function NewProformaModal({ open, onClose, editing = null }: Props) {
  const { addProforma, editProforma } = useData()
  const toast = useToast()
  const [client, setClient] = useState(editing?.client ?? '')
  const [detail, setDetail] = useState(editing?.detail ?? '')
  const [total, setTotal] = useState(editing ? String(editing.total) : '')
  const [validityDays, setValidityDays] = useState(editing?.validityDays ?? 15)
  const [saving, setSaving] = useState(false)

  const reset = () => {
    setClient('')
    setDetail('')
    setTotal('')
    setValidityDays(15)
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const amount = parseAmount(total)
    if (!client.trim()) return toast.error('Indica el nombre del cliente')
    if (!detail.trim()) return toast.error('Describe qué se está cotizando')
    if (amount <= 0) return toast.error('El monto cotizado debe ser mayor a cero')

    setSaving(true)
    try {
      const payload = {
        client: client.trim(),
        detail: detail.trim(),
        total: amount,
        validityDays,
      }

      if (editing) {
        const pf = await editProforma(editing.id, payload)
        toast.success(`Proforma ${pf.code} corregida`)
      } else {
        const pf = await addProforma(payload)
        toast.success(`Proforma ${pf.code} generada`)
        reset()
      }
      onClose()
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : `No se pudo ${editing ? 'corregir' : 'crear'} la proforma`,
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? `Corregir ${editing.code}` : 'Nueva proforma / cotización'}
      subtitle={
        editing ? 'Solo se puede editar mientras esté vigente' : 'El código se asigna de forma correlativa'
      }
      icon={editing ? 'fa-pen' : 'fa-file-invoice'}
    >
      <form onSubmit={submit} className="space-y-3">
        <div>
          <label className="field-label" htmlFor="pf-client">
            Nombre del cliente
          </label>
          <input
            id="pf-client"
            value={client}
            onChange={(event) => setClient(event.target.value)}
            placeholder="Ej: Importadora San José"
            className="field"
          />
        </div>

        <div>
          <label className="field-label" htmlFor="pf-detail">
            Detalle / servicios a cotizar
          </label>
          <textarea
            id="pf-detail"
            rows={3}
            value={detail}
            onChange={(event) => setDetail(event.target.value)}
            placeholder="Ej: 5,000 folletos full color + diseño gráfico corporativo"
            className="field resize-none"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="field-label" htmlFor="pf-total">
              Monto cotizado (S/)
            </label>
            <input
              id="pf-total"
              inputMode="decimal"
              value={total}
              onChange={(event) => setTotal(event.target.value)}
              placeholder="0.00"
              className="field font-bold"
            />
          </div>
          <div>
            <label className="field-label" htmlFor="pf-validity">
              Vigencia
            </label>
            <select
              id="pf-validity"
              value={validityDays}
              onChange={(event) => setValidityDays(Number(event.target.value))}
              className="field"
            >
              {VALIDITY_OPTIONS.map((d) => (
                <option key={d} value={d}>
                  {d} días
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="btn-ghost">
            Cancelar
          </button>
          <button type="submit" disabled={saving} className="btn-primary px-5">
            {saving ? 'Guardando…' : editing ? 'Guardar cambios' : 'Guardar proforma'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
