-- DEM-0362 · Reverter o recálculo do selo de plantão de 07/09/2026.
--
-- Desfaz `20260907011000_dem0362_recalcular_plantao_do_historico.sql`, que foi
-- uma ideia errada e o resultado provou. Fica registrado para ninguém tentar de
-- novo.
--
-- O recálculo mudou 102 dos 2.408: 62 viraram plantão, 5 deixaram de ser, 35 só
-- mudaram de horário. Só que **100 dessas 102 linhas foram fechadas ANTES da
-- configuração de horário que hoje está no ar** — e é a de hoje que a função
-- consulta.
--
-- O caso que denuncia: 53 dos 62 são da Liberty, que tem
-- `business_hours_enabled = true` e **segunda-feira com `active: false`**. Para
-- a função, toda segunda-feira da Liberty é fora do expediente, o dia inteiro.
-- Atendimentos de segunda às 10h04, 11h31 e 13h49, fechados entre 27/04 e
-- 31/08, viraram plantão — não porque o `assumed_at` mudou, mas porque a
-- configuração deles foi alterada em 06/09, depois de todos eles.
--
-- A lição: `plantao` / `plantao_em` são um JULGAMENTO FEITO NO FECHAMENTO, sob
-- o calendário vigente naquele instante. O calendário (`configuracoes.
-- business_hours`, `support_departments.business_hours`,
-- `business_hours_exceptions`, `tenant_holiday_template`) NÃO é versionado: não
-- existe forma de saber que horário valia em abril. Recalcular hoje não corrige
-- o passado, reescreve o passado com a régua de hoje. Ao contrário de
-- `wait_seconds`, que se reconstrói de carimbos imutáveis
-- (`conversation_assignments`, `first_human_response_at`), o selo de plantão não
-- tem como ser reconstruído.
--
-- O que fica: daqui para frente o selo nasce certo, porque o `assumed_at` parou
-- de andar (`…_assumed_at_nao_reseta_na_transferencia.sql`). Os ~129 históricos
-- cujo selo saiu de um `assumed_at` inflado seguem possivelmente errados, e é
-- melhor assim: é um erro menor, antigo e limitado, contra um erro novo, maior
-- e introduzido por nós.

BEGIN;

UPDATE public.support_attendances sa
SET plantao    = b.plantao_antes,
    plantao_em = b.plantao_em_antes
FROM public.bkp_dem0362_backfill_tme b
WHERE b.id = sa.id
  AND b.plantao_aplicado = true
  AND (sa.plantao    IS DISTINCT FROM b.plantao_antes
    OR sa.plantao_em IS DISTINCT FROM b.plantao_em_antes);

COMMIT;

-- Confere que o selo voltou ao que era (as duas colunas devem bater em 2408):
SELECT count(*) FILTER (WHERE sa.plantao    IS NOT DISTINCT FROM b.plantao_antes)    AS selo_igual_ao_original,
       count(*) FILTER (WHERE sa.plantao_em IS NOT DISTINCT FROM b.plantao_em_antes) AS horario_igual_ao_original,
       count(*)                                                                      AS total
FROM public.bkp_dem0362_backfill_tme b
JOIN public.support_attendances sa ON sa.id = b.id;
