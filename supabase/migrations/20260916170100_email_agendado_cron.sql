-- ============================================================================
-- E-mail agendado -- a agenda (16/09/2026)
--
-- ⚠️ APLICAR SÓ DEPOIS de 20260916170000_email_agendado.sql e da edge function
-- `dispatch-scheduled-emails` publicada.
--
-- CADÊNCIA */1, como a mensagem agendada do chat: a pessoa marca hora cheia.
-- Diferente dela, o cron só chama a function quando EXISTE e-mail vencido (ou
-- preso em 'enviando' há mais de 15 min). No minuto sem nada, é uma leitura no
-- índice parcial email_agendados_fila e nenhuma chamada HTTP.
--
-- A anon key abaixo é a mesma dos crons do purge-chat-media e do
-- dispatch-scheduled-messages: pública por design (está no .env commitado).
-- A function tem verify_jwt = true no config.toml: é esse o portão.
--
-- cron.schedule com nome que já existe substitui o job: reaplicar é seguro.
-- ============================================================================

SELECT cron.schedule(
  'dispatch-scheduled-emails',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := 'https://vbngjzovjhkmietztffo.supabase.co/functions/v1/dispatch-scheduled-emails',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZibmdqem92amhrbWlldHp0ZmZvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE4MDM1MTUsImV4cCI6MjA4NzM3OTUxNX0.A9O36VZMT3x0OlnvjyEUwfa7TwLXkATTqw1dhMpJmGQ"}'::jsonb,
    body := '{}'::jsonb
  ) AS request_id
  WHERE EXISTS (
    SELECT 1 FROM public.email_agendados
     WHERE (status = 'agendado' AND agendar_para <= now())
        OR (status = 'enviando' AND updated_at < now() - interval '15 minutes')
  );
  $$
);

-- Conferência: deve devolver uma linha com active = true.
-- SELECT jobid, jobname, schedule, active FROM cron.job WHERE jobname = 'dispatch-scheduled-emails';
