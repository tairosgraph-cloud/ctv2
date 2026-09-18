-- ============================================================================
-- Tairos.rc — Lo que 0005 no alcanzó a cerrar
-- Ejecutar DESPUES de 0005_cerrar_rls.sql.
-- ============================================================================
--
-- QUE ARREGLA
--
-- 1. `schema_migrations` estaba abierta a la anon key, para leer y ESCRIBIR.
--    No la crea ninguna migración sino los aplicadores (scripts/migrate.mjs),
--    así que 0005 no la vio. Con la URL y la clave pública —las dos en el repo—
--    cualquiera podía insertar una fila falsa «0008_…» y el aplicador se
--    saltaría esa migración en silencio, incluidas las de seguridad; o borrar
--    filas para que reaplicara otras. Comprobado tras aplicar 0005:
--      curl "$SUPABASE_URL/rest/v1/schema_migrations?select=*" -H "apikey: $ANON_KEY"
--    devolvía la lista completa.
--
-- 2. 0005 lo avisa como regla a recordar ("OJO para el futuro: los DEFAULT
--    PRIVILEGES de Supabase vuelven a conceder todo a anon en cada tabla
--    NUEVA"). Una regla que depende de acordarse es la que falló en el punto 1.
--    Aquí se cambia el valor por defecto: lo que el rol `postgres` cree en
--    `public` a partir de ahora nace SIN permisos para `anon`. `authenticated`
--    y `service_role` los conservan, porque la app los necesita y la RLS de
--    cada tabla es la que decide.
--
-- LO QUE NO CUBRE, A PROPÓSITO
--
-- Las funciones nuevas siguen siendo ejecutables por PUBLIC: ese permiso es un
-- defecto global de PostgreSQL, no uno de Supabase, y solo se puede quitar para
-- todos los esquemas a la vez. Demasiado alcance para este arreglo. Toda
-- migración que cree una función sigue necesitando su
--   revoke execute on function ... from public, anon;
-- igual que hace 0005.
--
-- Las migraciones corren como `postgres` (dueño de lo que crea y con
-- BYPASSRLS), así que los aplicadores siguen leyendo y escribiendo
-- `schema_migrations` sin cambios.
-- ============================================================================

-- 1. El registro de migraciones: solo para quien migra.
revoke all on table public.schema_migrations from anon, authenticated;
alter table public.schema_migrations enable row level security;
-- Sin políticas a propósito: RLS activa y ninguna política = nadie pasa,
-- salvo el dueño y los roles con BYPASSRLS (postgres, service_role).

-- 2. Lo que se cree de aquí en adelante nace cerrado a `anon`.
alter default privileges for role postgres in schema public
  revoke all on tables from anon;
alter default privileges for role postgres in schema public
  revoke all on sequences from anon;
alter default privileges for role postgres in schema public
  revoke all on functions from anon;

-- ============================================================================
-- COMPROBACIONES
-- ============================================================================
--
-- a) Ningún objeto de public accesible para anon. Debe salir vacío:
--
--    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
--    where n.nspname = 'public' and c.relkind in ('r','v','m')
--      and (has_table_privilege('anon', c.oid, 'SELECT')
--        or has_table_privilege('anon', c.oid, 'INSERT')
--        or has_table_privilege('anon', c.oid, 'UPDATE')
--        or has_table_privilege('anon', c.oid, 'DELETE'));
--
-- b) Los valores por defecto de postgres en public ya no mencionan a anon:
--
--    select defaclobjtype, defaclacl from pg_default_acl a
--    join pg_namespace n on n.oid = a.defaclnamespace
--    where n.nspname = 'public' and defaclrole = 'postgres'::regrole;
--
-- c) Desde fuera, con la clave pública: debe responder "permission denied".
--
--    curl "$SUPABASE_URL/rest/v1/schema_migrations?select=*" -H "apikey: $ANON_KEY"
--
-- ============================================================================
-- ROLLBACK
-- ============================================================================
--
-- begin;
-- grant select, insert, update, delete on table public.schema_migrations to anon, authenticated;
-- alter table public.schema_migrations disable row level security;
-- alter default privileges for role postgres in schema public grant all on tables to anon;
-- alter default privileges for role postgres in schema public grant all on sequences to anon;
-- alter default privileges for role postgres in schema public grant all on functions to anon;
-- commit;
