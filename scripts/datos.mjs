#!/usr/bin/env node
/**
 * Respaldo, restauración y vaciado de los datos del negocio.
 *
 *   npm run db:respaldo                       copia completa a ~/Respaldos/tairos/
 *   npm run db:restaurar -- ARCHIVO           ensayo: restaura y DESHACE (no cambia nada)
 *   npm run db:restaurar -- ARCHIVO --confirmar   restaura de verdad (antes respalda lo actual)
 *   npm run db:vaciar                         ensayo del vaciado de la demostración
 *   npm run db:vaciar -- --confirmar          vacía los libros y reinicia la numeración
 *                                             (antes respalda lo actual)
 *
 * El plan gratuito de Supabase no guarda copias: esto es lo que hay. El
 * archivo va fuera del repositorio, legible solo por tu usuario, y lleva
 * nombres y teléfonos de clientes: guárdalo como guardarías el cuaderno de
 * caja (un disco externo, una nube privada). Nunca en el repositorio.
 *
 * Las cuentas de acceso (auth.users) no se copian: las lleva Supabase. Los
 * perfiles sí, y al restaurar solo vuelven los de cuentas que existen.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { conectar } from './bd.mjs'

/** En orden de dependencias: cada tabla solo apunta a las de antes. */
const TABLAS = [
  'work_orders',
  'work_order_items',
  'transactions',
  'proformas',
  'debts',
  'debt_payments',
  'cash_closings',
  'profiles',
  'voice_extractions',
  'uso_dictado',
]
/** Lo que se vacía al empezar con datos reales: los libros y su medición, no las cuentas. */
const DE_LOS_LIBROS = TABLAS.filter((t) => t !== 'profiles')
/** Con qué número empieza cada numeración (0001: OP-000001, PF-1001). */
const SECUENCIAS = { voucher_seq: 1, proforma_seq: 1001 }
const FORMATO = 'tairos-respaldo'

const [orden, ...resto] = process.argv.slice(2)
const confirmar = resto.includes('--confirmar')
const archivo = resto.find((a) => !a.startsWith('--'))

const bd = await conectar()
let codigo = 0
try {
  if (orden === 'respaldo') await respaldar()
  else if (orden === 'restaurar') await restaurar()
  else if (orden === 'vaciar') await vaciar()
  else {
    console.error('Uso: node scripts/datos.mjs respaldo | restaurar ARCHIVO [--confirmar] | vaciar [--confirmar]')
    codigo = 2
  }
} catch (error) {
  await bd.query('rollback').catch(() => undefined)
  console.error(`\n✗ ${error.message}`)
  codigo = 1
} finally {
  await bd.end()
}
process.exit(codigo)

// --- respaldo ------------------------------------------------------------------

/**
 * Todo en una sola foto: con la app en uso, leer tabla por tabla podría coger
 * un pedido guardado entre dos lecturas con sus trabajos pero sin él, y ese
 * respaldo no se podría restaurar.
 */
async function leerTodo() {
  await bd.query('begin isolation level repeatable read read only')
  try {
    const tablas = {}
    for (const t of TABLAS) {
      const { rows } = await bd.query(`select coalesce(jsonb_agg(t), '[]'::jsonb) as filas from public.${t} t`)
      tablas[t] = rows[0].filas
    }
    const secuencias = {}
    for (const s of Object.keys(SECUENCIAS)) {
      const { rows } = await bd.query(`select last_value::text, is_called from public.${s}`)
      secuencias[s] = { ultimo: rows[0].last_value, usado: rows[0].is_called }
    }
    const { rows: migraciones } = await bd.query('select version from public.schema_migrations order by version')
    return { tablas, secuencias, migraciones: migraciones.map((m) => m.version) }
  } finally {
    await bd.query('commit')
  }
}

async function respaldar(motivo = '') {
  const datos = await leerTodo()
  const ahora = new Date()
  const sello = ahora.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 13)
  const carpeta = join(homedir(), 'Respaldos', 'tairos')
  mkdirSync(carpeta, { recursive: true, mode: 0o700 })
  const ruta = join(carpeta, `tairos-${sello}${motivo ? `-${motivo}` : ''}.json`)
  writeFileSync(ruta, JSON.stringify({ formato: FORMATO, version: 1, creado: ahora.toISOString(), ...datos }), {
    mode: 0o600,
  })
  chmodSync(ruta, 0o600)
  const filas = Object.values(datos.tablas).reduce((n, f) => n + f.length, 0)
  console.log(`✓ Respaldo: ${ruta}`)
  console.log(`  ${filas} filas · ${Object.entries(datos.tablas).map(([t, f]) => `${t} ${f.length}`).join(' · ')}`)
  return ruta
}

// --- restaurar -----------------------------------------------------------------

async function columnas(tabla) {
  const { rows } = await bd.query(
    `select column_name from information_schema.columns
     where table_schema = 'public' and table_name = $1 and is_generated = 'NEVER'`,
    [tabla],
  )
  return new Set(rows.map((r) => r.column_name))
}

/** Inserta las filas del respaldo tal cual, con sus tipos (jsonb_populate_recordset). */
async function cargar(tabla, filas) {
  if (!filas.length) return 0
  const existentes = await columnas(tabla)
  // Solo las columnas que trae el respaldo: las añadidas después toman su valor por defecto.
  const lista = Object.keys(filas[0]).filter((c) => existentes.has(c))
  const cols = lista.map((c) => `"${c}"`).join(', ')
  // Perfiles y dictados apuntan a cuentas de acceso: solo vuelven los de cuentas que existen.
  const filtro =
    tabla === 'profiles' || tabla === 'uso_dictado'
      ? `where exists (select 1 from auth.users u where u.id = r.${tabla === 'profiles' ? 'id' : 'user_id'})`
      : ''
  const origen =
    tabla === 'voice_extractions'
      ? lista.map((c) => (c === 'user_id' ? `(select u.id from auth.users u where u.id = r.user_id)` : `r."${c}"`)).join(', ')
      : lista.map((c) => `r."${c}"`).join(', ')
  // Un perfil que ya existe se queda como está: restaurar no reactiva a nadie
  // dado de baja ni devuelve un papel que ya se quitó.
  const conflicto = tabla === 'profiles' ? 'on conflict (id) do nothing' : ''
  await bd.query(
    `insert into public.${tabla} (${cols})
     select ${origen} from jsonb_populate_recordset(null::public.${tabla}, $1::jsonb) r ${filtro} ${conflicto}`,
    [JSON.stringify(filas)],
  )
}

/** Cuántas filas del respaldo tienen que estar en la base al terminar (mismo filtro que al cargar). */
async function esperadas(tabla, filas) {
  if (tabla !== 'profiles' && tabla !== 'uso_dictado') return filas.length
  const col = tabla === 'profiles' ? 'id' : 'user_id'
  const { rows } = await bd.query(
    `select count(*)::int as n from jsonb_to_recordset($1::jsonb) as r(${col} uuid)
     where exists (select 1 from auth.users u where u.id = r.${col})`,
    [JSON.stringify(filas)],
  )
  return rows[0].n
}

async function restaurar() {
  if (!archivo || !existsSync(archivo)) throw new Error('Indica el archivo de respaldo: npm run db:restaurar -- RUTA')
  const respaldo = JSON.parse(readFileSync(archivo, 'utf8'))
  if (respaldo.formato !== FORMATO) throw new Error('Ese archivo no es un respaldo de Tairos.rc')
  const { rows } = await bd.query('select version from public.schema_migrations')
  const aplicadas = new Set(rows.map((r) => r.version))
  const faltan = respaldo.migraciones.filter((m) => !aplicadas.has(m))
  if (faltan.length) throw new Error(`La base es más antigua que el respaldo: faltan ${faltan.join(', ')}. Ejecuta npm run db:migrate.`)

  if (confirmar) await respaldar('antes-de-restaurar')
  console.log(`\n${confirmar ? 'Restaurando' : 'Ensayo de restauración (se deshace al final)'} desde ${archivo} (${respaldo.creado})`)
  await bd.query('begin')
  await bd.query(`truncate ${DE_LOS_LIBROS.map((t) => `public.${t}`).join(', ')} restart identity cascade`)
  let bien = true
  for (const t of TABLAS) {
    const filas = respaldo.tablas[t] ?? []
    const debe = await esperadas(t, filas)
    await cargar(t, filas)
    const presentes =
      t === 'profiles'
        ? // Se fusionan con los que ya hay: basta con que estén todos los del respaldo.
          (
            await bd.query(
              `select count(*)::int as n from jsonb_to_recordset($1::jsonb) as r(id uuid)
               where exists (select 1 from public.profiles p where p.id = r.id)`,
              [JSON.stringify(filas)],
            )
          ).rows[0].n
        : (await bd.query(`select count(*)::int as n from public.${t}`)).rows[0].n
    const cuadra = presentes === debe
    if (!cuadra) bien = false
    console.log(`  ${cuadra ? '✓' : '✗'} ${t.padEnd(18)} ${String(debe).padStart(5)} esperadas · ${presentes} en la base`)
  }
  // La numeración con ALTER SEQUENCE, que es transaccional: si algo falla o es
  // un ensayo, vuelve atrás con lo demás. (setval no: quedaría movida.)
  for (const [s, { ultimo, usado }] of Object.entries(respaldo.secuencias ?? {})) {
    const siguiente = BigInt(ultimo) + (usado ? 1n : 0n)
    await bd.query(`alter sequence public.${s} restart with ${siguiente}`)
    console.log(`  · ${s.padEnd(18)} sigue en ${siguiente}`)
  }
  if (!bien) throw new Error('Las cuentas no cuadran: no se restauró nada.')
  if (confirmar) {
    await bd.query('commit')
    console.log('\n✓ Restaurado.')
  } else {
    await bd.query('rollback')
    console.log('\n✓ El respaldo se puede restaurar. No se cambió nada (ensayo). Para hacerlo de verdad: --confirmar')
  }
}

// --- vaciar ----------------------------------------------------------------------

async function vaciar() {
  const antes = {}
  for (const t of DE_LOS_LIBROS) {
    const { rows } = await bd.query(`select count(*)::int as n from public.${t}`)
    antes[t] = rows[0].n
  }
  if (confirmar) await respaldar('antes-de-vaciar')
  console.log(`\n${confirmar ? 'Vaciando' : 'Ensayo del vaciado (se deshace al final)'}: ${Object.entries(antes).map(([t, n]) => `${t} ${n}`).join(' · ')}`)
  await bd.query('begin')
  await bd.query(`truncate ${DE_LOS_LIBROS.map((t) => `public.${t}`).join(', ')} restart identity cascade`)
  for (const [s, inicio] of Object.entries(SECUENCIAS)) {
    await bd.query(`alter sequence public.${s} restart with ${inicio}`)
  }
  const { rows } = await bd.query(
    `select (select count(*) from public.transactions)::int as asientos,
            (select count(*) from public.profiles where activo)::int as cuentas_activas`,
  )
  if (confirmar) {
    await bd.query('commit')
    console.log(`\n✓ Libros vacíos (${rows[0].asientos} asientos). Las cuentas siguen (${rows[0].cuentas_activas} activas). El próximo asiento será OP-000001 y la próxima proforma PF-1001.`)
  } else {
    await bd.query('rollback')
    console.log(`\n✓ El vaciado funciona. No se cambió nada (ensayo). Para hacerlo de verdad: npm run db:vaciar -- --confirmar`)
  }
}
