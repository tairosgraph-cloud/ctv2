-- ============================================================================
-- Tairos.rc — Clientes, catálogo de precios y aprobación del diseño
-- Ejecutar DESPUÉS de 0013_trabajos.sql.
-- ============================================================================
--
-- CLIENTES. Hasta aquí el cliente era el texto que alguien escribió: «Rosa»,
-- «rosa», «la señora Rosa» eran tres personas, y no había dónde guardar su
-- teléfono ni ver cuánto debe. Ahora hay una tabla `clientes` (también los
-- proveedores, con su marca) y cada pedido, proforma y deuda apunta a uno.
--
-- La base vincula SOLA: al guardar, un disparador busca el cliente por su
-- nombre normalizado (sin tildes, sin «señora», «cliente», «don»…) y, si no
-- existe, lo crea. Así funciona desde cualquier pantalla, desde el dictado y
-- con el frontend anterior. El texto de siempre (`party`) se conserva: es lo
-- que se escribió en su momento.
--
-- CATÁLOGO. Productos con precio por unidad según la cantidad («Volantes A5,
-- por millar: desde 1, S/ 180; desde 5, S/ 150»). Solo el gerente lo cambia.
--
-- APROBACIÓN. El historial de un trabajo gana una nota: al pasar a producción
-- se anota quién aprobó el diseño y cómo («por WhatsApp», «en persona»).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- La misma persona escrita de varias formas: una sola clave.
-- (Espejo de normalizar() en src/lib/partes.ts.)
-- ---------------------------------------------------------------------------
create function public.normalizar_nombre(p text)
returns text
language sql
immutable
set search_path = public
as $$
  select coalesce(
    nullif(
      btrim(regexp_replace(
        regexp_replace(
          translate(lower(coalesce(p, '')), 'áéíóúüñàèìòù.,;:', 'aeiouunaeiou    '),
          '\s+', ' ', 'g'),
        '^((el|la|los|las|al|a|senor|senora|senorita|sr|sra|srta|don|dona|do|cliente|clienta|proveedor|proveedora|empresa|tio|tia) )+',
        '')),
      ''),
    btrim(lower(coalesce(p, ''))))
$$;

create table public.clientes (
  id          uuid primary key default gen_random_uuid(),
  nombre      text not null check (btrim(nombre) <> ''),
  clave       text generated always as (public.normalizar_nombre(nombre)) stored,
  telefono    text not null default '',
  -- DNI o RUC, opcional.
  documento   text not null default '',
  notas       text not null default '',
  proveedor   boolean not null default false,
  created_at  timestamptz not null default now(),
  constraint clientes_clave_unica unique (clave)
);

alter table public.work_orders add column cliente_id uuid references public.clientes (id) on delete set null;
alter table public.debts       add column cliente_id uuid references public.clientes (id) on delete set null;
alter table public.proformas   add column cliente_id uuid references public.clientes (id) on delete set null;
create index work_orders_cliente_idx on public.work_orders (cliente_id);
create index debts_cliente_idx on public.debts (cliente_id);
create index proformas_cliente_idx on public.proformas (cliente_id);

/**
 * El cliente de ese nombre, o uno nuevo. Guarda el teléfono si el cliente no
 * tenía. SECURITY DEFINER porque la llama un disparador con los permisos de
 * quien guarda (un cajero también crea clientes al registrar).
 */
create function public.cliente_para(p_nombre text, p_telefono text, p_proveedor boolean)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_clave text := public.normalizar_nombre(p_nombre);
  v_id uuid;
  v_tel text := regexp_replace(coalesce(p_telefono, ''), '\D', '', 'g');
begin
  if v_clave = '' then
    return null;
  end if;
  select id into v_id from public.clientes where clave = v_clave;
  if v_id is null then
    insert into public.clientes (nombre, telefono, proveedor)
    values (btrim(p_nombre), v_tel, coalesce(p_proveedor, false))
    on conflict (clave) do update set nombre = public.clientes.nombre
    returning id into v_id;
  elsif v_tel <> '' then
    update public.clientes set telefono = v_tel where id = v_id and telefono = '';
  end if;
  return v_id;
end;
$$;

create function public.asignar_cliente()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_table_name = 'work_orders' then
    new.cliente_id := public.cliente_para(new.party, new.phone, new.kind = 'Egreso');
  elsif tg_table_name = 'debts' then
    new.cliente_id := public.cliente_para(new.party, '', new.kind = 'PAGAR');
  elsif tg_table_name = 'proformas' then
    new.cliente_id := public.cliente_para(new.client, '', false);
  end if;
  return new;
end;
$$;

create trigger vincular_cliente before insert or update of party, phone on public.work_orders
  for each row execute function public.asignar_cliente();
create trigger vincular_cliente before insert or update of party on public.debts
  for each row execute function public.asignar_cliente();
create trigger vincular_cliente before insert or update of client on public.proformas
  for each row execute function public.asignar_cliente();

-- Lo que ya había: se vincula (y se crean sus clientes) de una vez.
update public.work_orders set cliente_id = public.cliente_para(party, phone, kind = 'Egreso');
update public.debts set cliente_id = public.cliente_para(party, '', kind = 'PAGAR');
update public.proformas set cliente_id = public.cliente_para(client, '', false);
-- Y el teléfono más reciente que se anotó de cada uno.
update public.clientes c set telefono = t.phone
from (
  select distinct on (cliente_id) cliente_id, regexp_replace(phone, '\D', '', 'g') as phone
  from public.work_orders
  where cliente_id is not null and regexp_replace(phone, '\D', '', 'g') <> ''
  order by cliente_id, created_at desc
) t
where c.id = t.cliente_id;

alter table public.clientes enable row level security;
revoke all on table public.clientes from public, anon, authenticated;
grant select, insert on table public.clientes to authenticated;
-- Corregir un teléfono o anotar el RUC es trabajo del mostrador; el nombre
-- también (un error de tipeo). Borrar, solo el gerente.
grant update (nombre, telefono, documento, notas, proveedor) on table public.clientes to authenticated;
grant delete on table public.clientes to authenticated;
create policy clientes_ver on public.clientes for select to authenticated using (public.puede_ver());
create policy clientes_crear on public.clientes for insert to authenticated with check (public.puede_registrar());
create policy clientes_corregir on public.clientes for update to authenticated
  using (public.puede_registrar()) with check (public.puede_registrar());
create policy clientes_borrar on public.clientes for delete to authenticated using (public.es_gerente());

revoke execute on function public.cliente_para(text, text, boolean) from public, anon, authenticated;
revoke execute on function public.asignar_cliente() from public, anon, authenticated;
revoke execute on function public.normalizar_nombre(text) from public, anon;
grant execute on function public.normalizar_nombre(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Catálogo: productos y su precio por cantidad
-- ---------------------------------------------------------------------------
create table public.productos (
  id         uuid primary key default gen_random_uuid(),
  nombre     text not null check (btrim(nombre) <> ''),
  clave      text generated always as (public.normalizar_nombre(nombre)) stored,
  -- En qué se cuenta y se cobra: el precio es «por» esta unidad.
  unidad     text not null default 'unidad'
    check (unidad in ('unidad', 'ciento', 'millar', 'm2', 'metro', 'hoja', 'juego')),
  categoria  text not null default 'Ventas',
  activo     boolean not null default true,
  created_at timestamptz not null default now(),
  constraint productos_clave_unica unique (clave)
);

create table public.precios_producto (
  producto_id uuid not null references public.productos (id) on delete cascade,
  -- Desde cuántas unidades vale este precio.
  desde       numeric(12, 2) not null check (desde > 0),
  -- Precio por unidad a partir de esa cantidad.
  precio      numeric(12, 2) not null check (precio > 0),
  primary key (producto_id, desde)
);

alter table public.productos enable row level security;
alter table public.precios_producto enable row level security;
revoke all on table public.productos, public.precios_producto from public, anon, authenticated;
grant select, insert, update, delete on table public.productos, public.precios_producto to authenticated;
create policy productos_ver on public.productos for select to authenticated using (public.puede_ver());
create policy productos_gestionar on public.productos for all to authenticated
  using (public.es_gerente()) with check (public.es_gerente());
create policy precios_ver on public.precios_producto for select to authenticated using (public.puede_ver());
create policy precios_gestionar on public.precios_producto for all to authenticated
  using (public.es_gerente()) with check (public.es_gerente());

-- ---------------------------------------------------------------------------
-- Aprobación del diseño: una nota en el historial del trabajo
-- ---------------------------------------------------------------------------
alter table public.work_order_events add column nota text not null default '';

drop function if exists public.avanzar_trabajo(uuid, text, text);

create function public.avanzar_trabajo(p_id uuid, p_estado text, p_author text, p_nota text default '')
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.puede_registrar() then
    raise exception 'Esta cuenta no puede mover trabajos' using errcode = '42501';
  end if;
  if p_estado not in ('recibido', 'diseno', 'aprobacion', 'produccion', 'listo', 'entregado') then
    raise exception 'Estado desconocido: %', p_estado;
  end if;
  update public.work_orders set estado = p_estado, estado_at = now() where id = p_id;
  if not found then
    raise exception 'El pedido no existe';
  end if;
  insert into public.work_order_events (work_order_id, estado, author, nota)
  values (p_id, p_estado, coalesce(p_author, ''), left(coalesce(p_nota, ''), 200));
end;
$$;

revoke execute on function public.avanzar_trabajo(uuid, text, text, text) from public, anon;
grant execute on function public.avanzar_trabajo(uuid, text, text, text) to authenticated, service_role;

notify pgrst, 'reload schema';

-- ============================================================================
-- COMPROBACIONES
--   select count(*) from public.clientes;
--   select count(*) filter (where cliente_id is null) from public.work_orders;  -- 0
-- ROLLBACK (a mano)
--   drop trigger vincular_cliente on public.work_orders; (y en debts, proformas)
--   alter table ... drop column cliente_id; drop table public.clientes, public.precios_producto, public.productos;
--   drop function public.asignar_cliente(), public.cliente_para(text, text, boolean), public.normalizar_nombre(text);
-- ============================================================================
