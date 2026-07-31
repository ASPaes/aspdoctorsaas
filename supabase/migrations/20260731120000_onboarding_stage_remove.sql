-- Exclusão / arquivamento de etapa de onboarding.
--
-- Problema: DELETE seco em onboarding_stages esbarra em 2 FKs NO ACTION
--   - onboarding_journeys.current_stage_id  (cartão parado na etapa)
--   - onboarding_stage_history.stage_id     (NOT NULL, histórico de SLA)
-- Resultado: nenhuma etapa que já foi usada uma vez podia ser removida.
--
-- Esta RPC dá as duas saídas ao usuário:
--   'arquivar' -> tira do quadro (ativo=false) e PRESERVA o histórico
--   'excluir'  -> APAGA o histórico da etapa e a etapa
--
-- Jornada ativa x encerrada NÃO são a mesma coisa:
--   - ativa (nao_iniciado/em_andamento/parado) aparece no quadro; precisa de
--     um destino, senão o cartão sumiria da vista do operador.
--   - encerrada (concluido/cancelado) já não aparece no quadro, mas continua
--     apontando para a etapa e travando a FK. Ela NÃO é movida: no arquivamento
--     fica onde está (o registro de onde a jornada terminou é informação real);
--     na exclusão, some a etapa e ela fica sem etapa corrente.

CREATE OR REPLACE FUNCTION public.onboarding_stage_remove(
  p_stage_id         uuid,
  p_mode             text,                 -- 'arquivar' | 'excluir'
  p_move_to_stage_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_tenant      uuid;
  v_pipeline    uuid;
  v_is_initial  boolean;
  v_nome        text;
  v_ativas      int;
  v_encerradas  int;
  v_hist        int;
  v_moved       int := 0;
  v_desvinc     int := 0;
  v_hist_del    int := 0;
  v_target_ok   boolean;
  r             record;
BEGIN
  IF p_mode IS NULL OR p_mode NOT IN ('arquivar', 'excluir') THEN
    RAISE EXCEPTION 'modo invalido: %', COALESCE(p_mode, '(null)');
  END IF;

  SELECT s.tenant_id, s.pipeline_id, s.is_initial, s.nome
    INTO v_tenant, v_pipeline, v_is_initial, v_nome
    FROM public.onboarding_stages s
   WHERE s.id = p_stage_id;

  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'etapa nao encontrada';
  END IF;
  IF NOT public.can_access_tenant_row(v_tenant) THEN
    RAISE EXCEPTION 'sem permissao';
  END IF;

  -- A etapa inicial é a porta de entrada do pipeline: remover deixaria o
  -- cadastro de jornada sem destino.
  IF v_is_initial THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'etapa_inicial');
  END IF;

  SELECT
    count(*) FILTER (WHERE j.situacao NOT IN ('concluido'::public.onb_situacao, 'cancelado'::public.onb_situacao)),
    count(*) FILTER (WHERE j.situacao     IN ('concluido'::public.onb_situacao, 'cancelado'::public.onb_situacao))
    INTO v_ativas, v_encerradas
    FROM public.onboarding_journeys j
   WHERE j.current_stage_id = p_stage_id;

  SELECT count(*) INTO v_hist
    FROM public.onboarding_stage_history h WHERE h.stage_id = p_stage_id;

  -- Só cartão vivo exige destino.
  IF v_ativas > 0 THEN
    IF p_move_to_stage_id IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'destino_obrigatorio', 'jornadas', v_ativas);
    END IF;

    SELECT true INTO v_target_ok
      FROM public.onboarding_stages s
     WHERE s.id = p_move_to_stage_id
       AND s.tenant_id = v_tenant
       AND s.pipeline_id = v_pipeline
       AND s.ativo
       AND s.id <> p_stage_id;

    IF NOT COALESCE(v_target_ok, false) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'destino_invalido');
    END IF;

    FOR r IN
      SELECT id FROM public.onboarding_journeys
       WHERE current_stage_id = p_stage_id
         AND situacao NOT IN ('concluido'::public.onb_situacao, 'cancelado'::public.onb_situacao)
    LOOP
      PERFORM public.move_onboarding_stage(r.id, p_move_to_stage_id, '{}'::uuid[], true);
      v_moved := v_moved + 1;
    END LOOP;
  END IF;

  IF p_mode = 'arquivar' THEN
    -- Jornada encerrada continua apontando para a etapa arquivada: é o registro
    -- de onde ela parou. Arquivar não é apagar, então nada aqui se perde.
    UPDATE public.onboarding_stages SET ativo = false WHERE id = p_stage_id;
    RETURN jsonb_build_object(
      'ok', true, 'mode', 'arquivar', 'etapa', v_nome,
      'movidas', v_moved, 'encerradas_mantidas', v_encerradas, 'historico_preservado', v_hist
    );
  END IF;

  -- Exclusão: a etapa deixa de existir, então quem sobrou apontando para ela
  -- (só jornada encerrada, as ativas já foram movidas) fica sem etapa corrente.
  UPDATE public.onboarding_journeys SET current_stage_id = NULL WHERE current_stage_id = p_stage_id;
  GET DIAGNOSTICS v_desvinc = ROW_COUNT;

  DELETE FROM public.onboarding_stage_history WHERE stage_id = p_stage_id;
  GET DIAGNOSTICS v_hist_del = ROW_COUNT;

  -- checklist (grupos e itens) cai por CASCADE;
  -- onboarding_journey_checklist.stage_id é ON DELETE SET NULL.
  DELETE FROM public.onboarding_stages WHERE id = p_stage_id;

  RETURN jsonb_build_object(
    'ok', true, 'mode', 'excluir', 'etapa', v_nome,
    'movidas', v_moved, 'encerradas_desvinculadas', v_desvinc, 'historico_apagado', v_hist_del
  );
END
$function$;

REVOKE ALL ON FUNCTION public.onboarding_stage_remove(uuid, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.onboarding_stage_remove(uuid, text, uuid) TO authenticated, service_role;
