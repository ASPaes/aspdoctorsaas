-- Go-live: trava única no journey_go_live + arquivamento dos treinos na etapa final
--
-- Dois furos que apareceram quando a fase Acompanhamento da Digi Office foi ativada
-- em 31/07 (fase 16:55, pipeline 17:09):
--
-- 1. A trava "não conclui com sub-ticket de treinamento em aberto" só existia em
--    conclude_onboarding_journey. Com uma próxima fase configurada, journey_go_live
--    passa a chamar advance_onboarding_phase, que NÃO tem trava — dava para registrar
--    go-live com treino em aberto. A guarda sobe para journey_go_live, que é o único
--    caminho de go-live do front, e assim cobre os dois desfechos.
--    conclude_onboarding_journey fica como está: a guarda dele vira redundante, não errada.
--
-- 2. Depois do go-live o cartão do treino sumia do quadro da Implantação. A etapa final
--    do pipeline JÁ é a "Implantação Encerrada" — decisão do owner: não criar etapa nova.
--    O que faltava era o go-live levar os treinos até ela. Passa a levar, gravando de
--    verdade (current_stage_id + onboarding_training_stage_history + evento no pai),
--    porque o registro precisa existir no banco para auditoria futura.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Arquivamento dos treinos na etapa final do próprio pipeline
--
--    O pipeline vem da etapa em que o treino está, não da jornada: quando há próxima
--    fase, advance_onboarding_phase já moveu a JORNADA para o pipeline da fase seguinte,
--    e derivar dela apontaria para o pipeline errado.
--
--    Move só o que está 'realizado' e fora da etapa final. Não toca em 'cancelado'
--    (fica fora do quadro por desenho) nem em treino aberto — a trava abaixo garante
--    que não existe treino aberto num go-live. Jornada antiga que fechou antes da trava
--    e ficou com filho 'agendado'/'no_show' continua como está: marcar como realizado
--    só para caber na coluna seria falsificar histórico.
--
--    Reusa move_onboarding_training_stage em vez de escrever à mão — é ele que já sabe
--    fechar a linha de histórico com duração útil, marcar realizado_em e registrar o
--    evento no ticket pai.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.fn_onb_arquivar_treinos_no_golive(p_journey_id uuid)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE r record; v_final uuid; v_movidos int := 0;
BEGIN
  FOR r IN
    SELECT t.id AS training_id, s.pipeline_id
      FROM public.onboarding_training_sessions t
      JOIN public.onboarding_stages s ON s.id = t.current_stage_id
     WHERE t.journey_id = p_journey_id
       AND t.deleted_at IS NULL
       AND t.status = 'realizado'::public.onb_treino_status
       AND COALESCE(s.is_final, false) = false
     ORDER BY t.created_at
  LOOP
    SELECT s.id INTO v_final
      FROM public.onboarding_stages s
     WHERE s.pipeline_id = r.pipeline_id AND s.ativo AND s.is_final
     ORDER BY s.position
     LIMIT 1;

    IF v_final IS NULL THEN CONTINUE; END IF;

    PERFORM public.move_onboarding_training_stage(r.training_id, v_final);
    v_movidos := v_movidos + 1;
  END LOOP;

  RETURN v_movidos;
END $function$;

REVOKE ALL ON FUNCTION public.fn_onb_arquivar_treinos_no_golive(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_onb_arquivar_treinos_no_golive(uuid) TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. journey_go_live: trava antes, arquivamento depois
--
--    Corpo de hoje (md5 do pg_get_functiondef: 35de159fe0ab829684502e714b8db9ee) com
--    duas adições, nada removido. O retorno
--    {ok:false, reason:…} é o formato que handleConclude já trata no front.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.journey_go_live(p_journey_id uuid, p_go_live_real date DEFAULT NULL::date)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid; v_ticket uuid; v_next uuid; v_res jsonb;
  v_abertos int; v_codigos text; v_arquivados int;
BEGIN
  SELECT tenant_id, ticket_id INTO v_tenant, v_ticket
    FROM public.onboarding_journeys WHERE id = p_journey_id;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'jornada nao encontrada'; END IF;
  IF NOT public.can_access_tenant_row(v_tenant) THEN RAISE EXCEPTION 'sem permissao'; END IF;

  -- Go-live só finaliza a jornada inteira: todo sub-ticket de treinamento precisa estar
  -- encerrado (realizado ou cancelado). Vale inclusive para admin — o bypass de admin
  -- existe só no botão do front, não aqui.
  SELECT a.qtd, a.codigos INTO v_abertos, v_codigos
    FROM public.fn_onb_treinos_em_aberto(v_ticket) a;
  IF COALESCE(v_abertos, 0) > 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'treinos_em_aberto',
                              'qtd', v_abertos, 'codigos', v_codigos);
  END IF;

  v_next := public.fn_onboarding_next_phase(p_journey_id);

  IF v_next IS NULL THEN
    v_res := public.conclude_onboarding_journey(p_journey_id, p_go_live_real)
             || jsonb_build_object('concluiu', true);
  ELSE
    UPDATE public.onboarding_journeys
       SET go_live_real = COALESCE(p_go_live_real, go_live_real, current_date)
     WHERE id = p_journey_id;

    v_res := public.advance_onboarding_phase(p_journey_id, v_next, true)
             || jsonb_build_object('concluiu', false);
  END IF;

  -- Só arquiva se o go-live realmente aconteceu: fase sem pipeline / sem etapa devolve
  -- ok:false e a jornada continua na Implantação.
  IF COALESCE((v_res->>'ok')::boolean, false) THEN
    v_arquivados := public.fn_onb_arquivar_treinos_no_golive(p_journey_id);
    v_res := v_res || jsonb_build_object('treinos_arquivados', v_arquivados);
  END IF;

  RETURN v_res;
END $function$;

REVOKE ALL ON FUNCTION public.journey_go_live(uuid, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.journey_go_live(uuid, date) TO authenticated, service_role;
