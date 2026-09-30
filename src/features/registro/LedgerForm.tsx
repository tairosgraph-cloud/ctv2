import { useMemo, useRef, useState, type FormEvent } from 'react'
import { ElegirDelCatalogo } from '@/components/catalogo/ElegirDelCatalogo'
import { AvisoDictado } from '@/components/dictado/AvisoDictado'
import { MicButton } from '@/components/ui/MicButton'
import { useCamposDictados } from '@/hooks/useCamposDictados'
import { useDictado, type Borrador } from '@/hooks/useDictado'
import { usePartes } from '@/hooks/usePartes'
import { useRecognizer } from '@/hooks/useSpeech'
import { useToast } from '@/hooks/useToast'
import { hoyEnLima } from '@/lib/dictado/extraer'
import { formularioDePedido, type Duda, type FormularioPedido } from '@/lib/dictado/formulario'
import { money, parseAmount } from '@/lib/format'
import { normalizar } from '@/lib/partes'
import { useData } from '@/store/DataProvider'
import {
  CATEGORIES,
  PAYMENT_METHODS,
  type PaymentMethod,
  type TxType,
  type WorkOrder,
} from '@/types'
import { rutaDe, type Ruta } from '../../../supabase/functions/_shared/dictado/tipos.ts'

interface JobLine {
  key: number
  description: string
  amount: string
}

let nextKey = 1
const emptyLine = (): JobLine => ({ key: nextKey++, description: '', amount: '' })

/**
 * Los nombres de campo del dictado (src/lib/dictado/formulario.ts) cuentan las
 * líneas por posición; aquí cada línea tiene su `key`, que no cambia al quitar
 * otras. Esto traduce de uno a otro.
 */
const EN_FORMULARIO: Record<string, string> = { parte: 'party', telefono: 'phone', pago: 'payment', kind: 'tipo' }
function enFormulario(campo: string, lineas: JobLine[]): string {
  const linea = /^(?:(descripcion|monto)-|items\.)(\d+)(?:\.monto)?$/.exec(campo)
  if (linea) {
    const key = lineas[Number(linea[2])]?.key
    return key === undefined ? campo : `${linea[1] ?? 'monto'}-${key}`
  }
  return EN_FORMULARIO[campo] ?? campo
}

/** Y al revés, para la auditoría: qué hubo que corregir, con nombres estables. */
const DEL_FORMULARIO: Record<string, string> = { party: 'parte', phone: 'telefono', payment: 'pago', tipo: 'kind' }
function delFormulario(campo: string, lineas: JobLine[]): string {
  const linea = /^(descripcion|monto)-(\d+)$/.exec(campo)
  if (linea) {
    const i = lineas.findIndex((l) => l.key === Number(linea[2]))
    return `items.${i < 0 ? '?' : i}.${linea[1]}`
  }
  return DEL_FORMULARIO[campo] ?? campo
}

const NOMBRE_DE_RUTA: Partial<Record<Ruta, string>> = {
  proforma: 'una proforma',
  abono: 'un abono a una cuenta',
  deuda: 'una cuenta pendiente',
  consulta: 'una pregunta',
}

/** El dictado no dijo cómo se cobró (o solo lo supuso). */
const faltaCobro = (b: Borrador | null) =>
  Boolean(b && (b.resultado.extraccion.faltantes.includes('cobro') || b.resultado.extraccion.supuestos.includes('cobro')))

interface LedgerFormProps {
  /** Se llama tras guardar con éxito; el modal lo usa para cerrarse. */
  onSaved?: () => void
  /** Si se pasa, aparece el botón Cancelar. */
  onCancel?: () => void
  /** Si se pasa, el formulario corrige ese pedido en vez de crear uno nuevo. */
  editing?: WorkOrder | null
  /** Si se pasa, el formulario arranca con lo dictado desde la barra superior. */
  dictado?: Borrador | null
  /** Un pedido nuevo para un cliente ya elegido (desde su ficha). */
  paraCliente?: { nombre: string; telefono: string } | null
}

/** Lo dictado, traducido a lo que el formulario pone en pantalla. */
interface Aplicacion {
  formulario: FormularioPedido
  lineas: JobLine[]
  marcas: string[]
  dudas: Duda[]
}

function prepararAplicacion(formulario: FormularioPedido, libres: JobLine[]): Aplicacion {
  const lineas = formulario.lineas.map((l, i) => ({
    key: libres[i]?.key ?? nextKey++,
    description: l.descripcion,
    amount: l.monto,
  }))
  return {
    formulario,
    lineas,
    marcas: formulario.marcas.map((m) => enFormulario(m, lineas)),
    dudas: formulario.dudas.map((d) => ({ ...d, campo: enFormulario(d.campo, lineas) })),
  }
}

export function LedgerForm({ onSaved, onCancel, editing, dictado = null, paraCliente = null }: LedgerFormProps = {}) {
  const { registerWorkOrder, editWorkOrder, transactions, clientes, productos } = useData()
  const { interpretar, arreglar, confirmar } = useDictado()
  const partes = usePartes()
  const toast = useToast()

  // El dictado que abrió el formulario se traduce una sola vez, al montar.
  const [arranque] = useState<Aplicacion | null>(() => {
    const formulario = dictado ? formularioDePedido(dictado.resultado.extraccion, partes, productos) : null
    return formulario ? prepararAplicacion(formulario, []) : null
  })
  const inicial = arranque?.formulario

  // El método de pago vive en el asiento del adelanto, no en el pedido.
  const originalPayment = editing
    ? (transactions.find((t) => t.workOrderId === editing.id)?.payment ?? 'Efectivo')
    : 'Efectivo'

  const [type, setType] = useState<TxType>(editing?.kind ?? inicial?.tipo ?? 'Ingreso')
  const [party, setParty] = useState(editing?.party ?? inicial?.parte ?? paraCliente?.nombre ?? '')
  const [phone, setPhone] = useState(editing?.phone ?? inicial?.telefono ?? paraCliente?.telefono ?? '')
  const [lines, setLines] = useState<JobLine[]>(
    editing?.items.length
      ? editing.items.map((i) => ({
          key: nextKey++,
          description: i.description,
          amount: String(i.amount),
        }))
      : arranque?.lineas ?? [emptyLine()],
  )
  const [category, setCategory] = useState<string>(editing?.category ?? inicial?.categoria ?? 'Ventas')
  const [payment, setPayment] = useState<PaymentMethod>(inicial?.pago ?? originalPayment)
  const [advance, setAdvance] = useState(
    editing && editing.advance < editing.total ? String(editing.advance) : (inicial?.cobro?.adelanto ?? ''),
  )
  /** false = el cliente paga todo ahora; true = adelanta una parte. */
  const [partial, setPartial] = useState(
    Boolean(editing && editing.advance < editing.total) || Boolean(inicial?.cobro?.parcial),
  )
  const [saving, setSaving] = useState(false)
  const [interpretando, setInterpretando] = useState(false)
  const [arreglando, setArreglando] = useState(false)
  const [delCatalogo, setDelCatalogo] = useState(false)
  /**
   * Cuándo se lleva el trabajo. 'ya' = venta al instante (no ocupa el tablero
   * de Trabajos); 'fecha' = comprometida; 'pendiente' = en el taller, sin día.
   * Mientras nadie lo elija, un pago completo es 'ya' y un adelanto o crédito
   * es 'pendiente': lo que no se paga entero rara vez sale en el momento.
   */
  const [entregaModo, setEntregaModo] = useState<'ya' | 'fecha' | 'pendiente' | null>(inicial?.entrega ? 'fecha' : null)
  const [entregaFecha, setEntregaFecha] = useState(inicial?.entrega ?? '')

  /** Lo que escribió el dictado y nadie ha confirmado todavía: en ámbar. */
  const campos = useCamposDictados(arranque?.marcas)
  const [dudas, setDudas] = useState<Duda[]>(arranque?.dudas ?? [])
  const [faltantes, setFaltantes] = useState<string[]>(inicial?.faltantes ?? [])
  const [supuestos, setSupuestos] = useState<string[]>(inicial?.supuestos ?? [])
  /** Los dictados aplicados, en orden: a todos se les anota qué hubo que corregir. */
  const [borradores, setBorradores] = useState<Borrador[]>(arranque && dictado ? [dictado] : [])
  const borrador = borradores.at(-1) ?? null
  /**
   * La frase no dijo cómo se cobró. Dejar «pagó todo» por defecto también es
   * adivinar, así que no se guarda hasta que alguien lo diga con un botón.
   * Una vez decidido (por la persona o por un dictado que sí lo dice), un
   * dictado posterior que no lo mencione no lo vuelve a preguntar.
   */
  // Decidido = alguien lo dijo: la persona con los controles, un dictado que lo
  // nombra, o el pedido que se corrige. Sin dictado de por medio nunca se
  // pregunta: quien teclea ve la casilla.
  const cobroDecidido = useRef(Boolean(editing) || Boolean(arranque && !faltaCobro(dictado)))
  const [cobroPorConfirmar, setCobroPorConfirmar] = useState(Boolean(arranque) && !cobroDecidido.current)
  const decidirCobro = () => {
    cobroDecidido.current = true
    setCobroPorConfirmar(false)
  }
  /**
   * Si este registro salió de un dictado. No se deduce de las marcas: «Ya lo
   * revisé» las borra y el asiento seguiría siendo de origen voz.
   */
  const [origenVoz, setOrigenVoz] = useState(Boolean(arranque))

  /** La persona tocó el campo: fuera el ámbar y la duda, si la había. */
  const editar = (campo: string) => {
    campos.editar(campo)
    setDudas((actual) => (actual.some((d) => d.campo === campo) ? actual.filter((d) => d.campo !== campo) : actual))
  }

  const total = useMemo(
    () =>
      Math.round(lines.reduce((sum, line) => sum + parseAmount(line.amount), 0) * 100) / 100,
    [lines],
  )

  const advanceValue = partial ? parseAmount(advance) : total
  const balance = Math.round((total - advanceValue) * 100) / 100
  const advanceExceeds = partial && advanceValue > total + 0.001

  const isCobrar = type === 'Ingreso'
  const modoEntrega = entregaModo ?? (partial ? 'pendiente' : 'ya')

  const setLine = (key: number, patch: Partial<JobLine>) =>
    setLines((current) => current.map((l) => (l.key === key ? { ...l, ...patch } : l)))

  const addLine = () => setLines((current) => [...current, emptyLine()])

  /** Una línea del catálogo ocupa la primera vacía, o se añade. */
  const addDelCatalogo = (linea: { descripcion: string; monto: number }) =>
    setLines((current) => {
      const nueva = { key: nextKey++, description: linea.descripcion, amount: String(linea.monto) }
      const vacia = current.findIndex((l) => !l.description.trim() && !l.amount.trim())
      return vacia >= 0 ? current.map((l, i) => (i === vacia ? nueva : l)) : [...current, nueva]
    })

  /** Elegir un cliente que ya existe trae su teléfono, si aquí no hay uno. */
  const alCambiarParte = (valor: string) => {
    setParty(valor)
    editar('party')
    const conocido = clientes.find((c) => normalizar(c.nombre) === normalizar(valor))
    if (conocido?.telefono && !phone.trim()) setPhone(conocido.telefono)
  }

  const removeLine = (key: number) => {
    setLines((current) => (current.length === 1 ? current : current.filter((l) => l.key !== key)))
    campos.quitar(`descripcion-${key}`)
    campos.quitar(`monto-${key}`)
    setDudas((actual) => actual.filter((d) => d.campo !== `monto-${key}`))
  }

  /**
   * Un dictado hecho con el micrófono de este mismo formulario. Se suma a lo
   * que ya hay: lo que la frase dice se escribe, y lo que solo supone (el
   * tipo, la categoría, «pagó todo») no pisa lo que ya estaba.
   */
  const aplicar = (b: Borrador, reemplazarLineas = false) => {
    const formulario = formularioDePedido(b.resultado.extraccion, partes, productos)
    if (!formulario) return
    const supuesto = new Set(b.resultado.extraccion.supuestos)
    // Líneas nuevas siempre, con claves nuevas; las vacías se quitan dentro
    // del actualizador, con lo que haya en ese momento: lo que alguien haya
    // tecleado mientras se interpretaba la frase no se pierde.
    const { lineas, marcas, dudas: nuevas } = prepararAplicacion(formulario, [])
    const noAplicadas = new Set<string>()

    // Al corregir un pedido el tipo no se puede cambiar (editWorkOrder no lo manda).
    if (formulario.tipo && !supuesto.has('kind') && !editing) setType(formulario.tipo)
    else noAplicadas.add('tipo')
    if (formulario.parte !== null) setParty(formulario.parte)
    else if (nuevas.some((d) => d.campo === 'party')) setParty('')
    if (formulario.telefono) setPhone(formulario.telefono)
    if (formulario.categoria && !supuesto.has('categoria')) setCategory(formulario.categoria)
    else noAplicadas.add('categoria')
    if (formulario.pago) setPayment(formulario.pago)
    if (formulario.entrega) {
      setEntregaModo('fecha')
      setEntregaFecha(formulario.entrega)
    }
    // Un dictado nuevo suma sus líneas a las que ya hay; un arreglo las
    // sustituye, porque habla del pedido entero y sumarlas lo duplicaría.
    setLines((current) =>
      reemplazarLineas ? lineas : [...current.filter((l) => l.description.trim() || l.amount.trim()), ...lineas],
    )

    if (formulario.cobro && !supuesto.has('cobro')) {
      setPartial(formulario.cobro.parcial)
      // «Dejó un adelanto» sin cifra no borra el que ya estaba escrito.
      if (formulario.cobro.adelanto !== '') setAdvance(formulario.cobro.adelanto)
      decidirCobro()
    } else {
      noAplicadas.add('cobro')
      noAplicadas.add('adelanto')
      if (!cobroDecidido.current) setCobroPorConfirmar(true)
    }

    campos.marcar(marcas.filter((m) => !noAplicadas.has(m)))
    setDudas((actual) => [...actual.filter((d) => !nuevas.some((n) => n.campo === d.campo)), ...nuevas])
    setFaltantes(formulario.faltantes)
    // Las suposiciones no se aplican en un dictado posterior: las que se ven
    // son las del primero, que siguen en pantalla.
    setBorradores((actual) => [...actual, b])
    setOrigenVoz(true)
  }

  /**
   * El segundo filtro: lo que se escribe en la franja ámbar vuelve al
   * intérprete con lo que ya había entendido delante. Si no pudo, el borrador
   * se queda igual y el aviso dice por qué; a mano siempre se puede.
   */
  const pedirArreglo = async (escrito: string) => {
    if (!borrador) return
    setArreglando(true)
    try {
      const nuevo = await arreglar(borrador, escrito)
      if (nuevo.resultado.aviso) toast.info(nuevo.resultado.aviso)
      if (nuevo.resultado.extraccion === borrador.resultado.extraccion) return
      if (rutaDe(nuevo.resultado.extraccion.intent) !== 'registro') {
        toast.info(
          `Con ese arreglo ya no es una orden, sino ${NOMBRE_DE_RUTA[rutaDe(nuevo.resultado.extraccion.intent)] ?? 'otra cosa'}: díctalo con el micrófono de la barra superior.`,
        )
        return
      }
      aplicar(nuevo, true)
      toast.success('Listo, apliqué tu arreglo: revisa lo que quedó en ámbar.')
    } finally {
      setArreglando(false)
    }
  }

  const elegir = (campo: string, valor: string) => {
    const linea = /^monto-(\d+)$/.exec(campo)
    if (linea) setLine(Number(linea[1]), { amount: valor })
    else if (campo === 'party') setParty(valor)
    else if (campo === 'payment') setPayment(valor as PaymentMethod)
    else if (campo === 'categoria') setCategory(valor)
    else if (campo === 'tipo') setType(valor as TxType)
    else if (campo === 'adelanto') {
      setPartial(true)
      setAdvance(valor)
      decidirCobro()
    }
    // Lo eligió la persona: no hace falta pintarlo de ámbar.
    campos.quitar(campo)
    setDudas((actual) => actual.filter((d) => d.campo !== campo))
  }

  const revisado = () => {
    campos.revisar()
    setFaltantes([])
    setSupuestos([])
  }

  const { listening, toggle } = useRecognizer({
    onResult: async (transcript) => {
      setInterpretando(true)
      try {
        const b = await interpretar(transcript)
        const ruta = rutaDe(b.resultado.extraccion.intent)
        if (ruta === 'registro') aplicar(b)
        else if (ruta === 'desconocido') toast.info(`No entendí qué registrar en «${transcript}».`)
        else {
          toast.info(
            `Eso parece ${NOMBRE_DE_RUTA[ruta] ?? 'otra cosa'}, no una orden: díctalo con el micrófono de la barra superior.`,
          )
        }
      } finally {
        setInterpretando(false)
      }
    },
    onError: (message) => toast.error(message),
  })

  const reset = () => {
    setParty('')
    setPhone('')
    setLines([emptyLine()])
    setAdvance('')
    setPartial(false)
    campos.limpiar()
    setDudas([])
    setFaltantes([])
    setSupuestos([])
    setBorradores([])
    setOrigenVoz(false)
    cobroDecidido.current = false
    setCobroPorConfirmar(false)
    setEntregaModo(null)
    setEntregaFecha('')
  }

  /**
   * Anota en la auditoría qué hubo que corregir, en cada dictado que llegó al
   * formulario. Las líneas se numeran por su posición aquí. Nunca frena el
   * guardado.
   */
  const anotarDictado = (registroId: string) => {
    const camposEditados = campos.camposEditados().map((c) => delFormulario(c, lines))
    for (const b of borradores) confirmar(b, { camposEditados, registroTipo: 'pedido', registroId })
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
    if (cobroPorConfirmar) {
      toast.error('Indica cómo se cobró: pagó todo, dejó una parte o se lo lleva al crédito')
      return
    }
    // Un adelanto marcado y vacío no es «al crédito»: eso se dice con su botón.
    if (partial && !advance.trim()) {
      toast.error('Escribe cuánto adelantó, o pulsa «Sin adelanto» si se lo lleva al crédito')
      return
    }
    if (!editing && isCobrar && modoEntrega === 'fecha' && !entregaFecha) {
      toast.error('Elige el día de entrega, o marca «Sin fecha todavía»')
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
        anotarDictado(editing.id)
        toast.success(`Orden de ${payload.party} corregida`)
        onSaved?.()
        return
      }

      // Los gastos no pasan por el taller: nacen entregados.
      const conTaller = isCobrar && modoEntrega !== 'ya'
      const { workOrder, transaction, debt } = await registerWorkOrder({
        kind: type,
        ...payload,
        source: origenVoz ? 'voz' : 'manual',
        estado: conTaller ? 'recibido' : 'entregado',
        entrega: conTaller && modoEntrega === 'fecha' ? entregaFecha : null,
      })
      anotarDictado(workOrder.id)

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
        <MicButton
          listening={listening}
          onToggle={toggle}
          busy={interpretando}
          label="Dictar datos de la orden"
        />
      </div>

      {borrador && (
        <AvisoDictado
          origen={borrador.resultado.extraccion.origen}
          aviso={borrador.resultado.aviso}
          marcados={campos.marcados.size}
          dudas={dudas}
          faltantes={faltantes}
          supuestos={supuestos}
          onElegir={elegir}
          onRevisado={revisado}
          onArreglar={borrador ? pedirArreglo : undefined}
          arreglando={arreglando}
        />
      )}

      <div
        role="radiogroup"
        aria-label="Tipo de operación"
        className={`grid grid-cols-2 gap-2 rounded-xl bg-slate-100 dark:bg-slate-800 p-1${
          campos.marcados.has('tipo') ? ' ring-1 ring-amber-400 dark:ring-amber-500/60' : ''
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
              editar('tipo')
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
          list="lista-clientes"
          autoComplete="off"
          onChange={(event) => alCambiarParte(event.target.value)}
          placeholder={isCobrar ? 'Ej: Cliente Juan Pérez' : 'Ej: Proveedor Pacheco S.A.C.'}
          className={`field${campos.clase('party')}`}
          {...campos.describe('party')}
        />
        <datalist id="lista-clientes">
          {clientes
            .filter((c) => c.proveedor === !isCobrar)
            .map((c) => (
              <option key={c.id} value={c.nombre} />
            ))}
        </datalist>
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
          onChange={(event) => {
            setPhone(event.target.value)
            editar('phone')
          }}
          placeholder="Ej: 987 654 321"
          className={`field${campos.clase('phone')}`}
          {...campos.describe('phone')}
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
                  editar(`descripcion-${line.key}`)
                }}
                placeholder={index === 0 ? 'Ej: 1,000 volantes A6 couche' : 'Otro trabajo…'}
                aria-label={`Descripción del trabajo ${index + 1}`}
                className={`field flex-1${campos.clase(`descripcion-${line.key}`)}`}
                {...campos.describe(`descripcion-${line.key}`)}
              />
              <input
                value={line.amount}
                onChange={(event) => {
                  setLine(line.key, { amount: event.target.value })
                  editar(`monto-${line.key}`)
                }}
                inputMode="decimal"
                placeholder="0.00"
                aria-label={`Monto del trabajo ${index + 1}`}
                className={`field w-24 shrink-0 text-right font-semibold${campos.clase(`monto-${line.key}`)}`}
                {...campos.describe(`monto-${line.key}`)}
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
          <span className="flex flex-wrap items-center gap-1">
            <button
              type="button"
              onClick={addLine}
              className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] font-bold text-brand-700 dark:text-brand-300 transition-colors hover:bg-brand-50 dark:hover:bg-brand-500/10"
            >
              <i className="fa-solid fa-plus text-[10px]" aria-hidden="true" />
              Agregar trabajo
            </button>
            {productos.length > 0 && (
              <button
                type="button"
                onClick={() => setDelCatalogo(true)}
                className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] font-bold text-brand-700 dark:text-brand-300 transition-colors hover:bg-brand-50 dark:hover:bg-brand-500/10"
              >
                <i className="fa-solid fa-tags text-[10px]" aria-hidden="true" />
                Del catálogo
              </button>
            )}
          </span>
          <p className="text-xs font-bold text-slate-700 dark:text-slate-200">
            Total: <span className="tabular-nums text-slate-900 dark:text-slate-50">{money(total)}</span>
          </p>
        </div>
      </div>

      {/* 4 — Adelanto */}
      <div
        className={`rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-3${
          campos.marcados.has('cobro') ? ' ring-1 ring-amber-400 dark:ring-amber-500/60' : ''
        }`}
        {...campos.describe('cobro')}
      >
        {cobroPorConfirmar && (
          <div role="group" aria-label="Cómo se cobró" className="mb-2.5 flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-bold text-amber-800 dark:text-amber-300">
              La frase no dice cómo se cobró:
            </span>
            {(
              [
                ['Pagó todo', false, ''],
                ['Dejó una parte', true, null],
                ['Al crédito', true, '0'],
              ] as const
            ).map(([texto, parcial, adelanto]) => (
              <button
                key={texto}
                type="button"
                onClick={() => {
                  setPartial(parcial)
                  if (adelanto !== null) setAdvance(adelanto)
                  decidirCobro()
                  campos.quitar('cobro')
                }}
                className="rounded-lg border border-amber-400 bg-white px-2 py-0.5 text-[11px] font-bold text-amber-900 transition-colors hover:bg-amber-100 dark:border-amber-500/50 dark:bg-slate-900 dark:text-amber-200 dark:hover:bg-amber-500/20"
              >
                {texto}
              </button>
            ))}
          </div>
        )}

        <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-200">
          <input
            type="checkbox"
            checked={partial}
            onChange={(event) => {
              setPartial(event.target.checked)
              if (!event.target.checked) setAdvance('')
              editar('cobro')
              decidirCobro()
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
                onChange={(event) => {
                  setAdvance(event.target.value)
                  editar('adelanto')
                  decidirCobro()
                }}
                placeholder="0.00"
                aria-label="Monto adelantado"
                className={`field flex-1 font-bold ${advanceExceeds ? 'border-rose-400 bg-rose-50 dark:bg-rose-500/10' : campos.clase('adelanto')}`}
                {...campos.describe('adelanto')}
              />
              <button
                type="button"
                onClick={() => {
                  setAdvance('0')
                  editar('adelanto')
                  decidirCobro()
                }}
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

      {/* 4b — Entrega (solo trabajos para un cliente, y no al corregir: eso va en Trabajos) */}
      {isCobrar && !editing && (
        <div
          className={`rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950${
            campos.marcados.has('entrega') ? ' ring-1 ring-amber-400 dark:ring-amber-500/60' : ''
          }`}
          {...campos.describe('entrega')}
        >
          <p className="mb-2 text-xs font-semibold text-slate-700 dark:text-slate-200">Entrega</p>
          <div role="radiogroup" aria-label="Entrega" className="flex flex-wrap gap-1.5">
            {(
              [
                ['ya', 'Se lo lleva ya'],
                ['fecha', 'Para el día…'],
                ['pendiente', 'Sin fecha todavía'],
              ] as const
            ).map(([valor, texto]) => (
              <button
                key={valor}
                type="button"
                role="radio"
                aria-checked={modoEntrega === valor}
                onClick={() => {
                  setEntregaModo(valor)
                  editar('entrega')
                }}
                className={`rounded-lg border px-2.5 py-1 text-[11px] font-bold transition-colors ${
                  modoEntrega === valor
                    ? 'border-brand-500 bg-brand-50 text-brand-800 dark:bg-brand-500/10 dark:text-brand-300'
                    : 'border-slate-200 text-slate-500 hover:border-slate-300 dark:border-slate-700 dark:text-slate-400'
                }`}
              >
                {texto}
              </button>
            ))}
          </div>
          {modoEntrega === 'fecha' && (
            <input
              type="date"
              value={entregaFecha}
              min={hoyEnLima()}
              onChange={(event) => {
                setEntregaFecha(event.target.value)
                editar('entrega')
              }}
              aria-label="Día de entrega"
              className={`field mt-2${campos.clase('entrega')}`}
            />
          )}
          <p className="mt-1.5 text-[11px] text-slate-500 dark:text-slate-400">
            {modoEntrega === 'ya'
              ? 'Venta al instante: no pasa por el tablero de Trabajos.'
              : 'Aparece en Trabajos para seguirlo hasta entregarlo.'}
          </p>
        </div>
      )}

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
              editar('categoria')
            }}
            className={`field${campos.clase('categoria')}`}
            {...campos.describe('categoria')}
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
              editar('payment')
            }}
            disabled={advanceValue === 0}
            className={`field disabled:opacity-50${campos.clase('payment')}`}
            {...campos.describe('payment')}
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
            : cobroPorConfirmar
              ? 'Falta decir cómo se cobró'
              : editing
              ? 'Guardar cambios'
              : advanceValue === 0 && total > 0
                ? `Registrar ${money(total)} al crédito`
                : balance > 0
                  ? `Registrar adelanto de ${money(advanceValue)}`
                  : 'Guardar asiento'}
        </button>
      </div>
      {delCatalogo && <ElegirDelCatalogo productos={productos} onElegir={addDelCatalogo} onClose={() => setDelCatalogo(false)} />}
    </form>
  )
}
