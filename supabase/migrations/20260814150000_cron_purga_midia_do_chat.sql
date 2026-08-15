-- Agenda a purga de mídia do chat — 1x por dia, de madrugada
--
-- Medido em 14/08/2026, com a retenção ligada em todos os setores:
--   26.248 arquivos elegíveis, ~11,3 GB — metade do bucket whatsapp-media.
--   Consysa + ASP + Digi Office concentram 6,9 GB (61%).
--
-- Teto da function: 25 lotes × 200 = 5.000 arquivos por execução. O backlog
-- inicial escoa em ~6 noites, de propósito: execução curta não arrisca o limite
-- de tempo da edge function, e um erro só custa uma noite.
--
-- POR QUE A RESPOSTA DO net.http_post NÃO IMPORTA AQUI:
-- o pg_net desiste de esperar a resposta em poucos segundos e a purga demora
-- mais que isso. O request já saiu e a function segue rodando do outro lado —
-- só o corpo da resposta se perde. É exatamente para isso que existe a tabela
-- chat_media_purge_runs: o resultado de cada execução é gravado por lá, não pelo
-- retorno HTTP.
--
-- A anon key abaixo é a mesma já usada no cron do check-csat-timeout e é pública
-- por design (está no .env commitado). A function tem verify_jwt=true, então ela
-- serve de portão: sem um JWT válido do projeto, ninguém dispara a purga de fora.

SELECT cron.unschedule('purge-chat-media')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'purge-chat-media');

-- 06:20 UTC = 03:20 em America/Sao_Paulo (UTC-3 fixo, BR sem DST desde 2019).
-- Fora do pico e longe da janela de envio de WhatsApp (07:30–19:00).
SELECT cron.schedule(
  'purge-chat-media',
  '20 6 * * *',
  $$
  SELECT net.http_post(
    url := 'https://vbngjzovjhkmietztffo.supabase.co/functions/v1/purge-chat-media',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZibmdqem92amhrbWlldHp0ZmZvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE4MDM1MTUsImV4cCI6MjA4NzM3OTUxNX0.A9O36VZMT3x0OlnvjyEUwfa7TwLXkATTqw1dhMpJmGQ"}'::jsonb,
    body := '{}'::jsonb
  ) AS request_id;
  $$
);
