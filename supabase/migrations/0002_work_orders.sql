-- ============================================================================
-- Tairos.rc — Pedidos con varios trabajos y adelantos
-- Ejecutar DESPUES de 0001_init.sql.
--
-- Un "pedido" (work_order) es lo que el cliente encarga: puede tener varios
-- trabajos, cada uno con su monto. De un pedido nacen hasta dos registros:
--   * un asiento en el libro, por el monto realmente adelantado
--   * una cuenta pendiente en deudas, por el saldo que queda
-- Si el cliente paga todo, no hay deuda. Si se lleva el trabajo al credito
-- (adelanto 0), no hay asiento porque no se movio dinero.
-- ============================================================================

create table if not exists public.work_orders (
  id         uuid primary key default gen_random_uuid(),
  kind       text not null check (kind in ('Ingreso', 'Egreso')),
  party      text not null,
  category   text not null,
  total      numeric(12, 2) not null check (total > 0),
  advance    numeric(12, 2) not null default 0 check (advance >= 0),
  notes      text not null default '',
  author     text not null default 'Sistema',
  created_at timestamptz not null default now(),
  constraint work_orders_advance_within_total check (advance <= total)
);

create table if not exists public.work_order_items (
  id            uuid primary key default gen_random_uuid(),
  work_order_id uuid not null references public.work_orders (id) on delete cascade,
  position      int not null default 1,
  description   text not null,
  amount        numeric(12, 2) not null check (amount > 0)
);

create index if not exists work_order_items_order_idx
  on public.work_order_items (work_order_id, position);

-- Enlace desde el asiento y desde la deuda hacia su pedido de origen.
alter table public.transactions
  add column if not exists work_order_id uuid references public.work_orders (id) on delete set null;

alter table public.debts
  add column if not exists work_order_id uuid references public.work_orders (id) on delete set null;

create index if not exists transactions_work_order_idx on public.transactions (work_order_id);
create index if not exists debts_work_order_idx        on public.debts (work_order_id);

-- La vista de saldos debe arrastrar la nueva columna. `create or replace` no
-- permite insertar una columna en medio, asi que se recrea desde cero.
drop view if exists public.debts_with_balance;

create view public.debts_with_balance as
select
  d.id,
  d.kind,
  d.party,
  d.concept,
  d.total,
  d.due_date,
  d.created_at,
  d.work_order_id,
  coalesce(sum(p.amount), 0)::numeric(12, 2)             as paid,
  (d.total - coalesce(sum(p.amount), 0))::numeric(12, 2) as balance,
  case
    when coalesce(sum(p.amount), 0) >= d.total then 'Cancelado'
    when coalesce(sum(p.amount), 0) > 0        then 'Parcial'
    else 'Pendiente'
  end                                                    as status
from public.debts d
left join public.debt_payments p on p.debt_id = d.id
group by d.id;

-- ---------------------------------------------------------------------------
-- register_work_order — crea pedido, trabajos, asiento y deuda en una sola
-- transaccion. Sin esto, un fallo a media secuencia dejaria el pedido a medias.
--
-- p_items: [{"description": "1,000 volantes A6", "amount": 240}, ...]
-- Devuelve: {"work_order_id": ..., "transaction_id": ..., "debt_id": ...}
-- ---------------------------------------------------------------------------
create or replace function public.register_work_order(
  p_kind     text,
  p_party    text,
  p_category text,
  p_payment  text,
  p_advance  numeric,
  p_notes    text,
  p_author   text,
  p_items    jsonb
) returns jsonb
language plpgsql
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

  insert into public.work_orders (kind, party, category, total, advance, notes, author)
  values (p_kind, p_party, p_category, v_total, p_advance, coalesce(p_notes, ''), p_author)
  returning id into v_order_id;

  insert into public.work_order_items (work_order_id, position, description, amount)
  select v_order_id, ordinality, item->>'description', (item->>'amount')::numeric
  from jsonb_array_elements(p_items) with ordinality as t(item, ordinality);

  -- Asiento: solo si entro (o salio) dinero de verdad.
  if p_advance > 0 then
    insert into public.transactions
      (type, amount, category, party, concept, payment, status, author, notes, source, work_order_id)
    values (
      p_kind,
      p_advance,
      p_category,
      p_party,
      case when p_advance < v_total
           then 'Adelanto de: ' || v_summary
           else v_summary end,
      p_payment,
      'Completado',
      p_author,
      coalesce(p_notes, ''),
      'manual',
      v_order_id
    )
    returning id into v_tx_id;
  end if;

  -- Deuda: por el saldo que queda pendiente.
  v_balance := v_total - p_advance;
  if v_balance > 0 then
    insert into public.debts (kind, party, concept, total, work_order_id)
    values (
      case when p_kind = 'Ingreso' then 'COBRAR' else 'PAGAR' end,
      p_party,
      'Saldo de: ' || v_summary,
      v_balance,
      v_order_id
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

-- ---------------------------------------------------------------------------
-- RLS de las tablas nuevas (mismo criterio abierto que 0001_init.sql).
-- ---------------------------------------------------------------------------
alter table public.work_orders      enable row level security;
alter table public.work_order_items enable row level security;

drop policy if exists anon_full_work_orders      on public.work_orders;
drop policy if exists anon_full_work_order_items on public.work_order_items;

create policy anon_full_work_orders      on public.work_orders      for all using (true) with check (true);
create policy anon_full_work_order_items on public.work_order_items for all using (true) with check (true);
