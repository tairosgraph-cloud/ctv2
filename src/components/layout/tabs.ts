import type { TabKey } from '@/types'

export interface TabDef {
  key: TabKey
  label: string
  icon: string
  group: 'Espacio Principal' | 'Gestión y Cuentas' | 'Sistema'
  title: string
  subtitle: string
}

export const TABS: TabDef[] = [
  {
    key: 'registro',
    label: 'Registro Contable',
    icon: 'fa-book-bookmark',
    group: 'Espacio Principal',
    title: 'Libro Contable Diario',
    subtitle: 'Registro directo de ingresos y egresos en tiempo real.',
  },
  {
    key: 'movimientos',
    label: 'Movimientos',
    icon: 'fa-arrow-right-arrow-left',
    group: 'Espacio Principal',
    title: 'Historial & Control de Movimientos',
    subtitle: 'Auditoría, métodos de pago, vouchers y flujo de caja.',
  },
  {
    key: 'proformas',
    label: 'Proformas',
    icon: 'fa-file-invoice',
    group: 'Espacio Principal',
    title: 'Proformas y Cotizaciones',
    subtitle: 'Emisión de presupuestos a clientes y conversión en ventas.',
  },
  {
    key: 'deudas',
    label: 'Deudas / Cobros',
    icon: 'fa-hand-holding-dollar',
    group: 'Gestión y Cuentas',
    title: 'Cuentas por Cobrar y por Pagar',
    subtitle: 'Control de deudas de clientes, cuentas a proveedores y abonos.',
  },
  {
    key: 'arqueo',
    label: 'Arqueo de Caja',
    icon: 'fa-chart-pie',
    group: 'Gestión y Cuentas',
    title: 'Arqueo de Caja',
    subtitle: 'Cuadre físico de billetes y monedas contra el saldo del sistema.',
  },
  {
    key: 'configuracion',
    label: 'Configuración',
    icon: 'fa-gear',
    group: 'Sistema',
    title: 'Configuración del Sistema',
    subtitle: 'Datos del negocio, accesos, apariencia y respaldo de la información.',
  },
]

export const GROUPS = ['Espacio Principal', 'Gestión y Cuentas', 'Sistema'] as const

export function tabDef(key: TabKey): TabDef {
  return TABS.find((t) => t.key === key) ?? TABS[0]
}
