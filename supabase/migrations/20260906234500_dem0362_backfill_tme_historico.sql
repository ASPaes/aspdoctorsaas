-- DEM-0362 · Backfill do TME/TMA dos atendimentos já encerrados.
--
-- Complemento de `20260906120000_dem0362_assumed_at_nao_reseta_na_transferencia.sql`,
-- que consertou o comportamento daqui para frente. Este arquivo conserta o
-- histórico: 2.408 atendimentos encerrados entre 25/03/2026 e 05/09/2026, em
-- 11 tenants, que ficaram com a espera inflada e o tempo de atendimento
-- subestimado porque cada transferência regravava o `assumed_at`.
--
-- ÂNCORA: o momento em que o atendimento saiu da espera é o MENOR entre
--   (a) a primeira linha de `conversation_assignments` dentro da janela do
--       atendimento — o extrato de quem pegou o chat e quando;
--   (b) `first_human_response_at` — responder encerra a espera, tendo assumido
--       formalmente ou não;
--   (c) o `assumed_at` atual.
-- Só entram (a) e (b) quando caem DENTRO de [opened_at, closed_at]: em 619
-- atendimentos a 1ª resposta humana é anterior à abertura (mensagem de agente
-- que precede o atendimento) e usar aquilo zeraria uma espera legítima.
--
-- A regra nunca AUMENTA a espera de ninguém: grava só onde a âncora nova é
-- menor que o `wait_seconds` guardado. 148 linhas do alvo não passam nesse
-- filtro e ficam como estão — nelas o `wait_seconds` já tinha sido gravado por
-- outro caminho (as edge functions de envio), abaixo do que o `assumed_at`
-- sugeria. Outras 3 não têm âncora nenhuma. E 13 ficam de fora porque estão
-- sem setor: `sync_attendance_department` dispara em TODO update e carimbaria
-- nelas o setor da conversa, que é efeito colateral que este backfill não pede.
--
-- GATILHOS: os 27 de `support_attendances` foram auditados um a um contra este
-- UPDATE (linha já `closed`, mexendo em assumed_at/wait_seconds/handle_seconds).
-- Nenhum dispara: os que gravam em `whatsapp_conversations`
-- (`fn_clear_conversation_assigned_on_close`, `fn_clear_out_of_hours_on_assign`,
-- `fn_mirror_attendance_to_conversation`), os de distribuição e o de IA
-- (`trg_enqueue_attendance_analysis`) exigem mudança de `status`;
-- `fn_block_close_without_cliente` exige `OLD.status <> 'closed'`;
-- `fn_reopen_orfao_para_fila` exige reabertura;
-- `trg_set_frt_business_seconds` só recalcularia com
-- `first_response_business_seconds IS NULL`, e no alvo isso é zero.
--
-- REALTIME: a tabela está na publication `supabase_realtime` e o chat assina
-- `event: "*"` nela. Este UPDATE emite um evento por linha. Rodar fora do
-- horário de atendimento (seg–sex 07:30–19:00).
--
-- ROLLBACK: `bkp_dem0362_backfill_tme` guarda os três valores anteriores de
-- cada linha. O UPDATE de volta está no rodapé, comentado.

BEGIN;

CREATE TABLE IF NOT EXISTS public.bkp_dem0362_backfill_tme (
  id                uuid PRIMARY KEY,
  tenant_id         uuid,
  attendance_code   text,
  opened_at         timestamptz,
  closed_at         timestamptz,
  assumed_at_antes  timestamptz,
  wait_antes        integer,
  handle_antes      integer,
  ancora_nova       timestamptz,
  wait_depois       integer,
  handle_depois     integer,
  gravado_em        timestamptz NOT NULL DEFAULT now(),
  aplicado          boolean NOT NULL DEFAULT false
);

COMMENT ON TABLE public.bkp_dem0362_backfill_tme IS
  'DEM-0362 (06/09/2026): assumed_at / wait_seconds / handle_seconds ANTES do backfill do TME. Caminho de rollback; descartável depois que os numeros forem conferidos.';

REVOKE ALL ON TABLE public.bkp_dem0362_backfill_tme FROM PUBLIC;

WITH alvo AS (
  SELECT sa.id, sa.tenant_id, sa.attendance_code, sa.conversation_id,
         sa.opened_at, sa.closed_at, sa.assumed_at, sa.first_human_response_at,
         sa.wait_seconds, sa.handle_seconds
  FROM public.support_attendances sa
  WHERE sa.status = 'closed'
    AND sa.wait_seconds > 60
    AND sa.first_human_response_at IS NOT NULL
    AND sa.assumed_at > sa.first_human_response_at + interval '60 seconds'
    AND sa.department_id IS NOT NULL
),
anc AS (
  SELECT a.*,
    (SELECT min(ca.created_at)
       FROM public.conversation_assignments ca
      WHERE ca.conversation_id = a.conversation_id
        AND ca.created_at >= a.opened_at
        AND ca.created_at <= a.closed_at) AS primeira_atrib,
    CASE WHEN a.first_human_response_at BETWEEN a.opened_at AND a.closed_at
         THEN a.first_human_response_at END AS resposta_valida
  FROM alvo a
),
fim AS (
  SELECT anc.*,
         LEAST(COALESCE(primeira_atrib, assumed_at),
               COALESCE(resposta_valida, assumed_at),
               assumed_at) AS ancora
  FROM anc
)
INSERT INTO public.bkp_dem0362_backfill_tme
  (id, tenant_id, attendance_code, opened_at, closed_at,
   assumed_at_antes, wait_antes, handle_antes,
   ancora_nova, wait_depois, handle_depois)
SELECT f.id, f.tenant_id, f.attendance_code, f.opened_at, f.closed_at,
       f.assumed_at, f.wait_seconds, f.handle_seconds,
       f.ancora,
       EXTRACT(epoch FROM (f.ancora - f.opened_at))::int,
       EXTRACT(epoch FROM (f.closed_at - f.ancora))::int
FROM fim f
WHERE EXTRACT(epoch FROM (f.ancora - f.opened_at))::int < f.wait_seconds
ON CONFLICT (id) DO NOTHING;

UPDATE public.support_attendances sa
SET assumed_at    = b.ancora_nova,
    wait_seconds  = b.wait_depois,
    handle_seconds = b.handle_depois
FROM public.bkp_dem0362_backfill_tme b
WHERE b.id = sa.id
  AND b.aplicado = false
  AND sa.status = 'closed';

UPDATE public.bkp_dem0362_backfill_tme SET aplicado = true WHERE aplicado = false;

COMMIT;

-- Conferência (rodar depois do COMMIT):
--
--   SELECT count(*) AS corrigidos,
--          ROUND(avg(wait_antes))::int  AS espera_media_antes,
--          ROUND(avg(wait_depois))::int AS espera_media_depois,
--          count(*) FILTER (WHERE wait_depois >= wait_antes) AS aumentaram_deve_ser_zero,
--          count(*) FILTER (WHERE wait_depois < 0 OR handle_depois < 0) AS negativos_deve_ser_zero
--   FROM public.bkp_dem0362_backfill_tme;
--
-- Rollback, se precisar:
--
--   UPDATE public.support_attendances sa
--   SET assumed_at = b.assumed_at_antes,
--       wait_seconds = b.wait_antes,
--       handle_seconds = b.handle_antes
--   FROM public.bkp_dem0362_backfill_tme b
--   WHERE b.id = sa.id AND b.aplicado = true;
