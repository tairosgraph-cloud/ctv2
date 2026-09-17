-- ============================================================================
-- Tairos.rc — Cerrar RLS: fuera la anon key
-- Ejecutar DESPUES de 0004_edit_proformas_debts.sql.
--
--  ############################################################
--  #  NO APLIQUES ESTE ARCHIVO TODAVIA.                       #
--  #                                                          #
--  #  Aplicalo SOLO cuando el inicio de sesion ya este         #
--  #  desplegado en produccion y verificado.                   #
--  #                                                          #
--  #  Hoy la app entra a Supabase con la anon key y sin        #
--  #  sesion. En el momento en que corras esto, esa app deja   #
--  #  de ver y de guardar nada: todas las consultas vuelven    #
--  #  vacias o con "permission denied". Es exactamente lo que  #
--  #  queremos, pero solo despues de que exista una pantalla   #
--  #  de login que consiga un JWT con role = authenticated.    #
--  #                                                          #
--  #  Orden correcto del despliegue:                           #
--  #    1. Publicar el login en Vercel y comprobar que un      #
--  #       usuario real entra y la sesion persiste.            #
--  #    2. Crear los usuarios (dueño y cajero) en              #
--  #       Authentication > Users del panel de Supabase.       #
--  #    3. Recien entonces aplicar esta migracion.             #
--  #    4. Comprobar desde la app ya logueada que el libro,    #
--  #       las proformas y las cuentas siguen cargando.        #
--  #                                                          #
--  #  Si algo sale mal, al final del archivo esta el rollback. #
--  ############################################################
--
-- QUE ARREGLA
-- El repositorio es publico y la app esta en Vercel, asi que la URL del
-- proyecto y la anon key son de dominio publico. Con las politicas actuales
-- (`for all using (true) with check (true)`, sin clausula `to`) cualquiera
-- con esos dos datos puede leer, editar y borrar toda la contabilidad de la
-- imprenta desde una terminal. Aqui se sustituyen por politicas que exigen
-- sesion iniciada.
--
-- ----------------------------------------------------------------------------
-- DECISION DE ALCANCE: negocio compartido, NO propiedad por usuario
-- ----------------------------------------------------------------------------
-- El patron habitual de Supabase (columna `owner uuid` + `auth.uid() = owner`)
-- es el correcto para una app multiinquilino, donde cada usuario tiene SUS
-- datos. Aqui seria un error de modelo:
--
--   * Los libros son del NEGOCIO, no de la persona que los teclea. El dueño y
--     el cajero trabajan sobre la misma caja, las mismas deudas y los mismos
--     pedidos.
--   * Con propiedad por usuario, cada uno veria una contabilidad distinta: el
--     cajero registraria un ingreso que el dueño no veria en su caja, el
--     arqueo del dia no cuadraria nunca y `debts_with_balance` mostraria
--     saldos diferentes segun quien mire. Seria un bug contable, no una
--     medida de seguridad.
--   * Ademas obligaria a rellenar `owner` en los datos ya existentes eligiendo
--     un dueño arbitrario, y a que las funciones RPC lo propagaran.
--
-- Por eso la regla es: "cualquier usuario autenticado accede a los libros del
-- negocio". La frontera de seguridad es la puerta de entrada (quien tiene
-- cuenta), no la fila. No se añade ninguna columna `owner` ni se migra dato
-- alguno.
--
-- Distinguir dueño de cajero (por ejemplo, que el cajero no pueda borrar
-- asientos) es una capa DISTINTA y posterior: se hace separando este `for all`
-- en politicas por comando contra un rol guardado en la base. Eso no cambia la
-- decision de arriba — los libros siguen siendo del negocio, compartidos; solo
-- limita quien puede tocarlos. Este archivo se queda en el escalon de abajo:
-- dejar fuera a quien no ha iniciado sesion.
--
-- La autoria queda registrada igual: las tablas ya guardan `author`, que es
-- informativo y no manda sobre el acceso.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Politicas: solo `authenticated`
--
-- La clave no es el `using (true)` sino el `to authenticated`. Sin esa
-- clausula la politica aplica a PUBLIC, es decir tambien al rol `anon` con el
-- que entra la anon key. Con ella, una peticion sin sesion no encuentra
-- ninguna politica que la ampare y RLS la deja sin filas (y sin escritura).
--
-- `service_role` no necesita politica: tiene BYPASSRLS, y por eso la service
-- key jamas debe salir del servidor ni entrar en este repositorio.
-- ---------------------------------------------------------------------------
alter table public.transactions     enable row level security;
alter table public.proformas        enable row level security;
alter table public.debts            enable row level security;
alter table public.debt_payments    enable row level security;
alter table public.cash_closings    enable row level security;
alter table public.work_orders      enable row level security;
alter table public.work_order_items enable row level security;

-- Fuera las siete politicas abiertas de 0001 y 0002.
drop policy if exists anon_full_transactions     on public.transactions;
drop policy if exists anon_full_proformas        on public.proformas;
drop policy if exists anon_full_debts            on public.debts;
drop policy if exists anon_full_debt_payments    on public.debt_payments;
drop policy if exists anon_full_cash_closings    on public.cash_closings;
drop policy if exists anon_full_work_orders      on public.work_orders;
drop policy if exists anon_full_work_order_items on public.work_order_items;

-- Idempotencia: si esta migracion se corre dos veces, no debe fallar.
--
-- El nombre `auth_full_<tabla>` no es decorativo: una migracion posterior que
-- afine permisos por rol (gerente / cajero) tiene que poder RETIRAR estas
-- politicas. Las politicas permisivas de PostgreSQL se combinan con OR, asi
-- que si una de estas sobreviviera junto a otras mas finas, su `using (true)`
-- las anularia todas y el cajero podria borrar asientos. Quien escriba la
-- siguiente migracion de permisos debe dropear `auth_full_<tabla>` primero.
drop policy if exists auth_full_transactions     on public.transactions;
drop policy if exists auth_full_proformas        on public.proformas;
drop policy if exists auth_full_debts            on public.debts;
drop policy if exists auth_full_debt_payments    on public.debt_payments;
drop policy if exists auth_full_cash_closings    on public.cash_closings;
drop policy if exists auth_full_work_orders      on public.work_orders;
drop policy if exists auth_full_work_order_items on public.work_order_items;

create policy auth_full_transactions on public.transactions
  for all to authenticated using (true) with check (true);

create policy auth_full_proformas on public.proformas
  for all to authenticated using (true) with check (true);

create policy auth_full_debts on public.debts
  for all to authenticated using (true) with check (true);

create policy auth_full_debt_payments on public.debt_payments
  for all to authenticated using (true) with check (true);

create policy auth_full_cash_closings on public.cash_closings
  for all to authenticated using (true) with check (true);

create policy auth_full_work_orders on public.work_orders
  for all to authenticated using (true) with check (true);

create policy auth_full_work_order_items on public.work_order_items
  for all to authenticated using (true) with check (true);

-- ---------------------------------------------------------------------------
-- 2. Permisos SQL: segunda cerradura, por debajo de RLS
--
-- RLS solo entra en juego DESPUES de que el rol tenga permiso sobre la tabla.
-- Supabase le concede a `anon` todos los permisos del esquema public por
-- defecto, asi que hoy `anon` llega hasta RLS y hoy RLS lo deja pasar. Con el
-- punto 1 ya no pasaria, pero quitarle ademas el permiso evita que un futuro
-- `using (true)` mal escrito vuelva a abrir la puerta, y hace que el error
-- sea explicito ("permission denied") en vez de una lista vacia silenciosa.
--
-- OJO para el futuro: los DEFAULT PRIVILEGES de Supabase vuelven a conceder
-- todo a `anon` en cada tabla NUEVA. Toda tabla que se cree despues de aqui
-- necesita su politica y su revoke.
-- ---------------------------------------------------------------------------
revoke all on table
  public.transactions,
  public.proformas,
  public.debts,
  public.debt_payments,
  public.cash_closings,
  public.work_orders,
  public.work_order_items
from anon;

grant select, insert, update, delete on table
  public.transactions,
  public.proformas,
  public.debts,
  public.debt_payments,
  public.cash_closings,
  public.work_orders,
  public.work_order_items
to authenticated;

-- Las secuencias alimentan los correlativos OP-000001 y PF-1001 por DEFAULT.
-- Quien inserta necesita USAGE sobre ellas; `anon` ya no inserta nada.
revoke all on sequence public.voucher_seq, public.proforma_seq from anon;
grant usage, select on sequence public.voucher_seq, public.proforma_seq to authenticated;

-- ---------------------------------------------------------------------------
-- 3. La vista debts_with_balance — el agujero facil de pasar por alto
--
-- Una vista NO tiene RLS propia: hereda la de sus tablas base. Pero por
-- defecto en PostgreSQL la hereda evaluada con los permisos del DUEÑO de la
-- vista, no de quien consulta (se comporta como SECURITY DEFINER). Aqui la
-- vista la creo `postgres` en el editor SQL, que es tambien dueño de `debts`
-- y `debt_payments`, y el dueño de una tabla SALTA su propia RLS mientras no
-- exista FORCE ROW LEVEL SECURITY.
--
-- Resultado sin esta linea: aunque el punto 1 cierre `debts`, un `anon`
-- consultando `debts_with_balance` recibiria TODAS las deudas de la imprenta,
-- con su saldo y su cliente. Es justo la tabla mas sensible, y la app la lee
-- por su nombre (src/data/supabaseAdapter.ts), asi que esta expuesta en
-- PostgREST.
--
-- La base es PostgreSQL 17 y la opcion `security_invoker` existe desde
-- PostgreSQL 15, asi que aqui SI esta disponible y hay que activarla: con
-- ella la vista se evalua con el rol que consulta y la RLS de `debts` y
-- `debt_payments` se aplica de verdad.
--
-- (Si la base fuese PostgreSQL 14 o anterior no existiria la opcion y habria
-- que sustituir la vista por una funcion SECURITY INVOKER o por FORCE ROW
-- LEVEL SECURITY en las tablas base. No es el caso.)
-- ---------------------------------------------------------------------------
alter view public.debts_with_balance set (security_invoker = on);

-- Cinturon y tirantes: sin permiso sobre la vista, `anon` ni la alcanza.
revoke all on table public.debts_with_balance from anon;
grant select on table public.debts_with_balance to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Funciones RPC — confirmado: son SECURITY INVOKER
--
-- Revisadas una por una en 0002, 0003 y 0004: register_work_order,
-- update_work_order, update_proforma, annul_proforma, update_debt y
-- delete_debt_payment se declaran `language plpgsql` SIN la clausula
-- `security definer`. En PostgreSQL, cuando no se dice nada el modo es
-- SECURITY INVOKER, asi que ya se ejecutan con los permisos y la RLS del
-- usuario que las llama. Ninguna es un agujero.
--
-- Eso importa mucho aqui: si alguna fuese SECURITY DEFINER, correria como
-- `postgres` y seguiria escribiendo en el libro para un `anon` sin sesion,
-- dejando inutil todo lo anterior. register_work_order es el caso grave,
-- porque inserta pedidos, asientos y deudas de una sola llamada.
--
-- Los `alter function` de abajo no cambian el comportamiento: lo fijan por
-- escrito, para que un futuro `create or replace` que se olvide de esto
-- choque contra una declaracion explicita en la historia de migraciones.
-- Las firmas deben coincidir exactamente con las de 0003 y 0004.
-- ---------------------------------------------------------------------------
alter function public.register_work_order(
  text, text, text, text, text, numeric, text, text, jsonb
) security invoker;

alter function public.update_work_order(
  uuid, text, text, text, text, numeric, text, jsonb
) security invoker;

alter function public.update_proforma(uuid, text, text, numeric, int) security invoker;
alter function public.annul_proforma(uuid) security invoker;
alter function public.update_debt(uuid, text, text, numeric, date) security invoker;
alter function public.delete_debt_payment(uuid) security invoker;

-- PostgreSQL concede EXECUTE a PUBLIC en toda funcion nueva, y Supabase se lo
-- concede ademas a `anon` de forma explicita. Aunque siendo INVOKER la RLS ya
-- las frenaria por dentro, sin sesion no deben ni poder invocarse.
revoke execute on function
  public.register_work_order(text, text, text, text, text, numeric, text, text, jsonb),
  public.update_work_order(uuid, text, text, text, text, numeric, text, jsonb),
  public.update_proforma(uuid, text, text, numeric, int),
  public.annul_proforma(uuid),
  public.update_debt(uuid, text, text, numeric, date),
  public.delete_debt_payment(uuid)
from public, anon;

grant execute on function
  public.register_work_order(text, text, text, text, text, numeric, text, text, jsonb),
  public.update_work_order(uuid, text, text, text, text, numeric, text, jsonb),
  public.update_proforma(uuid, text, text, numeric, int),
  public.annul_proforma(uuid),
  public.update_debt(uuid, text, text, numeric, date),
  public.delete_debt_payment(uuid)
to authenticated, service_role;

commit;

-- ============================================================================
-- COMPROBACIONES despues de aplicar (copiar y pegar en el editor SQL)
-- ============================================================================
--
-- a) Ninguna politica debe seguir alcanzando a `anon`. Debe salir vacio:
--
--    select schemaname, tablename, policyname, roles
--    from pg_policies
--    where schemaname = 'public'
--      and (roles is null or roles && array['anon', 'public']::name[]);
--
-- b) Las siete tablas con RLS activa y una politica solo para authenticated:
--
--    select c.relname, c.relrowsecurity, p.policyname, p.roles
--    from pg_class c
--    join pg_namespace n on n.oid = c.relnamespace
--    left join pg_policies p on p.schemaname = n.nspname and p.tablename = c.relname
--    where n.nspname = 'public' and c.relkind = 'r'
--    order by c.relname;
--
-- c) La vista debe aparecer con security_invoker=on:
--
--    select relname, reloptions from pg_class where relname = 'debts_with_balance';
--
-- d) Ninguna funcion del esquema public puede ser SECURITY DEFINER.
--    Debe salir vacio:
--
--    select proname from pg_proc p
--    join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.prosecdef;
--
-- e) Prueba de fuego desde fuera, con la anon key publica (sin sesion). Las
--    dos deben responder con lista vacia o con error de permisos, nunca con
--    datos:
--
--    curl "$SUPABASE_URL/rest/v1/transactions?select=*" -H "apikey: $ANON_KEY"
--    curl "$SUPABASE_URL/rest/v1/debts_with_balance?select=*" -H "apikey: $ANON_KEY"
--
-- ============================================================================
-- ROLLBACK — volver a dejarlo abierto si el login falla en produccion
-- ============================================================================
--
-- Usalo SOLO como parche de emergencia para que la imprenta pueda seguir
-- facturando, y vuelve a cerrar en cuanto el login este arreglado: mientras
-- este bloque este aplicado, la contabilidad esta publica en internet otra
-- vez. Mejor alternativa antes de llegar aqui: dejar RLS cerrada y usar la
-- app en modo local (localStorage), que funciona sin credenciales de Supabase
-- — ver isSupabaseConfigured en src/lib/supabase.ts.
--
-- begin;
--
-- drop policy if exists auth_full_transactions     on public.transactions;
-- drop policy if exists auth_full_proformas        on public.proformas;
-- drop policy if exists auth_full_debts            on public.debts;
-- drop policy if exists auth_full_debt_payments    on public.debt_payments;
-- drop policy if exists auth_full_cash_closings    on public.cash_closings;
-- drop policy if exists auth_full_work_orders      on public.work_orders;
-- drop policy if exists auth_full_work_order_items on public.work_order_items;
--
-- create policy anon_full_transactions on public.transactions
--   for all using (true) with check (true);
-- create policy anon_full_proformas on public.proformas
--   for all using (true) with check (true);
-- create policy anon_full_debts on public.debts
--   for all using (true) with check (true);
-- create policy anon_full_debt_payments on public.debt_payments
--   for all using (true) with check (true);
-- create policy anon_full_cash_closings on public.cash_closings
--   for all using (true) with check (true);
-- create policy anon_full_work_orders on public.work_orders
--   for all using (true) with check (true);
-- create policy anon_full_work_order_items on public.work_order_items
--   for all using (true) with check (true);
--
-- -- Devolver los permisos que se le quitaron a anon.
-- grant select, insert, update, delete on table
--   public.transactions, public.proformas, public.debts, public.debt_payments,
--   public.cash_closings, public.work_orders, public.work_order_items
-- to anon;
-- grant usage, select on sequence public.voucher_seq, public.proforma_seq to anon;
--
-- -- La vista vuelve al comportamiento anterior (hereda los permisos del dueño).
-- alter view public.debts_with_balance reset (security_invoker);
-- grant select on table public.debts_with_balance to anon;
--
-- grant execute on function
--   public.register_work_order(text, text, text, text, text, numeric, text, text, jsonb),
--   public.update_work_order(uuid, text, text, text, text, numeric, text, jsonb),
--   public.update_proforma(uuid, text, text, numeric, int),
--   public.annul_proforma(uuid),
--   public.update_debt(uuid, text, text, numeric, date),
--   public.delete_debt_payment(uuid)
-- to anon;
--
-- commit;
--
-- Las funciones se quedan SECURITY INVOKER tambien tras el rollback: es como
-- estaban de hecho desde 0002, y volverlas DEFINER no arreglaria nada.
