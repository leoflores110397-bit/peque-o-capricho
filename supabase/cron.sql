-- =====================================================================
-- Tarea automática de cada noche: resumen por email + copia de seguridad.
-- Correr en Supabase > SQL Editor DESPUÉS de publicar la función cierre-diario.
-- Reemplazar TU-PROYECTO y TU-CLAVE-SECRETA (la misma que CRON_SECRET).
-- =====================================================================
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 23:30 hora de Córdoba = 02:30 UTC
select cron.unschedule('cierre-diario') where exists (select 1 from cron.job where jobname = 'cierre-diario');
select cron.schedule(
  'cierre-diario',
  '30 2 * * *',
  $$
  select net.http_post(
    url := 'https://TU-PROYECTO.supabase.co/functions/v1/cierre-diario',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', 'TU-CLAVE-SECRETA'),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $$
);
