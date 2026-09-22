import { useMemo, useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import { usePermisos } from '@/hooks/usePermisos'
import { useToast } from '@/hooks/useToast'
import { describirLinea, totalDe, unidadEn } from '@/lib/catalogo'
import { money, parseAmount } from '@/lib/format'
import { normalizar } from '@/lib/partes'
import { useData } from '@/store/DataProvider'
import { CATEGORIES, UNIDADES, type Producto, type Unidad } from '@/types'

/**
 * El catálogo de precios: cada producto con su precio por cantidad. De aquí
 * salen las líneas «Del catálogo» de pedidos y proformas, y el precio que el
 * dictado sugiere cuando la frase no lo dijo. Solo el gerente lo cambia (la
 * base rechaza lo demás).
 */
export function CatalogoView({ search }: { search: string }) {
  const { productos, loading, borrarProducto } = useData()
  const { esGerente } = usePermisos()
  const toast = useToast()
  const [editando, setEditando] = useState<Producto | 'nuevo' | null>(null)
  const [local, setLocal] = useState('')
  const q = normalizar(search || local)
  const visibles = useMemo(() => productos.filter((p) => !q || normalizar(p.nombre).includes(q)), [productos, q])

  const borrar = async (p: Producto) => {
    if (!window.confirm(`¿Borrar «${p.nombre}» del catálogo? Los pedidos ya registrados no cambian.`)) return
    try {
      await borrarProducto(p.id)
      toast.success(`${p.nombre} borrado`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo borrar')
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[11px] text-slate-500 dark:text-slate-400">
          {productos.length} productos · precio por unidad según la cantidad · solo el gerente los cambia
        </p>
        <div className="flex gap-2">
          <input
            type="search"
            value={local}
            onChange={(e) => setLocal(e.target.value)}
            placeholder="Buscar producto…"
            aria-label="Buscar producto"
            disabled={Boolean(search)}
            className="w-44 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs outline-none focus:border-brand-500 disabled:opacity-50 dark:border-slate-800 dark:bg-slate-950"
          />
          {esGerente && (
            <button type="button" onClick={() => setEditando('nuevo')} className="btn-primary">
              <i className="fa-solid fa-plus" aria-hidden="true" />
              Nuevo producto
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <p className="py-10 text-center text-xs text-slate-400">Cargando catálogo…</p>
      ) : visibles.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 p-8 text-center dark:border-slate-700">
          <p className="text-sm font-bold text-slate-700 dark:text-slate-200">
            {productos.length ? 'Nada con ese nombre' : 'El catálogo está vacío'}
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Ej.: «Volantes A5 couché», por millar: desde 1 a S/ 180, desde 5 a S/ 150.
          </p>
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {visibles.map((p) => (
            <Ficha key={p.id} producto={p} editable={esGerente} onEditar={() => setEditando(p)} onBorrar={() => void borrar(p)} />
          ))}
        </div>
      )}

      {editando && (
        <EditarProducto
          key={editando === 'nuevo' ? 'nuevo' : editando.id}
          producto={editando === 'nuevo' ? null : editando}
          onClose={() => setEditando(null)}
        />
      )}
    </div>
  )
}

function Ficha({
  producto,
  editable,
  onEditar,
  onBorrar,
}: {
  producto: Producto
  editable: boolean
  onEditar: () => void
  onBorrar: () => void
}) {
  const [cantidad, setCantidad] = useState('')
  const n = parseAmount(cantidad)
  const total = n > 0 ? totalDe(producto, n) : null
  return (
    <div className={`space-y-2 rounded-2xl border border-slate-200 bg-white p-3.5 dark:border-slate-800 dark:bg-slate-900 ${producto.activo ? '' : 'opacity-60'}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-slate-900 dark:text-slate-50">{producto.nombre}</p>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            Por {unidadEn(producto.unidad, 1)} · {producto.categoria}
            {!producto.activo && ' · inactivo'}
          </p>
        </div>
        <span className={`flex shrink-0 gap-1${editable ? '' : ' hidden'}`}>
          <button type="button" onClick={onEditar} aria-label={`Editar ${producto.nombre}`} className="rounded p-1 text-slate-400 hover:text-brand-700 dark:hover:text-brand-300">
            <i className="fa-solid fa-pen text-xs" aria-hidden="true" />
          </button>
          <button type="button" onClick={onBorrar} aria-label={`Borrar ${producto.nombre}`} className="rounded p-1 text-slate-400 hover:text-rose-600">
            <i className="fa-solid fa-trash-can text-xs" aria-hidden="true" />
          </button>
        </span>
      </div>
      <ul className="space-y-0.5 text-[11px] text-slate-600 dark:text-slate-300">
        {producto.precios.map((t) => (
          <li key={t.desde} className="flex justify-between">
            <span>
              Desde {t.desde} {unidadEn(producto.unidad, t.desde)}
            </span>
            <span className="font-semibold tabular-nums">{money(t.precio)} c/u</span>
          </li>
        ))}
      </ul>
      <label className="flex items-center gap-2 border-t border-slate-100 pt-2 text-[11px] dark:border-slate-800">
        <span className="shrink-0 text-slate-500 dark:text-slate-400">Calcular:</span>
        <input
          inputMode="decimal"
          value={cantidad}
          onChange={(e) => setCantidad(e.target.value)}
          placeholder={unidadEn(producto.unidad, 2)}
          aria-label={`Cantidad de ${producto.nombre}`}
          className="w-20 rounded-lg border border-slate-200 px-2 py-1 dark:border-slate-700 dark:bg-slate-950"
        />
        <span className="ml-auto font-bold tabular-nums text-slate-900 dark:text-slate-50">
          {total !== null ? money(total) : '—'}
        </span>
      </label>
      {total !== null && <p className="text-[10px] text-slate-400">{describirLinea(producto, n)}</p>}
    </div>
  )
}

function EditarProducto({ producto, onClose }: { producto: Producto | null; onClose: () => void }) {
  const { guardarProducto } = useData()
  const toast = useToast()
  const [nombre, setNombre] = useState(producto?.nombre ?? '')
  const [unidad, setUnidad] = useState<Unidad>(producto?.unidad ?? 'millar')
  const [categoria, setCategoria] = useState(producto?.categoria ?? 'Ventas')
  const [activo, setActivo] = useState(producto?.activo ?? true)
  const [tramos, setTramos] = useState(
    producto?.precios.map((t) => ({ desde: String(t.desde), precio: String(t.precio) })) ?? [{ desde: '1', precio: '' }],
  )
  const [guardando, setGuardando] = useState(false)

  const guardar = async () => {
    const precios = tramos
      .map((t) => ({ desde: parseAmount(t.desde), precio: parseAmount(t.precio) }))
      .filter((t) => t.desde > 0 || t.precio > 0)
    if (!nombre.trim()) return toast.error('Escribe el nombre del producto')
    if (!precios.length || precios.some((t) => t.desde <= 0 || t.precio <= 0)) {
      return toast.error('Cada tramo necesita una cantidad y un precio mayores a cero')
    }
    if (new Set(precios.map((t) => t.desde)).size !== precios.length) return toast.error('Dos tramos empiezan en la misma cantidad')
    setGuardando(true)
    try {
      await guardarProducto({ id: producto?.id ?? null, nombre, unidad, categoria, activo, precios })
      toast.success(`${nombre.trim()} guardado`)
      onClose()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo guardar')
    } finally {
      setGuardando(false)
    }
  }

  return (
    <Modal open onClose={onClose} title={producto ? `Editar ${producto.nombre}` : 'Nuevo producto'} icon="fa-tags">
      <div className="space-y-3">
        <div>
          <label className="field-label" htmlFor="prod-nombre">
            Nombre
          </label>
          <input id="prod-nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ej: Volantes A5 couché" className="field" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="field-label" htmlFor="prod-unidad">
              Se cobra por
            </label>
            <select id="prod-unidad" value={unidad} onChange={(e) => setUnidad(e.target.value as Unidad)} className="field">
              {UNIDADES.map((u) => (
                <option key={u} value={u}>
                  {unidadEn(u, 1)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="field-label" htmlFor="prod-cat">
              Categoría
            </label>
            <select id="prod-cat" value={categoria} onChange={(e) => setCategoria(e.target.value)} className="field">
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <p className="field-label">Precio por {unidadEn(unidad, 1)}, según la cantidad</p>
          <ul className="space-y-1.5">
            {tramos.map((t, i) => (
              <li key={i} className="flex items-center gap-2 text-xs">
                <span className="shrink-0 text-slate-500">Desde</span>
                <input
                  inputMode="decimal"
                  value={t.desde}
                  onChange={(e) => setTramos((ts) => ts.map((x, j) => (j === i ? { ...x, desde: e.target.value } : x)))}
                  aria-label={`Tramo ${i + 1}: desde`}
                  className="field w-20"
                />
                <span className="shrink-0 text-slate-500">{unidadEn(unidad, 2)}, a S/</span>
                <input
                  inputMode="decimal"
                  value={t.precio}
                  onChange={(e) => setTramos((ts) => ts.map((x, j) => (j === i ? { ...x, precio: e.target.value } : x)))}
                  aria-label={`Tramo ${i + 1}: precio`}
                  placeholder="0.00"
                  className="field w-24 font-bold"
                />
                <button
                  type="button"
                  disabled={tramos.length === 1}
                  onClick={() => setTramos((ts) => ts.filter((_, j) => j !== i))}
                  aria-label={`Quitar tramo ${i + 1}`}
                  className="rounded p-1 text-slate-400 hover:text-rose-600 disabled:opacity-30"
                >
                  <i className="fa-solid fa-xmark" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => setTramos((ts) => [...ts, { desde: '', precio: '' }])}
            className="mt-1.5 text-[11px] font-bold text-brand-700 dark:text-brand-300"
          >
            + Otro tramo
          </button>
        </div>
        <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-200">
          <input type="checkbox" checked={activo} onChange={(e) => setActivo(e.target.checked)} className="accent-brand-700" />
          Activo (aparece al elegir del catálogo)
        </label>
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="btn-ghost">
            Cancelar
          </button>
          <button type="button" disabled={guardando} onClick={() => void guardar()} className="btn-primary px-4">
            {guardando ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
