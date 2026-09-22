#!/usr/bin/env node
/**
 * Aplicador de migraciones.
 *
 * Aplica los .sql de supabase/migrations que aún no estén en la base y anota
 * cuáles fueron, para que la próxima vez sepa dónde retomar.
 *
 * Cada migración entra en UNA transacción junto con su anotación: o se aplica
 * y queda registrada, o no pasa nada. Los .sql no llevan begin/commit propios.
 *
 * Credenciales: NINGUNA vive aquí ni en el repositorio (ver scripts/bd.mjs).
 *
 * Uso:
 *   npm run db:status     ver qué está aplicado y qué falta
 *   npm run db:migrate    aplicar lo pendiente
 *   npm run db:baseline   adoptar una base que YA tiene el esquema: anota todo
 *                         como aplicado sin ejecutarlo. Solo la primera vez,
 *                         sobre una base cuyo esquema ya coincide.
 */
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { conectar } from './bd.mjs'

const DIRECTORIO = 'supabase/migrations'
const TABLA = 'public.schema_migrations'

const huella = (ruta) => createHash('sha256').update(readFileSync(ruta)).digest('hex').slice(0, 16)

const soloEstado = process.argv.includes('--status')
const adoptar = process.argv.includes('--baseline')

const bd = await conectar()
let codigo = 0
try {
  await bd.query(`create table if not exists ${TABLA} (
    version    text primary key,
    checksum   text not null,
    applied_at timestamptz not null default now()
  )`)

  const archivos = readdirSync(DIRECTORIO)
    .filter((n) => n.endsWith('.sql'))
    .sort()
  const { rows } = await bd.query(`select version, checksum from ${TABLA}`)
  const aplicadas = new Map(rows.map((r) => [r.version, r.checksum]))

  if (adoptar) {
    // Reaplicar migraciones sobre un esquema que ya las tiene no es inocuo: por
    // ejemplo 0001 recrea una vista que 0002 amplía, y Postgres lo rechaza. Lo
    // correcto al adoptar una base existente es registrar, no ejecutar.
    for (const nombre of archivos) {
      await bd.query(
        `insert into ${TABLA} (version, checksum) values ($1, $2)
         on conflict (version) do update set checksum = excluded.checksum`,
        [nombre, huella(join(DIRECTORIO, nombre))],
      )
      console.log(`  registrada  ${nombre}`)
    }
    console.log(`\n${archivos.length} migraciones registradas como aplicadas. Nada se ejecutó.`)
  } else {
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
          await bd.query('begin')
          await bd.query(readFileSync(ruta, 'utf8'))
          await bd.query(`insert into ${TABLA} (version, checksum) values ($1, $2)`, [nombre, actual])
          await bd.query('commit')
          console.log('ok')
        } catch (error) {
          await bd.query('rollback').catch(() => undefined)
          console.log('FALLÓ (no se aplicó nada de este archivo)')
          console.error(`  ${error.message}${error.position ? ` (posición ${error.position})` : ''}`)
          codigo = 1
          break
        }
      } else if (previa !== actual) {
        // Editar una migración ya aplicada es la forma clásica de que dos
        // entornos acaben con esquemas distintos sin que nadie se entere.
        alteradas++
        console.log(`  ⚠ ALTERADA  ${nombre} — se aplicó con otro contenido; crea una nueva migración`)
      } else if (soloEstado) {
        console.log(`  aplicada   ${nombre}`)
      }
    }

    if (soloEstado) {
      console.log(`\n${archivos.length} migraciones · ${pendientes} pendientes · ${alteradas} alteradas`)
    } else if (!codigo) {
      console.log(pendientes === 0 ? '\nNada pendiente: la base está al día.' : `\n${pendientes} aplicadas.`)
    }
    if (alteradas > 0) codigo = 1
  }
} finally {
  await bd.end()
}
process.exit(codigo)
