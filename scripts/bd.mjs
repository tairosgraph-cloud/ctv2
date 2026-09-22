/**
 * Conexión a la base de producción para los scripts (migraciones, respaldo).
 *
 * - La URL sale de DATABASE_URL (entorno) o de .env.db, que git ignora. Nunca
 *   se imprime.
 * - TLS verificado: el servidor tiene que presentar un certificado firmado por
 *   la raíz de Supabase (supabase/ca-supabase-2021.crt, pública). Sin esto,
 *   cualquiera en medio de la red podría hacerse pasar por la base y quedarse
 *   con la contraseña.
 */
import { existsSync, readFileSync } from 'node:fs'
import pg from 'pg'

const CA = 'supabase/ca-supabase-2021.crt'

function leerUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL
  if (existsSync('.env.db')) {
    for (const linea of readFileSync('.env.db', 'utf8').split('\n')) {
      const m = linea.match(/^\s*(?:export\s+)?DATABASE_URL\s*=\s*(.+?)\s*$/)
      if (m) return m[1].replace(/^["']|["']$/g, '')
    }
  }
  console.error(
    'Falta DATABASE_URL. Ponla en el entorno o en .env.db (git lo ignora):\n' +
      '  DATABASE_URL=postgresql://postgres.<ref>:<contraseña>@<host>:5432/postgres\n' +
      'Supabase → Project Settings → Database → Connection string (Session pooler).',
  )
  process.exit(1)
}

export async function conectar() {
  const url = new URL(leerUrl())
  // Los parámetros ssl de la URL pisarían la verificación de abajo.
  for (const p of ['sslmode', 'sslrootcert', 'sslcert', 'sslkey']) url.searchParams.delete(p)
  const cliente = new pg.Client({
    connectionString: url.toString(),
    ssl: { ca: readFileSync(CA, 'utf8'), rejectUnauthorized: true },
  })
  try {
    await cliente.connect()
  } catch (error) {
    // El mensaje de pg puede traer el host, nunca la contraseña; aun así, solo
    // lo imprescindible.
    console.error(`No se pudo conectar con la base: ${error.code ?? ''} ${error.message}`)
    process.exit(1)
  }
  return cliente
}
