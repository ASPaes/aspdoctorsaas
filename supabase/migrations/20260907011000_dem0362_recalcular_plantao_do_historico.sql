-- DEM-0362 · Recalcular o selo de plantão dos atendimentos que o backfill do TME mexeu.
--
-- ⚠️ APLICADO EM 07/09/2026 E REVERTIDO NO MESMO DIA. NÃO RODE ESTE ARQUIVO.
--    O calendário de expediente não é versionado, então o recálculo julgou
--    atendimento antigo com a régua de hoje: 100 das 102 linhas que mudaram
--    tinham sido fechadas ANTES da configuração de horário que está no ar.
--    Ver `20260907014000_dem0362_reverter_recalculo_do_plantao.sql`.
--
-- Terceiro e último arquivo da DEM-0362, depois de
-- `…_assumed_at_nao_reseta_na_transferencia.sql` (comportamento) e
-- `…_backfill_tme_historico.sql` (histórico de TME/TMA).
--
-- `support_attendances.plantao` / `.plantao_em` são gravados UMA VEZ, no
-- fechamento, por `trg_zz_set_plantao`, a partir de
-- `fn_atendimento_plantao_em(...)`. Como aquele gatilho só dispara na transição
-- para `closed`, o backfill de ontem mudou o `assumed_at` de 2.408 atendimentos
-- sem recalcular o selo. Este arquivo recalcula.
--
-- ⚠️ O selo NÃO sai só do `assumed_at`. `fn_atendimento_plantao_em` devolve o
-- MENOR de três candidatos que caiam fora do expediente, dentro da janela do
-- atendimento:
--   1. `assumed_at`            <- o único que o backfill moveu
--   2. `first_human_response_at`
--   3. a 1ª mensagem de agente da conversa (`sent_by_user_id IS NOT NULL`)
-- Por isso a conta não é "assumiu em horário comercial, logo não é plantão":
-- quem respondeu às 20h continua sendo plantão pelo candidato 3, e vai continuar
-- marcado. E a mudança corre para os DOIS lados: um atendimento aberto às 06h e
-- assumido às 06h, cujo `assumed_at` estava empurrado para as 10h pela
-- transferência, PASSA a ser plantão agora que a âncora voltou para o lugar.
--
-- Quem decide é a função do próprio sistema, chamada com os mesmos argumentos
-- que o gatilho usa (inclusive a tolerância padrão de 30 min). Nada de regra de
-- horário reimplementada aqui.
--
-- Só grava onde o resultado muda de verdade, para não gerar evento de realtime
-- à toa. Os valores anteriores ficam na mesma tabela de rollback do backfill.

BEGIN;

ALTER TABLE public.bkp_dem0362_backfill_tme
  ADD COLUMN IF NOT EXISTS plantao_antes     boolean,
  ADD COLUMN IF NOT EXISTS plantao_em_antes  timestamptz,
  ADD COLUMN IF NOT EXISTS plantao_depois    boolean,
  ADD COLUMN IF NOT EXISTS plantao_em_depois timestamptz,
  ADD COLUMN IF NOT EXISTS plantao_aplicado  boolean NOT NULL DEFAULT false;

-- 1) Guarda o selo atual e calcula o novo. Toca só a tabela de backup:
--    nenhum lock em support_attendances enquanto a função varre as mensagens.
UPDATE public.bkp_dem0362_backfill_tme b
SET plantao_antes     = sa.plantao,
    plantao_em_antes  = sa.plantao_em,
    plantao_em_depois = calc.em,
    plantao_depois    = (calc.em IS NOT NULL)
FROM public.support_attendances sa
     CROSS JOIN LATERAL (
       SELECT public.fn_atendimento_plantao_em(
                sa.tenant_id, sa.department_id, sa.conversation_id,
                sa.opened_at, COALESCE(sa.closed_at, now()),
                sa.assumed_at, sa.first_human_response_at) AS em
     ) calc
WHERE sa.id = b.id
  AND b.plantao_aplicado = false;

-- 2) Grava só onde mudou.
UPDATE public.support_attendances sa
SET plantao    = b.plantao_depois,
    plantao_em = b.plantao_em_depois
FROM public.bkp_dem0362_backfill_tme b
WHERE b.id = sa.id
  AND b.plantao_aplicado = false
  AND sa.status = 'closed'
  AND (sa.plantao    IS DISTINCT FROM b.plantao_depois
    OR sa.plantao_em IS DISTINCT FROM b.plantao_em_depois);

UPDATE public.bkp_dem0362_backfill_tme SET plantao_aplicado = true WHERE plantao_aplicado = false;

COMMIT;

-- Resultado (o SQL Editor devolve este SELECT):
SELECT count(*)                                                                          AS avaliados,
       count(*) FILTER (WHERE COALESCE(plantao_antes,false) AND NOT plantao_depois)      AS deixaram_de_ser_plantao,
       count(*) FILTER (WHERE NOT COALESCE(plantao_antes,false) AND plantao_depois)      AS viraram_plantao,
       count(*) FILTER (WHERE COALESCE(plantao_antes,false) = plantao_depois
                          AND plantao_em_antes IS DISTINCT FROM plantao_em_depois)       AS so_mudou_o_horario,
       count(*) FILTER (WHERE COALESCE(plantao_antes,false) = plantao_depois
                          AND plantao_em_antes IS NOT DISTINCT FROM plantao_em_depois)   AS sem_mudanca
FROM public.bkp_dem0362_backfill_tme;

-- Rollback do selo, se precisar:
--
--   UPDATE public.support_attendances sa
--   SET plantao = b.plantao_antes, plantao_em = b.plantao_em_antes
--   FROM public.bkp_dem0362_backfill_tme b
--   WHERE b.id = sa.id AND b.plantao_aplicado = true;
