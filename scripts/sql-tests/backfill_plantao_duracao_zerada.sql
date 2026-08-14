-- ============================================================================
-- Backfill: tickets de plantão gravados com horario_inicio = horario_fim
-- (duração 0). Origem do defeito: RPC de criação no encerramento gravava
-- now() nos dois campos. Parou em 20/07/2026; sobraram 105 tickets.
--
-- Fonte da verdade da correção: public.support_attendances
--   inicio := COALESCE(first_human_response_at, opened_at)
--   fim    := closed_at
--
-- duracao_minutos é COLUNA GERADA — recalcula sozinha, não escrever nela.
-- Rodar no SQL Editor (roda como postgres; auth.uid() nulo não dispara
-- trg_protect_terminal_ticket). Idempotente: rodar 2x não muda nada.
-- Medido em 13/08/2026: 102 tickets, 73,4 h recuperadas.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- PASSO 1 — PRÉVIA (só leitura, não grava nada). Rodar sozinho primeiro.
-- ----------------------------------------------------------------------------
WITH alvo AS (
  SELECT t.id, t.ticket_code, t.tenant_id, t.aberto_em,
         t.horario_inicio                                   AS ini_antigo,
         t.horario_fim                                      AS fim_antigo,
         COALESCE(a.first_human_response_at, a.opened_at)    AS ini_novo,
         a.closed_at                                         AS fim_novo
  FROM public.support_tickets t
  JOIN public.support_attendances a ON a.id = t.attendance_id
  WHERE t.tipo_horario = 'plantao'
    AND t.deleted_at IS NULL
    AND t.horario_inicio IS NOT NULL
    AND t.horario_fim IS NOT NULL
    AND t.horario_inicio = t.horario_fim          -- assinatura do now(), now()
)
SELECT
  CASE
    WHEN ini_novo IS NULL OR fim_novo IS NULL           THEN 'fora: atendimento sem carimbo'
    WHEN fim_novo <= ini_novo                            THEN 'fora: fim <= inicio'
    WHEN fim_novo - ini_novo > interval '8 hours'        THEN 'fora: > 8h, revisar a mao'
    ELSE 'corrige'
  END                                                     AS situacao,
  count(*)                                                AS tickets,
  round(sum(EXTRACT(epoch FROM (fim_novo - ini_novo)) / 3600)::numeric, 1) AS horas,
  round(avg(EXTRACT(epoch FROM (fim_novo - ini_novo)) / 60)::numeric)      AS media_min
FROM alvo
GROUP BY 1
ORDER BY 1;


-- ----------------------------------------------------------------------------
-- PASSO 2 — APLICAÇÃO.
-- Um único statement de propósito: o pooler roda cada statement numa conexão
-- diferente, então tabela temporária entre statements NÃO sobrevive
-- (ERRO 42P01 relation "fix_plantao" does not exist). Statement único também
-- já é atômico — não precisa de BEGIN/COMMIT.
-- ----------------------------------------------------------------------------
WITH alvo AS (
  SELECT t.id                                              AS ticket_id,
         t.tenant_id,
         t.horario_inicio                                  AS ini_antigo,
         t.horario_fim                                     AS fim_antigo,
         COALESCE(a.first_human_response_at, a.opened_at)  AS ini_novo,
         a.closed_at                                       AS fim_novo
  FROM public.support_tickets t
  JOIN public.support_attendances a ON a.id = t.attendance_id
  WHERE t.tipo_horario = 'plantao'
    AND t.deleted_at IS NULL
    AND t.horario_inicio IS NOT NULL
    AND t.horario_fim IS NOT NULL
    AND t.horario_inicio = t.horario_fim
    AND COALESCE(a.first_human_response_at, a.opened_at) IS NOT NULL
    AND a.closed_at IS NOT NULL
    AND a.closed_at > COALESCE(a.first_human_response_at, a.opened_at)
    AND a.closed_at - COALESCE(a.first_human_response_at, a.opened_at) <= interval '8 hours'
),
upd AS (
  UPDATE public.support_tickets t
     SET horario_inicio = al.ini_novo,
         horario_fim    = al.fim_novo
    FROM alvo al
   WHERE t.id = al.ticket_id
  RETURNING t.id, t.tenant_id, al.ini_antigo, al.fim_antigo, al.ini_novo, al.fim_novo
),
-- Rastro na timeline do ticket (user_id nulo = correção de sistema)
ev AS (
  INSERT INTO public.support_ticket_events
    (tenant_id, ticket_id, user_id, event_type, content, old_value, new_value)
  SELECT tenant_id, id, NULL::uuid, 'field_change', 'horario_inicio',
         ini_antigo::text, ini_novo::text
    FROM upd
  UNION ALL
  SELECT tenant_id, id, NULL::uuid, 'field_change', 'horario_fim',
         fim_antigo::text, fim_novo::text
    FROM upd
  RETURNING 1
)
SELECT (SELECT count(*) FROM upd)                                                     AS tickets_corrigidos,
       (SELECT round(sum(EXTRACT(epoch FROM (fim_novo - ini_novo)) / 3600)::numeric, 1)
          FROM upd)                                                                   AS horas_recuperadas,
       (SELECT count(*) FROM ev)                                                      AS eventos_gravados;


-- ----------------------------------------------------------------------------
-- PASSO 3 — CONFERÊNCIA (esperado: 0 linhas alem do TK-2026-0001 e dos 2
-- tickets manuais sem atendimento vinculado)
-- ----------------------------------------------------------------------------
SELECT t.ticket_code,
       t.aberto_em AT TIME ZONE 'America/Sao_Paulo' AS criado,
       (t.attendance_id IS NULL)                    AS sem_atendimento
  FROM public.support_tickets t
 WHERE t.tipo_horario = 'plantao'
   AND t.deleted_at IS NULL
   AND t.horario_inicio IS NOT NULL
   AND t.horario_inicio = t.horario_fim
 ORDER BY t.aberto_em;
