import { useState, type FormEvent } from 'react'
import { AvisoDictado } from '@/components/dictado/AvisoDictado'
import { Modal } from '@/components/ui/Modal'
import { useCamposDictados } from '@/hooks/useCamposDictados'
import { useDictado, type Borrador } from '@/hooks/useDictado'
import { usePartes } from '@/hooks/usePartes'
import { useToast } from '@/hooks/useToast'
import { formularioDeProforma, type Duda } from '@/lib/dictado/formulario'
import { parseAmount } from '@/lib/format'
import { useData } from '@/store/DataProvider'
import type { Proforma } from '@/types'

const VALIDITY_OPTIONS = [7, 15, 30]
const VIGENCIA_POR_DEFECTO = 15

interface Props {
  open: boolean
  onClose: () => void
  /** Si viene, el modal corrige esa cotización en vez de crear una nueva. */
  editing?: Proforma | null
  /** Si viene, el formulario arranca con lo dictado. */
  dictado?: Borrador | null
}

/** Lo dictado, con la vigencia por defecto declarada como suposición. */
function prepararDictado(dictado: Borrador | null, partes: ReturnType<typeof usePartes>) {
  const f = dictado ? formularioDeProforma(dictado.resultado.extraccion, partes) : null
  if (!f) return null
  const dudas = f.dudas.map((d) => (d.campo === 'vigenciaDias' ? { ...d, campo: 'vigencia' } : d))
  const conDudaDeVigencia = dudas.some((d) => d.campo === 'vigencia')
  // Sin plazo dicho, el formulario pone 15 días: eso es suponer, y se dice.
  const suponerVigencia = f.vigencia === null && !conDudaDeVigencia
  return {
    ...f,
    dudas,
    marcas: suponerVigencia ? [...f.marcas, 'vigencia'] : f.marcas,
    faltantes: suponerVigencia ? f.faltantes.filter((x) => x !== 'la vigencia') : f.faltantes,
    supuestos: suponerVigencia ? [...f.supuestos, `una vigencia de ${VIGENCIA_POR_DEFECTO} días`] : f.supuestos,
  }
}

export function NewProformaModal({ open, onClose, editing = null, dictado = null }: Props) {
  const { addProforma, editProforma } = useData()
  const { confirmar } = useDictado()
  const partes = usePartes()
  const toast = useToast()
  const [arranque] = useState(() => (editing ? null : prepararDictado(dictado, partes)))
  const [client, setClient] = useState(editing?.client ?? arranque?.cliente ?? '')
  const [detail, setDetail] = useState(editing?.detail ?? arranque?.detalle ?? '')
  const [total, setTotal] = useState(editing ? String(editing.total) : (arranque?.total ?? ''))
  const [validityDays, setValidityDays] = useState(
    editing?.validityDays ?? arranque?.vigencia ?? VIGENCIA_POR_DEFECTO,
  )
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
    if (campo === 'cliente') setClient(valor)
    else if (campo === 'total') setTotal(valor)
    else if (campo === 'vigencia') setValidityDays(Number(valor))
    campos.quitar(campo)
    setDudas((actual) => actual.filter((d) => d.campo !== campo))
  }

  const reset = () => {
    setClient('')
    setDetail('')
    setTotal('')
    setValidityDays(VIGENCIA_POR_DEFECTO)
    campos.limpiar()
    setDudas([])
    setFaltantes([])
    setSupuestos([])
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
        if (dictado && arranque) {
          confirmar(dictado, { camposEditados: campos.camposEditados(), registroTipo: 'proforma', registroId: pf.id })
        }
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
      title={editing ? `Corregir ${editing.code}` : dictado ? 'Proforma dictada' : 'Nueva proforma / cotización'}
      subtitle={
        editing ? 'Solo se puede editar mientras esté vigente' : 'El código se asigna de forma correlativa'
      }
      icon={editing ? 'fa-pen' : 'fa-file-invoice'}
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

        <div>
          <label className="field-label" htmlFor="pf-client">
            Nombre del cliente
          </label>
          <input
            id="pf-client"
            value={client}
            onChange={(event) => {
              setClient(event.target.value)
              editar('cliente')
            }}
            placeholder="Ej: Importadora San José"
            className={`field${campos.clase('cliente')}`}
            {...campos.describe('cliente')}
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
            onChange={(event) => {
              setDetail(event.target.value)
              editar('detalle')
            }}
            placeholder="Ej: 5,000 folletos full color + diseño gráfico corporativo"
            className={`field resize-none${campos.clase('detalle')}`}
            {...campos.describe('detalle')}
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
            <label className="field-label" htmlFor="pf-validity">
              Vigencia
            </label>
            <select
              id="pf-validity"
              value={validityDays}
              onChange={(event) => {
                setValidityDays(Number(event.target.value))
                editar('vigencia')
              }}
              className={`field${campos.clase('vigencia')}`}
              {...campos.describe('vigencia')}
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
