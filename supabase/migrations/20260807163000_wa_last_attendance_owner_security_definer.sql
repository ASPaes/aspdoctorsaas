-- wa_last_attendance_owner passa a SECURITY DEFINER
--
-- Medido em producao em 07/08/2026, logo depois de
-- 20260807150000_filtro_operador_alcanca_encerradas.sql:
--   whatsapp_pill_counts com filtro de operador = 4,11 s pela tela.
--   A mesma chamada por EXPLAIN ANALYZE no SQL Editor = 32 ms.
--
-- A diferenca de 128x e o RLS. As duas funcoes que chamam este helper sao
-- SECURITY INVOKER, entao pelo app ele roda como 'authenticated' e a policy
-- support_attendances_select e avaliada DENTRO da subconsulta correlacionada —
-- uma vez por conversa do tenant. As funcoes da policy (is_admin_or_head,
-- current_tenant_id, current_user_department_id) estao embrulhadas em
-- "(SELECT f())" justamente para virarem InitPlan e rodarem uma vez por query;
-- dentro de um SubPlan correlacionado esse cache se perde e elas voltam a rodar
-- por linha. Era esse o custo.
--
-- SECURITY DEFINER tira o RLS de dentro do helper e devolve o tempo do
-- EXPLAIN. O que ele expoe: dado um par (conversation_id, tenant_id) — dois
-- uuids — o uuid do operador que atendeu por ultimo. Nao devolve linha, nao
-- devolve conteudo de conversa, e quem nao enxerga a conversa teria que adivinhar
-- um uuid para chegar nela. As linhas que o usuario ve continuam recortadas pelo
-- RLS de whatsapp_conversations, que segue valendo nas duas funcoes chamadoras.
--
-- Se isto nao bastar, o proximo passo (maior) e denormalizar: coluna
-- whatsapp_conversations.last_attendance_owner preenchida pelo proprio
-- fn_clear_conversation_assigned_on_close, com indice parcial. Ai o filtro vira
-- comparacao de coluna e nao existe subconsulta nenhuma — ao custo de backfill
-- numa tabela que esta na publication supabase_realtime.
--
-- Nao mexe nas assinaturas de whatsapp_list_conversations nem de wa_pill_scope:
-- as duas continuam chamando o mesmo helper.
CREATE OR REPLACE FUNCTION public.wa_last_attendance_owner(
  p_conversation_id uuid,
  p_tenant_id       uuid
)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT COALESCE(s.assigned_to, s.closed_by)
  FROM public.support_attendances s
  WHERE s.conversation_id = p_conversation_id
    AND s.tenant_id       = p_tenant_id
  ORDER BY s.opened_at DESC NULLS LAST, s.created_at DESC
  LIMIT 1;
$function$;

COMMENT ON FUNCTION public.wa_last_attendance_owner(uuid, uuid) IS
  'Operador do ultimo atendimento da conversa (assigned_to, ou closed_by quando '
  'ninguem assumiu). Existe porque o encerramento zera '
  'whatsapp_conversations.assigned_to: e daqui que o filtro de operador do chat '
  'descobre de quem foi uma conversa encerrada. SECURITY DEFINER de proposito — '
  'como SECURITY INVOKER o RLS de support_attendances era avaliado por linha '
  'dentro da subconsulta e a contagem das pills ia a 4,1s (medido 07/08/2026). '
  'Fonte unica de whatsapp_list_conversations e wa_pill_scope.';

REVOKE ALL ON FUNCTION public.wa_last_attendance_owner(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.wa_last_attendance_owner(uuid, uuid)
  TO authenticated, service_role;
