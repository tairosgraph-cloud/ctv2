/**
 * Mensajes de WhatsApp listos para enviar. Con un enlace wa.me: cuesta cero,
 * no hace falta cuenta de empresa ni API, y lo envía una persona (que puede
 * leerlo y cambiarlo antes). Sin número, WhatsApp deja elegir el chat.
 */
import { expiryDate, money } from '@/lib/format'
import type { Proforma, WorkOrder } from '@/types'

/** Un celular peruano en formato internacional (51 + 9 cifras), o null. */
export function numeroPeruano(telefono: string | null | undefined): string | null {
  const cifras = (telefono ?? '').replace(/\D/g, '')
  if (/^9\d{8}$/.test(cifras)) return `51${cifras}`
  if (/^519\d{8}$/.test(cifras)) return cifras
  return null
}

export function enlaceWhatsApp(telefono: string | null | undefined, texto: string): string {
  const numero = numeroPeruano(telefono)
  return `https://wa.me/${numero ?? ''}?text=${encodeURIComponent(texto)}`
}

const resumen = (pedido: WorkOrder) => pedido.items.map((i) => i.description).join(' + ')

export const mensaje = {
  listo: (pedido: WorkOrder, saldo: number) =>
    `Hola ${pedido.party}, tu pedido (${resumen(pedido)}) ya está listo para recoger.` +
    (saldo > 0 ? ` Queda un saldo de ${money(saldo)}.` : '') +
    ' ¡Gracias!',
  /** Para pedir el visto bueno del diseño: la imagen se adjunta en WhatsApp. */
  prueba: (pedido: WorkOrder) =>
    `Hola ${pedido.party}, te envío la prueba de tu pedido (${resumen(pedido)}). ` +
    '¿Me confirmas si está bien para imprimir? Si hay que cambiar algo, dime qué.',
  saldo: (parte: string, concepto: string, saldo: number) =>
    `Hola ${parte}, te recordamos que queda un saldo de ${money(saldo)} por ${concepto.replace(/^Saldo de:\s*/i, '')}. ¡Gracias!`,
  proforma: (pf: Proforma) =>
    `Hola ${pf.client}, te envío la cotización ${pf.code}: ${pf.detail}, por ${money(pf.total)}. ` +
    `Vale hasta el ${expiryDate(pf.issuedAt, pf.validityDays)}.`,
}
