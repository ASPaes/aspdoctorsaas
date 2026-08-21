-- ============================================================================
-- O cron da fila do OEM passa a carimbar que rodou, mesmo sem ter o que enviar.
--
-- Como estava: cron_oem_sync desiste antes de chamar a edge function quando a
-- fila está vazia — isso é certo, 720 chamadas por dia para não fazer nada é
-- egress à toa. O erro é que o carimbo em cron_estado vinha DEPOIS dessa
-- desistência. Com a fila vazia, o cron rodava, não carimbava, e seis minutos
-- depois o painel anunciava "o processador não roda desde ..." — exatamente
-- quando estava tudo funcionando.
--
-- Alarme que dispara com tudo certo é pior que alarme nenhum: ensina a ignorar.
--
-- Agora são duas informações separadas, que é o que elas sempre foram:
--   ultima_execucao   -> o cron rodou (carimbado sempre)
--   ultimo_request_id -> houve chamada de verdade (só quando há o que enviar)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.cron_oem_sync() RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  v_segredo text;
  v_req     bigint;
  v_tem     boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.oem_sync_fila
     WHERE status IN ('pendente','erro') AND proxima_tentativa_em <= now()
  ) INTO v_tem;

  IF v_tem THEN
    SELECT s.decrypted_secret INTO v_segredo
      FROM vault.decrypted_secrets s
     WHERE s.name = 'oem_sync_cron_secret';

    IF v_segredo IS NULL THEN
      RAISE WARNING 'cron_oem_sync: segredo ausente no vault; nada disparado';
    ELSE
      SELECT net.http_post(
        url     := 'https://vbngjzovjhkmietztffo.supabase.co/functions/v1/oem-sync-processar',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || v_segredo
        ),
        body    := '{}'::jsonb,
        timeout_milliseconds := 120000
      ) INTO v_req;
    END IF;
  END IF;

  -- Fora do IF de propósito: o cron rodou, e é isso que este carimbo diz.
  INSERT INTO public.cron_estado (jobname, ultimo_request_id, ultima_execucao)
  VALUES ('oem-sync-processar', v_req, now())
  ON CONFLICT (jobname) DO UPDATE
    SET ultimo_request_id = coalesce(excluded.ultimo_request_id, public.cron_estado.ultimo_request_id),
        ultima_execucao   = excluded.ultima_execucao;
END;
$$;

ALTER FUNCTION public.cron_oem_sync() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.cron_oem_sync() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cron_oem_sync() FROM anon;
REVOKE ALL ON FUNCTION public.cron_oem_sync() FROM authenticated;

-- Carimba agora para o painel parar de acusar morte de quem está vivo; o cron
-- normal assume a partir do próximo minuto par.
INSERT INTO public.cron_estado (jobname, ultima_execucao)
VALUES ('oem-sync-processar', now())
ON CONFLICT (jobname) DO UPDATE SET ultima_execucao = excluded.ultima_execucao;
