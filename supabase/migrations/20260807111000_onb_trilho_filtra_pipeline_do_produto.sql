-- O trilho (total de SLA e go-live) escolhia pipeline de OUTRO produto.
--
-- `ORDER BY (p.produto_id = p_produto_id) DESC NULLS LAST` sozinho não filtra: em
-- boolean DESC o `false` (pipeline amarrado a outro produto) vem ANTES do `NULL`
-- (pipeline genérico, que é o que serve o produto sem quadro próprio). Sem o
-- `WHERE`, um produto sem pipeline dedicado herdava o quadro do produto vizinho.
--
-- `create_onboarding_journey` e `fn_onboarding_assignment_pool` já tinham o filtro,
-- então a jornada nascia no quadro certo e só a PROMESSA (go-live) saía do quadro
-- errado. Medido na Digi Office em 07/08/2026: PDV Legal somava o trilho do Gula —
-- 3960 min (9 dias úteis) em vez de 2280 min (5 dias úteis).
--
-- Aditivo: só acrescenta o WHERE que faltava. Produto com pipeline próprio continua
-- casando por ele; produto sem pipeline próprio cai no genérico, como na criação.

CREATE OR REPLACE FUNCTION public.fn_onb_trilho_sla_min(p_tenant_id uuid, p_produto_id bigint DEFAULT NULL::bigint)
 RETURNS integer
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_total int := 0;
BEGIN
  -- Guarda de escopo: SECURITY DEFINER ignora RLS, então tenant_id vindo por parâmetro
  -- precisa ser conferido contra quem chamou.
  PERFORM public.assert_tenant_scope(p_tenant_id);

  WITH trilho AS (
    SELECT ph.position AS fpos,
           (SELECT p.id FROM public.onboarding_pipelines p
             WHERE p.tenant_id = p_tenant_id AND p.phase_id = ph.id AND p.ativo
               -- mesma regra de create_onboarding_journey: o quadro do produto, ou o genérico
               AND (p.produto_id = p_produto_id OR p.produto_id IS NULL)
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

  RETURN COALESCE(v_total, 0);
END $function$;

CREATE OR REPLACE FUNCTION public.fn_onb_trilho_resumo(p_tenant_id uuid, p_produto_id bigint DEFAULT NULL::bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_res jsonb;
BEGIN
  PERFORM public.assert_tenant_scope(p_tenant_id);

  WITH trilho AS (
    SELECT ph.position AS fpos, ph.nome AS jornada,
           (SELECT p.id FROM public.onboarding_pipelines p
             WHERE p.tenant_id = p_tenant_id AND p.phase_id = ph.id AND p.ativo
               -- mesma regra de create_onboarding_journey: o quadro do produto, ou o genérico
               AND (p.produto_id = p_produto_id OR p.produto_id IS NULL)
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
