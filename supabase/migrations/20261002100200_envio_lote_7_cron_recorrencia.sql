-- ============================================================================
-- Envio em lote (DEM-0492) -- 7: cron da recorrencia  (02/10/2026)
--
-- A cada 5 minutos, cria o lote de cada recorrencia vencida
-- (fn_bulk_recurrence_run, migration 6). SQL puro: nada de http, nada sai daqui
-- -- quem entrega e o motor de sempre (dispatch-scheduled-messages, cron 75).
-- Idempotente: reagenda pelo nome do job.
-- ============================================================================
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'envio-lote-recorrencia';
SELECT cron.schedule('envio-lote-recorrencia', '*/5 * * * *', 'SELECT public.fn_bulk_recurrence_run()');
