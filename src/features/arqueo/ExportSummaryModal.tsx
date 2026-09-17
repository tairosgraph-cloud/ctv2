import { useMemo, useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import { useToast } from '@/hooks/useToast'
import { copyText } from '@/lib/clipboard'
import { fileStamp, money } from '@/lib/format'
import { useData } from '@/store/DataProvider'

function buildReport(params: {
  ingresos: number
  egresos: number
  balance: number
  porCobrar: number
  porPagar: number
  proformasVigentes: number
  proformasMonto: number
  efectivo: number
  digital: number
  asientos: number
}): string {
  const line = '='.repeat(51)
  const fecha = new Date().toLocaleString('es-PE', {
    dateStyle: 'long',
    timeStyle: 'short',
  })

  return [
    line,
    'TAIROS.RC — RESUMEN EJECUTIVO FINANCIERO',
    `Fecha de emisión: ${fecha}`,
    line,
    '',
    '1. MOVIMIENTOS Y FLUJO DE CAJA',
    `   Total ingresos:        ${money(params.ingresos)}`,
    `   Total egresos:         ${money(params.egresos)}`,
    `   BALANCE NETO:          ${money(params.balance)}`,
    '',
    '2. DESGLOSE POR CUENTA',
    `   Efectivo en caja:      ${money(params.efectivo)}`,
    `   Cuentas digitales:     ${money(params.digital)}`,
    '',
    '3. CUENTAS PENDIENTES',
    `   Por cobrar a clientes: ${money(params.porCobrar)}`,
    `   Por pagar a proveedor: ${money(params.porPagar)}`,
    `   Posición neta:         ${money(params.porCobrar - params.porPagar)}`,
    '',
    '4. COTIZACIONES',
    `   Proformas vigentes:    ${params.proformasVigentes}`,
    `   Monto cotizado:        ${money(params.proformasMonto)}`,
    '',
    '5. AUDITORÍA',
    `   Asientos registrados:  ${params.asientos}`,
    '',
    line,
    'Documento generado automáticamente por Tairos.rc',
    line,
  ].join('\n')
}

export function ExportSummaryModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { stats, transactions } = useData()
  const toast = useToast()
  const [copied, setCopied] = useState(false)

  const report = useMemo(
    () =>
      buildReport({
        ...stats,
        asientos: transactions.filter((t) => t.status !== 'Anulado').length,
      }),
    [stats, transactions],
  )

  const copy = async () => {
    const ok = await copyText(report)
    if (ok) {
      setCopied(true)
      toast.success('Resumen copiado al portapapeles')
      window.setTimeout(() => setCopied(false), 2000)
    } else {
      toast.error('El navegador bloqueó el portapapeles. Selecciona y copia manualmente.')
    }
  }

  const downloadTxt = () => {
    const blob = new Blob(['﻿', report], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `resumen_tairos_${fileStamp()}.txt`
    document.body.appendChild(anchor)
    anchor.click()
    document.body.removeChild(anchor)
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    toast.success('Resumen descargado')
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Resumen ejecutivo"
      subtitle="Listo para enviar por WhatsApp o correo"
      icon="fa-file-export"
      size="lg"
      footer={
        <>
          <button type="button" onClick={downloadTxt} className="btn-ghost">
            <i className="fa-solid fa-download" aria-hidden="true" />
            Descargar .txt
          </button>
          <button type="button" onClick={() => void copy()} className="btn-primary px-5">
            <i className={`fa-solid ${copied ? 'fa-check' : 'fa-copy'}`} aria-hidden="true" />
            {copied ? 'Copiado' : 'Copiar'}
          </button>
        </>
      }
    >
      <pre className="max-h-[45vh] overflow-auto whitespace-pre rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-900 p-4 font-mono text-[11px] leading-relaxed text-brand-100">
        {report}
      </pre>
    </Modal>
  )
}
