-- ============================================================================
-- Tairos.rc — Guardar un producto con su escala de precios de una vez
-- Ejecutar DESPUÉS de 0014_clientes_y_catalogo.sql.
-- ============================================================================
--
-- Cambiar los precios de un producto es reemplazar su escala entera. Hecho en
-- varias llamadas desde el navegador, un corte a mitad dejaría el producto sin
-- precios. guardar_producto() lo hace en una transacción. Es SECURITY INVOKER:
-- pasa por la RLS de 0014, así que solo un gerente puede usarla.
-- ============================================================================

create function public.guardar_producto(
  p_id        uuid,
  p_nombre    text,
  p_unidad    text,
  p_categoria text,
  p_activo    boolean,
  p_precios   jsonb
) returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_id uuid := p_id;
begin
  if jsonb_array_length(coalesce(p_precios, '[]'::jsonb)) = 0 then
    raise exception 'El producto necesita al menos un precio';
  end if;

  if v_id is null then
    insert into public.productos (nombre, unidad, categoria, activo)
    values (btrim(p_nombre), p_unidad, coalesce(p_categoria, 'Ventas'), coalesce(p_activo, true))
    returning id into v_id;
  else
    update public.productos
    set nombre = btrim(p_nombre), unidad = p_unidad, categoria = coalesce(p_categoria, 'Ventas'),
        activo = coalesce(p_activo, true)
    where id = v_id;
    if not found then
      raise exception 'El producto no existe o tu cuenta no puede cambiar el catálogo' using errcode = '42501';
    end if;
    delete from public.precios_producto where producto_id = v_id;
  end if;

  insert into public.precios_producto (producto_id, desde, precio)
  select v_id, (p ->> 'desde')::numeric, (p ->> 'precio')::numeric
  from jsonb_array_elements(p_precios) as t(p);

  return v_id;
end;
$$;

revoke execute on function public.guardar_producto(uuid, text, text, text, boolean, jsonb) from public, anon;
grant execute on function public.guardar_producto(uuid, text, text, text, boolean, jsonb) to authenticated, service_role;

notify pgrst, 'reload schema';

-- ROLLBACK
--   drop function public.guardar_producto(uuid, text, text, text, boolean, jsonb);
