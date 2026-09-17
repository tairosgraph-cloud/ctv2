-- ============================================================================
-- Tairos.rc — Teléfono del cliente y edición de pedidos
-- Ejecutar DESPUES de 0002_work_orders.sql.
-- ============================================================================

alter table public.work_orders
  add column if not exists phone      text        not null default '',
  add column if not exists updated_at timestamptz;

-- ---------------------------------------------------------------------------
-- register_work_order gana el parametro p_phone. Cambiar la lista de
-- argumentos crearia una sobrecarga en vez de reemplazar, asi que se borra
-- primero la version anterior.
-- ---------------------------------------------------------------------------
drop function if exists public.register_work_order(
  text, text, text, text, numeric, text, text, jsonb
);

create or replace function public.register_work_order(
  p_kind     text,
  p_party    text,
  p_phone    text,
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

  insert into public.work_orders (kind, party, phone, category, total, advance, notes, author)
  values (p_kind, p_party, coalesce(p_phone, ''), p_category, v_total, p_advance,
          coalesce(p_notes, ''), p_author)
  returning id into v_order_id;

  insert into public.work_order_items (work_order_id, position, description, amount)
  select v_order_id, ordinality, item->>'description', (item->>'amount')::numeric
  from jsonb_array_elements(p_items) with ordinality as t(item, ordinality);

  if p_advance > 0 then
    insert into public.transactions
      (type, amount, category, party, concept, payment, status, author, notes, source, work_order_id)
    values (
      p_kind, p_advance, p_category, p_party,
      case when p_advance < v_total then 'Adelanto de: ' || v_summary else v_summary end,
      p_payment, 'Completado', p_author, coalesce(p_notes, ''), 'manual', v_order_id
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

-- ---------------------------------------------------------------------------
-- update_work_order — corrige un pedido ya registrado.
--
-- Rehace los trabajos, reajusta el asiento del adelanto y recalcula el saldo
-- de la deuda, todo en una sola transaccion. Lo unico que rechaza es dejar el
-- pedido por debajo de lo que ya se cobro: eso descuadraria la caja.
--
-- Transiciones que cubre:
--   adelanto 0 -> >0 : crea el asiento que no existia
--   adelanto >0 -> 0 : borra el asiento, porque ese dinero no se movio
--   saldo    0 -> >0 : crea la cuenta pendiente
--   saldo    >0 -> 0 : borra la cuenta, si no tiene abonos
-- ---------------------------------------------------------------------------
create or replace function public.update_work_order(
  p_order_id uuid,
  p_party    text,
  p_phone    text,
  p_category text,
  p_payment  text,
  p_advance  numeric,
  p_notes    text,
  p_items    jsonb
) returns jsonb
language plpgsql
as $$
declare
  v_order    public.work_orders%rowtype;
  v_total    numeric(12, 2);
  v_summary  text;
  v_balance  numeric(12, 2);
  v_paid     numeric(12, 2);
  v_tx_id    uuid;
  v_debt_id  uuid;
begin
  select * into v_order from public.work_orders where id = p_order_id for update;
  if not found then
    raise exception 'El pedido ya no existe';
  end if;

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
    raise exception 'El adelanto (S/ %) no puede superar el total (S/ %)', p_advance, v_total;
  end if;

  select id, coalesce((select sum(amount) from public.debt_payments where debt_id = d.id), 0)
  into v_debt_id, v_paid
  from public.debts d
  where d.work_order_id = p_order_id;

  v_paid    := coalesce(v_paid, 0);
  v_balance := v_total - p_advance;

  -- Ya se cobro mas de lo que quedaria pendiente: la correccion no cuadra.
  if v_balance < v_paid then
    raise exception
      'Ya se cobraron S/ % de este pedido. El total no puede quedar por debajo de S/ %',
      p_advance + v_paid, p_advance + v_paid;
  end if;

  update public.work_orders
  set party      = p_party,
      phone      = coalesce(p_phone, ''),
      category   = p_category,
      total      = v_total,
      advance    = p_advance,
      notes      = coalesce(p_notes, ''),
      updated_at = now()
  where id = p_order_id;

  delete from public.work_order_items where work_order_id = p_order_id;
  insert into public.work_order_items (work_order_id, position, description, amount)
  select p_order_id, ordinality, item->>'description', (item->>'amount')::numeric
  from jsonb_array_elements(p_items) with ordinality as t(item, ordinality);

  -- --- asiento del adelanto ---
  select id into v_tx_id from public.transactions where work_order_id = p_order_id limit 1;

  if p_advance > 0 then
    if v_tx_id is null then
      insert into public.transactions
        (type, amount, category, party, concept, payment, status, author, notes, source, work_order_id)
      values (
        v_order.kind, p_advance, p_category, p_party,
        case when p_advance < v_total then 'Adelanto de: ' || v_summary else v_summary end,
        p_payment, 'Completado', v_order.author, coalesce(p_notes, ''), 'manual', p_order_id
      )
      returning id into v_tx_id;
    else
      update public.transactions
      set amount   = p_advance,
          category = p_category,
          party    = p_party,
          concept  = case when p_advance < v_total
                          then 'Adelanto de: ' || v_summary
                          else v_summary end,
          payment  = p_payment,
          notes    = coalesce(p_notes, '')
      where id = v_tx_id;
    end if;
  elsif v_tx_id is not null then
    delete from public.transactions where id = v_tx_id;
    v_tx_id := null;
  end if;

  -- --- cuenta pendiente ---
  if v_balance > 0 then
    if v_debt_id is null then
      insert into public.debts (kind, party, concept, total, work_order_id)
      values (
        case when v_order.kind = 'Ingreso' then 'COBRAR' else 'PAGAR' end,
        p_party, 'Saldo de: ' || v_summary, v_balance, p_order_id
      )
      returning id into v_debt_id;
    else
      update public.debts
      set party = p_party, concept = 'Saldo de: ' || v_summary, total = v_balance
      where id = v_debt_id;
    end if;
  elsif v_debt_id is not null then
    delete from public.debts where id = v_debt_id;
    v_debt_id := null;
  end if;

  return jsonb_build_object(
    'work_order_id', p_order_id,
    'transaction_id', v_tx_id,
    'debt_id', v_debt_id
  );
end;
$$;
