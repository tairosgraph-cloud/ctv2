import { useState, type FormEvent } from 'react'
import { AvisoDictado } from '@/components/dictado/AvisoDictado'
import { Modal } from '@/components/ui/Modal'
import { useCamposDictados } from '@/hooks/useCamposDictados'
import { useDictado, type Borrador } from '@/hooks/useDictado'
import { usePartes } from '@/hooks/usePartes'
import { useToast } from '@/hooks/useToast'
import { formularioDeDeuda, type Duda } from '@/lib/dictado/formulario'
import { parseAmount } from '@/lib/format'
import { useData } from '@/store/DataProvider'
import type { Debt, DebtKind } from '@/types'

interface Props {
  open: boolean
  onClose: () => void
  /** Si viene, el modal corrige esa cuenta en vez de crear una nueva. */
  editing?: Debt | null
  /** Si viene, el formulario arranca con lo dictado. */
  dictado?: Borrador | null
}

/** Lo dictado, con el «por cobrar» por defecto declarado como suposición. */
function prepararDictado(dictado: Borrador | null, partes: ReturnType<typeof usePartes>) {
  const f = dictado ? formularioDeDeuda(dictado.resultado.extraccion, partes) : null
  if (!f) return null
  const suponerTipo = f.tipo === null && !f.dudas.some((d) => d.campo === 'kind')
  return {
    ...f,
    dudas: f.dudas.map((d) => (d.campo === 'kind' ? { ...d, campo: 'tipo' } : d)),
    marcas: suponerTipo ? [...f.marcas, 'tipo'] : f.marcas,
    faltantes: suponerTipo ? f.faltantes.filter((x) => x !== 'si te deben o debes') : f.faltantes,
    supuestos: suponerTipo ? [...f.supuestos, 'que te deben (por cobrar)'] : f.supuestos,
  }
}

export function NewDebtModal({ open, onClose, editing = null, dictado = null }: Props) {
  const { addDebt, editDebt } = useData()
  const { confirmar } = useDictado()
  const partes = usePartes()
  const toast = useToast()
  const [arranque] = useState(() => (editing ? null : prepararDictado(dictado, partes)))
  const [kind, setKind] = useState<DebtKind>(editing?.kind ?? arranque?.tipo ?? 'COBRAR')
  const [party, setParty] = useState(editing?.party ?? arranque?.parte ?? '')
  const [concept, setConcept] = useState(editing?.concept ?? arranque?.concepto ?? '')
  const [total, setTotal] = useState(editing ? String(editing.total) : (arranque?.total ?? ''))
  const [dueDate, setDueDate] = useState(editing?.dueDate ?? arranque?.vence ?? '')
  const [saving, setSaving] = useState(false)
  const campos = useCamposDictados(arranque?.marcas)
  const [dudas, setDudas] = useState<Duda[]>(arranque?.dudas ?? [])
  const [faltantes, setFaltantes] = useState(arranque?.faltantes ?? [])
  const [supuestos, setSupuestos] = useState(arranque?.supuestos ?? [])

  const editar = (campo: string) => {
    campos.editar(campo)
    setDudas((actual) => actual.filter((d) => d.campo !== campo))
  }

  const elegir = (campo: string, valor: string) => {
    if (campo === 'parte') setParty(valor)
    else if (campo === 'total') setTotal(valor)
    else if (campo === 'tipo') setKind(valor as DebtKind)
    campos.quitar(campo)
    setDudas((actual) => actual.filter((d) => d.campo !== campo))
  }

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
        const debt = await addDebt({ kind, ...payload })
        if (dictado && arranque) {
          confirmar(dictado, { camposEditados: campos.camposEditados(), registroTipo: 'deuda', registroId: debt.id })
        }
        toast.success(`Cuenta registrada para ${payload.party}`)
        setParty('')
        setConcept('')
        setTotal('')
        setDueDate('')
        campos.limpiar()
        setDudas([])
        setFaltantes([])
        setSupuestos([])
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
      title={editing ? 'Corregir cuenta' : dictado ? 'Cuenta dictada' : 'Nueva cuenta pendiente'}
      subtitle={
        editing
          ? `Ya abonado: ${editing.paid.toFixed(2)} — el total no puede quedar por debajo`
          : 'Por cobrar a un cliente o por pagar a un proveedor'
      }
      icon={editing ? 'fa-pen' : 'fa-hand-holding-dollar'}
    >
      <form onSubmit={submit} className="space-y-3">
        {dictado && arranque && (
          <AvisoDictado
            origen={dictado.resultado.extraccion.origen}
            aviso={dictado.resultado.aviso}
            marcados={campos.marcados.size}
            dudas={dudas}
            faltantes={faltantes}
            supuestos={supuestos}
            onElegir={elegir}
            onRevisado={() => {
              campos.revisar()
              setFaltantes([])
              setSupuestos([])
            }}
          />
        )}

        <div
          role="radiogroup"
          aria-label="Tipo de cuenta"
          className={`grid grid-cols-2 gap-2 rounded-xl bg-slate-100 dark:bg-slate-800 p-1${
            campos.marcados.has('tipo') ? ' ring-1 ring-amber-400 dark:ring-amber-500/60' : ''
          }`}
        >
          {(['COBRAR', 'PAGAR'] as DebtKind[]).map((k) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={kind === k}
              onClick={() => {
                if (editing) return
                setKind(k)
                editar('tipo')
              }}
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
            onChange={(event) => {
              setParty(event.target.value)
              editar('parte')
            }}
            placeholder={kind === 'COBRAR' ? 'Ej: Constructora del Centro' : 'Ej: Papelera Lima S.A.'}
            className={`field${campos.clase('parte')}`}
            {...campos.describe('parte')}
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
            onChange={(event) => {
              setConcept(event.target.value)
              editar('concepto')
            }}
            placeholder="Ej: Saldo pendiente por impresión de planos"
            className={`field resize-none${campos.clase('concepto')}`}
            {...campos.describe('concepto')}
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
              onChange={(event) => {
                setTotal(event.target.value)
                editar('total')
              }}
              placeholder="0.00"
              className={`field font-bold${campos.clase('total')}`}
              {...campos.describe('total')}
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
              onChange={(event) => {
                setDueDate(event.target.value)
                editar('vence')
              }}
              className={`field${campos.clase('vence')}`}
              {...campos.describe('vence')}
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
