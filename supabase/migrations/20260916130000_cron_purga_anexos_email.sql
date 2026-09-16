-- ============================================================================
-- Agenda a faxina do anexo de e-mail que nunca foi enviado -- 1x por dia
--
-- O arquivo sobe assim que a pessoa anexa, e a send-email o apaga depois de
-- enviar. Quando o e-mail não é enviado, ninguém apaga: é esse resto que a
-- purge-email-anexos recolhe, e só na pasta `<tenant>/emails/` do bucket
-- whatsapp-media, onde não existe mídia de mensagem nem anexo de nota interna.
-- Ela só toca no que tem mais de 24 h, para não levar arquivo de tela aberta
-- nem o de um envio que falhou e vai ser tentado de novo.
--
-- ORDEM: publicar a edge function ANTES de aplicar esta agenda (a primeira
-- execução seria um 404 inofensivo, mas não há motivo para provocá-la).
--
-- 06:50 UTC = 03:50 em America/Sao_Paulo (UTC-3 fixo, BR sem DST desde 2019).
-- Meia hora depois da purge-chat-media (06:20) para as duas não disputarem o
-- mesmo bucket, e longe da janela de envio de WhatsApp (07:30-19:00).
--
-- A anon key abaixo é a mesma dos crons do purge-chat-media e do
-- dispatch-scheduled-messages, pública por design (está no .env commitado).
-- A function tem verify_jwt=true: é esse o portão.
--
-- Aplicar pelo SQL Editor. Idempotente: o unschedule só roda se a agenda existir.
-- ============================================================================

SELECT cron.unschedule('purge-email-anexos')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'purge-email-anexos');

SELECT cron.schedule(
  'purge-email-anexos',
  '50 6 * * *',
  $$
  SELECT net.http_post(
    url := 'https://vbngjzovjhkmietztffo.supabase.co/functions/v1/purge-email-anexos',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZibmdqem92amhrbWlldHp0ZmZvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE4MDM1MTUsImV4cCI6MjA4NzM3OTUxNX0.A9O36VZMT3x0OlnvjyEUwfa7TwLXkATTqw1dhMpJmGQ"}'::jsonb,
    body := '{}'::jsonb
  ) AS request_id;
  $$
);
