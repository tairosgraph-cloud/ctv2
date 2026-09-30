-- ============================================================================
-- Tairos.rc — Los arreglos escritos sobre un dictado
-- Ejecutar DESPUÉS de 0010_auditoria_dictado.sql.
-- ============================================================================
--
-- Cuando el intérprete se equivoca, quien registra escribe el arreglo («eran
-- 280 y dejó 100 en yape») y el intérprete vuelve a pasar con el borrador
-- delante. Ese segundo paso deja su propia fila en voice_extractions, apuntando
-- con `corrige` a la del dictado que arregla y guardando en `arreglo` lo que se
-- escribió (la `transcripcion` sigue siendo la frase original, para no perder
-- de vista qué transcribió el micrófono).
--
-- Así se puede medir lo único que importa de esta función: cuántos dictados
-- necesitaron un arreglo, y si el arreglo bastó (la fila corregida es la que
-- acaba confirmada).
--
-- El arreglo lleva palabras de una persona sobre un cliente: lo borra la misma
-- purga de los 90 días, que aquí se amplía para incluirlo.
-- ============================================================================

alter table public.voice_extractions
  add column arreglo text check (arreglo is null or char_length(arreglo) between 1 and 1000),
  add column corrige uuid references public.voice_extractions (id) on delete set null;

comment on column public.voice_extractions.arreglo is
  'Lo que una persona escribió para corregir el borrador de la fila `corrige`.';
comment on column public.voice_extractions.corrige is
  'La fila del dictado que esta corrige; null en un dictado normal.';

create index voice_extractions_corrige_idx on public.voice_extractions (corrige)
  where corrige is not null;

-- La purga de los 90 días también se lleva el arreglo: es texto de una persona
-- sobre un cliente, igual que la transcripción.
create or replace function public.purgar_dictados(p_dias integer default 90)
returns integer
language sql
security definer
set search_path = public
as $$
  with purgados as (
    update public.voice_extractions
    set transcripcion = null, extraccion = null, arreglo = null, purgada_at = now()
    where purgada_at is null and created_at < now() - make_interval(days => greatest(p_dias, 1))
    returning 1
  )
  select count(*)::integer from purgados
$$;

revoke execute on function public.purgar_dictados(integer) from public, anon, authenticated;

notify pgrst, 'reload schema';

-- ============================================================================
-- COMPROBACIONES
-- ============================================================================
--
-- a) anon sigue sin ver nada y el arreglo no se puede reescribir:
--      select has_table_privilege('anon', 'public.voice_extractions', 'SELECT');  -- false
--      select has_column_privilege('authenticated', 'public.voice_extractions', 'arreglo', 'UPDATE'); -- false
--
-- b) ¿Cuántos dictados necesitaron que se los arreglara por escrito?
--      select v.origen,
--             count(*) as dictados,
--             count(c.id) as con_arreglo,
--             round(100.0 * count(c.id) / greatest(count(*), 1), 1) as pct
--      from public.voice_extractions v
--      left join public.voice_extractions c on c.corrige = v.id
--      where v.corrige is null
--      group by v.origen;
--
-- c) ¿Bastó el arreglo? (la fila corregida es la que se confirma)
--      select count(*) filter (where confirmada_at is not null) as guardados,
--             count(*) as arreglos
--      from public.voice_extractions where corrige is not null;
--
-- ============================================================================
-- ROLLBACK
-- ============================================================================
--
--   drop index public.voice_extractions_corrige_idx;
--   alter table public.voice_extractions drop column corrige, drop column arreglo;
--   -- y volver a crear purgar_dictados sin `arreglo` (0010).
