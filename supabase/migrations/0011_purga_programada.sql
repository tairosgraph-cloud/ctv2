-- ============================================================================
-- Tairos.rc — La purga de los dictados, todos los días sola
-- Ejecutar DESPUÉS de 0010_auditoria_dictado.sql.
-- ============================================================================
--
-- Va aparte de 0010 a propósito: pg_cron es una extensión, y si en algún
-- entorno no se pudiera instalar, la auditoría y el freno de gasto seguirían
-- aplicados. En ese caso, la purga se lanza a mano:
--      select public.purgar_dictados();
--
-- A las 03:00 de Lima (08:00 UTC), cuando nadie está dictando.
-- ============================================================================

create extension if not exists pg_cron;

-- Reprogramar sin duplicar: si ya existía, se sustituye.
select cron.unschedule(jobid) from cron.job where jobname = 'purgar-dictados';
select cron.schedule('purgar-dictados', '0 8 * * *', $$select public.purgar_dictados(90)$$);

-- ============================================================================
-- COMPROBACIONES
-- ============================================================================
--
--   select jobname, schedule, command, active from cron.job;
--   select status, start_time, return_message from cron.job_run_details
--   order by start_time desc limit 5;
--
-- ROLLBACK
--   select cron.unschedule('purgar-dictados');
