-- Reabrir a jornada não limpava os marcadores de encerramento da fase.
--
-- `reopen_onboarding_journey` devolvia `situacao`, `fase_atual`, `concluido_em` e o
-- `concluido_em` do ticket, e a linha de fase reabre sozinha (o `fase_atual` sincroniza
-- `current_phase_id` e o trigger `fn_open_onboarding_phase_row` zera o `concluida_em`).
-- O que ficava para trás era `implantacao_concluida_em` / `onboarding_concluido_em` e
-- `go_live_real`.
--
-- Consequência medida em 28/08/2026 (reopen + nova conclusão 15h depois, em transação
-- revertida): `fn_snapshot_onboarding_phase` monta o fim da fase com
-- `COALESCE(implantacao_concluida_em, concluido_em)` — como o primeiro continuava
-- preenchido, a fase foi gravada de novo com `concluida_em = 27/08 20:19` e
-- `sla_util_min = 249`. As 15 horas de jornada reaberta simplesmente não existiram no
-- painel de SLA. E `revert_onboarding_to_onboarding` recusa com 'jornada_encerrada'
-- enquanto `implantacao_concluida_em` estiver preenchido: jornada reaberta nunca mais
-- conseguia voltar para o Onboarding.
--
-- `go_live_real` só é escrito por `conclude_onboarding_journey` — não existe data
-- digitada em outro lugar para se perder ao limpar aqui.
--
-- Zerar o snapshot de SLA da fase segue o precedente de `revert_onboarding_to_onboarding`:
-- a view recalcula ao vivo, mas quem lê a tabela direto pegava o número velho.
CREATE OR REPLACE FUNCTION public.reopen_onboarding_journey(p_journey_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_tenant uuid; v_ticket uuid; v_stage uuid; v_fase public.onb_fase; v_fase_txt text;
BEGIN
  SELECT tenant_id, ticket_id, current_stage_id INTO v_tenant, v_ticket, v_stage
    FROM public.onboarding_journeys WHERE id=p_journey_id;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'jornada nao encontrada'; END IF;
  IF NOT public.can_access_tenant_row(v_tenant) THEN RAISE EXCEPTION 'sem permissao'; END IF;

  SELECT pl.fase INTO v_fase FROM public.onboarding_stages s
    JOIN public.onboarding_pipelines pl ON pl.id=s.pipeline_id WHERE s.id=v_stage;
  v_fase_txt := COALESCE(v_fase::text, 'onboarding');

  UPDATE public.onboarding_journeys
     SET situacao='em_andamento',
         fase_atual=v_fase_txt::public.onb_fase_atual,
         concluido_em=NULL,
         -- Só o marcador da fase que está voltando: quem reabre na Implantação continua
         -- tendo concluído o Onboarding de verdade.
         implantacao_concluida_em = CASE WHEN v_fase_txt='implantacao'
                                         THEN NULL ELSE implantacao_concluida_em END,
         onboarding_concluido_em  = CASE WHEN v_fase_txt='onboarding'
                                         THEN NULL ELSE onboarding_concluido_em END,
         go_live_real=NULL
   WHERE id=p_journey_id;

  -- reabre a etapa atual se nao houver etapa aberta
  IF NOT EXISTS (SELECT 1 FROM public.onboarding_stage_history WHERE journey_id=p_journey_id AND saiu_em IS NULL) AND v_stage IS NOT NULL THEN
    INSERT INTO public.onboarding_stage_history (tenant_id, journey_id, stage_id) VALUES (v_tenant, p_journey_id, v_stage);
  END IF;

  -- O snapshot de SLA gravado na conclusão deixa de valer.
  UPDATE public.onboarding_phase_metrics
     SET sla_corrido_min = NULL, sla_util_min = NULL, pausado_min = NULL
   WHERE journey_id = p_journey_id AND fase::text = v_fase_txt;

  UPDATE public.support_tickets SET concluido_em=NULL WHERE id=v_ticket;

  INSERT INTO public.support_ticket_events (tenant_id, ticket_id, user_id, event_type, content)
  VALUES (v_tenant, v_ticket, auth.uid(), 'onboarding_reaberto', 'Jornada reaberta');

  RETURN jsonb_build_object('ok', true);
END $function$;
