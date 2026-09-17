-- ============================================================================
-- Tairos.rc — Personas, roles y permisos
-- Ejecutar DESPUES de 0005_cerrar_rls.sql.
--
-- 0005 cerró la puerta: ya solo entra quien tiene sesión. Esto reparte llaves:
-- no todo el que entra debe poder anular un asiento ni cerrar la caja.
--
-- REGLA DE FONDO: los permisos viven AQUI, no en la interfaz. Esconder un botón
-- no impide nada — la clave publicable viaja en el JavaScript, así que cualquiera
-- puede llamar a la API por su cuenta. Si el permiso no está en la base, no existe.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Los tres papeles de una imprenta pequeña
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'rol_usuario') then
    create type public.rol_usuario as enum ('gerente', 'cajero', 'contador');
  end if;
end $$;

comment on type public.rol_usuario is
  'gerente: el dueño o jefe, puede todo. '
  'cajero: registra ventas y cobra, pero no anula ni borra ni cierra caja. '
  'contador: solo consulta y exporta, no modifica nada.';

-- ---------------------------------------------------------------------------
-- profiles — quién es cada cuenta y qué puede hacer
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  email      text not null,
  nombre     text not null default '',
  rol        public.rol_usuario not null default 'cajero',
  -- Dar de baja a alguien sin borrar su rastro: sus asientos siguen siendo suyos.
  activo     boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Al crearse una cuenta, nace su perfil.
--
-- El PRIMERO es gerente por necesidad: si todos nacieran cajeros, no habría
-- nadie con permiso para ascender a nadie y el sistema quedaría bloqueado.
-- Los siguientes nacen cajeros, que es el permiso más bajo que sigue siendo útil.
-- ---------------------------------------------------------------------------
create or replace function public.crear_perfil_de_usuario()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, nombre, rol)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'nombre', ''),
    case when (select count(*) from public.profiles) = 0 then 'gerente'::public.rol_usuario
         else 'cajero'::public.rol_usuario end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists al_crear_usuario on auth.users;
create trigger al_crear_usuario
  after insert on auth.users
  for each row execute function public.crear_perfil_de_usuario();

-- ---------------------------------------------------------------------------
-- Ayudantes de permiso.
--
-- Van en SECURITY DEFINER a propósito: leen profiles saltándose RLS. Si no,
-- una política de profiles que consultara profiles entraría en recursión
-- infinita y Postgres abortaría la consulta.
-- ---------------------------------------------------------------------------
create or replace function public.mi_rol()
returns public.rol_usuario
language sql stable security definer set search_path = public as $$
  select rol from public.profiles where id = auth.uid() and activo
$$;

/** Cualquiera con cuenta viva: puede mirar los libros. */
create or replace function public.puede_ver()
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and activo)
$$;

/** Gerente y cajero: registran el día a día. */
create or replace function public.puede_registrar()
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and activo and rol in ('gerente', 'cajero')
  )
$$;

/** Solo el gerente: corregir, anular, borrar y cerrar caja. */
create or replace function public.es_gerente()
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and activo and rol = 'gerente'
  )
$$;

-- ---------------------------------------------------------------------------
-- RLS de profiles
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;

drop policy if exists perfiles_ver on public.profiles;
drop policy if exists perfiles_gestionar on public.profiles;

-- Todos ven quién trabaja aquí (la pantalla de Configuración los lista).
create policy perfiles_ver on public.profiles
  for select to authenticated using (public.puede_ver());

-- Solo el gerente reparte roles y da de baja. Sin esto, un cajero podría
-- ascenderse a sí mismo con una sola llamada a la API.
create policy perfiles_gestionar on public.profiles
  for update to authenticated
  using (public.es_gerente()) with check (public.es_gerente());

-- ---------------------------------------------------------------------------
-- Permisos por tabla
--
--   ver       → cualquiera con cuenta viva
--   registrar → gerente y cajero
--   corregir  → solo gerente
--   borrar    → solo gerente
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'transactions', 'proformas', 'debts', 'debt_payments', 'work_orders', 'work_order_items'
  ]
  loop
    execute format('drop policy if exists %I on public.%I', t || '_ver', t);
    execute format('drop policy if exists %I on public.%I', t || '_registrar', t);
    execute format('drop policy if exists %I on public.%I', t || '_corregir', t);
    execute format('drop policy if exists %I on public.%I', t || '_borrar', t);
    -- Barrido de las políticas anteriores, por si quedó alguna de 0001/0002/0005.
    execute format('drop policy if exists %I on public.%I', 'anon_full_' || t, t);
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
drop policy if exists anon_full_cash_closings on public.cash_closings;
drop policy if exists auth_full_cash_closings on public.cash_closings;
drop policy if exists cierres_ver on public.cash_closings;
drop policy if exists cierres_cerrar on public.cash_closings;
drop policy if exists cierres_corregir on public.cash_closings;

create policy cierres_ver on public.cash_closings
  for select to authenticated using (public.puede_ver());
create policy cierres_cerrar on public.cash_closings
  for insert to authenticated with check (public.es_gerente());
create policy cierres_corregir on public.cash_closings
  for update to authenticated using (public.es_gerente()) with check (public.es_gerente());

-- ---------------------------------------------------------------------------
-- Cómo volver atrás si algo sale mal (ejecutar a mano, con cabeza):
--
--   drop trigger if exists al_crear_usuario on auth.users;
--   -- y recrear las políticas permisivas de 0005 mientras se investiga
-- ---------------------------------------------------------------------------
