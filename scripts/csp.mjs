#!/usr/bin/env node
/**
 * La política de contenido (CSP) del sitio publicado, calculada y comprobada.
 *
 *   node scripts/csp.mjs            comprueba (lo corre el build de Vercel y CI)
 *   node scripts/csp.mjs --escribir la escribe en vercel.json y netlify.toml
 *
 * index.html lleva un script en línea (el tema antes del primer pintado). La
 * CSP lo permite por su huella SHA-256, no con 'unsafe-inline': si alguien lo
 * cambia y no actualiza la huella, el navegador lo bloquearía en silencio. Por
 * eso este script corre después de `vite build` y falla si la huella del
 * dist/index.html no es la que dicen los archivos de despliegue.
 *
 * La app solo habla con su propio dominio y con su proyecto de Supabase: eso
 * es todo lo que la política permite.
 */
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'

const escribir = process.argv.includes('--escribir')

const html = readFileSync('dist/index.html', 'utf8')
const huellas = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(
  (m) => `'sha256-${createHash('sha256').update(m[1]).digest('base64')}'`,
)

const vercel = JSON.parse(readFileSync('vercel.json', 'utf8'))
const supabase = process.env.VITE_SUPABASE_URL || vercel.build?.env?.VITE_SUPABASE_URL
if (!supabase || !/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(supabase)) {
  console.error('csp: falta VITE_SUPABASE_URL (en el entorno o en vercel.json) con la forma https://<ref>.supabase.co')
  process.exit(1)
}

export const POLITICA = [
  "default-src 'self'",
  `script-src 'self' ${huellas.join(' ')}`.trim(),
  // React escribe estilos por el DOM (eso no lo limita la CSP), pero alguna
  // librería puede inyectar <style>: se permite, el riesgo es mínimo.
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self' ${supabase} ${supabase.replace('https://', 'wss://')}`,
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ')

const OTRAS = {
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  // El dictado necesita el micrófono, y solo este sitio.
  'Permissions-Policy': 'microphone=(self), camera=(), geolocation=(), payment=(), usb=()',
}

const cabeceras = { 'Content-Security-Policy': POLITICA, ...OTRAS }

if (escribir) {
  const bloque = { source: '/(.*)', headers: Object.entries(cabeceras).map(([key, value]) => ({ key, value })) }
  vercel.headers = [bloque, ...(vercel.headers ?? []).filter((h) => h.source !== '/(.*)')]
  writeFileSync('vercel.json', `${JSON.stringify(vercel, null, 2)}\n`)

  const toml = readFileSync('netlify.toml', 'utf8')
  const inicio = '# >>> cabeceras de seguridad (las escribe scripts/csp.mjs --escribir)'
  const fin = '# <<< cabeceras de seguridad'
  const nuevo = [
    inicio,
    '[[headers]]',
    '  for = "/*"',
    '  [headers.values]',
    ...Object.entries(cabeceras).map(([k, v]) => `    ${k} = ${JSON.stringify(v)}`),
    fin,
  ].join('\n')
  const conBloque = toml.includes(inicio)
    ? toml.replace(new RegExp(`${inicio}[\\s\\S]*?${fin}`), nuevo)
    : `${toml.trimEnd()}\n\n${nuevo}\n`
  writeFileSync('netlify.toml', conBloque)
  console.log(`csp: escrita en vercel.json y netlify.toml (${huellas.length} script en línea)`)
  process.exit(0)
}

const publicada = vercel.headers
  ?.find((h) => h.source === '/(.*)')
  ?.headers.find((h) => h.key === 'Content-Security-Policy')?.value
const toml = readFileSync('netlify.toml', 'utf8')
const errores = []
if (publicada !== POLITICA) errores.push('vercel.json')
if (!toml.includes(JSON.stringify(POLITICA))) errores.push('netlify.toml')
if (errores.length) {
  console.error(
    `csp: la política de ${errores.join(' y ')} no coincide con dist/index.html.\n` +
      '  ¿Cambió el script en línea de index.html? Ejecuta: npm run build && node scripts/csp.mjs --escribir',
  )
  process.exit(1)
}
console.log(`csp: correcta (${huellas.length} script en línea con su huella)`)
