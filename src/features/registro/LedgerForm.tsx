import { useMemo, useState, type FormEvent } from 'react'
import { MicButton } from '@/components/ui/MicButton'
import { useRecognizer } from '@/hooks/useSpeech'
import { useToast } from '@/hooks/useToast'
import { money, parseAmount } from '@/lib/format'
import { parseVoiceEntry } from '@/lib/voiceParser'
import { useData } from '@/store/DataProvider'
import {
  CATEGORIES,
  PAYMENT_METHODS,
  type PaymentMethod,
  type TxType,
  type WorkOrder,
} from '@/types'

interface JobLine {
  key: number
  description: string
  amount: string
}

let nextKey = 1
const emptyLine = (): JobLine => ({ key: nextKey++, description: '', amount: '' })

/** "cliente, monto y método de pago" */
function listar(campos: string[]): string {
  if (campos.length < 2) return campos.join('')
  return `${campos.slice(0, -1).join(', ')} y ${campos[campos.length - 1]}`
}

/**
 * El aviso del dictado enumera qué campos se rellenaron y cuáles no salieron;
 * nunca afirma que la cifra sea la correcta, porque el intérprete falla a
 * menudo y antes un acierto y un error se leían exactamente igual.
 */
function resumenDictado(rellenados: string[], faltantes: string[]): string {
  const partes = [
    rellenados.length
      ? `Dictado: llené ${listar(rellenados)}.`
      : 'Dictado: no pude deducir ningún campo.',
  ]
  if (faltantes.length) partes.push(`No deduje ${listar(faltantes)}.`)
  partes.push('Tipo y categoría son suposiciones: revisa lo marcado en ámbar.')
  return partes.join(' ')
}

interface LedgerFormProps {
  /** Se llama tras guardar con éxito; el modal lo usa para cerrarse. */
  onSaved?: () => void
  /** Si se pasa, aparece el botón Cancelar. */
  onCancel?: () => void
  /** Si se pasa, el formulario corrige ese pedido en vez de crear uno nuevo. */
  editing?: WorkOrder | null
}

export function LedgerForm({ onSaved, onCancel, editing }: LedgerFormProps = {}) {
  const { registerWorkOrder, editWorkOrder, transactions } = useData()
  const toast = useToast()

  // El método de pago vive en el asiento del adelanto, no en el pedido.
  const originalPayment = editing
    ? (transactions.find((t) => t.workOrderId === editing.id)?.payment ?? 'Efectivo')
    : 'Efectivo'

  const [type, setType] = useState<TxType>(editing?.kind ?? 'Ingreso')
  const [party, setParty] = useState(editing?.party ?? '')
  const [phone, setPhone] = useState(editing?.phone ?? '')
  const [lines, setLines] = useState<JobLine[]>(
    editing?.items.length
      ? editing.items.map((i) => ({
          key: nextKey++,
          description: i.description,
          amount: String(i.amount),
        }))
      : [emptyLine()],
  )
  const [category, setCategory] = useState<string>(editing?.category ?? 'Ventas')
  const [payment, setPayment] = useState<PaymentMethod>(originalPayment)
  const [advance, setAdvance] = useState(
    editing && editing.advance < editing.total ? String(editing.advance) : '',
  )
  /** false = el cliente paga todo ahora; true = adelanta una parte. */
  const [partial, setPartial] = useState(Boolean(editing && editing.advance < editing.total))
  const [saving, setSaving] = useState(false)
  /**
   * Campos que escribió el dictado y el usuario todavía no ha confirmado. El
   * intérprete acierta poco, así que lo que llena se marca en ámbar hasta que
   * alguien lo edita a mano: la marca dice "esto lo puso la máquina, revísalo".
   */
  const [dictado, setDictado] = useState<Set<string>>(() => new Set())

  const olvidarDictado = (campo: string) =>
    setDictado((current) => {
      if (!current.has(campo)) return current
      const siguiente = new Set(current)
      siguiente.delete(campo)
      return siguiente
    })

  /** Clases del recuadro ámbar; sólo se añaden mientras el campo siga sin revisar. */
  const marca = (campo: string) =>
    dictado.has(campo)
      ? ' border-amber-400 bg-amber-50 dark:border-amber-500/60 dark:bg-amber-500/10'
      : ''

  const avisoDictado = (campo: string) =>
    dictado.has(campo) ? { 'aria-describedby': 'aviso-dictado' } : {}

  const total = useMemo(
    () =>
      Math.round(lines.reduce((sum, line) => sum + parseAmount(line.amount), 0) * 100) / 100,
    [lines],
  )

  const advanceValue = partial ? parseAmount(advance) : total
  const balance = Math.round((total - advanceValue) * 100) / 100
  const advanceExceeds = partial && advanceValue > total + 0.001

  const isCobrar = type === 'Ingreso'

  const setLine = (key: number, patch: Partial<JobLine>) =>
    setLines((current) => current.map((l) => (l.key === key ? { ...l, ...patch } : l)))

  const addLine = () => setLines((current) => [...current, emptyLine()])

  const removeLine = (key: number) => {
    setLines((current) => (current.length === 1 ? current : current.filter((l) => l.key !== key)))
    olvidarDictado(`descripcion-${key}`)
    olvidarDictado(`monto-${key}`)
  }

  const { listening, toggle } = useRecognizer({
    onResult: (transcript) => {
      const parsed = parseVoiceEntry(transcript)
      const marcas = new Set<string>()
      const rellenados: string[] = []
      const faltantes: string[] = []

      // El tipo y la categoría siempre traen un valor porque el intérprete cae
      // en un valor por defecto: son suposiciones, no deducciones, y el aviso
      // las nombra aparte para no venderlas como dato leído.
      setType(parsed.type)
      marcas.add('tipo')
      if (parsed.category) {
        setCategory(parsed.category)
        marcas.add('categoria')
      }

      // El nombre se pide con la etiqueta del tipo recién dictado, no con la
      // que estaba en pantalla antes.
      const quien = parsed.type === 'Ingreso' ? 'cliente' : 'proveedor'
      if (parsed.party) {
        setParty(parsed.party)
        marcas.add('party')
        rellenados.push(quien)
      } else {
        faltantes.push(`el ${quien}`)
      }

      if (parsed.payment) {
        setPayment(parsed.payment)
        marcas.add('payment')
        rellenados.push('método de pago')
      } else {
        faltantes.push('el método de pago')
      }

      // El dictado llena la primera línea vacía, o añade una nueva.
      const target = lines.find((l) => !l.description.trim() && !l.amount.trim())
      const key = target?.key ?? nextKey++
      const filled: JobLine = {
        key,
        description: parsed.concept,
        amount: parsed.amount !== null ? String(parsed.amount) : '',
      }
      setLines((current) =>
        current.some((l) => l.key === key)
          ? current.map((l) => (l.key === key ? filled : l))
          : [...current, filled],
      )
      marcas.add(`descripcion-${key}`)
      rellenados.push('concepto')
      if (parsed.amount !== null) {
        marcas.add(`monto-${key}`)
        rellenados.push('monto')
      } else {
        faltantes.push('el monto')
      }

      // Se suman a las marcas previas: un campo dictado antes y todavía sin
      // revisar no puede perder el aviso porque el segundo dictado lo omita.
      setDictado((current) => new Set([...current, ...marcas]))
      toast.info(resumenDictado(rellenados, faltantes))
    },
    onError: (message) => toast.error(message),
  })

  const reset = () => {
    setParty('')
    setPhone('')
    setLines([emptyLine()])
    setAdvance('')
    setPartial(false)
    setDictado(new Set())
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()

    if (!party.trim()) {
      toast.error(`Indica el ${isCobrar ? 'cliente' : 'proveedor'}`)
      return
    }

    const items = lines
      .map((line) => ({ description: line.description.trim(), amount: parseAmount(line.amount) }))
      .filter((item) => item.description || item.amount > 0)

    if (!items.length) {
      toast.error('Agrega al menos un trabajo')
      return
    }
    const incomplete = items.find((item) => !item.description || item.amount <= 0)
    if (incomplete) {
      toast.error('Cada trabajo necesita descripción y monto mayor a cero')
      return
    }
    if (advanceExceeds) {
      toast.error(`El adelanto no puede superar el total de ${money(total)}`)
      return
    }

    setSaving(true)
    try {
      const payload = {
        party: party.trim(),
        phone: phone.trim(),
        category,
        payment,
        advance: advanceValue,
        notes: '',
        items,
      }

      if (editing) {
        await editWorkOrder(editing.id, payload)
        toast.success(`Orden de ${payload.party} corregida`)
        onSaved?.()
        return
      }

      const { transaction, debt } = await registerWorkOrder({ kind: type, ...payload })

      if (transaction && debt) {
        toast.success(
          `Adelanto de ${money(transaction.amount)} registrado · ${money(debt.balance)} por ${isCobrar ? 'cobrar' : 'pagar'}`,
        )
      } else if (transaction) {
        toast.success(`Asiento ${transaction.voucher} guardado por ${money(transaction.amount)}`)
      } else if (debt) {
        toast.success(
          `Sin adelanto: ${money(debt.balance)} quedó por ${isCobrar ? 'cobrar' : 'pagar'}`,
        )
      }

      reset()
      onSaved?.()
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : `No se pudo ${editing ? 'corregir' : 'registrar'} el pedido`,
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3.5">
      <div className="flex items-center justify-between gap-3 rounded-xl border border-brand-100 dark:border-brand-500/25 bg-brand-50/60 dark:bg-brand-500/10 px-3 py-2">
        <span className="text-[11px] font-semibold text-brand-800 dark:text-brand-300">
          <i className="fa-solid fa-wand-magic-sparkles mr-1.5" aria-hidden="true" />
          Dicta la orden: se llena lo que se entienda y queda marcado para revisar
        </span>
        <MicButton listening={listening} onToggle={toggle} label="Dictar datos de la orden" />
      </div>

      {dictado.size > 0 && (
        <div
          id="aviso-dictado"
          className="flex items-start justify-between gap-2 rounded-xl border border-amber-300 dark:border-amber-500/40 bg-amber-50 dark:bg-amber-500/10 px-3 py-2 text-[11px] font-semibold text-amber-800 dark:text-amber-300"
        >
          <span>
            <i className="fa-solid fa-triangle-exclamation mr-1.5" aria-hidden="true" />
            Lo marcado en ámbar lo escribió el dictado, no está verificado: confírmalo antes de
            guardar.
          </span>
          <button
            type="button"
            onClick={() => setDictado(new Set())}
            className="shrink-0 rounded-lg px-2 py-0.5 text-[11px] font-bold text-amber-900 dark:text-amber-200 transition-colors hover:bg-amber-200/60 dark:hover:bg-amber-500/20"
          >
            Ya lo revisé
          </button>
        </div>
      )}

      <div
        role="radiogroup"
        aria-label="Tipo de operación"
        className={`grid grid-cols-2 gap-2 rounded-xl bg-slate-100 dark:bg-slate-800 p-1${
          dictado.has('tipo') ? ' ring-1 ring-amber-400 dark:ring-amber-500/60' : ''
        }`}
      >
        {(['Ingreso', 'Egreso'] as TxType[]).map((option) => (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={type === option}
            onClick={() => {
              if (editing) return
              setType(option)
              olvidarDictado('tipo')
            }}
            disabled={Boolean(editing)}
            className={`rounded-lg py-2 text-xs font-bold transition-all ${
              type === option
                ? option === 'Ingreso'
                  ? 'bg-emerald-600 text-white shadow'
                  : 'bg-rose-600 text-white shadow'
                : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-100'
            }`}
          >
            <i
              className={`fa-solid ${option === 'Ingreso' ? 'fa-arrow-down' : 'fa-arrow-up'} mr-1.5`}
              aria-hidden="true"
            />
            {option}
          </button>
        ))}
      </div>

      {/* 1 — Cliente / Proveedor  ·  2 — Teléfono */}
      <div>
        <label className="field-label" htmlFor="tx-party">
          {isCobrar ? 'Cliente' : 'Proveedor'}
        </label>
        <input
          id="tx-party"
          value={party}
          onChange={(event) => {
            setParty(event.target.value)
            olvidarDictado('party')
          }}
          placeholder={isCobrar ? 'Ej: Cliente Juan Pérez' : 'Ej: Proveedor Pacheco S.A.C.'}
          className={`field${marca('party')}`}
          {...avisoDictado('party')}
        />
      </div>

      <div>
        <label className="field-label" htmlFor="tx-phone">
          Teléfono <span className="font-normal text-slate-400 dark:text-slate-500">(opcional)</span>
        </label>
        <input
          id="tx-phone"
          type="tel"
          inputMode="tel"
          value={phone}
          onChange={(event) => setPhone(event.target.value)}
          placeholder="Ej: 987 654 321"
          className="field"
        />
      </div>

      {/* 3 — Trabajos */}
      <div>
        <div className="mb-1 flex items-baseline justify-between">
          <span className="field-label mb-0">Concepto / trabajos</span>
          <span className="text-[10px] text-slate-400 dark:text-slate-500">
            {lines.length === 1 ? '1 trabajo' : `${lines.length} trabajos`}
          </span>
        </div>

        <div className="space-y-2">
          {lines.map((line, index) => (
            <div key={line.key} className="flex items-start gap-1.5">
              <input
                value={line.description}
                onChange={(event) => {
                  setLine(line.key, { description: event.target.value })
                  olvidarDictado(`descripcion-${line.key}`)
                }}
                placeholder={index === 0 ? 'Ej: 1,000 volantes A6 couche' : 'Otro trabajo…'}
                aria-label={`Descripción del trabajo ${index + 1}`}
                className={`field flex-1${marca(`descripcion-${line.key}`)}`}
                {...avisoDictado(`descripcion-${line.key}`)}
              />
              <input
                value={line.amount}
                onChange={(event) => {
                  setLine(line.key, { amount: event.target.value })
                  olvidarDictado(`monto-${line.key}`)
                }}
                inputMode="decimal"
                placeholder="0.00"
                aria-label={`Monto del trabajo ${index + 1}`}
                className={`field w-24 shrink-0 text-right font-semibold${marca(`monto-${line.key}`)}`}
                {...avisoDictado(`monto-${line.key}`)}
              />
              <button
                type="button"
                onClick={() => removeLine(line.key)}
                disabled={lines.length === 1}
                aria-label={`Quitar trabajo ${index + 1}`}
                title="Quitar trabajo"
                className="mt-0.5 flex h-9 w-7 shrink-0 items-center justify-center rounded-lg text-slate-300 dark:text-slate-600 transition-colors hover:text-rose-500 dark:hover:text-rose-400 disabled:opacity-30 disabled:hover:text-slate-300 dark:disabled:hover:text-slate-600"
              >
                <i className="fa-solid fa-xmark text-xs" aria-hidden="true" />
              </button>
            </div>
          ))}
        </div>

        <div className="mt-2 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={addLine}
            className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] font-bold text-brand-700 dark:text-brand-300 transition-colors hover:bg-brand-50 dark:hover:bg-brand-500/10"
          >
            <i className="fa-solid fa-plus text-[10px]" aria-hidden="true" />
            Agregar trabajo
          </button>
          <p className="text-xs font-bold text-slate-700 dark:text-slate-200">
            Total: <span className="tabular-nums text-slate-900 dark:text-slate-50">{money(total)}</span>
          </p>
        </div>
      </div>

      {/* 4 — Adelanto */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-3">
        <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-200">
          <input
            type="checkbox"
            checked={partial}
            onChange={(event) => {
              setPartial(event.target.checked)
              if (!event.target.checked) setAdvance('')
            }}
            className="accent-brand-700"
          />
          {isCobrar ? 'El cliente adelanta solo una parte' : 'Pago solo una parte'}
        </label>

        {partial && (
          <div className="mt-2.5 space-y-1.5">
            <div className="flex items-center gap-2">
              <input
                id="tx-advance"
                inputMode="decimal"
                value={advance}
                onChange={(event) => setAdvance(event.target.value)}
                placeholder="0.00"
                aria-label="Monto adelantado"
                className={`field flex-1 font-bold ${advanceExceeds ? 'border-rose-400 bg-rose-50 dark:bg-rose-500/10' : ''}`}
              />
              <button
                type="button"
                onClick={() => setAdvance('0')}
                className="shrink-0 rounded-lg px-2 py-1 text-[11px] font-bold text-slate-500 dark:text-slate-400 transition-colors hover:bg-slate-200 dark:hover:bg-slate-700"
                title="El trabajo se entrega al crédito"
              >
                Sin adelanto
              </button>
            </div>

            {advanceExceeds ? (
              <p className="text-[11px] font-semibold text-rose-600 dark:text-rose-400">
                El adelanto no puede superar {money(total)}
              </p>
            ) : (
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                {balance > 0 ? (
                  <>
                    Quedarán{' '}
                    <span className="font-bold text-amber-700 dark:text-amber-300">{money(balance)}</span> por{' '}
                    {isCobrar ? 'cobrar' : 'pagar'}
                    {advanceValue === 0 && ' (no se registra asiento, no se movió dinero)'}
                  </>
                ) : (
                  'El adelanto cubre el total: no quedará saldo pendiente.'
                )}
              </p>
            )}
          </div>
        )}
      </div>

      {/* 5 — Clasificación */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="field-label" htmlFor="tx-category">
            Categoría
          </label>
          <select
            id="tx-category"
            value={category}
            onChange={(event) => {
              setCategory(event.target.value)
              olvidarDictado('categoria')
            }}
            className={`field${marca('categoria')}`}
            {...avisoDictado('categoria')}
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="field-label" htmlFor="tx-payment">
            Método de pago
          </label>
          <select
            id="tx-payment"
            value={payment}
            onChange={(event) => {
              setPayment(event.target.value as PaymentMethod)
              olvidarDictado('payment')
            }}
            disabled={advanceValue === 0}
            className={`field disabled:opacity-50${marca('payment')}`}
            {...avisoDictado('payment')}
          >
            {PAYMENT_METHODS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex items-center gap-2 pt-1">
        {onCancel && (
          <button type="button" onClick={onCancel} className="btn-ghost shrink-0">
            Cancelar
          </button>
        )}
        <button type="submit" disabled={saving || total <= 0} className="btn-primary flex-1 py-2.5">
          <i className="fa-solid fa-floppy-disk" aria-hidden="true" />
          {saving
            ? 'Guardando…'
            : editing
              ? 'Guardar cambios'
              : advanceValue === 0 && total > 0
                ? `Registrar ${money(total)} al crédito`
                : balance > 0
                  ? `Registrar adelanto de ${money(advanceValue)}`
                  : 'Guardar asiento'}
        </button>
      </div>
    </form>
  )
}
