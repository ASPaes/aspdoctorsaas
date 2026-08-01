-- Decomposição do trilho, para a faixa da configuração parar de mentir.
--
-- A faixa mostrava só o total ("53d 6h") dentro da coluna de UM pipeline, e lia como se
-- fosse daquele pipeline — que tem 4d 6h. O número estava certo (é o trilho inteiro:
-- Onboarding + Implantação + Acompanhamento), o rótulo é que escondia de onde vinha.
-- Aqui devolvemos a conta aberta, para a tela mostrar "4d 6h + 4d + 45d = 53d 6h" e
-- deixar óbvio que a massa está no Acompanhamento e que falta marcar o encerra_sla.

CREATE OR REPLACE FUNCTION public.fn_onb_trilho_resumo(
  p_tenant_id uuid,
  p_produto_id bigint DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_res jsonb;
BEGIN
  PERFORM public.assert_tenant_scope(p_tenant_id);

  WITH trilho AS (
    -- MESMA regra de fn_onb_trilho_sla_min / create_onboarding_journey.
    SELECT ph.position AS fpos, ph.nome AS jornada,
           (SELECT p.id FROM public.onboarding_pipelines p
             WHERE p.tenant_id = p_tenant_id AND p.phase_id = ph.id AND p.ativo
               AND EXISTS (SELECT 1 FROM public.onboarding_stages s
                            WHERE s.pipeline_id = p.id AND s.ativo)
             ORDER BY (p.produto_id = p_produto_id) DESC NULLS LAST, p.position
             LIMIT 1) AS pipeline_id
      FROM public.onboarding_phases ph
     WHERE ph.tenant_id = p_tenant_id AND ph.ativo
  ), etapas AS (
    SELECT t.fpos, t.jornada, t.pipeline_id, s.nome,
           COALESCE(s.sla_minutos, 0) AS sla_minutos,
           COALESCE(s.inicia_sla,false)  AS inicia_sla,
           COALESCE(s.encerra_sla,false) AS encerra_sla,
           COALESCE(s.pausa_sla,false)   AS pausa_sla,
           row_number() OVER (ORDER BY t.fpos, s.position) AS ord
      FROM trilho t
      JOIN public.onboarding_stages s ON s.pipeline_id = t.pipeline_id AND s.ativo
  ), janela AS (
    SELECT COALESCE(min(ord) FILTER (WHERE inicia_sla),  min(ord)) AS ini,
           COALESCE(min(ord) FILTER (WHERE encerra_sla), max(ord)) AS fim,
           bool_or(encerra_sla) AS tem_encerra,
           bool_or(inicia_sla)  AS tem_inicia
      FROM etapas
  ), dentro AS (
    SELECT e.* FROM etapas e CROSS JOIN janela j
     WHERE e.ord >= j.ini AND e.ord <= j.fim AND NOT e.pausa_sla
  )
  SELECT jsonb_build_object(
           'total_min', (SELECT COALESCE(sum(sla_minutos),0) FROM dentro),
           'tem_encerra', (SELECT COALESCE(tem_encerra,false) FROM janela),
           'tem_inicia',  (SELECT COALESCE(tem_inicia,false)  FROM janela),
           'inicia_nome', (SELECT nome FROM etapas e, janela j WHERE e.ord = j.ini),
           'encerra_nome',(SELECT nome FROM etapas e, janela j WHERE e.ord = j.fim),
           'segmentos', COALESCE((
             SELECT jsonb_agg(x ORDER BY fpos)
               FROM (SELECT d.fpos, jsonb_build_object(
                              'jornada', d.jornada,
                              'min', sum(d.sla_minutos)) AS x
                       FROM dentro d GROUP BY d.fpos, d.jornada) y
           ), '[]'::jsonb)
         ) INTO v_res;

  RETURN v_res;
END $function$;

REVOKE ALL ON FUNCTION public.fn_onb_trilho_resumo(uuid, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_onb_trilho_resumo(uuid, bigint) TO authenticated, service_role;

COMMENT ON FUNCTION public.fn_onb_trilho_resumo(uuid, bigint) IS
  'Trilho aberto por jornada + limites da janela contada. Alimenta a faixa da configuração.';
