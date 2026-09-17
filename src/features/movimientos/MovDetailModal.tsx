import { useMemo, type ReactNode } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Badge } from '@/components/ui/Badge'
import { WorkOrderBreakdown } from '@/components/ui/WorkOrderBreakdown'
import { buildLedgerRows } from '@/lib/ledgerRows'
import { usePrintReceipt } from '@/components/receipt/usePrintReceipt'
import { useSpeaker } from '@/hooks/useSpeech'
import { money, shortDateTime } from '@/lib/format'
import { useData } from '@/store/DataProvider'
import type { Transaction } from '@/types'

/** Sólo dígitos: lo que necesitan los enlaces tel: y wa.me. */
const digits = (phone: string) => phone.replace(/\D/g, '')

interface Props {
  transaction: Transaction | null
  onClose: () => void
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="text-[11px] font-medium text-slate-400 dark:text-slate-500">{label}</p>
      <p className="text-xs font-bold text-slate-800 dark:text-slate-100">{children}</p>
    </div>
  )
}

export function MovDetailModal({ transaction, onClose }: Props) {
  const { speaking, say, stop } = useSpeaker()
  const { workOrders, debts } = useData()
  const { print, receipt } = usePrintReceipt()

  // Reutiliza el mismo armado del libro para tener total, cobrado y saldo.
  const row = useMemo(
    () =>
      transaction
        ? (buildLedgerRows({
            transactions: [transaction],
            workOrders,
            debts,
          })[0] ?? null)
        : null,
    [transaction, workOrders, debts],
  )

  if (!transaction || !row) return null
  const t = transaction
  const phone = row.workOrder?.phone?.trim() ?? ''

  const narrate = () => {
    if (speaking) {
      stop()
      return
    }
    void say(
      `Movimiento ${t.voucher}. ${t.type} de ${t.amount.toFixed(2)} soles por concepto de ${t.concept}. Método de pago: ${t.payment}. Estado: ${t.status}.`,
    )
  }

  return (
    <>
      {receipt}
      <Modal
        open
        onClose={onClose}
        title="Ficha de movimiento auditado"
        subtitle={t.voucher}
        icon="fa-receipt"
        footer={
          <>
            <button type="button" onClick={onClose} className="btn-ghost">
              Cerrar
            </button>
            <button type="button" onClick={() => print(row)} className="btn-ghost">
              <i className="fa-solid fa-print" aria-hidden="true" />
              Comprobante
            </button>
            <button type="button" onClick={narrate} className="btn-primary">
              <i
                className={`fa-solid ${speaking ? 'fa-stop' : 'fa-volume-high'}`}
                aria-hidden="true"
              />
              {speaking ? 'Detener' : 'Escuchar detalle'}
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3 rounded-2xl border border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-3.5">
            <Field label="Tipo de operación">
              {t.type} ({t.category})
            </Field>
            <div>
              <p className="text-[11px] font-medium text-slate-400 dark:text-slate-500">Monto procesado</p>
              <p
                className={`text-base font-bold tabular-nums ${
                  t.type === 'Ingreso' ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-600 dark:text-rose-400'
                }`}
              >
                {money(t.amount)}
              </p>
            </div>
            <Field label="Cliente / Proveedor">{t.party}</Field>
            <Field label="Método de pago">{t.payment}</Field>
            {phone && (
              <div className="col-span-2">
                <p className="text-[11px] font-medium text-slate-400 dark:text-slate-500">Teléfono</p>
                <div className="flex items-center gap-2.5">
                  <a
                    href={`tel:${digits(phone)}`}
                    className="text-xs font-bold text-brand-800 dark:text-brand-300 hover:underline"
                  >
                    {phone}
                  </a>
                  <a
                    href={`https://wa.me/51${digits(phone)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="Escribir por WhatsApp"
                    className="text-emerald-600 dark:text-emerald-400 transition-colors hover:text-emerald-700 dark:hover:text-emerald-300"
                  >
                    <i className="fa-brands fa-whatsapp text-sm" aria-hidden="true" />
                  </a>
                </div>
              </div>
            )}
          </div>

          <WorkOrderBreakdown workOrderId={t.workOrderId} />

          <div className="space-y-2.5 px-1">
            <Field label="Concepto">{t.concept}</Field>
            <Field label="Fecha y hora">{shortDateTime(t.occurredAt)}</Field>
            <Field label="Registrado por">{t.author}</Field>
            <div>
              <p className="text-[11px] font-medium text-slate-400 dark:text-slate-500">Estado</p>
              <Badge
                tone={
                  t.status === 'Completado'
                    ? 'emerald'
                    : t.status === 'Pendiente'
                      ? 'amber'
                      : 'slate'
                }
              >
                {t.status.toUpperCase()}
              </Badge>
            </div>
            <Field label="Origen del registro">
              {
                {
                  manual: 'Formulario manual',
                  voz: 'Dictado por voz',
                  proforma: 'Conversión de proforma',
                  abono: 'Abono de deuda',
                }[t.source]
              }
            </Field>
            {t.notes && (
              <div className="rounded-xl border border-amber-100 dark:border-amber-500/25 bg-amber-50 dark:bg-amber-500/10 p-3">
                <p className="text-[11px] font-semibold text-amber-800 dark:text-amber-300">Notas</p>
                <p className="text-xs text-amber-900 dark:text-amber-200">{t.notes}</p>
              </div>
            )}
          </div>
        </div>
      </Modal>
    </>
  )
}
