import { money } from '@/lib/format'
import { useData } from '@/store/DataProvider'

/**
 * Desglose de los trabajos de un pedido. Se muestra igual en la ficha del
 * asiento y en el modal de abono, porque ambos apuntan al mismo pedido.
 */
export function WorkOrderBreakdown({ workOrderId }: { workOrderId: string | null }) {
  const { workOrderById } = useData()
  const order = workOrderById(workOrderId)

  if (!order || order.items.length === 0) return null

  const balance = Math.round((order.total - order.advance) * 100) / 100

  return (
    <div className="rounded-2xl border border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 p-3.5">
      <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-slate-400 dark:text-slate-500">
        {order.items.length === 1 ? 'Trabajo del pedido' : `Trabajos del pedido (${order.items.length})`}
      </p>

      <ul className="space-y-1.5">
        {order.items.map((item) => (
          <li key={item.id} className="flex items-baseline justify-between gap-3 text-xs">
            <span className="text-slate-700 dark:text-slate-200">{item.description}</span>
            <span className="shrink-0 font-semibold tabular-nums text-slate-800 dark:text-slate-100">
              {money(item.amount)}
            </span>
          </li>
        ))}
      </ul>

      <div className="mt-2.5 space-y-1 border-t border-slate-100 dark:border-slate-800 pt-2.5 text-xs">
        <div className="flex items-baseline justify-between gap-3">
          <span className="font-semibold text-slate-600 dark:text-slate-300">Total del pedido</span>
          <span className="font-bold tabular-nums text-slate-900 dark:text-slate-50">{money(order.total)}</span>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-slate-500 dark:text-slate-400">Adelantado</span>
          <span className="font-semibold tabular-nums text-emerald-700 dark:text-emerald-300">
            {money(order.advance)}
          </span>
        </div>
        {balance > 0 && (
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-slate-500 dark:text-slate-400">
              Saldo por {order.kind === 'Ingreso' ? 'cobrar' : 'pagar'}
            </span>
            <span className="font-bold tabular-nums text-amber-700 dark:text-amber-300">{money(balance)}</span>
          </div>
        )}
      </div>
    </div>
  )
}
