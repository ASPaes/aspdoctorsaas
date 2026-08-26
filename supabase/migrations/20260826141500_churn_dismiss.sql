-- Descarte manual do risco de churn / sugestão de ticket CS numa conversa.
--
-- Motivação: em 26/08/2026 o Théo abriu "Risco de churn" para a conversa
-- 9ca42b6c-…, com o trecho "Estás mexendo né" — o cliente perguntando se o
-- técnico estava atuando na máquina, não uma reclamação. Não existia nenhuma
-- forma de o admin derrubar o sinal: o único controle era o liga/desliga
-- global do tenant (`configuracoes.churn_alert_enabled`).
--
-- Âncora do descarte: o ID do atendimento ativo no momento em que se descarta.
-- É isso que faz "vale até fechar o atendimento" funcionar sem cron nem
-- rotina de limpeza — quando o atendimento fecha, o ativo passa a ser outro
-- (ou nenhum), o id deixa de bater e o descarte expira sozinho.
-- Descarte feito sem atendimento ativo (ex.: marcador sobrando na lista de uma
-- conversa já fechada) grava NULL e expira quando o próximo atendimento abrir.

ALTER TABLE public.whatsapp_sentiment_analysis
  ADD COLUMN IF NOT EXISTS churn_dismissed_at            timestamptz,
  ADD COLUMN IF NOT EXISTS churn_dismissed_by            uuid,
  ADD COLUMN IF NOT EXISTS churn_dismissed_attendance_id uuid;

COMMENT ON COLUMN public.whatsapp_sentiment_analysis.churn_dismissed_at IS
  'Quando um admin/head descartou o risco de churn. NULL = sem descarte.';
COMMENT ON COLUMN public.whatsapp_sentiment_analysis.churn_dismissed_by IS
  'profiles.user_id de quem descartou.';
COMMENT ON COLUMN public.whatsapp_sentiment_analysis.churn_dismissed_attendance_id IS
  'Atendimento ativo no momento do descarte. O descarte só vale enquanto este for o atendimento ativo da conversa; NULL vale enquanto não houver atendimento ativo.';

-- Atendimento ativo da conversa. Fonte única: a mesma regra que o frontend usa
-- em ChatHeader/ConversationItem (status waiting|in_progress).
CREATE OR REPLACE FUNCTION public.fn_conversa_atendimento_ativo(p_conversation_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT a.id
    FROM public.support_attendances a
   WHERE a.conversation_id = p_conversation_id
     AND a.status IN ('waiting','in_progress')
   ORDER BY a.opened_at DESC NULLS LAST, a.created_at DESC
   LIMIT 1;
$function$;

REVOKE ALL ON FUNCTION public.fn_conversa_atendimento_ativo(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_conversa_atendimento_ativo(uuid) TO authenticated, service_role;

-- Descarte ativo? Usada pela edge function e pelos testes. O frontend faz a
-- mesma comparação em TS porque já tem o atendimento em mãos.
CREATE OR REPLACE FUNCTION public.fn_churn_descarte_ativo(p_conversation_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
      FROM public.whatsapp_sentiment_analysis s
     WHERE s.conversation_id = p_conversation_id
       AND s.churn_dismissed_at IS NOT NULL
       AND s.churn_dismissed_attendance_id
           IS NOT DISTINCT FROM public.fn_conversa_atendimento_ativo(p_conversation_id)
  );
$function$;

REVOKE ALL ON FUNCTION public.fn_churn_descarte_ativo(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_churn_descarte_ativo(uuid) TO authenticated, service_role;

-- Liga/desliga o descarte. Toggle porque quem erra precisa poder voltar.
CREATE OR REPLACE FUNCTION public.toggle_churn_dismiss(
  p_conversation_id uuid,
  p_dismiss         boolean DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant     uuid;
  v_att        uuid;
  v_atual      boolean;
  v_alvo       boolean;
  v_dismissed  timestamptz;
BEGIN
  SELECT c.tenant_id INTO v_tenant
    FROM public.whatsapp_conversations c
   WHERE c.id = p_conversation_id;

  IF v_tenant IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Conversa não encontrada.');
  END IF;

  -- Mesma regra de permissão do omie_fila_descartar: dono do tenant e gestor.
  -- O operador do chat não apaga o próprio sinal de risco.
  IF NOT (
    public.is_super_admin()
    OR EXISTS (
      SELECT 1 FROM public.profiles p
       WHERE p.user_id = auth.uid()
         AND p.tenant_id = v_tenant
         AND p.role IN ('admin','head')
    )
  ) THEN
    RAISE EXCEPTION 'Sem permissao para descartar risco de churn deste tenant.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.whatsapp_sentiment_analysis s
                  WHERE s.conversation_id = p_conversation_id) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Esta conversa ainda não tem análise de sentimento.');
  END IF;

  v_att   := public.fn_conversa_atendimento_ativo(p_conversation_id);
  v_atual := public.fn_churn_descarte_ativo(p_conversation_id);
  v_alvo  := COALESCE(p_dismiss, NOT v_atual);

  IF v_alvo THEN
    UPDATE public.whatsapp_sentiment_analysis
       SET churn_dismissed_at            = now(),
           churn_dismissed_by            = auth.uid(),
           churn_dismissed_attendance_id = v_att
     WHERE conversation_id = p_conversation_id
     RETURNING churn_dismissed_at INTO v_dismissed;
  ELSE
    UPDATE public.whatsapp_sentiment_analysis
       SET churn_dismissed_at            = NULL,
           churn_dismissed_by            = NULL,
           churn_dismissed_attendance_id = NULL
     WHERE conversation_id = p_conversation_id
     RETURNING churn_dismissed_at INTO v_dismissed;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'dismissed', v_alvo,
    'dismissed_at', v_dismissed,
    'attendance_id', CASE WHEN v_alvo THEN v_att ELSE NULL END
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.toggle_churn_dismiss(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.toggle_churn_dismiss(uuid, boolean) TO authenticated, service_role;
