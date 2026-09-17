import { createPortal } from 'react-dom'
import { money, shortDateTime } from '@/lib/format'
import type { LedgerRow } from '@/lib/ledgerRows'

/**
 * Comprobante imprimible. Vive en #print-root y está oculto en pantalla; la
 * regla @media print de index.css esconde el resto del documento y deja solo
 * este nodo, así el navegador imprime en papel o guarda como PDF sin librerías.
 */
export function OrderReceipt({ row }: { row: LedgerRow }) {
  const host = document.getElementById('print-root')
  if (!host) return null

  const order = row.workOrder
  const items = order?.items ?? []
  const total = row.total
  const cobrado = order ? order.advance : row.cash
  const abonado = Math.max(0, total - cobrado - row.pending)
  const isIngreso = row.type === 'Ingreso'

  return createPortal(
    <article className="receipt">
      <header>
        <h1>TAIROS.RC</h1>
        <p className="sub">Comprobante de {isIngreso ? 'trabajo' : 'compra'}</p>
      </header>

      <dl>
        <div>
          <dt>Orden</dt>
          <dd>{row.transaction?.voucher ?? `PEDIDO-${(order?.id ?? row.id).slice(0, 8)}`}</dd>
        </div>
        <div>
          <dt>Fecha</dt>
          <dd>{shortDateTime(row.occurredAt)}</dd>
        </div>
        <div>
          <dt>{isIngreso ? 'Cliente' : 'Proveedor'}</dt>
          <dd>{row.party}</dd>
        </div>
        {order?.phone && (
          <div>
            <dt>Teléfono</dt>
            <dd>{order.phone}</dd>
          </div>
        )}
      </dl>

      <table>
        <thead>
          <tr>
            <th>Descripción</th>
            <th className="num">Importe</th>
          </tr>
        </thead>
        <tbody>
          {items.length > 0 ? (
            items.map((item) => (
              <tr key={item.id}>
                <td>{item.description}</td>
                <td className="num">{money(item.amount)}</td>
              </tr>
            ))
          ) : (
            <tr>
              <td>{row.concept}</td>
              <td className="num">{money(total)}</td>
            </tr>
          )}
        </tbody>
      </table>

      <dl className="totals">
        <div>
          <dt>Total del trabajo</dt>
          <dd>{money(total)}</dd>
        </div>
        {cobrado > 0 && (
          <div>
            <dt>{isIngreso ? 'Adelanto' : 'Pagado'}{row.payment ? ` (${row.payment})` : ''}</dt>
            <dd>{money(cobrado)}</dd>
          </div>
        )}
        {abonado > 0 && (
          <div>
            <dt>Abonos posteriores</dt>
            <dd>{money(abonado)}</dd>
          </div>
        )}
        <div className={row.pending > 0 ? 'due' : 'settled'}>
          <dt>{row.pending > 0 ? 'SALDO PENDIENTE' : 'CANCELADO'}</dt>
          <dd>{money(row.pending)}</dd>
        </div>
      </dl>

      <footer>
        <p>Gracias por su preferencia</p>
        <p className="sub">Documento generado por Tairos.rc</p>
      </footer>
    </article>,
    host,
  )
}
