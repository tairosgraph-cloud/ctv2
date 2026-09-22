-- ============================================================================
-- Tairos.rc — La vista de deudas lleva el cliente
-- Ejecutar DESPUÉS de 0015_guardar_producto.sql.
-- ============================================================================
--
-- debts_with_balance enumera sus columnas: la columna cliente_id de 0014 no
-- aparece hasta recrearla. Se añade al final (así CREATE OR REPLACE lo acepta)
-- y se mantiene security_invoker, que es lo que hace que respete la RLS (0005).
-- ============================================================================

create or replace view public.debts_with_balance with (security_invoker = on) as
select
  d.id,
  d.kind,
  d.party,
  d.concept,
  d.total,
  d.due_date,
  d.created_at,
  d.work_order_id,
  coalesce(sum(p.amount), 0::numeric)::numeric(12, 2) as paid,
  (d.total - coalesce(sum(p.amount), 0::numeric))::numeric(12, 2) as balance,
  case
    when coalesce(sum(p.amount), 0::numeric) >= d.total then 'Cancelado'::text
    when coalesce(sum(p.amount), 0::numeric) > 0::numeric then 'Parcial'::text
    else 'Pendiente'::text
  end as status,
  d.cliente_id
from public.debts d
left join public.debt_payments p on p.debt_id = d.id
group by d.id;

revoke all on table public.debts_with_balance from public, anon;
grant select on table public.debts_with_balance to authenticated;

notify pgrst, 'reload schema';

-- COMPROBACIÓN
--   select reloptions from pg_class where oid = 'public.debts_with_balance'::regclass;  -- {security_invoker=on}
