/**
 * Banco de pruebas del dictado: pasa frases por el intérprete REAL y enseña
 * qué campos saca. Sirve para medir cobertura sin tener que hablarle a la app.
 *
 *   npm run voz -- "ingreso 500 soles cliente Juan por volantes en Yape"
 *   npm run voz -- --archivo frases.txt
 */
import { readFileSync } from 'node:fs'
import { parseVoiceEntry } from '@/lib/voiceParser'

const args = process.argv.slice(2)
const iArchivo = args.indexOf('--archivo')
const frases =
  iArchivo >= 0
    ? readFileSync(args[iArchivo + 1], 'utf8').split('\n').map((l) => l.trim()).filter(Boolean)
    : [args.join(' ')]

let completas = 0
for (const frase of frases) {
  const r = parseVoiceEntry(frase)
  const faltan: string[] = []
  if (r.amount === null) faltan.push('MONTO')
  if (!r.party) faltan.push('CLIENTE')
  if (!r.payment) faltan.push('MÉTODO')
  if (faltan.length === 0) completas++
  console.log(
    JSON.stringify({
      frase,
      tipo: r.type,
      monto: r.amount,
      cliente: r.party,
      metodo: r.payment,
      categoria: r.category,
      concepto: r.concept,
      faltan,
    }),
  )
}
console.error(`\n${completas}/${frases.length} frases con monto+cliente+método completos`)
