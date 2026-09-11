-- 1º contato do onboarding: a régua passa a ser o CHAT DO TICKET.
--
-- Defeito relatado pelo owner em 11/09/2026, caso VO TITA RESTAURANTE:
--   04/08 09:16  ticket criado e distribuído (responsável formal: Fabianne)
--   04/08 16:13  Igor abre o chat PELO TICKET e fala com o cliente   <- o contato real
--   13/08 10:14  1ª mensagem da Fabianne
-- O painel mostrava 217h. A régua antiga exigia que o autor fosse o responsável
-- FORMAL no instante da mensagem, então ignorou o Igor — que fez o onboarding
-- inteiro — e foi catar a primeira mensagem da responsável de cadastro, 9 dias
-- depois. A resposta certa é 7h.
--
-- Pior: ela aceitava QUALQUER conversa do cliente. Medido em ago+set, 65 de 190
-- jornadas não tinham chat aberto pelo ticket e mesmo assim exibiam um número,
-- tirado de conversa que não era do onboarding (suporte, em geral).
--
-- Régua nova, em dois níveis:
--   1) o chat aberto PELO TICKET (support_attendances.ticket_id) — auditável: é o
--      mesmo carimbo do evento "Conversa WhatsApp iniciada" na timeline;
--   2) na falta dele, conversa solta do cliente, desde que quem falou seja do TIME
--      DA JORNADA — membro de um setor que atende os pipelines dela, OU alguém que
--      já foi responsável por ela.
--
-- O "ou já foi responsável" não é enfeite: sem ele o Gula inteiro perdia o número,
-- porque os pipelines Gula apontam para os setores "Onboarding"/"Implantação" e
-- quem trabalha Gula está em "Suporte Gula".
--
-- Medido antes de aplicar (Digi Office):        hoje        nova
--   agosto   · jornadas medidas                  103         111
--   setembro · jornadas medidas                   29          32
--   agosto   · média                            43,4h       35,9h
--   setembro · média                            20,4h       18,1h
--   jornadas que PERDEM o número                              0
--
-- Performance: a primeira versão desta query levava 6842 ms e 561.665 buffers — o
-- filtro `m.tenant_id` fazia o planner casar dois bitmaps e varrer 89.930 linhas por
-- loop em idx_whatsapp_messages_billing_lookup. Sem ele (conversation_id já é único
-- e a conversa já vem filtrada por tenant) e com o time da jornada resolvido UMA vez
-- por jornada em vez de um EXISTS por mensagem: 127 ms e 65.131 buffers.
--
-- DROP + CREATE porque o RETURNS TABLE ganha colunas; CREATE OR REPLACE não muda
-- assinatura. Vai em transação, então não há janela sem a função.

DROP FUNCTION IF EXISTS public.get_onboarding_first_contact(uuid);

CREATE FUNCTION public.get_onboarding_first_contact(p_tenant_id uuid)
RETURNS TABLE(
  journey_id uuid,
  distribuido_em timestamptz,
  primeiro_contato_em timestamptz,
  minutos_corridos numeric,
  minutos_uteis numeric,
  -- quem realmente mandou a mensagem. O responsável de hoje não serve: em 16 das 51
  -- jornadas de setembro a jornada trocou de mão depois do contato.
  contato_por uuid,
  -- 'ticket' = veio do chat do ticket (auditável na timeline).
  -- 'time'   = conversa solta, mas de alguém do time da jornada.
  contato_origem text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH guard AS (
    SELECT 1 WHERE p_tenant_id = current_tenant_id() OR is_super_admin()
  ),
  base AS (
    SELECT j.id AS journey_id,
           j.tenant_id,
           j.cliente_id,
           j.ticket_id,
           -- mesma regra da vw_onboarding_journeys.sla_dept_onb_id
           COALESCE(pon.department_id, t.department_id) AS dept_onb,
           (SELECT min(rh.de) FROM onboarding_responsavel_history rh
             WHERE rh.journey_id = j.id) AS distribuido_em,
           -- o time da jornada, resolvido uma vez só (ver nota de performance acima)
           (SELECT array_agg(DISTINCT u) FROM (
              SELECT dm.user_id AS u
                FROM support_department_members dm
               WHERE dm.department_id IN (
                       SELECT p.department_id FROM onboarding_pipelines p
                        WHERE p.id IN (j.pipeline_onboarding_id, j.pipeline_implantacao_id)
                          AND p.department_id IS NOT NULL)
              UNION
              SELECT rh.user_id FROM onboarding_responsavel_history rh
               WHERE rh.journey_id = j.id
            ) s WHERE u IS NOT NULL) AS time_ids
      FROM onboarding_journeys j
      JOIN support_tickets t ON t.id = j.ticket_id
      LEFT JOIN onboarding_pipelines pon ON pon.id = j.pipeline_onboarding_id
     WHERE j.tenant_id = p_tenant_id
       AND j.situacao::text <> 'cancelado'
       AND EXISTS (SELECT 1 FROM guard)
  )
  SELECT b.journey_id,
         b.distribuido_em,
         fc.ts,
         EXTRACT(epoch FROM (fc.ts - b.distribuido_em)) / 60,
         CASE WHEN fc.ts IS NULL THEN NULL
              ELSE fn_onb_util_min(b.distribuido_em, fc.ts, b.tenant_id, b.dept_onb)
         END,
         fc.por,
         fc.origem
    FROM base b
    LEFT JOIN LATERAL (
      SELECT x.ts, x.por, x.origem
        FROM (
          -- nível 1: o chat aberto pelo ticket, qualquer humano nosso
          (SELECT m."timestamp" AS ts, m.sent_by_user_id AS por, 'ticket'::text AS origem, 1 AS prio
             FROM support_attendances a
             JOIN whatsapp_messages m ON m.conversation_id = a.conversation_id
            WHERE a.ticket_id = b.ticket_id
              AND a.conversation_id IS NOT NULL
              AND m.is_from_me
              AND m.sent_by_user_id IS NOT NULL
              AND m."timestamp" >= b.distribuido_em
            ORDER BY m."timestamp"
            LIMIT 1)
          UNION ALL
          -- nível 2: conversa solta do cliente, mas de alguém do time da jornada
          (SELECT m."timestamp", m.sent_by_user_id, 'time'::text, 2
             FROM whatsapp_contacts ct
             JOIN whatsapp_conversations cv ON cv.tenant_id = ct.tenant_id AND cv.contact_id = ct.id
             JOIN whatsapp_messages m ON m.conversation_id = cv.id
            WHERE ct.cliente_id = b.cliente_id
              AND ct.tenant_id = b.tenant_id
              AND m.is_from_me
              AND m."timestamp" >= b.distribuido_em
              AND m.sent_by_user_id = ANY(b.time_ids)
            ORDER BY m."timestamp"
            LIMIT 1)
        ) x
       ORDER BY x.prio
       LIMIT 1
    ) fc ON true;
$function$;

REVOKE ALL ON FUNCTION public.get_onboarding_first_contact(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_onboarding_first_contact(uuid) TO authenticated, service_role;
