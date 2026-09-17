import { Modal } from '@/components/ui/Modal'
import type { WorkOrder } from '@/types'
import { LedgerForm } from './LedgerForm'

interface Props {
  open: boolean
  onClose: () => void
  /** Si viene, el modal corrige ese pedido en vez de crear uno nuevo. */
  editing?: WorkOrder | null
}

/**
 * El formulario de registro vive aquí, encima del libro, en vez de robarle
 * ancho a la tabla. Sirve para las dos cosas: registrar una orden nueva y
 * corregir una ya guardada.
 */
export function NewOrderModal({ open, onClose, editing = null }: Props) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? 'Corregir orden' : 'Nuevo Orden'}
      subtitle={
        editing
          ? 'Se reajustan el asiento y el saldo pendiente'
          : 'Trabajos, adelanto y saldo en un solo registro'
      }
      icon={editing ? 'fa-pen' : 'fa-file-pen'}
    >
      {/* key fuerza un formulario limpio al cambiar de pedido */}
      <LedgerForm
        key={editing?.id ?? 'nuevo'}
        editing={editing}
        onSaved={onClose}
        onCancel={onClose}
      />
    </Modal>
  )
}
