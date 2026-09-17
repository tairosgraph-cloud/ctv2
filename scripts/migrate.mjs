#!/usr/bin/env node
/**
 * Aplicador de migraciones.
 *
 * Aplica los .sql de supabase/migrations que aún no estén en la base y anota
 * cuáles fueron, para que la próxima vez sepa dónde retomar. Antes esto se
 * hacía a mano, que funciona la primera vez y falla a la décima.
 *
 * Credenciales: NINGUNA vive aquí ni en el repositorio.
 *   - La conexión sale de DATABASE_URL (del entorno o de .env.db, ignorado por git).
 *   - La contraseña la resuelve psql desde ~/.pgpass, fuera del proyecto.
 *
 * Uso:
 *   npm run db:status     ver qué está aplicado y qué falta
 *   npm run db:migrate    aplicar lo pendiente
 *   npm run db:baseline   adoptar una base que YA tiene el esquema: anota todo
 *                         como aplicado sin ejecutarlo. Solo la primera vez,
 *                         sobre una base cuyo esquema ya coincide.
 */
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const DIRECTORIO = 'supabase/migrations'
const TABLA = 'public.schema_migrations'

function leerUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL
  if (existsSync('.env.db')) {
    for (const linea of readFileSync('.env.db', 'utf8').split('\n')) {
      const m = linea.match(/^\s*DATABASE_URL\s*=\s*(.+?)\s*$/)
      if (m) return m[1].replace(/^["']|["']$/g, '')
    }
  }
  console.error(
    'Falta DATABASE_URL. Ponla en el entorno o en .env.db (ignorado por git).\n' +
      'Formato, SIN contraseña — esa la pone ~/.pgpass:\n' +
      '  DATABASE_URL=postgresql://usuario@host:5432/postgres?sslmode=require',
  )
  process.exit(1)
}

const URL_BD = leerUrl()

/** Ejecuta SQL y devuelve la salida en crudo. */
const sql = (texto) =>
  execFileSync('psql', [URL_BD, '-v', 'ON_ERROR_STOP=1', '-tAq', '-c', texto], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })

/** Ejecuta un archivo entero dentro de UNA transacción: o entra todo o nada. */
const sqlArchivo = (ruta) =>
  execFileSync('psql', [URL_BD, '-v', 'ON_ERROR_STOP=1', '-q', '--single-transaction', '-f', ruta], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })

const huella = (ruta) => createHash('sha256').update(readFileSync(ruta)).digest('hex').slice(0, 16)

sql(`create table if not exists ${TABLA} (
       version    text primary key,
       checksum   text not null,
       applied_at timestamptz not null default now()
     )`)

const archivos = readdirSync(DIRECTORIO)
  .filter((n) => n.endsWith('.sql'))
  .sort()

const aplicadas = new Map(
  sql(`select version || '|' || checksum from ${TABLA}`)
    .split('\n')
    .filter(Boolean)
    .map((l) => l.split('|')),
)

const soloEstado = process.argv.includes('--status')
const adoptar = process.argv.includes('--baseline')

if (adoptar) {
  // Reaplicar migraciones sobre un esquema que ya las tiene no es inocuo: por
  // ejemplo 0001 recrea una vista que 0002 amplía, y Postgres lo rechaza. Lo
  // correcto al adoptar una base existente es registrar, no ejecutar.
  for (const nombre of archivos) {
    const actual = huella(join(DIRECTORIO, nombre))
    sql(
      `insert into ${TABLA} (version, checksum) values ('${nombre}', '${actual}')
       on conflict (version) do update set checksum = excluded.checksum`,
    )
    console.log(`  registrada  ${nombre}`)
  }
  console.log(`\n${archivos.length} migraciones registradas como aplicadas. Nada se ejecutó.`)
  process.exit(0)
}
let pendientes = 0
let alteradas = 0

for (const nombre of archivos) {
  const ruta = join(DIRECTORIO, nombre)
  const actual = huella(ruta)
  const previa = aplicadas.get(nombre)

  if (previa === undefined) {
    pendientes++
    if (soloEstado) {
      console.log(`  pendiente  ${nombre}`)
      continue
    }
    process.stdout.write(`  aplicando  ${nombre} … `)
    try {
      sqlArchivo(ruta)
      sql(`insert into ${TABLA} (version, checksum) values ('${nombre}', '${actual}')`)
      console.log('ok')
    } catch (error) {
      console.log('FALLÓ')
      console.error(String(error.stderr || error.message).trim())
      process.exit(1)
    }
  } else if (previa !== actual) {
    // Editar una migración ya aplicada es la forma clásica de que dos entornos
    // acaben con esquemas distintos sin que nadie se entere.
    alteradas++
    console.log(`  ⚠ ALTERADA  ${nombre} — se aplicó con otro contenido; crea una nueva migración`)
  } else if (soloEstado) {
    console.log(`  aplicada   ${nombre}`)
  }
}

if (soloEstado) {
  console.log(`\n${archivos.length} migraciones · ${pendientes} pendientes · ${alteradas} alteradas`)
} else {
  console.log(pendientes === 0 ? '\nNada pendiente: la base está al día.' : `\n${pendientes} aplicadas.`)
}
process.exit(alteradas > 0 ? 1 : 0)
