-- ============================================================================
-- fn_atendimento_plantao_em: os carimbos também precisam caber na janela
--
-- Defeito da migration anterior (20260824210000), pego pelo assert 8 de
-- scripts/sql-tests/44_volume_bate_com_chats.sql — o teste nasceu junto com o
-- código e achou o problema antes de a tela ir ao ar.
--
-- A varredura de mensagens já era limitada a [opened_at, closed_at], mas
-- assumed_at e first_human_response_at entravam crus. O dado tem casos
-- absurdos: o atendimento 00191/26 fechou em 22/03 e tem
-- first_human_response_at em 01/04 — dez dias depois. Resultado: plantão
-- atribuído a um instante em que o atendimento nem estava aberto.
--
-- Medido em produção antes da correção: 11 dos 395 atendimentos marcados
-- tinham plantao_em fora da janela, e os 11 deixam de ser plantão. Restam 384.
--
-- A sujeira de origem é maior e CONTINUA LÁ: 107 atendimentos com
-- first_human_response_at depois do fechamento e 25 com assumed_at depois.
-- Não é escopo desta correção limpar isso — aqui só paramos de confiar nesses
-- carimbos quando caem fora da janela.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fn_atendimento_plantao_em(
  p_tenant_id       uuid,
  p_department_id   uuid,
  p_conversation_id uuid,
  p_opened_at       timestamptz,
  p_closed_at       timestamptz,
  p_assumed_at      timestamptz,
  p_first_human_at  timestamptz,
  p_tolerancia_min  int DEFAULT 30
) RETURNS timestamptz
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $function$
DECLARE
  v_min timestamptz;
  v_msg timestamptz;
  v_fim timestamptz := COALESCE(p_closed_at, now());
BEGIN
  IF p_opened_at IS NULL THEN RETURN NULL; END IF;

  -- Carimbo só vale se estiver DENTRO da janela do atendimento — mesma régua
  -- da varredura de mensagens logo abaixo.
  IF p_assumed_at IS NOT NULL
     AND p_assumed_at >= p_opened_at AND p_assumed_at <= v_fim
     AND public.fn_instante_fora_expediente(p_tenant_id, p_department_id, p_assumed_at, p_tolerancia_min)
  THEN v_min := p_assumed_at; END IF;

  IF p_first_human_at IS NOT NULL
     AND p_first_human_at >= p_opened_at AND p_first_human_at <= v_fim
     AND public.fn_instante_fora_expediente(p_tenant_id, p_department_id, p_first_human_at, p_tolerancia_min)
  THEN v_min := LEAST(COALESCE(v_min, p_first_human_at), p_first_human_at); END IF;

  IF p_conversation_id IS NOT NULL THEN
    SELECT min(m.timestamp) INTO v_msg
    FROM public.whatsapp_messages m
    WHERE m.conversation_id = p_conversation_id
      AND m.timestamp >= p_opened_at
      AND m.timestamp <= v_fim
      AND m.sent_by_user_id IS NOT NULL
      AND public.fn_instante_fora_expediente(p_tenant_id, p_department_id, m.timestamp, p_tolerancia_min);

    IF v_msg IS NOT NULL THEN v_min := LEAST(COALESCE(v_min, v_msg), v_msg); END IF;
  END IF;

  RETURN v_min;
END;
$function$;


-- Recalcula os já marcados. Mesma guarda dos backfills anteriores: pula as
-- linhas sem setor cuja conversa ainda tem setor, porque
-- sync_attendance_department herdaria o setor da conversa e reescreveria a
-- atribuição histórica em silêncio.
WITH alvo AS (
  SELECT sa.id,
         public.fn_atendimento_plantao_em(sa.tenant_id, sa.department_id, sa.conversation_id,
           sa.opened_at, sa.closed_at, sa.assumed_at, sa.first_human_response_at) AS em
  FROM public.support_attendances sa
  LEFT JOIN public.whatsapp_conversations c ON c.id = sa.conversation_id
  WHERE sa.plantao IS TRUE
    AND NOT (sa.department_id IS NULL AND c.department_id IS NOT NULL)
)
UPDATE public.support_attendances s
SET plantao    = (a.em IS NOT NULL),
    plantao_em = a.em
FROM alvo a
WHERE s.id = a.id
  AND (s.plantao_em IS DISTINCT FROM a.em OR s.plantao IS DISTINCT FROM (a.em IS NOT NULL));
