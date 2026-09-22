import { useMemo, useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import { describirLinea, precioPorUnidad, totalDe, unidadEn } from '@/lib/catalogo'
import { money, parseAmount } from '@/lib/format'
import { normalizar } from '@/lib/partes'
import type { Producto } from '@/types'

interface Props {
  productos: Producto[]
  onElegir: (linea: { descripcion: string; monto: number }) => void
  onClose: () => void
}

/**
 * Añadir una línea desde el catálogo: producto y cantidad, y el precio sale de
 * su escala. Si el catálogo está vacío, lo dice y dice dónde se llena.
 */
export function ElegirDelCatalogo({ productos, onElegir, onClose }: Props) {
  const [busqueda, setBusqueda] = useState('')
  const [elegido, setElegido] = useState<Producto | null>(null)
  const [cantidad, setCantidad] = useState('1')

  const activos = useMemo(() => productos.filter((p) => p.activo && p.precios.length), [productos])
  const visibles = useMemo(() => {
    const q = normalizar(busqueda)
    return q ? activos.filter((p) => normalizar(p.nombre).includes(q)) : activos
  }, [activos, busqueda])

  const n = parseAmount(cantidad)
  const unitario = elegido ? precioPorUnidad(elegido, n) : null
  const total = elegido ? totalDe(elegido, n) : null

  return (
    <Modal open onClose={onClose} title="Añadir del catálogo" subtitle="El precio sale de la escala por cantidad" icon="fa-tags">
      {activos.length === 0 ? (
        <p className="py-6 text-center text-xs text-slate-500 dark:text-slate-400">
          El catálogo está vacío. El gerente lo llena en la pestaña <span className="font-bold">Catálogo</span>.
        </p>
      ) : !elegido ? (
        <div className="space-y-2">
          <input
            autoFocus
            type="search"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar producto…"
            aria-label="Buscar producto"
            className="field"
          />
          <ul className="max-h-72 space-y-1 overflow-y-auto">
            {visibles.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => setElegido(p)}
                  className="flex w-full items-center justify-between gap-2 rounded-xl border border-slate-200 px-3 py-2 text-left text-xs transition-colors hover:border-brand-400 hover:bg-brand-50 dark:border-slate-800 dark:hover:bg-brand-500/10"
                >
                  <span className="font-bold text-slate-800 dark:text-slate-100">{p.nombre}</span>
                  <span className="shrink-0 text-slate-500 dark:text-slate-400">
                    desde {money(p.precios[0].precio)} / {unidadEn(p.unidad, 1)}
                  </span>
                </button>
              </li>
            ))}
            {visibles.length === 0 && <li className="py-3 text-center text-xs text-slate-400">Nada con ese nombre.</li>}
          </ul>
        </div>
      ) : (
        <div className="space-y-3">
          <button type="button" onClick={() => setElegido(null)} className="text-[11px] font-bold text-brand-700 dark:text-brand-300">
            ← Otro producto
          </button>
          <p className="text-sm font-bold text-slate-900 dark:text-slate-50">{elegido.nombre}</p>
          <div>
            <label className="field-label" htmlFor="cat-cantidad">
              Cantidad ({unidadEn(elegido.unidad, 2)})
            </label>
            <input
              id="cat-cantidad"
              autoFocus
              inputMode="decimal"
              value={cantidad}
              onChange={(e) => setCantidad(e.target.value)}
              className="field font-bold"
            />
          </div>
          <ul className="space-y-0.5 text-[11px] text-slate-500 dark:text-slate-400">
            {elegido.precios.map((t) => (
              <li key={t.desde} className={unitario === t.precio && n >= t.desde ? 'font-bold text-brand-800 dark:text-brand-300' : ''}>
                Desde {t.desde} {unidadEn(elegido.unidad, t.desde)}: {money(t.precio)} c/u
              </li>
            ))}
          </ul>
          <div className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2 dark:bg-slate-950">
            <span className="text-xs text-slate-600 dark:text-slate-300">{n > 0 ? describirLinea(elegido, n) : '—'}</span>
            <span className="text-base font-extrabold tabular-nums text-slate-900 dark:text-slate-50">{total !== null ? money(total) : '—'}</span>
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="btn-ghost">
              Cancelar
            </button>
            <button
              type="button"
              disabled={total === null}
              onClick={() => {
                if (total === null) return
                onElegir({ descripcion: describirLinea(elegido, n), monto: total })
                onClose()
              }}
              className="btn-primary px-4"
            >
              Añadir
            </button>
          </div>
        </div>
      )}
    </Modal>
  )
}
