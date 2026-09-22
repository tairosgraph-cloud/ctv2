-- ============================================================================
-- Tairos.rc — Cada pedido sabe en qué va y para cuándo es
-- Ejecutar DESPUÉS de 0012_cobro_de_proformas.sql.
-- ============================================================================
--
-- Hasta aquí un pedido solo sabía de dinero. La pregunta de cada día en el
-- mostrador —«¿ya está mi pedido?»— no tenía respuesta en el sistema.
--
-- work_orders gana:
--   estado     recibido → diseno → aprobacion → produccion → listo → entregado
--   entrega    la fecha comprometida (null = sin fecha)
--   estado_at  desde cuándo está en ese estado
-- y work_order_events guarda cada cambio (quién y cuándo).
--
-- Una venta al instante (copias, un sello que ya estaba hecho) nace
-- «entregado» y no ocupa el tablero; un encargo nace «recibido». Los pedidos
-- que ya existían quedan como entregados: no hay forma de saber en qué iban.
--
-- Mover un trabajo de estado o cambiarle la fecha es trabajo diario del
-- cajero, pero 0009 solo deja corregir pedidos al gerente. Por eso va por dos
-- funciones que comprueban puede_registrar() y solo tocan esas columnas.
--
-- pedido_desde_proforma(): la cotización aceptada pasa a pedido (con su
-- adelanto o al crédito) en una sola transacción, igual que cobrar_proforma.
-- ============================================================================

alter table public.work_orders
  add column estado text not null default 'entregado'
    check (estado in ('recibido', 'diseno', 'aprobacion', 'produccion', 'listo', 'entregado')),
  add column entrega date,
  add column estado_at timestamptz not null default now();

create index work_orders_pendientes_idx on public.work_orders (entrega) where estado <> 'entregado';

alter table public.proformas
  add column work_order_id uuid references public.work_orders (id) on delete set null;

create table public.work_order_events (
  id            uuid primary key default gen_random_uuid(),
  work_order_id uuid not null references public.work_orders (id) on delete cascade,
  estado        text not null,
  created_at    timestamptz not null default now(),
  user_id       uuid default auth.uid() references auth.users (id) on delete set null,
  author        text not null default ''
);

create index work_order_events_orden_idx on public.work_order_events (work_order_id, created_at);

alter table public.work_order_events enable row level security;
revoke all on table public.work_order_events from public, anon, authenticated;
grant select, insert on table public.work_order_events to authenticated;
create policy trabajos_historial_ver on public.work_order_events
  for select to authenticated using (public.puede_ver());
create policy trabajos_historial_anotar on public.work_order_events
  for insert to authenticated with check (public.puede_registrar() and user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- register_work_order gana p_estado y p_entrega, al final y con valor por
-- defecto: quien la llama como antes sigue funcionando igual. Cambiar la lista
-- de argumentos obliga a borrarla (0003, 0008) y a repetir sus permisos.
-- ---------------------------------------------------------------------------
drop function if exists public.register_work_order(
  text, text, text, text, text, numeric, text, text, jsonb, text
);

create function public.register_work_order(
  p_kind     text,
  p_party    text,
  p_phone    text,
  p_category text,
  p_payment  text,
  p_advance  numeric,
  p_notes    text,
  p_author   text,
  p_items    jsonb,
  p_source   text default 'manual',
  p_estado   text default 'entregado',
  p_entrega  date default null
) returns jsonb
language plpgsql
security invoker
as $$
declare
  v_total    numeric(12, 2);
  v_summary  text;
  v_order_id uuid;
  v_tx_id    uuid;
  v_debt_id  uuid;
  v_balance  numeric(12, 2);
begin
  if jsonb_array_length(coalesce(p_items, '[]'::jsonb)) = 0 then
    raise exception 'El pedido necesita al menos un trabajo';
  end if;

  select
    sum((item->>'amount')::numeric),
    string_agg(item->>'description', ' + ' order by ordinality)
  into v_total, v_summary
  from jsonb_array_elements(p_items) with ordinality as t(item, ordinality);

  if v_total is null or v_total <= 0 then
    raise exception 'El total del pedido debe ser mayor a cero';
  end if;

  if p_advance < 0 or p_advance > v_total then
    raise exception 'El adelanto (%) debe estar entre 0 y el total (%)', p_advance, v_total;
  end if;

  insert into public.work_orders (kind, party, phone, category, total, advance, notes, author, estado, entrega)
  values (p_kind, p_party, coalesce(p_phone, ''), p_category, v_total, p_advance,
          coalesce(p_notes, ''), p_author, coalesce(p_estado, 'entregado'), p_entrega)
  returning id into v_order_id;

  insert into public.work_order_items (work_order_id, position, description, amount)
  select v_order_id, ordinality, item->>'description', (item->>'amount')::numeric
  from jsonb_array_elements(p_items) with ordinality as t(item, ordinality);

  insert into public.work_order_events (work_order_id, estado, author)
  values (v_order_id, coalesce(p_estado, 'entregado'), coalesce(p_author, ''));

  if p_advance > 0 then
    insert into public.transactions
      (type, amount, category, party, concept, payment, status, author, notes, source, work_order_id)
    values (
      p_kind, p_advance, p_category, p_party,
      case when p_advance < v_total then 'Adelanto de: ' || v_summary else v_summary end,
      p_payment, 'Completado', p_author, coalesce(p_notes, ''),
      coalesce(p_source, 'manual'), v_order_id
    )
    returning id into v_tx_id;
  end if;

  v_balance := v_total - p_advance;
  if v_balance > 0 then
    insert into public.debts (kind, party, concept, total, work_order_id)
    values (
      case when p_kind = 'Ingreso' then 'COBRAR' else 'PAGAR' end,
      p_party, 'Saldo de: ' || v_summary, v_balance, v_order_id
    )
    returning id into v_debt_id;
  end if;

  return jsonb_build_object(
    'work_order_id', v_order_id,
    'transaction_id', v_tx_id,
    'debt_id', v_debt_id
  );
end;
$$;

revoke execute on function
  public.register_work_order(text, text, text, text, text, numeric, text, text, jsonb, text, text, date)
from public, anon;
grant execute on function
  public.register_work_order(text, text, text, text, text, numeric, text, text, jsonb, text, text, date)
to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Mover un trabajo de estado y cambiarle la fecha.
-- ---------------------------------------------------------------------------
create function public.avanzar_trabajo(p_id uuid, p_estado text, p_author text)
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
  insert into public.work_order_events (work_order_id, estado, author)
  values (p_id, p_estado, coalesce(p_author, ''));
end;
$$;

create function public.fijar_entrega(p_id uuid, p_entrega date)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.puede_registrar() then
    raise exception 'Esta cuenta no puede cambiar fechas de entrega' using errcode = '42501';
  end if;
  update public.work_orders set entrega = p_entrega where id = p_id;
  if not found then
    raise exception 'El pedido no existe';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- De proforma aceptada a pedido, de una vez.
-- ---------------------------------------------------------------------------
create function public.pedido_desde_proforma(
  p_proforma uuid,
  p_payment  text,
  p_advance  numeric,
  p_author   text,
  p_phone    text default '',
  p_estado   text default 'recibido',
  p_entrega  date default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pf public.proformas%rowtype;
  v_ids jsonb;
begin
  if not public.puede_registrar() then
    raise exception 'Esta cuenta no puede registrar pedidos' using errcode = '42501';
  end if;

  select * into v_pf from public.proformas where id = p_proforma for update;
  if not found then
    raise exception 'La proforma no existe';
  end if;
  if v_pf.status = 'Convertida' then
    raise exception 'La proforma % ya se usó', v_pf.code;
  end if;
  if v_pf.status <> 'Vigente' then
    raise exception 'La proforma % está anulada', v_pf.code;
  end if;

  v_ids := public.register_work_order(
    'Ingreso', v_pf.client, p_phone, 'Ventas', p_payment, p_advance,
    'Desde la proforma ' || v_pf.code, p_author,
    jsonb_build_array(jsonb_build_object('description', v_pf.detail, 'amount', v_pf.total)),
    'proforma', p_estado, p_entrega
  );

  update public.proformas
  set status = 'Convertida',
      work_order_id = (v_ids ->> 'work_order_id')::uuid,
      transaction_id = nullif(v_ids ->> 'transaction_id', '')::uuid
  where id = p_proforma;

  return v_ids;
end;
$$;

revoke execute on function public.avanzar_trabajo(uuid, text, text) from public, anon;
revoke execute on function public.fijar_entrega(uuid, date) from public, anon;
revoke execute on function public.pedido_desde_proforma(uuid, text, numeric, text, text, text, date) from public, anon;
grant execute on function public.avanzar_trabajo(uuid, text, text) to authenticated, service_role;
grant execute on function public.fijar_entrega(uuid, date) to authenticated, service_role;
grant execute on function public.pedido_desde_proforma(uuid, text, numeric, text, text, text, date) to authenticated, service_role;

notify pgrst, 'reload schema';

-- ============================================================================
-- COMPROBACIONES
-- ============================================================================
--
--   select estado, count(*) from public.work_orders group by estado;
--   select p.oid::regprocedure from pg_proc p where p.proname = 'register_work_order';  -- una sola
--
-- ROLLBACK (a mano)
--   drop function public.pedido_desde_proforma(uuid, text, numeric, text, text, text, date);
--   drop function public.fijar_entrega(uuid, date);
--   drop function public.avanzar_trabajo(uuid, text, text);
--   drop table public.work_order_events;
--   alter table public.proformas drop column work_order_id;
--   alter table public.work_orders drop column estado, drop column entrega, drop column estado_at;
--   -- y reaplicar register_work_order de 0008
