import { useEffect, useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import { WorkOrderBreakdown } from '@/components/ui/WorkOrderBreakdown'
import { db } from '@/data'
import { useToast } from '@/hooks/useToast'
import { money, parseAmount, shortDateTime } from '@/lib/format'
import { useData } from '@/store/DataProvider'
import { PAYMENT_METHODS, type Debt, type DebtPayment, type PaymentMethod } from '@/types'

interface Props {
  debt: Debt | null
  onClose: () => void
}

/**
 * Abono parcial real.
 *
 * En el prototipo el boton "Abonar" ejecutaba `Math.min(saldo, saldo)`, es
 * decir liquidaba siempre el 100% aunque la UI prometiera abonos parciales.
 */
export function AbonoModal({ debt, onClose }: Props) {
  const { abonarDeuda, borrarAbono } = useData()
  const toast = useToast()
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState<PaymentMethod>('Efectivo')
  const [history, setHistory] = useState<DebtPayment[]>([])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!debt) return
    setAmount('')
    setMethod('Efectivo')
    let alive = true
    void db
      .listDebtPayments(debt.id)
      .then((rows) => {
        if (alive) setHistory(rows)
      })
      .catch(() => {
        if (alive) setHistory([])
      })
    return () => {
      alive = false
    }
  }, [debt])

  if (!debt) return null

  const value = parseAmount(amount)
  const excede = value > debt.balance + 0.001
  const isCobrar = debt.kind === 'COBRAR'

  const quitarAbono = async (payment: DebtPayment) => {
    if (
      !window.confirm(
        `¿Borrar el abono de ${money(payment.amount)}? También se retira su asiento del libro.`,
      )
    )
      return
    try {
      await borrarAbono(payment.id)
      setHistory((current) => current.filter((p) => p.id !== payment.id))
      toast.success('Abono deshecho y asiento retirado')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo borrar el abono')
    }
  }

  const submit = async () => {
    if (value <= 0) return toast.error('Ingresa un monto mayor a cero')
    if (excede) return toast.error(`El abono no puede superar el saldo de ${money(debt.balance)}`)

    setSaving(true)
    try {
      await abonarDeuda(debt.id, value, method)
      toast.success(
        value >= debt.balance
          ? `Cuenta de ${debt.party} liquidada`
          : `Abono de ${money(value)} registrado`,
      )
      onClose()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo registrar el abono')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={isCobrar ? 'Registrar cobro' : 'Registrar pago'}
      subtitle={debt.party}
      icon="fa-hand-holding-dollar"
      footer={
        <>
          <button type="button" onClick={onClose} className="btn-ghost">
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={saving || value <= 0 || excede}
            className="btn-primary px-5"
          >
            {saving ? 'Procesando…' : 'Registrar abono'}
          </button>
        </>
      }
    >
      <div className="space-y-3.5">
        <div className="grid grid-cols-3 gap-2 rounded-2xl border border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-3.5 text-center">
          <div>
            <p className="text-[10px] font-semibold uppercase text-slate-400 dark:text-slate-500">Total</p>
            <p className="text-sm font-bold tabular-nums text-slate-800 dark:text-slate-100">{money(debt.total)}</p>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase text-slate-400 dark:text-slate-500">Abonado</p>
            <p className="text-sm font-bold tabular-nums text-emerald-700 dark:text-emerald-300">{money(debt.paid)}</p>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase text-slate-400 dark:text-slate-500">Saldo</p>
            <p
              className={`text-sm font-extrabold tabular-nums ${isCobrar ? 'text-amber-700 dark:text-amber-300' : 'text-rose-700 dark:text-rose-300'}`}
            >
              {money(debt.balance)}
            </p>
          </div>
        </div>

        <p className="px-1 text-xs text-slate-600 dark:text-slate-300">{debt.concept}</p>

        <WorkOrderBreakdown workOrderId={debt.workOrderId} />

        <div>
          <label className="field-label" htmlFor="abono-amount">
            Monto del abono (S/)
          </label>
          <input
            id="abono-amount"
            inputMode="decimal"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            placeholder="0.00"
            autoFocus
            className={`field text-base font-bold ${excede ? 'border-rose-400 bg-rose-50 dark:bg-rose-500/10' : ''}`}
          />
          <div className="mt-1.5 flex items-center justify-between gap-2">
            <p className={`text-[11px] ${excede ? 'text-rose-600 dark:text-rose-400' : 'text-slate-400 dark:text-slate-500'}`}>
              {excede ? `Máximo ${money(debt.balance)}` : `Saldo restante tras el abono: ${money(Math.max(0, debt.balance - value))}`}
            </p>
            <button
              type="button"
              onClick={() => setAmount(debt.balance.toFixed(2))}
              className="shrink-0 rounded-lg bg-brand-50 dark:bg-brand-500/10 px-2 py-1 text-[11px] font-bold text-brand-800 dark:text-brand-300 transition-colors hover:bg-brand-100 dark:hover:bg-brand-500/20"
            >
              {isCobrar ? 'Ya pagó todo' : 'Pagar todo'} · {money(debt.balance)}
            </button>
          </div>
        </div>

        <div>
          <label className="field-label" htmlFor="abono-method">
            Método
          </label>
          <select
            id="abono-method"
            value={method}
            onChange={(event) => setMethod(event.target.value as PaymentMethod)}
            className="field"
          >
            {PAYMENT_METHODS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>

        {history.length > 0 && (
          <div className="rounded-2xl border border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 p-3">
            <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-400 dark:text-slate-500">
              Abonos anteriores
            </p>
            <ul className="space-y-1">
              {history.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-2 text-[11px]">
                  <span className="text-slate-500 dark:text-slate-400">
                    {shortDateTime(p.paidAt)} · {p.paymentMethod}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="font-bold tabular-nums text-emerald-700 dark:text-emerald-300">
                      {money(p.amount)}
                    </span>
                    <button
                      type="button"
                      onClick={() => void quitarAbono(p)}
                      title="Deshacer este abono y su asiento"
                      aria-label={`Borrar abono de ${money(p.amount)}`}
                      className="rounded p-0.5 text-slate-300 dark:text-slate-600 transition-colors hover:text-rose-600 dark:hover:text-rose-400"
                    >
                      <i className="fa-solid fa-trash-can text-[10px]" aria-hidden="true" />
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Modal>
  )
}
