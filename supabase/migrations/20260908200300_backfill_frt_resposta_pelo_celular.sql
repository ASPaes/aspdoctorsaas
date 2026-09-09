-- Backfill do histórico que a trigger antiga deixou em branco. Aplicado em
-- produção em 08/09/2026, em lotes de 500 (support_attendances está na
-- publication supabase_realtime — UPDATE em massa gera WAL + fanout).
--
-- Regras que este UPDATE respeita, e o motivo de cada uma:
--   • Só status='closed'. Os 38 atendimentos vivos ficam para a trigger nova
--     pegar na próxima mensagem — não se mexe em estado de chat em andamento.
--   • NÃO toca em status nem assigned_to. As duas triggers de saudação
--     (trg_zz_assignment_greeting_ins/upd) são AFTER UPDATE OF assigned_to,
--     status: sem elas na lista, nem chegam a ser avaliadas. Era o risco real
--     de disparar mensagem de WhatsApp para 2.600 clientes reais.
--   • first_response_business_seconds sai de graça: trg_set_frt_business_seconds
--     é BEFORE UPDATE e recalcula sozinho a partir do first_response_time_seconds.
--
-- Verificado com rollback antes de rodar (30 linhas, diff de to_jsonb): mudaram
-- exatamente assumed_at, first_human_response_at, first_response_time_seconds,
-- wait_seconds e o derivado first_response_business_seconds. Nada mais.
--
-- Resultado: 2.194 atendimentos recuperados. Os 511 que sobraram têm delta < 1s
-- e 497 deles são created_from='agent' — chat aberto pelo time, não existe
-- "tempo de primeira resposta" porque não havia cliente esperando.
WITH alvo AS (
  SELECT sa.id, sa.opened_at, sa.conversation_id, sa.tenant_id, sa.closed_at
  FROM support_attendances sa
  WHERE sa.status = 'closed'
    AND COALESCE(sa.first_response_time_seconds, 0) = 0
    AND COALESCE(sa.msg_agent_count, 0) > 0
), calc AS (
  SELECT a.id, (
    SELECT min(m.timestamp) FROM whatsapp_messages m
    WHERE m.conversation_id = a.conversation_id AND m.tenant_id = a.tenant_id
      AND m.is_from_me AND m.message_type <> 'system'
      AND (m.sent_by_user_id IS NOT NULL OR m.metadata->>'source' = 'self_hosted')
      AND m.timestamp > a.opened_at
      AND (a.closed_at IS NULL OR m.timestamp <= a.closed_at)
  ) AS primeira
  FROM alvo a
)
UPDATE support_attendances sa
SET first_human_response_at     = COALESCE(sa.first_human_response_at, c.primeira),
    first_response_time_seconds = EXTRACT(EPOCH FROM (c.primeira - sa.opened_at))::int,
    wait_seconds                = CASE WHEN COALESCE(sa.wait_seconds, 0) = 0
                                    THEN EXTRACT(EPOCH FROM (c.primeira - sa.opened_at))::int
                                    ELSE sa.wait_seconds END,
    assumed_at                  = COALESCE(sa.assumed_at, c.primeira)
FROM calc c
WHERE c.id = sa.id AND c.primeira IS NOT NULL;
