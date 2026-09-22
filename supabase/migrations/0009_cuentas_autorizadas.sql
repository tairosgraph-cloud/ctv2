-- ============================================================================
-- Tairos.rc — Solo entran las cuentas autorizadas, y cada una con su papel
-- Ejecutar DESPUÉS de 0008_origen_voz.sql.
-- ============================================================================
--
-- EL HUECO: 0005 dejó los libros abiertos a toda cuenta con sesión
-- («authenticated»), y Supabase Auth trae el registro público activado. Con la
-- URL y la clave publicable (que viajan en el JavaScript), cualquiera podía
-- crearse una cuenta, confirmar su correo y leer, corregir o borrar la
-- contabilidad. Comprobado el 2026-09-22: una sola cuenta, la del dueño.
--
-- LA REGLA: tener cuenta ya no basta. Hace falta un perfil ACTIVO, y el perfil
-- dice qué se puede hacer. Una cuenta nueva nace inactiva y no ve nada hasta
-- que un gerente la activa. Así, aunque el registro público vuelva a
-- activarse, un desconocido no entra.
--
-- Sustituye a supabase/migraciones-futuras/0006_roles.sql, que tenía cuatro
-- fallos: no creaba perfil a las cuentas ya existentes (el dueño se habría
-- quedado fuera), hacía gerente a la PRIMERA cuenta nueva (con el dueño sin
-- perfil, esa podía ser la de un desconocido), daba permiso de cajero a toda
-- cuenta nueva y no retiraba EXECUTE de sus funciones SECURITY DEFINER.
--
-- Los libros siguen siendo del negocio, no de cada persona: todas las cuentas
-- activas ven lo mismo. Lo que cambia con el papel es qué pueden hacer.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Los tres papeles de una imprenta pequeña
-- ---------------------------------------------------------------------------
create type public.rol_usuario as enum ('gerente', 'cajero', 'contador');

comment on type public.rol_usuario is
  'gerente: el dueño o jefe, puede todo. '
  'cajero: registra ventas, abonos y gastos, pero no corrige, anula, borra ni cierra caja. '
  'contador: solo consulta y exporta.';

create table public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  email      text not null default '',
  nombre     text not null default '',
  rol        public.rol_usuario not null default 'cajero',
  -- Nace inactiva: tener cuenta no es tener permiso. Dar de baja tampoco borra
  -- el rastro: sus asientos siguen siendo suyos.
  activo     boolean not null default false,
  created_at timestamptz not null default now()
);

-- Las cuentas que ya existen son las del negocio (hoy, solo la del dueño):
-- entran como gerente para que nadie se quede fuera al aplicar esto.
insert into public.profiles (id, email, rol, activo)
select id, coalesce(email, ''), 'gerente', true from auth.users
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Cada cuenta nueva recibe un perfil INACTIVO. Nunca se asciende sola: el alta
-- la hace un gerente (o, en una base nueva sin nadie, el SQL de abajo).
-- ---------------------------------------------------------------------------
create function public.crear_perfil_de_usuario()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, nombre)
  values (new.id, coalesce(new.email, ''), coalesce(new.raw_user_meta_data ->> 'nombre', ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger al_crear_usuario
  after insert on auth.users
  for each row execute function public.crear_perfil_de_usuario();

-- Un disparador no necesita EXECUTE para dispararse: nadie más debe llamarla.
revoke execute on function public.crear_perfil_de_usuario() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Ayudantes de permiso. SECURITY DEFINER a propósito: leen profiles sin pasar
-- por su RLS, que a su vez los usa (si no, recursión infinita). Solo miran la
-- fila de quien pregunta.
-- ---------------------------------------------------------------------------
create function public.mi_rol()
returns public.rol_usuario
language sql stable security definer set search_path = public as $$
  select rol from public.profiles where id = auth.uid() and activo
$$;

create function public.puede_ver()
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and activo)
$$;

create function public.puede_registrar()
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles where id = auth.uid() and activo and rol in ('gerente', 'cajero')
  )
$$;

create function public.es_gerente()
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and activo and rol = 'gerente')
$$;

revoke execute on function public.mi_rol(), public.puede_ver(), public.puede_registrar(), public.es_gerente()
  from public, anon;
grant execute on function public.mi_rol(), public.puede_ver(), public.puede_registrar(), public.es_gerente()
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- profiles: todos los activos ven quién trabaja aquí; solo el gerente reparte
-- papeles y activa o da de baja. Sin esto, un cajero se ascendería solo.
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;

revoke all on table public.profiles from public, anon, authenticated;
grant select on table public.profiles to authenticated;
grant update (nombre, rol, activo) on table public.profiles to authenticated;

create policy perfiles_ver on public.profiles
  for select to authenticated using (public.puede_ver());
create policy perfiles_gestionar on public.profiles
  for update to authenticated using (public.es_gerente()) with check (public.es_gerente());

-- Nunca sin gerente: quitar el último dejaría el negocio sin nadie que pueda
-- activar cuentas ni cerrar la caja.
create function public.conservar_un_gerente()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.profiles where rol = 'gerente' and activo) then
    raise exception 'Tiene que quedar al menos un gerente activo';
  end if;
  return null;
end;
$$;

create constraint trigger siempre_un_gerente
  after update or delete on public.profiles
  deferrable initially deferred
  for each row execute function public.conservar_un_gerente();

revoke execute on function public.conservar_un_gerente() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Los libros
--
--   ver       → cualquier cuenta activa
--   registrar → gerente y cajero
--   corregir  → solo gerente (update)
--   borrar    → solo gerente
--
-- Las funciones de registro (register_work_order y compañía) son SECURITY
-- INVOKER desde 0005: pasan por estas mismas reglas.
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'transactions', 'proformas', 'debts', 'debt_payments', 'work_orders', 'work_order_items'
  ]
  loop
    execute format('drop policy if exists %I on public.%I', 'auth_full_' || t, t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (public.puede_ver())',
      t || '_ver', t);
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (public.puede_registrar())',
      t || '_registrar', t);
    execute format(
      'create policy %I on public.%I for update to authenticated using (public.es_gerente()) with check (public.es_gerente())',
      t || '_corregir', t);
    execute format(
      'create policy %I on public.%I for delete to authenticated using (public.es_gerente())',
      t || '_borrar', t);
  end loop;
end $$;

-- El arqueo lo cierra el gerente: es el acto que da por buena la caja del día.
drop policy if exists auth_full_cash_closings on public.cash_closings;
create policy cierres_ver on public.cash_closings
  for select to authenticated using (public.puede_ver());
create policy cierres_cerrar on public.cash_closings
  for insert to authenticated with check (public.es_gerente());
create policy cierres_corregir on public.cash_closings
  for update to authenticated using (public.es_gerente()) with check (public.es_gerente());
create policy cierres_borrar on public.cash_closings
  for delete to authenticated using (public.es_gerente());

notify pgrst, 'reload schema';

-- ============================================================================
-- ALTA DE CUENTAS
-- ============================================================================
--
-- 1. Crear la cuenta: Supabase → Authentication → Users → Add user.
-- 2. Activarla (como gerente, desde el SQL Editor):
--      update public.profiles set activo = true, rol = 'cajero'
--      where email = 'persona@correo.com';
--
-- En una base nueva, sin ningún gerente todavía, el primero se da de alta así
-- (el SQL Editor corre como postgres y no pasa por RLS):
--      update public.profiles set activo = true, rol = 'gerente'
--      where email = 'dueno@correo.com';
--
-- ============================================================================
-- COMPROBACIONES
-- ============================================================================
--
-- a) Quién tiene acceso:
--      select email, rol, activo from public.profiles order by created_at;
--
-- b) Una cuenta sin perfil activo no ve nada (como postgres, en una transacción):
--      begin;
--      set local role authenticated;
--      select set_config('request.jwt.claims',
--        json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
--      select count(*) from public.transactions;   -- 0
--      rollback;
--
-- ============================================================================
-- ROLLBACK (a mano, con cabeza): volver a las políticas abiertas de 0005
-- ============================================================================
--
--   drop trigger al_crear_usuario on auth.users;
--   -- por cada tabla: drop policy <t>_ver/_registrar/_corregir/_borrar y
--   -- create policy auth_full_<t> on public.<t> for all to authenticated
--   --   using (true) with check (true);
