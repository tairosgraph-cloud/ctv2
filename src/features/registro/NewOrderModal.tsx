import { Modal } from '@/components/ui/Modal'
import type { Borrador } from '@/hooks/useDictado'
import type { WorkOrder } from '@/types'
import { LedgerForm } from './LedgerForm'

interface Props {
  open: boolean
  onClose: () => void
  /** Si viene, el modal corrige ese pedido en vez de crear uno nuevo. */
  editing?: WorkOrder | null
  /** Si viene, el formulario arranca con lo dictado. */
  dictado?: Borrador | null
  /** Pedido nuevo para un cliente ya elegido. */
  paraCliente?: { nombre: string; telefono: string } | null
}

/**
 * El formulario de registro vive aquí, encima del libro, en vez de robarle
 * ancho a la tabla. Sirve para las dos cosas: registrar una orden nueva y
 * corregir una ya guardada.
 */
export function NewOrderModal({ open, onClose, editing = null, dictado = null, paraCliente = null }: Props) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? 'Corregir orden' : dictado ? 'Orden dictada' : 'Nueva orden'}
      subtitle={
        editing
          ? 'Se reajustan el asiento y el saldo pendiente'
          : 'Trabajos, adelanto y saldo en un solo registro'
      }
      icon={editing ? 'fa-pen' : 'fa-file-pen'}
    >
      {/* key fuerza un formulario limpio al cambiar de pedido o de dictado */}
      <LedgerForm
        key={editing?.id ?? (dictado ? `dictado-${dictado.id}` : 'nuevo')}
        editing={editing}
        dictado={dictado}
        paraCliente={paraCliente}
        onSaved={onClose}
        onCancel={onClose}
      />
    </Modal>
  )
}
