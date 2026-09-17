-- ============================================================================
-- Tairos.rc — Esquema inicial
-- Ejecutar en: Supabase Dashboard > SQL Editor > New query
-- ============================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Secuencias para numeracion correlativa (reemplaza los IDs aleatorios del
-- prototipo HTML, que podian colisionar).
-- ---------------------------------------------------------------------------
create sequence if not exists voucher_seq  start 1;
create sequence if not exists proforma_seq start 1001;

-- ---------------------------------------------------------------------------
-- TRANSACTIONS — el libro contable diario
-- ---------------------------------------------------------------------------
create table if not exists public.transactions (
  id          uuid primary key default gen_random_uuid(),
  voucher     text not null unique default ('OP-' || lpad(nextval('voucher_seq')::text, 6, '0')),
  type        text not null check (type in ('Ingreso', 'Egreso')),
  amount      numeric(12, 2) not null check (amount > 0),
  category    text not null,
  party       text not null default 'General',
  concept     text not null,
  payment     text not null check (payment in ('Efectivo', 'Yape/Plin', 'Transferencia', 'Tarjeta')),
  status      text not null default 'Completado' check (status in ('Completado', 'Pendiente', 'Anulado')),
  occurred_at timestamptz not null default now(),
  author      text not null default 'Sistema',
  notes       text not null default '',
  source      text not null default 'manual' check (source in ('manual', 'voz', 'proforma', 'abono')),
  created_at  timestamptz not null default now()
);

create index if not exists transactions_occurred_at_idx on public.transactions (occurred_at desc);
create index if not exists transactions_type_idx        on public.transactions (type);
create index if not exists transactions_payment_idx     on public.transactions (payment);

-- ---------------------------------------------------------------------------
-- PROFORMAS — cotizaciones a clientes
-- ---------------------------------------------------------------------------
create table if not exists public.proformas (
  id             uuid primary key default gen_random_uuid(),
  code           text not null unique default ('PF-' || nextval('proforma_seq')::text),
  client         text not null,
  detail         text not null,
  total          numeric(12, 2) not null check (total > 0),
  validity_days  int not null default 15 check (validity_days > 0),
  status         text not null default 'Vigente' check (status in ('Vigente', 'Convertida', 'Anulada')),
  issued_at      date not null default current_date,
  transaction_id uuid references public.transactions (id) on delete set null,
  created_at     timestamptz not null default now()
);

create index if not exists proformas_status_idx on public.proformas (status);

-- ---------------------------------------------------------------------------
-- DEBTS — cuentas por cobrar y por pagar
-- ---------------------------------------------------------------------------
create table if not exists public.debts (
  id         uuid primary key default gen_random_uuid(),
  kind       text not null check (kind in ('COBRAR', 'PAGAR')),
  party      text not null,
  concept    text not null,
  total      numeric(12, 2) not null check (total > 0),
  due_date   date,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- DEBT_PAYMENTS — abonos parciales (el prototipo solo sabia liquidar al 100%)
-- ---------------------------------------------------------------------------
create table if not exists public.debt_payments (
  id             uuid primary key default gen_random_uuid(),
  debt_id        uuid not null references public.debts (id) on delete cascade,
  amount         numeric(12, 2) not null check (amount > 0),
  payment_method text not null default 'Efectivo'
                 check (payment_method in ('Efectivo', 'Yape/Plin', 'Transferencia', 'Tarjeta')),
  transaction_id uuid references public.transactions (id) on delete set null,
  paid_at        timestamptz not null default now()
);

create index if not exists debt_payments_debt_id_idx on public.debt_payments (debt_id);

-- ---------------------------------------------------------------------------
-- CASH_CLOSINGS — bitacora real de arqueos (antes solo mostraba un toast)
-- ---------------------------------------------------------------------------
create table if not exists public.cash_closings (
  id            uuid primary key default gen_random_uuid(),
  counted_cash  numeric(12, 2) not null,
  expected_cash numeric(12, 2) not null,
  difference    numeric(12, 2) generated always as (counted_cash - expected_cash) stored,
  opening_cash  numeric(12, 2) not null default 0,
  notes         text not null default '',
  author        text not null default 'Sistema',
  closed_at     timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- VISTA: deudas con saldo calculado a partir de sus abonos
-- ---------------------------------------------------------------------------
create or replace view public.debts_with_balance as
select
  d.id,
  d.kind,
  d.party,
  d.concept,
  d.total,
  d.due_date,
  d.created_at,
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
-- RLS
--
-- ATENCION: este proyecto arranca SIN autenticacion, tal como se pidio.
-- Las politicas de abajo dejan la base abierta a la anon key: cualquiera que
-- conozca la URL del proyecto puede leer y escribir tu contabilidad.
-- Es aceptable para desarrollo; NO publiques la app asi.
--
-- Cuando actives Supabase Auth: borra las cuatro politicas "anon_full_*",
-- descomenta el bloque del final y añade `owner uuid references auth.users`
-- a cada tabla.
-- ---------------------------------------------------------------------------
alter table public.transactions  enable row level security;
alter table public.proformas     enable row level security;
alter table public.debts         enable row level security;
alter table public.debt_payments enable row level security;
alter table public.cash_closings enable row level security;

drop policy if exists anon_full_transactions  on public.transactions;
drop policy if exists anon_full_proformas     on public.proformas;
drop policy if exists anon_full_debts         on public.debts;
drop policy if exists anon_full_debt_payments on public.debt_payments;
drop policy if exists anon_full_cash_closings on public.cash_closings;

create policy anon_full_transactions  on public.transactions  for all using (true) with check (true);
create policy anon_full_proformas     on public.proformas     for all using (true) with check (true);
create policy anon_full_debts         on public.debts         for all using (true) with check (true);
create policy anon_full_debt_payments on public.debt_payments for all using (true) with check (true);
create policy anon_full_cash_closings on public.cash_closings for all using (true) with check (true);

-- Version con autenticacion, para cuando la necesites:
--
-- alter table public.transactions add column owner uuid not null default auth.uid()
--   references auth.users (id) on delete cascade;
-- create policy owner_rw on public.transactions for all
--   using (auth.uid() = owner) with check (auth.uid() = owner);
