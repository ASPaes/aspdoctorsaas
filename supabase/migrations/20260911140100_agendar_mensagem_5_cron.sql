-- ============================================================================
-- Mensagem agendada -- 5/5, o cron  (11/09/2026)
--
-- ⚠️ APLICAR SO DEPOIS que a edge function `dispatch-scheduled-messages`
-- estiver publicada. Antes disso o cron bateria numa URL que nao existe a cada
-- minuto.
--
-- CADENCIA */1: o operador marca hora cheia ("as 9h"). Cinco minutos de atraso
-- numa mensagem prometida ao cliente sao visiveis; num setor abrindo, nao.
-- O custo de uma execucao vazia e uma leitura no indice parcial
-- `idx_wa_sched_due`, que em tabela sem linha vencida nao encontra nada --
-- o mesmo perfil do `retry-waiting-conversations`, que ja roda */1.
--
-- cron.schedule com nome que ja existe SUBSTITUI o job, entao reaplicar este
-- arquivo e seguro.
--
-- A anon key abaixo e a mesma do cron do purge-chat-media e do
-- check-csat-timeout: publica por design (esta no .env commitado). Ela e o
-- portao do gateway, porque a function esta declarada com verify_jwt = true
-- no supabase/config.toml.
-- ============================================================================

SELECT cron.schedule(
  'dispatch-scheduled-messages',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := 'https://vbngjzovjhkmietztffo.supabase.co/functions/v1/dispatch-scheduled-messages',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZibmdqem92amhrbWlldHp0ZmZvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE4MDM1MTUsImV4cCI6MjA4NzM3OTUxNX0.A9O36VZMT3x0OlnvjyEUwfa7TwLXkATTqw1dhMpJmGQ"}'::jsonb,
    body := '{}'::jsonb
  ) AS request_id;
  $$
);

-- Conferencia: deve devolver uma linha com active = true.
-- SELECT jobname, schedule, active FROM cron.job WHERE jobname = 'dispatch-scheduled-messages';
