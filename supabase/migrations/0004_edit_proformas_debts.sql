-- ============================================================================
-- Tairos.rc — Corregir proformas, cuentas y abonos
-- Ejecutar DESPUES de 0003_phone_and_edit.sql.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- update_proforma — solo mientras la cotizacion siga vigente.
-- Una vez convertida genero un asiento de ingreso real: cambiarle el monto
-- lo desincronizaria de la caja.
-- ---------------------------------------------------------------------------
create or replace function public.update_proforma(
  p_id            uuid,
  p_client        text,
  p_detail        text,
  p_total         numeric,
  p_validity_days int
) returns void
language plpgsql
as $$
declare
  v_status text;
begin
  select status into v_status from public.proformas where id = p_id for update;

  if not found then
    raise exception 'La proforma ya no existe';
  end if;
  if v_status <> 'Vigente' then
    raise exception 'Esta proforma está %; ya no se puede editar', lower(v_status);
  end if;
  if p_total is null or p_total <= 0 then
    raise exception 'El monto cotizado debe ser mayor a cero';
  end if;

  update public.proformas
  set client        = p_client,
      detail        = p_detail,
      total         = p_total,
      validity_days = p_validity_days
  where id = p_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- annul_proforma — para las cotizaciones que el cliente rechaza.
-- Sin esto se quedaban como vigentes para siempre, inflando el total cotizado.
-- ---------------------------------------------------------------------------
create or replace function public.annul_proforma(p_id uuid) returns void
language plpgsql
as $$
declare
  v_status text;
begin
  select status into v_status from public.proformas where id = p_id for update;

  if not found then
    raise exception 'La proforma ya no existe';
  end if;
  if v_status = 'Convertida' then
    raise exception 'Esta proforma ya fue cobrada; anula su asiento en el libro';
  end if;

  update public.proformas set status = 'Anulada' where id = p_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- update_debt — corrige una cuenta creada a mano.
--
-- Las cuentas que nacen de un pedido tienen su total calculado por la orden
-- (total - adelanto); tocarlas aqui las desincronizaria, asi que se rechazan
-- y se corrigen desde el libro.
-- ---------------------------------------------------------------------------
create or replace function public.update_debt(
  p_id       uuid,
  p_party    text,
  p_concept  text,
  p_total    numeric,
  p_due_date date
) returns void
language plpgsql
as $$
declare
  v_order uuid;
  v_paid  numeric(12, 2);
begin
  select work_order_id into v_order from public.debts where id = p_id for update;

  if not found then
    raise exception 'La cuenta ya no existe';
  end if;
  if v_order is not null then
    raise exception 'Esta cuenta nace de una orden: corrígela desde el libro contable';
  end if;
  if p_total is null or p_total <= 0 then
    raise exception 'El monto debe ser mayor a cero';
  end if;

  select coalesce(sum(amount), 0) into v_paid
  from public.debt_payments where debt_id = p_id;

  if p_total < v_paid then
    raise exception 'Ya se abonaron S/ %; el total no puede quedar por debajo', v_paid;
  end if;

  update public.debts
  set party = p_party, concept = p_concept, total = p_total, due_date = p_due_date
  where id = p_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- delete_debt_payment — deshace un abono mal registrado.
--
-- Borra el abono y tambien el asiento que genero, en la misma transaccion:
-- si solo se borrara uno, la caja quedaria descuadrada.
-- ---------------------------------------------------------------------------
create or replace function public.delete_debt_payment(p_id uuid) returns void
language plpgsql
as $$
declare
  v_tx uuid;
begin
  select transaction_id into v_tx from public.debt_payments where id = p_id for update;

  if not found then
    raise exception 'El abono ya no existe';
  end if;

  delete from public.debt_payments where id = p_id;

  if v_tx is not null then
    delete from public.transactions where id = v_tx;
  end if;
end;
$$;
