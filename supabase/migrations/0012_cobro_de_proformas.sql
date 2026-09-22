-- ============================================================================
-- Tairos.rc — Cobrar una proforma de una sola vez, y nunca sin gerente
-- Ejecutar DESPUÉS de 0011_purga_programada.sql.
-- ============================================================================
--
-- COBRAR UNA PROFORMA eran dos pasos desde el navegador: crear el asiento y
-- después marcar la proforma como convertida. Si el segundo fallaba (red, o un
-- cajero, a quien 0009 no deja corregir proformas), el asiento ya estaba
-- guardado, la proforma seguía «Vigente» y un segundo intento la cobraba otra
-- vez: dos ingresos por un solo pago. Además, nada impedía cobrar una proforma
-- anulada.
--
-- cobrar_proforma() hace las dos cosas en una transacción. Es SECURITY
-- DEFINER para que un cajero pueda marcar la proforma sin tener permiso de
-- corregirla en general; por eso comprueba ella misma que quien llama puede
-- registrar, y solo toca la fila que cobra.
--
-- EL ÚLTIMO GERENTE: la comprobación de 0009 corre al confirmar cada
-- transacción. Dos gerentes que se quitaran el papel a la vez verían cada uno
-- al otro todavía activo. Con un candado, la segunda comprobación espera a la
-- primera y ya ve su cambio.
-- ============================================================================

create function public.cobrar_proforma(p_id uuid, p_payment text, p_author text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pf public.proformas%rowtype;
  v_tx uuid;
begin
  if not public.puede_registrar() then
    raise exception 'Esta cuenta no puede cobrar proformas' using errcode = '42501';
  end if;

  select * into v_pf from public.proformas where id = p_id for update;
  if not found then
    raise exception 'La proforma no existe';
  end if;
  if v_pf.status = 'Convertida' then
    raise exception 'La proforma % ya fue cobrada', v_pf.code;
  end if;
  if v_pf.status <> 'Vigente' then
    raise exception 'La proforma % está anulada: no se puede cobrar', v_pf.code;
  end if;

  insert into public.transactions
    (type, amount, category, party, concept, payment, status, author, notes, source)
  values (
    'Ingreso', v_pf.total, 'Ventas', v_pf.client,
    'Cobro de proforma ' || v_pf.code || ': ' || v_pf.detail,
    p_payment, 'Completado', coalesce(nullif(trim(p_author), ''), 'Operador'),
    'Generado automáticamente al cobrar la proforma ' || v_pf.code || '.',
    'proforma'
  )
  returning id into v_tx;

  update public.proformas set status = 'Convertida', transaction_id = v_tx where id = p_id;

  return jsonb_build_object('transaction_id', v_tx);
end;
$$;

revoke execute on function public.cobrar_proforma(uuid, text, text) from public, anon;
grant execute on function public.cobrar_proforma(uuid, text, text) to authenticated, service_role;

create or replace function public.conservar_un_gerente()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Un cambio de papeles a la vez: la consulta de abajo ya ve el anterior.
  perform pg_advisory_xact_lock(hashtext('tairos.siempre_un_gerente'));
  if not exists (select 1 from public.profiles where rol = 'gerente' and activo) then
    raise exception 'Tiene que quedar al menos un gerente activo';
  end if;
  return null;
end;
$$;

revoke execute on function public.conservar_un_gerente() from public, anon, authenticated;

notify pgrst, 'reload schema';

-- ============================================================================
-- ROLLBACK
--   drop function public.cobrar_proforma(uuid, text, text);
--   -- y reaplicar conservar_un_gerente() de 0009 (sin el candado)
-- ============================================================================
