import { useMemo, useState } from 'react'
import { Badge } from '@/components/ui/Badge'
import { EmptyRow } from '@/components/ui/EmptyRow'
import { Modal } from '@/components/ui/Modal'
import { Pagination } from '@/components/ui/Pagination'
import { AbonoModal } from '@/features/deudas/AbonoModal'
import { NewOrderModal } from '@/features/registro/NewOrderModal'
import { usePagination } from '@/hooks/usePagination'
import { useToast } from '@/hooks/useToast'
import { money, shortDateTime } from '@/lib/format'
import { normalizar } from '@/lib/partes'
import { enlaceWhatsApp, numeroPeruano } from '@/lib/whatsapp'
import { useData } from '@/store/DataProvider'
import { NOMBRE_ESTADO, type Cliente, type Debt } from '@/types'

type Filtro = 'clientes' | 'proveedores' | 'todos'

interface Resumen {
  pedidos: number
  /** Positivo: le debe al negocio. Negativo: el negocio le debe. */
  saldo: number
  ultimo: string | null
}

/**
 * Los clientes (y proveedores) del negocio. La base los crea y vincula sola al
 * registrar; aquí se corrigen sus datos y se ve todo lo suyo de un vistazo.
 */
export function ClientesView({ search }: { search: string }) {
  const { clientes, workOrders, debts, proformas, loading } = useData()
  const [filtro, setFiltro] = useState<Filtro>('clientes')
  const [local, setLocal] = useState('')
  const [abierto, setAbierto] = useState<Cliente | null>(null)
  const [creando, setCreando] = useState(false)

  const resumen = useMemo(() => {
    const r = new Map<string, Resumen>()
    const de = (id: string | null) => {
      if (!id) return null
      let x = r.get(id)
      if (!x) r.set(id, (x = { pedidos: 0, saldo: 0, ultimo: null }))
      return x
    }
    const ver = (x: Resumen | null, fecha: string) => {
      if (x && (!x.ultimo || fecha > x.ultimo)) x.ultimo = fecha
    }
    for (const w of workOrders) {
      const x = de(w.clienteId)
      if (x) x.pedidos++
      ver(x, w.createdAt)
    }
    for (const d of debts) {
      const x = de(d.clienteId)
      if (x && d.balance > 0) x.saldo += d.kind === 'COBRAR' ? d.balance : -d.balance
      ver(x, d.createdAt)
    }
    for (const p of proformas) ver(de(p.clienteId), p.issuedAt)
    return r
  }, [workOrders, debts, proformas])

  const q = normalizar(search || local)
  const visibles = useMemo(
    () =>
      clientes
        .filter((c) => filtro === 'todos' || c.proveedor === (filtro === 'proveedores'))
        .filter((c) => !q || normalizar(c.nombre).includes(q) || c.telefono.includes(q) || c.documento.includes(q))
        .sort((a, b) => (resumen.get(b.id)?.ultimo ?? '').localeCompare(resumen.get(a.id)?.ultimo ?? '')),
    [clientes, filtro, q, resumen],
  )
  const paginacion = usePagination(visibles, { firma: `${filtro}|${q}` })

  return (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm dark:border-slate-800/80 dark:bg-slate-900">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-4 dark:border-slate-800">
          <div>
            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-50">Clientes y proveedores</h3>
            <p className="text-[11px] text-slate-400 dark:text-slate-500">
              {visibles.length} de {clientes.length} · se crean solos al registrar
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="search"
              value={local}
              onChange={(e) => setLocal(e.target.value)}
              placeholder="Buscar nombre, teléfono o RUC…"
              aria-label="Buscar clientes"
              disabled={Boolean(search)}
              className="w-44 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs outline-none focus:border-brand-500 disabled:opacity-50 dark:border-slate-800 dark:bg-slate-950 sm:w-56"
            />
            <select
              value={filtro}
              onChange={(e) => setFiltro(e.target.value as Filtro)}
              aria-label="Mostrar"
              className="rounded-xl border border-slate-200 bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-700 outline-none dark:border-slate-800 dark:bg-slate-800 dark:text-slate-200"
            >
              <option value="clientes">Clientes</option>
              <option value="proveedores">Proveedores</option>
              <option value="todos">Todos</option>
            </select>
            <button type="button" onClick={() => setCreando(true)} className="btn-primary">
              <i className="fa-solid fa-plus" aria-hidden="true" />
              Nuevo
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[44rem] border-collapse text-left">
            <thead className="bg-slate-50/80 dark:bg-slate-900/60">
              <tr>
                <th className="th pl-5">Nombre</th>
                <th className="th">Teléfono</th>
                <th className="th">DNI / RUC</th>
                <th className="th text-right">Pedidos</th>
                <th className="th text-right">Saldo</th>
                <th className="th pr-5">Último movimiento</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {loading ? (
                <EmptyRow colSpan={6} message="Cargando clientes…" />
              ) : visibles.length === 0 ? (
                <EmptyRow colSpan={6} message="Nadie con ese nombre." />
              ) : (
                paginacion.visibles.map((c) => {
                  const r = resumen.get(c.id)
                  return (
                    <tr key={c.id} className="transition-colors hover:bg-slate-50/80 dark:hover:bg-slate-900/60">
                      <td className="td pl-5">
                        <button
                          type="button"
                          onClick={() => setAbierto(c)}
                          className="text-left font-semibold text-slate-800 hover:text-brand-700 dark:text-slate-100 dark:hover:text-brand-300"
                        >
                          {c.nombre}
                        </button>
                        {c.proveedor && (
                          <span className="ml-1.5">
                            <Badge tone="slate">Proveedor</Badge>
                          </span>
                        )}
                      </td>
                      <td className="td text-xs">
                        {numeroPeruano(c.telefono) ? (
                          <a
                            href={enlaceWhatsApp(c.telefono, `Hola ${c.nombre}, `)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-emerald-700 hover:underline dark:text-emerald-400"
                          >
                            <i className="fa-brands fa-whatsapp" aria-hidden="true" />
                            {c.telefono}
                          </a>
                        ) : (
                          <span className="text-slate-500 dark:text-slate-400">{c.telefono || '—'}</span>
                        )}
                      </td>
                      <td className="td text-xs text-slate-500 dark:text-slate-400">{c.documento || '—'}</td>
                      <td className="td text-right text-xs tabular-nums">{r?.pedidos ?? 0}</td>
                      <td className="td text-right text-xs font-bold tabular-nums">
                        {!r || Math.abs(r.saldo) < 0.005 ? (
                          <span className="text-slate-400">—</span>
                        ) : r.saldo > 0 ? (
                          <span className="text-amber-700 dark:text-amber-300" title="Le debe al negocio">
                            {money(r.saldo)}
                          </span>
                        ) : (
                          <span className="text-rose-700 dark:text-rose-300" title="El negocio le debe">
                            −{money(-r.saldo)}
                          </span>
                        )}
                      </td>
                      <td className="td pr-5 text-[11px] text-slate-500 dark:text-slate-400">
                        {r?.ultimo ? shortDateTime(r.ultimo) : '—'}
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
        <Pagination paginacion={paginacion} etiqueta="clientes" />
      </div>

      {abierto && <FichaCliente key={abierto.id} cliente={abierto} onClose={() => setAbierto(null)} />}
      {creando && <NuevoCliente proveedor={filtro === 'proveedores'} onClose={() => setCreando(false)} />}
    </div>
  )
}

function CamposCliente({
  datos,
  onChange,
}: {
  datos: Omit<Cliente, 'id' | 'createdAt'>
  onChange: (cambio: Partial<Omit<Cliente, 'id' | 'createdAt'>>) => void
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <label className="field-label" htmlFor="cli-nombre">
          Nombre
        </label>
        <input id="cli-nombre" value={datos.nombre} onChange={(e) => onChange({ nombre: e.target.value })} className="field" />
      </div>
      <div>
        <label className="field-label" htmlFor="cli-telefono">
          Teléfono / WhatsApp
        </label>
        <input
          id="cli-telefono"
          type="tel"
          inputMode="tel"
          value={datos.telefono}
          onChange={(e) => onChange({ telefono: e.target.value })}
          placeholder="987 654 321"
          className="field"
        />
      </div>
      <div>
        <label className="field-label" htmlFor="cli-doc">
          DNI o RUC <span className="font-normal text-slate-400">(opcional)</span>
        </label>
        <input
          id="cli-doc"
          inputMode="numeric"
          value={datos.documento}
          onChange={(e) => onChange({ documento: e.target.value })}
          className="field"
        />
      </div>
      <div className="sm:col-span-2">
        <label className="field-label" htmlFor="cli-notas">
          Notas
        </label>
        <textarea
          id="cli-notas"
          rows={2}
          value={datos.notas}
          onChange={(e) => onChange({ notas: e.target.value })}
          placeholder="Ej: prefiere couché brillante; paga con Yape"
          className="field resize-none"
        />
      </div>
      <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-200 sm:col-span-2">
        <input type="checkbox" checked={datos.proveedor} onChange={(e) => onChange({ proveedor: e.target.checked })} className="accent-brand-700" />
        Es un proveedor (le compramos)
      </label>
    </div>
  )
}

function NuevoCliente({ proveedor, onClose }: { proveedor: boolean; onClose: () => void }) {
  const { crearCliente } = useData()
  const toast = useToast()
  const [datos, setDatos] = useState({ nombre: '', telefono: '', documento: '', notas: '', proveedor })
  const [guardando, setGuardando] = useState(false)
  const guardar = async () => {
    if (!datos.nombre.trim()) return toast.error('Escribe el nombre')
    setGuardando(true)
    try {
      await crearCliente(datos)
      toast.success(`${datos.nombre.trim()} guardado`)
      onClose()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo guardar')
    } finally {
      setGuardando(false)
    }
  }
  return (
    <Modal open onClose={onClose} title={proveedor ? 'Nuevo proveedor' : 'Nuevo cliente'} icon="fa-user-plus">
      <div className="space-y-3">
        <CamposCliente datos={datos} onChange={(c) => setDatos((d) => ({ ...d, ...c }))} />
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

function FichaCliente({ cliente, onClose }: { cliente: Cliente; onClose: () => void }) {
  const { actualizarCliente, workOrders, debts, proformas } = useData()
  const toast = useToast()
  const [datos, setDatos] = useState({
    nombre: cliente.nombre,
    telefono: cliente.telefono,
    documento: cliente.documento,
    notas: cliente.notas,
    proveedor: cliente.proveedor,
  })
  const [guardando, setGuardando] = useState(false)
  const [pagando, setPagando] = useState<Debt | null>(null)
  const [nuevoPedido, setNuevoPedido] = useState(false)

  const suyos = useMemo(
    () => ({
      pedidos: workOrders.filter((w) => w.clienteId === cliente.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      deudas: debts.filter((d) => d.clienteId === cliente.id && d.balance > 0),
      proformas: proformas.filter((p) => p.clienteId === cliente.id).sort((a, b) => b.issuedAt.localeCompare(a.issuedAt)),
    }),
    [workOrders, debts, proformas, cliente.id],
  )
  const cambiado = (Object.keys(datos) as Array<keyof typeof datos>).some((k) => datos[k] !== cliente[k])

  const guardar = async () => {
    if (!datos.nombre.trim()) return toast.error('El nombre no puede quedar vacío')
    setGuardando(true)
    try {
      await actualizarCliente(cliente.id, datos)
      toast.success('Datos guardados')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo guardar')
    } finally {
      setGuardando(false)
    }
  }

  return (
    <Modal open onClose={onClose} title={cliente.nombre} subtitle={cliente.proveedor ? 'Proveedor' : 'Cliente'} icon="fa-address-card" size="lg">
      <div className="space-y-4">
        <CamposCliente datos={datos} onChange={(c) => setDatos((d) => ({ ...d, ...c }))} />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-2">
            {numeroPeruano(datos.telefono) && (
              <a
                href={enlaceWhatsApp(datos.telefono, `Hola ${datos.nombre}, `)}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-ghost"
              >
                <i className="fa-brands fa-whatsapp text-emerald-600" aria-hidden="true" />
                WhatsApp
              </a>
            )}
            {!cliente.proveedor && (
              <button type="button" onClick={() => setNuevoPedido(true)} className="btn-ghost">
                <i className="fa-solid fa-file-pen" aria-hidden="true" />
                Nuevo pedido
              </button>
            )}
          </div>
          <button type="button" disabled={!cambiado || guardando} onClick={() => void guardar()} className="btn-primary px-4">
            {guardando ? 'Guardando…' : 'Guardar cambios'}
          </button>
        </div>

        {suyos.deudas.length > 0 && (
          <section>
            <h4 className="mb-1 text-[11px] font-bold uppercase tracking-wide text-amber-700 dark:text-amber-300">Cuentas pendientes</h4>
            <ul className="divide-y divide-slate-100 text-xs dark:divide-slate-800">
              {suyos.deudas.map((d) => (
                <li key={d.id} className="flex items-center justify-between gap-2 py-1.5">
                  <span className="min-w-0 truncate text-slate-600 dark:text-slate-300">{d.concept}</span>
                  <span className="flex shrink-0 items-center gap-2">
                    <span className={`font-bold tabular-nums ${d.kind === 'COBRAR' ? 'text-amber-700 dark:text-amber-300' : 'text-rose-700 dark:text-rose-300'}`}>
                      {money(d.balance)}
                    </span>
                    <button type="button" onClick={() => setPagando(d)} className="rounded-lg bg-brand-800 px-2 py-1 text-[11px] font-bold text-white dark:bg-brand-600">
                      Abonar
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section>
          <h4 className="mb-1 text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Pedidos ({suyos.pedidos.length})
          </h4>
          {suyos.pedidos.length === 0 ? (
            <p className="text-xs text-slate-400">Todavía ninguno.</p>
          ) : (
            <ul className="max-h-56 divide-y divide-slate-100 overflow-y-auto text-xs dark:divide-slate-800">
              {suyos.pedidos.map((w) => (
                <li key={w.id} className="flex items-center justify-between gap-2 py-1.5">
                  <span className="min-w-0">
                    <span className="block truncate text-slate-700 dark:text-slate-200">{w.items.map((i) => i.description).join(' + ')}</span>
                    <span className="text-[10px] text-slate-400">
                      {shortDateTime(w.createdAt)} · {NOMBRE_ESTADO[w.estado]}
                    </span>
                  </span>
                  <span className="shrink-0 font-semibold tabular-nums">{money(w.total)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {suyos.proformas.length > 0 && (
          <section>
            <h4 className="mb-1 text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Proformas ({suyos.proformas.length})
            </h4>
            <ul className="divide-y divide-slate-100 text-xs dark:divide-slate-800">
              {suyos.proformas.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-2 py-1.5">
                  <span className="min-w-0 truncate text-slate-600 dark:text-slate-300">
                    {p.code} · {p.detail}
                  </span>
                  <span className="shrink-0 tabular-nums">
                    {money(p.total)} · <span className="text-slate-400">{p.status}</span>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
      <AbonoModal debt={pagando} onClose={() => setPagando(null)} />
      {nuevoPedido && (
        <NewOrderModal open paraCliente={{ nombre: datos.nombre, telefono: datos.telefono }} onClose={() => setNuevoPedido(false)} />
      )}
    </Modal>
  )
}
