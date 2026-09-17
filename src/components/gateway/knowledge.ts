import { briefingToSpeech, type DebtBriefing } from '@/lib/debtAlerts'

export interface Topic {
  key: string
  label: string
  icon: string
  answer: string
}

export const GREETING =
  '¡Bienvenido a Tairos! Puedes gestionar tus proformas, deudas, arqueos de caja y exportar tu resumen contable en tiempo real.'

export const TOPICS: Topic[] = [
  {
    key: 'que_es',
    label: '¿Qué es Tairos?',
    icon: 'fa-circle-question',
    answer:
      'Tairos punto ere ce es un sistema comercial con voz que mantiene tu registro diario, proformas y deudas sincronizados en tiempo real.',
  },
  {
    key: 'movimientos',
    label: 'Movimientos',
    icon: 'fa-arrow-right-arrow-left',
    answer:
      'En Movimientos ingresan todas las operaciones auditables con trazabilidad de Yape, transferencias, efectivo y estados de pago.',
  },
  {
    key: 'proformas',
    label: 'Proformas',
    icon: 'fa-file-invoice',
    answer:
      'Puedes crear cotizaciones para clientes y, con un solo clic, convertirlas en ingresos registrados en tu diario contable.',
  },
  {
    key: 'deudas',
    label: 'Deudas y abonos',
    icon: 'fa-hand-holding-dollar',
    answer:
      'El módulo de deudas gestiona cuentas por cobrar a clientes y por pagar a proveedores, con registro de abonos parciales.',
  },
  {
    key: 'arqueo',
    label: 'Arqueo de caja',
    icon: 'fa-chart-pie',
    answer:
      'El arqueo compara el efectivo que cuentas físicamente contra el saldo que calcula el sistema, e informa si hay sobrante o faltante.',
  },
  {
    key: 'dictado',
    label: 'Dictado por voz',
    icon: 'fa-microphone-lines',
    answer:
      'Presiona el micrófono y di, por ejemplo: ingreso quinientos soles cliente Juan por volantes en Yape. El sistema autocompletará el formulario.',
  },
]

const FALLBACK =
  'Puedo explicarte el registro contable, los movimientos, las proformas, las deudas con abonos parciales y el arqueo de caja. Elige un tema o pregúntame por uno de ellos.'

/**
 * Busca la mejor respuesta local para una pregunta libre.
 *
 * El prototipo llamaba a la API de Gemini con una clave vacía; aquí la base de
 * conocimiento vive en el cliente, así que responde al instante y sin costo.
 */
export function answerQuestion(question: string, briefing?: DebtBriefing): string {
  const q = question
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')

  const matchers: Array<[RegExp, string]> = [
    [/proforma|cotiza|presupuesto/, 'proformas'],
    [/deud|debe|debo|cobr|pagar|pago de|abono|credito|fiado|moroso|saldo|pendiente/, 'deudas'],
    [/arqueo|caja|efectivo|cuadre|cierre/, 'arqueo'],
    [/movimiento|historial|auditor|voucher|comprobante/, 'movimientos'],
    [/voz|dictad|microfono|hablar/, 'dictado'],
    [/que es|quien eres|para que sirve|tairos/, 'que_es'],
  ]

  for (const [pattern, key] of matchers) {
    if (!pattern.test(q)) continue

    // Sobre deudas y cobros el asistente responde con tus cifras reales,
    // no con la explicación genérica del módulo.
    if (key === 'deudas' && briefing && briefing.pendientes > 0) {
      return briefingToSpeech(briefing)
    }

    const topic = TOPICS.find((t) => t.key === key)
    if (topic) return topic.answer
  }

  return FALLBACK
}
