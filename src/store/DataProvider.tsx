import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { db } from '@/data'
import { buildCashArqueo } from '@/lib/cashArqueo'
import { buildProformaBriefing } from '@/lib/proformas'
import { APP_USER, isSupabaseConfigured } from '@/lib/supabase'
import type {
  CashClosing,
  Debt,
  NewDebt,
  NewProforma,
  UpdateProforma,
  UpdateDebt,
  NewTransaction,
  NewWorkOrder,
  UpdateWorkOrder,
  PaymentMethod,
  Proforma,
  Transaction,
  WorkOrder,
  WorkOrderResult,
} from '@/types'

export interface Stats {
  ingresos: number
  egresos: number
  balance: number
  porCobrar: number
  porPagar: number
  proformasVigentes: number
  proformasMonto: number
  efectivo: number
  digital: number
}

interface DataContextValue {
  transactions: Transaction[]
  proformas: Proforma[]
  debts: Debt[]
  workOrders: WorkOrder[]
  closings: CashClosing[]
  stats: Stats
  loading: boolean
  error: string | null
  mode: 'supabase' | 'local'
  refresh: () => Promise<void>

  addTransaction: (input: NewTransaction) => Promise<Transaction>
  /** Registra un pedido completo (trabajos + adelanto + saldo). */
  registerWorkOrder: (input: Omit<NewWorkOrder, 'author'>) => Promise<WorkOrderResult>
  /** Corrige un pedido ya registrado y reajusta su asiento y su saldo. */
  editWorkOrder: (id: string, input: UpdateWorkOrder) => Promise<WorkOrderResult>
  /** Busca el pedido de origen de un asiento o de una deuda. */
  workOrderById: (id: string | null) => WorkOrder | null
  voidTransaction: (id: string) => Promise<void>
  removeTransaction: (id: string) => Promise<void>

  addProforma: (input: NewProforma) => Promise<Proforma>
  editProforma: (id: string, input: UpdateProforma) => Promise<Proforma>
  anularProforma: (id: string) => Promise<Proforma>
  cobrarProforma: (id: string, payment: PaymentMethod) => Promise<void>

  addDebt: (input: NewDebt) => Promise<Debt>
  editDebt: (id: string, input: UpdateDebt) => Promise<Debt>
  borrarAbono: (paymentId: string) => Promise<void>
  abonarDeuda: (debtId: string, amount: number, method: PaymentMethod) => Promise<void>

  registrarCierre: (countedCash: number, openingCash: number, notes: string) => Promise<CashClosing>
}

const DataContext = createContext<DataContextValue | null>(null)

/** Los asientos anulados no cuentan para ningun total. */
const isActive = (t: Transaction) => t.status !== 'Anulado'

function computeStats(
  transactions: Transaction[],
  proformas: Proforma[],
  debts: Debt[],
): Stats {
  let ingresos = 0
  let egresos = 0
  let efectivo = 0
  let digital = 0

  for (const t of transactions) {
    if (!isActive(t)) continue
    const signed = t.type === 'Ingreso' ? t.amount : -t.amount
    if (t.type === 'Ingreso') ingresos += t.amount
    else egresos += t.amount
    if (t.payment === 'Efectivo') efectivo += signed
    else digital += signed
  }

  let porCobrar = 0
  let porPagar = 0
  for (const d of debts) {
    if (d.kind === 'COBRAR') porCobrar += d.balance
    else porPagar += d.balance
  }

  // Vigente es solo el estado en el papel: una cotización fuera de plazo lo
  // conserva para siempre y hasta ahora se contaba como dinero en juego.
  const { vivas, montoVivas } = buildProformaBriefing(proformas)

  return {
    ingresos,
    egresos,
    balance: ingresos - egresos,
    porCobrar,
    porPagar,
    proformasVigentes: vivas.length,
    proformasMonto: montoVivas,
    efectivo,
    digital,
  }
}

export function DataProvider({ children }: { children: ReactNode }) {
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [proformas, setProformas] = useState<Proforma[]>([])
  const [debts, setDebts] = useState<Debt[]>([])
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([])
  const [closings, setClosings] = useState<CashClosing[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setError(null)
    try {
      const [tx, pf, dd, wo, cc] = await Promise.all([
        db.listTransactions(),
        db.listProformas(),
        db.listDebts(),
        db.listWorkOrders(),
        db.listClosings(),
      ])
      setTransactions(tx)
      setProformas(pf)
      setDebts(dd)
      setWorkOrders(wo)
      setClosings(cc)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error desconocido'
      setError(
        isSupabaseConfigured
          ? `No se pudo leer de Supabase: ${message}. Revisa que hayas ejecutado supabase/migrations/0001_init.sql.`
          : message,
      )
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const addTransaction = useCallback(
    async (input: NewTransaction) => {
      const tx = await db.createTransaction({ ...input, author: input.author || APP_USER })
      await refresh()
      return tx
    },
    [refresh],
  )

  const registerWorkOrder = useCallback(
    async (input: Omit<NewWorkOrder, 'author'>) => {
      const result = await db.registerWorkOrder({ ...input, author: APP_USER })
      await refresh()
      return result
    },
    [refresh],
  )

  const editWorkOrder = useCallback(
    async (id: string, input: UpdateWorkOrder) => {
      const result = await db.updateWorkOrder(id, input)
      await refresh()
      return result
    },
    [refresh],
  )

  const workOrderById = useCallback(
    (id: string | null) => (id ? (workOrders.find((w) => w.id === id) ?? null) : null),
    [workOrders],
  )

  const voidTransaction = useCallback(
    async (id: string) => {
      await db.voidTransaction(id)
      await refresh()
    },
    [refresh],
  )

  const removeTransaction = useCallback(
    async (id: string) => {
      await db.deleteTransaction(id)
      await refresh()
    },
    [refresh],
  )

  const addProforma = useCallback(
    async (input: NewProforma) => {
      const pf = await db.createProforma(input)
      await refresh()
      return pf
    },
    [refresh],
  )

  const editProforma = useCallback(
    async (id: string, input: UpdateProforma) => {
      const pf = await db.updateProforma(id, input)
      await refresh()
      return pf
    },
    [refresh],
  )

  const anularProforma = useCallback(
    async (id: string) => {
      const pf = await db.annulProforma(id)
      await refresh()
      return pf
    },
    [refresh],
  )

  const cobrarProforma = useCallback(
    async (id: string, payment: PaymentMethod) => {
      await db.convertProforma(id, payment, APP_USER)
      await refresh()
    },
    [refresh],
  )

  const addDebt = useCallback(
    async (input: NewDebt) => {
      const debt = await db.createDebt(input)
      await refresh()
      return debt
    },
    [refresh],
  )

  const editDebt = useCallback(
    async (id: string, input: UpdateDebt) => {
      const debt = await db.updateDebt(id, input)
      await refresh()
      return debt
    },
    [refresh],
  )

  const borrarAbono = useCallback(
    async (paymentId: string) => {
      await db.deleteDebtPayment(paymentId)
      await refresh()
    },
    [refresh],
  )

  const abonarDeuda = useCallback(
    async (debtId: string, amount: number, method: PaymentMethod) => {
      await db.payDebt(debtId, amount, method, APP_USER)
      await refresh()
    },
    [refresh],
  )

  const registrarCierre = useCallback(
    async (countedCash: number, openingCash: number, notes: string) => {
      // Misma regla que muestra el arqueo en pantalla: el fondo de apertura ya
      // contiene todo lo anterior al último cierre, así que solo se suma el
      // efectivo movido después de él.
      const { expectedCash } = buildCashArqueo(transactions, closings, openingCash)

      const closing = await db.createClosing({
        countedCash,
        expectedCash,
        openingCash,
        notes,
        author: APP_USER,
      })
      await refresh()
      return closing
    },
    [refresh, transactions, closings],
  )

  const stats = useMemo(
    () => computeStats(transactions, proformas, debts),
    [transactions, proformas, debts],
  )

  const value = useMemo<DataContextValue>(
    () => ({
      transactions,
      proformas,
      debts,
      workOrders,
      closings,
      stats,
      loading,
      error,
      mode: db.mode,
      refresh,
      addTransaction,
      registerWorkOrder,
      editWorkOrder,
      workOrderById,
      voidTransaction,
      removeTransaction,
      addProforma,
      editProforma,
      anularProforma,
      cobrarProforma,
      addDebt,
      editDebt,
      borrarAbono,
      abonarDeuda,
      registrarCierre,
    }),
    [
      transactions,
      proformas,
      debts,
      workOrders,
      closings,
      stats,
      loading,
      error,
      refresh,
      addTransaction,
      registerWorkOrder,
      editWorkOrder,
      workOrderById,
      voidTransaction,
      removeTransaction,
      addProforma,
      editProforma,
      anularProforma,
      cobrarProforma,
      addDebt,
      editDebt,
      borrarAbono,
      abonarDeuda,
      registrarCierre,
    ],
  )

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>
}

export function useData(): DataContextValue {
  const ctx = useContext(DataContext)
  if (!ctx) throw new Error('useData debe usarse dentro de <DataProvider>')
  return ctx
}
