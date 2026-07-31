-- Quadro padrão da jornada de Acompanhamento.
--
-- A jornada nasce cadastrada e INATIVA em todo tenant (fn_seed_onboarding_phases), mas o seed
-- parava aí: sem pipeline, advance_onboarding_phase devolve 'fase_sem_pipeline' e a jornada
-- simplesmente não avança. Aqui o quadro passa a vir montado no momento em que alguém ativa a
-- jornada — depois é cadastro comum, o tenant edita o que quiser.
--
-- Sem SLA em etapa nenhuma, de propósito: advance_onboarding_phase faz
-- sla_iniciado_em = COALESCE(sla_iniciado_em, now()), ou seja o relógio da jornada NÃO reinicia
-- ao entrar no Acompanhamento — prazo por etapa aqui nasceria estourado.

CREATE OR REPLACE FUNCTION public.fn_seed_onboarding_acompanhamento_pipeline(p_tenant_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_phase uuid;
  v_pipe  uuid;
  v_secs  text[] := ARRAY['acompanhamento','participantes','eventos'];
BEGIN
  v_phase := public.fn_onboarding_phase_id(p_tenant_id, 'acompanhamento');
  IF v_phase IS NULL THEN
    RETURN NULL;  -- tenant sem a fase-semente: nada a fazer
  END IF;

  -- Guarda de idempotência: QUALQUER pipeline na jornada (ativo ou não) significa cadastro já
  -- mexido pelo tenant. Nunca sobrescreve, nunca duplica, nunca ressuscita o que foi apagado.
  IF EXISTS (
    SELECT 1 FROM public.onboarding_pipelines
     WHERE tenant_id = p_tenant_id AND phase_id = v_phase
  ) THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.onboarding_pipelines
    (tenant_id, phase_id, produto_id, department_id, nome, descricao, sla_total_minutos, ativo, position)
  VALUES
    (p_tenant_id, v_phase, NULL, NULL, 'Acompanhamento de uso',
     'Quadro padrão da jornada de Acompanhamento. Renomeie, reordene ou apague as etapas à vontade.',
     NULL, true, 1)
  RETURNING id INTO v_pipe;

  INSERT INTO public.onboarding_stages
    (tenant_id, pipeline_id, nome, slug, position, cor, is_initial, is_final, sla_minutos, visible_sections)
  VALUES
    (p_tenant_id, v_pipe, 'Primeiras semanas',  'primeiras-semanas',  1, '#0EA5E9', true,  false, NULL, v_secs),
    (p_tenant_id, v_pipe, 'Uso em ritmo',       'uso-em-ritmo',       2, '#22C55E', false, false, NULL, v_secs),
    -- onde cai quem parou de usar: é o motivo de abrir este quadro todo dia
    (p_tenant_id, v_pipe, 'Sinal de risco',     'sinal-de-risco',     3, '#EF4444', false, false, NULL, v_secs),
    (p_tenant_id, v_pipe, 'Cliente destravado', 'cliente-destravado', 4, '#F59E0B', false, true,  NULL,
     ARRAY['acompanhamento','eventos']);

  RETURN v_pipe;
END $function$;

COMMENT ON FUNCTION public.fn_seed_onboarding_acompanhamento_pipeline(uuid) IS
  'Monta o quadro padrão da jornada de Acompanhamento. Só age se o tenant não tiver NENHUM pipeline nessa jornada.';

-- ---------------------------------------------------------------- gatilho
-- No banco, não no front: vale para o toggle da tela de cadastro, para UPDATE manual via SQL e
-- para tenant novo. Um caminho só.
CREATE OR REPLACE FUNCTION public.trg_seed_acompanhamento_pipeline()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.fn_seed_onboarding_acompanhamento_pipeline(NEW.tenant_id);
  RETURN NULL;
END $function$;

DROP TRIGGER IF EXISTS trg_seed_acompanhamento_pipeline ON public.onboarding_phases;
CREATE TRIGGER trg_seed_acompanhamento_pipeline
  AFTER UPDATE OF ativo ON public.onboarding_phases
  FOR EACH ROW
  WHEN (NEW.slug = 'acompanhamento' AND NEW.ativo AND NOT OLD.ativo)
  EXECUTE FUNCTION public.trg_seed_acompanhamento_pipeline();

-- ---------------------------------------------------------------- grants
-- O default privilege do Supabase dá EXECUTE a `authenticated` em TODA função nova, e o REVOKE
-- FROM PUBLIC não remove esse grant explícito. Como esta função recebe tenant_id por parâmetro e
-- é SECURITY DEFINER, deixá-la aberta permitiria a um usuário semear pipeline no tenant de outro.
-- Quem precisa dela é o trigger, que roda como dono (postgres) — ninguém mais.
REVOKE ALL ON FUNCTION public.fn_seed_onboarding_acompanhamento_pipeline(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_seed_onboarding_acompanhamento_pipeline(uuid) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_seed_acompanhamento_pipeline() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.trg_seed_acompanhamento_pipeline() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_seed_onboarding_acompanhamento_pipeline(uuid) TO service_role;

-- Backfill: nenhum. Em 31/07/2026 não existe tenant com a jornada ativa e sem pipeline
-- (só a Digi Office tem a jornada ativa, e ela já tem o pipeline dela).
