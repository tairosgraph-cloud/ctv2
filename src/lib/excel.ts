import type { Borders, Workbook, Worksheet } from 'exceljs'

/**
 * Generación de archivos .xlsx.
 *
 * ExcelJS pesa unos 250 kB, así que se carga con `import()` dinámico: no entra
 * en el arranque de la app, solo cuando pulsas exportar. Vite lo deja en su
 * propio trozo.
 */
async function cargarExcel() {
  const mod = await import('exceljs')
  return mod.default ?? mod
}

// --- paleta y formatos, para que todas las hojas salgan iguales -------------

const VERDE = 'FF0A5C53' // brand-800
const VERDE_SUAVE = 'FFE8F5F2'
const GRIS_CEBRA = 'FFF7FAFC'
const TEXTO = 'FF1E293B'
const TENUE = 'FF64748B'

export const FORMATO_SOLES = '"S/" #,##0.00'
const FORMATO_FECHA = 'dd/mm/yyyy hh:mm'

const BORDE_FINO: Partial<Borders> = {
  top: { style: 'hair', color: { argb: 'FFCBD5E1' } },
  left: { style: 'hair', color: { argb: 'FFCBD5E1' } },
  bottom: { style: 'hair', color: { argb: 'FFCBD5E1' } },
  right: { style: 'hair', color: { argb: 'FFCBD5E1' } },
}

export interface Columna {
  titulo: string
  ancho: number
  /** 'soles' aplica formato de moneda; 'fecha' formatea la marca de tiempo. */
  formato?: 'soles' | 'fecha' | 'texto'
  alinear?: 'left' | 'center' | 'right'
}

/**
 * Prepara una hoja: título, cabecera con estilo, filas cebra, anchos,
 * panel congelado, filtro, y el ajuste de página con márgenes para que salga
 * decente al imprimir o al pasarla a PDF.
 */
export function montarHoja(
  ws: Worksheet,
  opciones: {
    titulo: string
    subtitulo?: string
    columnas: Columna[]
    filas: (string | number | Date | null)[][]
    apaisado?: boolean
  },
): Worksheet {
  const { titulo, subtitulo, columnas, filas, apaisado = true } = opciones
  const ultima = columnas.length

  ws.pageSetup = {
    paperSize: 9, // A4
    orientation: apaisado ? 'landscape' : 'portrait',
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    horizontalCentered: true,
    margins: { left: 0.45, right: 0.45, top: 0.6, bottom: 0.5, header: 0.25, footer: 0.25 },
  }
  ws.headerFooter = {
    oddFooter: '&LTairos.rc&CPágina &P de &N&R&D',
  }

  // --- título ---
  ws.mergeCells(1, 1, 1, ultima)
  const celdaTitulo = ws.getCell(1, 1)
  celdaTitulo.value = `TAIROS.RC — ${titulo.toUpperCase()}`
  celdaTitulo.font = { name: 'Calibri', bold: true, size: 15, color: { argb: VERDE } }
  celdaTitulo.alignment = { vertical: 'middle' }
  ws.getRow(1).height = 26

  ws.mergeCells(2, 1, 2, ultima)
  const celdaSub = ws.getCell(2, 1)
  celdaSub.value =
    subtitulo ?? `Emitido el ${new Date().toLocaleString('es-PE')} · ${filas.length} registros`
  celdaSub.font = { name: 'Calibri', size: 9, italic: true, color: { argb: TENUE } }
  ws.getRow(3).height = 6

  // --- cabecera ---
  const cabecera = ws.getRow(4)
  columnas.forEach((col, i) => {
    const celda = cabecera.getCell(i + 1)
    celda.value = col.titulo
    celda.font = { name: 'Calibri', bold: true, size: 10, color: { argb: 'FFFFFFFF' } }
    celda.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: VERDE } }
    celda.alignment = { vertical: 'middle', horizontal: col.alinear ?? 'left', wrapText: true }
    celda.border = BORDE_FINO
  })
  cabecera.height = 22

  // --- datos ---
  filas.forEach((fila, indice) => {
    const row = ws.getRow(5 + indice)
    columnas.forEach((col, i) => {
      const celda = row.getCell(i + 1)
      celda.value = fila[i] ?? ''
      celda.font = { name: 'Calibri', size: 10, color: { argb: TEXTO } }
      celda.border = BORDE_FINO
      celda.alignment = {
        vertical: 'top',
        horizontal: col.alinear ?? (col.formato === 'soles' ? 'right' : 'left'),
        wrapText: col.formato !== 'soles',
      }
      if (col.formato === 'soles') celda.numFmt = FORMATO_SOLES
      if (col.formato === 'fecha') celda.numFmt = FORMATO_FECHA
      if (indice % 2 === 1) {
        celda.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GRIS_CEBRA } }
      }
    })
  })

  ws.columns = columnas.map((c) => ({ width: c.ancho }))
  ws.views = [{ state: 'frozen', ySplit: 4 }]

  if (filas.length > 0) {
    ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: ultima } }
    // La cabecera se repite en cada página impresa.
    ws.pageSetup.printTitlesRow = '4:4'
  }

  return ws
}

/** Bloque de etiqueta y valor, para la hoja de resumen. */
export function filaResumen(
  ws: Worksheet,
  fila: number,
  etiqueta: string,
  valor: string | number,
  opciones: { destacar?: boolean; soles?: boolean } = {},
): void {
  const { destacar = false, soles = false } = opciones

  const celdaEtiqueta = ws.getCell(fila, 1)
  celdaEtiqueta.value = etiqueta
  celdaEtiqueta.font = {
    name: 'Calibri',
    size: destacar ? 11 : 10,
    bold: destacar,
    color: { argb: destacar ? VERDE : TEXTO },
  }

  const celdaValor = ws.getCell(fila, 2)
  celdaValor.value = valor
  celdaValor.font = {
    name: 'Calibri',
    size: destacar ? 12 : 10,
    bold: destacar,
    color: { argb: destacar ? VERDE : TEXTO },
  }
  celdaValor.alignment = { horizontal: 'right' }
  if (soles) celdaValor.numFmt = FORMATO_SOLES

  if (destacar) {
    for (const columna of [1, 2]) {
      ws.getCell(fila, columna).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: VERDE_SUAVE },
      }
      ws.getCell(fila, columna).border = {
        top: { style: 'thin', color: { argb: VERDE } },
        bottom: { style: 'thin', color: { argb: VERDE } },
      }
    }
  }
}

/** Crea un libro con las propiedades comunes ya puestas. */
export async function nuevoLibro(titulo: string): Promise<Workbook> {
  const ExcelJS = await cargarExcel()
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Tairos.rc'
  wb.created = new Date()
  wb.title = titulo
  wb.company = 'Tairos.rc'
  return wb
}

/** Descarga el libro como .xlsx. */
export async function descargarLibro(wb: Workbook, nombre: string): Promise<void> {
  const buffer = await wb.xlsx.writeBuffer()
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const url = URL.createObjectURL(blob)
  const enlace = document.createElement('a')
  enlace.href = url
  enlace.download = nombre.endsWith('.xlsx') ? nombre : `${nombre}.xlsx`
  document.body.appendChild(enlace)
  enlace.click()
  document.body.removeChild(enlace)
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
