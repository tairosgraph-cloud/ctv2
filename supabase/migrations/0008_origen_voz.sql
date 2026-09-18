-- ============================================================================
-- Tairos.rc — El asiento dictado queda marcado como dictado
-- Ejecutar DESPUES de 0007_cerrar_anon_restante.sql.
-- ============================================================================
--
-- `transactions.source` admite 'voz' desde 0001, pero ningún camino de
-- escritura lo usaba: register_work_order insertaba siempre el literal
-- 'manual', y un pedido dictado era indistinguible de uno tecleado. Sin ese
-- dato no hay forma de medir, con uso real, cuánto hay que corregir lo que
-- rellena el dictado.
--
-- register_work_order gana `p_source`, al final y con valor por defecto
-- 'manual': quien la llama con los nueve parámetros de siempre —incluido el
-- frontend ya desplegado— sigue funcionando igual.
--
-- update_work_order NO cambia: al corregir un asiento existente hace UPDATE
-- sin tocar `source`, así que el origen se conserva; y cuando la corrección
-- crea un asiento que no existía, 'manual' es lo cierto.
--
-- Cambiar la lista de argumentos crearía una sobrecarga en vez de reemplazar
-- (mismo motivo que en 0003), así que se borra la versión anterior. Con el
-- DROP se pierden sus permisos: se vuelven a declarar abajo, igual que 0005.
-- ============================================================================

drop function if exists public.register_work_order(
  text, text, text, text, text, numeric, text, text, jsonb
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
  p_source   text default 'manual'
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

-- PostgreSQL concede EXECUTE a PUBLIC en toda función nueva (0007 solo quitó
-- el permiso explícito de `anon`, no este): sin sesión no debe poder invocarse.
revoke execute on function
  public.register_work_order(text, text, text, text, text, numeric, text, text, jsonb, text)
from public, anon;

grant execute on function
  public.register_work_order(text, text, text, text, text, numeric, text, text, jsonb, text)
to authenticated, service_role;

-- Que la API vea la nueva firma sin esperar a que refresque su caché.
notify pgrst, 'reload schema';

-- ============================================================================
-- COMPROBACIONES
-- ============================================================================
--
-- a) Una sola versión de la función, con diez argumentos, INVOKER:
--
--    select p.oid::regprocedure, p.prosecdef from pg_proc p
--    join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.proname = 'register_work_order';
--
-- b) anon no puede ejecutarla; authenticated sí:
--
--    select has_function_privilege('anon', p.oid, 'EXECUTE') as anon,
--           has_function_privilege('authenticated', p.oid, 'EXECUTE') as autenticado
--    from pg_proc p where p.proname = 'register_work_order';
--
-- ============================================================================
-- ROLLBACK — volver a la firma de 0003 (el origen vuelve a ser siempre 'manual')
-- ============================================================================
--
-- Reaplicar el bloque `create or replace function public.register_work_order`
-- de 0003_phone_and_edit.sql tras
--   drop function public.register_work_order(text, text, text, text, text, numeric, text, text, jsonb, text);
-- y volver a declarar el revoke/grant de 0005 sobre la firma de nueve argumentos.
