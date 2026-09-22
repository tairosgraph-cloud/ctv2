-- ============================================================================
-- Tairos.rc — Qué se dictó, cuánto hubo que corregirlo y cuánto se usa
-- Ejecutar DESPUÉS de 0009_cuentas_autorizadas.sql.
-- ============================================================================
--
-- voice_extractions: cada dictado deja una fila con la frase, lo que el
-- intérprete entendió (el modelo o las reglas), cuánto tardó y cuánto costó.
-- Al guardar el formulario se completa con los campos que la persona tuvo que
-- cambiar. Con eso se mide el acierto de verdad, en el mostrador.
--
-- La escribe el navegador (no la Edge Function) para cubrir también el
-- dictado con reglas, que nunca pasa por la función. Nunca bloquea: si falla
-- el registro, el asiento se guarda igual. Sin audio: solo el texto.
--
-- La frase y la extracción llevan nombres y teléfonos de clientes: a los 90
-- días se borran (purgar_dictados) y quedan solo las métricas.
--
-- uso_dictado: cuántas veces al día llama cada cuenta al intérprete
-- inteligente. La Edge Function lo consulta antes de gastar la clave.
-- ============================================================================

create table public.voice_extractions (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  user_id         uuid default auth.uid() references auth.users (id) on delete set null,
  -- null tras la purga de los 90 días.
  transcripcion   text check (transcripcion is null or char_length(transcripcion) between 1 and 1000),
  extraccion      jsonb,
  purgada_at      timestamptz,
  intent          text not null,
  origen          text not null check (origen in ('llm', 'reglas')),
  modelo          text,
  aviso           text,
  ms              integer check (ms >= 0),
  tokens_entrada  integer check (tokens_entrada >= 0),
  tokens_cache    integer check (tokens_cache >= 0),
  tokens_salida   integer check (tokens_salida >= 0),
  -- Se rellenan al guardar el formulario; null = se descartó sin guardar.
  confirmada_at   timestamptz,
  campos_editados text[] not null default '{}',
  registro_tipo   text check (registro_tipo in ('pedido', 'proforma', 'deuda', 'abono')),
  registro_id     uuid,
  check (purgada_at is not null or (transcripcion is not null and extraccion is not null))
);

create index voice_extractions_created_at_idx on public.voice_extractions (created_at desc);

alter table public.voice_extractions enable row level security;

-- Las tablas nuevas nacen con permisos para los roles de la API (aviso de
-- 0005): se retira todo y se concede solo lo necesario.
revoke all on table public.voice_extractions from public, anon, authenticated;
grant select, insert on table public.voice_extractions to authenticated;
-- Lo dictado no se reescribe: solo se puede completar la confirmación.
grant update (confirmada_at, campos_editados, registro_tipo, registro_id)
  on table public.voice_extractions to authenticated;

-- Cada cuenta, lo suyo; y solo cuentas activas (0009).
create policy dictado_insertar on public.voice_extractions
  for insert to authenticated with check (user_id = auth.uid() and public.puede_ver());
create policy dictado_leer on public.voice_extractions
  for select to authenticated using (user_id = auth.uid() and public.puede_ver());
create policy dictado_confirmar on public.voice_extractions
  for update to authenticated
  using (user_id = auth.uid() and public.puede_ver())
  with check (user_id = auth.uid() and public.puede_ver());

-- ---------------------------------------------------------------------------
-- Purga: a los 90 días se borra lo que identifica a alguien.
-- 0011 la programa a diario; también se puede lanzar a mano.
-- ---------------------------------------------------------------------------
create function public.purgar_dictados(p_dias integer default 90)
returns integer
language sql
security definer
set search_path = public
as $$
  with purgados as (
    update public.voice_extractions
    set transcripcion = null, extraccion = null, purgada_at = now()
    where purgada_at is null and created_at < now() - make_interval(days => greatest(p_dias, 1))
    returning 1
  )
  select count(*)::integer from purgados
$$;

revoke execute on function public.purgar_dictados(integer) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- uso_dictado: el freno de gasto por cuenta.
--
-- Nadie la lee ni la escribe directamente: solo contar_dictado(), que suma
-- una llamada de quien pregunta y devuelve cuántas lleva hoy (día de Lima).
-- La Edge Function decide con su propio límite; quien llame a esto por su
-- cuenta solo consigue gastar su propio cupo.
-- ---------------------------------------------------------------------------
create table public.uso_dictado (
  user_id  uuid not null references auth.users (id) on delete cascade,
  dia      date not null,
  llamadas integer not null default 0 check (llamadas >= 0),
  primary key (user_id, dia)
);

alter table public.uso_dictado enable row level security;
revoke all on table public.uso_dictado from public, anon, authenticated;

create function public.contar_dictado()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_llamadas integer;
begin
  if auth.uid() is null or not public.puede_registrar() then
    raise exception 'Cuenta sin permiso para dictar' using errcode = '42501';
  end if;
  insert into public.uso_dictado as u (user_id, dia, llamadas)
  values (auth.uid(), (now() at time zone 'America/Lima')::date, 1)
  on conflict (user_id, dia) do update set llamadas = u.llamadas + 1
  returning llamadas into v_llamadas;
  return v_llamadas;
end;
$$;

revoke execute on function public.contar_dictado() from public, anon;
grant execute on function public.contar_dictado() to authenticated;

notify pgrst, 'reload schema';

-- ============================================================================
-- COMPROBACIONES
-- ============================================================================
--
-- a) RLS activa y sin nada para anon:
--      select has_table_privilege('anon', 'public.voice_extractions', 'SELECT');  -- false
--      select has_function_privilege('anon', 'public.contar_dictado()', 'EXECUTE'); -- false
--
-- b) Acierto en el mostrador (dictados guardados):
--      select origen, count(*) as guardados,
--             round(avg(cardinality(campos_editados)), 2) as campos_corregidos_por_dictado,
--             percentile_cont(0.5) within group (order by ms) as ms_p50,
--             percentile_cont(0.95) within group (order by ms) as ms_p95
--      from public.voice_extractions
--      where confirmada_at is not null
--      group by origen;
--
-- c) Uso por día:
--      select dia, sum(llamadas) from public.uso_dictado group by dia order by dia desc;
--
-- ============================================================================
-- ROLLBACK
-- ============================================================================
--
--   drop function public.contar_dictado();
--   drop table public.uso_dictado;
--   drop function public.purgar_dictados(integer);
--   drop table public.voice_extractions;
