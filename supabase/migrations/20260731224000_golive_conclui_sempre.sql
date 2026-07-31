-- Go-live encerra a jornada. Ponto.
--
-- journey_go_live perguntava a fn_onboarding_next_phase se havia jornada seguinte ativa e, se
-- houvesse, AVANÇAVA a jornada para lá em vez de concluir. Efeito prático na Digi Office (única
-- com a jornada de Acompanhamento ativa): todo go-live empurrava o cartão para o Acompanhamento
-- sozinho, sem olhar tipo de treino nenhum — e como é a MESMA jornada e o MESMO ticket, o cartão
-- chegava lá idêntico ao da implantação, sem lugar para lançar os dados novos.
--
-- Decisão do owner (31/07): acompanhamento não é continuação da jornada. É um TICKET NOVO, vazio,
-- aberto pela regra do tipo de treino (trg_onb_acompanhamento_on_golive), para o usuário preencher.
-- Com o go-live concluindo, aquele gatilho passa a disparar — ele espera situacao → concluido.
--
-- A trava de treinamentos em aberto e o arquivamento dos sub-tickets seguem iguais.

CREATE OR REPLACE FUNCTION public.journey_go_live(p_journey_id uuid, p_go_live_real date DEFAULT NULL::date)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid; v_ticket uuid; v_res jsonb;
  v_abertos int; v_codigos text; v_arquivados int;
BEGIN
  SELECT tenant_id, ticket_id INTO v_tenant, v_ticket
    FROM public.onboarding_journeys WHERE id = p_journey_id;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'jornada nao encontrada'; END IF;
  IF NOT public.can_access_tenant_row(v_tenant) THEN RAISE EXCEPTION 'sem permissao'; END IF;

  -- Go-live só finaliza a jornada inteira: todo sub-ticket de treinamento precisa estar
  -- encerrado (realizado ou cancelado). Vale inclusive para admin.
  SELECT a.qtd, a.codigos INTO v_abertos, v_codigos
    FROM public.fn_onb_treinos_em_aberto(v_ticket) a;
  IF COALESCE(v_abertos, 0) > 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'treinos_em_aberto',
                              'qtd', v_abertos, 'codigos', v_codigos);
  END IF;

  v_res := public.conclude_onboarding_journey(p_journey_id, p_go_live_real)
           || jsonb_build_object('concluiu', true);

  -- Só arquiva se o go-live realmente aconteceu.
  IF COALESCE((v_res->>'ok')::boolean, false) THEN
    v_arquivados := public.fn_onb_arquivar_treinos_no_golive(p_journey_id);
    v_res := v_res || jsonb_build_object('treinos_arquivados', v_arquivados);
  END IF;

  RETURN v_res;
END $function$;
