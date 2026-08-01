-- Total configurado da jornada = soma das etapas da JANELA contada, ao longo do trilho
-- inteiro (Onboarding → Implantação → Acompanhamento). Substitui os três números
-- concorrentes que existiam em 01/08 (pipeline digitado à mão, soma das etapas e
-- prazo do tipo de demanda, todos diferentes entre si).

CREATE OR REPLACE FUNCTION public.fn_onb_trilho_sla_min(
  p_tenant_id uuid,
  p_produto_id bigint DEFAULT NULL
) RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_total int := 0;
BEGIN
  -- Guarda de escopo: SECURITY DEFINER ignora RLS, então tenant_id vindo por parâmetro
  -- precisa ser barrado para usuário logado de outra empresa. Deixa passar
  -- service_role, cron e trigger. (ver 20260731230000_guarda_escopo_tenant_rpcs)
  PERFORM public.assert_tenant_scope(p_tenant_id);

  WITH trilho AS (
    -- Um pipeline por jornada ativa. MESMA regra de create_onboarding_journey e
    -- advance_onboarding_phase: ativo, com etapa, produto do cliente na frente.
    SELECT ph.position AS fpos,
           (SELECT p.id FROM public.onboarding_pipelines p
             WHERE p.tenant_id = p_tenant_id AND p.phase_id = ph.id AND p.ativo
               AND EXISTS (SELECT 1 FROM public.onboarding_stages s
                            WHERE s.pipeline_id = p.id AND s.ativo)
             ORDER BY (p.produto_id = p_produto_id) DESC NULLS LAST, p.position
             LIMIT 1) AS pipeline_id
      FROM public.onboarding_phases ph
     WHERE ph.tenant_id = p_tenant_id AND ph.ativo
  ), etapas AS (
    SELECT s.sla_minutos,
           COALESCE(s.inicia_sla,false)  AS inicia_sla,
           COALESCE(s.encerra_sla,false) AS encerra_sla,
           COALESCE(s.pausa_sla,false)   AS pausa_sla,
           row_number() OVER (ORDER BY t.fpos, s.position) AS ord
      FROM trilho t
      JOIN public.onboarding_stages s ON s.pipeline_id = t.pipeline_id AND s.ativo
  ), janela AS (
    SELECT COALESCE(min(ord) FILTER (WHERE inicia_sla),  min(ord)) AS ini,
           COALESCE(min(ord) FILTER (WHERE encerra_sla), max(ord)) AS fim
      FROM etapas
  )
  SELECT COALESCE(sum(e.sla_minutos), 0) INTO v_total
    FROM etapas e CROSS JOIN janela j
   WHERE e.ord >= j.ini AND e.ord <= j.fim
     AND NOT e.pausa_sla;

  -- Config incoerente (encerra antes de iniciar) devolve 0 em vez de número negativo;
  -- a faixa do trilho na tela de configuração é quem avisa.
  RETURN COALESCE(v_total, 0);
END $function$;

REVOKE ALL ON FUNCTION public.fn_onb_trilho_sla_min(uuid, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_onb_trilho_sla_min(uuid, bigint) TO authenticated, service_role;

COMMENT ON FUNCTION public.fn_onb_trilho_sla_min(uuid, bigint) IS
  'Minutos úteis configurados no trilho do produto, da etapa que inicia o SLA até a que encerra.';
