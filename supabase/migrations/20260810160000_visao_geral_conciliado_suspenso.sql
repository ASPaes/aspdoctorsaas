-- Conciliacao: expor quanto do "conciliado" esta SUSPENSO no Omie.
--
-- Nada de calculo muda aqui -- so entram 2 campos novos no bloco 'conciliado'.
--
-- Medido em producao em 10/08/2026, dentro de estado_match='CASADO' com contrato no Omie:
--   Digi Up      91 situacao '10'  ·  0 suspenso                       -- limpo
--   Digi Office 659 situacao '10'  · 39 suspenso ('90'), R$ 47.597,20
-- Nenhum com vigencia_final_omie vencida, e nenhum cancelado: '99' ja sai do CASADO como
-- CASADO_INATIVO na deteccao (20260807013000).
--
-- Por que o suspenso CONTINUA no conciliado: o vinculo e real e a deteccao mantem '90' como
-- CASADO de proposito -- suspenso pode ser reativado, e trata-lo como nao-vinculado faria o
-- painel oferecer "criar" um SEGUNDO contrato para quem ja tem um vivo no Omie (cobranca em
-- duplicidade). O valor tambem nao distorce a divergencia: os 39 batem centavo a centavo nos
-- dois lados, e a deteccao ja marca estado_valor='NAO_COMPARAVEL' para eles.
--
-- O que faltava era so dizer isso na tela: R$ 47,6 mil (16,5% do conciliado da Digi Office) o
-- Omie nao esta faturando, e o DoctorSaaS conta como receita ativa. Os 39 ja existem no balde
-- 'contrato_suspenso'; agora o numero do medidor aponta para la.
--
-- Corpo identico ao aplicado hoje em 20260810140000 fora as 2 linhas novas.

begin;

CREATE OR REPLACE FUNCTION public.reconciliacao_visao_geral(p_tenant_id uuid, p_conta_integration_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT public.assert_tenant_scope(p_tenant_id);
WITH escopo AS (
  SELECT unidades_base_ids AS ids FROM omie_integration WHERE id = p_conta_integration_id
),
rc AS (SELECT * FROM reconciliacao_cadastro WHERE tenant_id = p_tenant_id AND conta_integration_id = p_conta_integration_id),
om AS (SELECT * FROM omie_espelho_cadastro WHERE conta_integration_id = p_conta_integration_id),
-- Um registro por CONTRATO do Omie. Fallback para as colunas achatadas quando contratos_omie
-- vier vazio (espelho puxado por uma versao anterior a v4): sem ele o card zeraria em silencio.
om_ctr AS (
  SELECT (c->>'situacao_contrato') AS situacao_contrato,
         (c->>'valor_omie')::numeric AS valor_omie
  FROM om o
  CROSS JOIN LATERAL jsonb_array_elements(
    COALESCE(
      NULLIF(o.contratos_omie, '[]'::jsonb),
      CASE WHEN o.codigo_contrato_omie IS NOT NULL
           THEN jsonb_build_array(jsonb_build_object(
                  'situacao_contrato', o.situacao_contrato,
                  'valor_omie',        o.valor_omie))
           ELSE '[]'::jsonb END
    )
  ) c
)
SELECT jsonb_build_object(
  'gerado_em', (SELECT max(gerado_em) FROM rc),
  'ds', jsonb_build_object(
     -- clientes ativos DENTRO do escopo de unidades da integracao (NULL = todas)
     'clientes',          (SELECT count(*) FROM clientes cl
                           WHERE cl.tenant_id = p_tenant_id
                             AND COALESCE(cl.cancelado,false) = false
                             AND ( (SELECT ids FROM escopo) IS NULL
                                   OR cl.unidade_base_id IN (SELECT unnest(e.ids) FROM escopo e) )),
     'contratos_ativos',  (SELECT count(*) FROM rc),
     'mrr_total',         (SELECT COALESCE(sum(valor_mrr_ds),0) FROM rc),
     'mrr_conciliavel',   (SELECT COALESCE(sum(valor_mrr_ds),0) FROM rc WHERE estado_match='CASADO')
  ),
  'omie', jsonb_build_object(
     'clientes',          (SELECT count(*) FROM om),
     'contratos_ativos',  (SELECT count(*) FROM om_ctr WHERE situacao_contrato = '10'),
     'mrr_total_ativos',  (SELECT COALESCE(sum(valor_omie),0) FROM om_ctr WHERE situacao_contrato = '10')
  ),
  'conciliado', jsonb_build_object(
     'contratos_casados', (SELECT count(*) FROM rc WHERE estado_match='CASADO'),
     'com_contrato_omie', (SELECT count(*) FROM rc WHERE estado_match='CASADO' AND codigo_contrato_omie IS NOT NULL),
     'mrr_casado_ds',     (SELECT COALESCE(sum(valor_mrr_ds),0) FROM rc WHERE estado_match='CASADO' AND codigo_contrato_omie IS NOT NULL),
     'mrr_casado_omie',   (SELECT COALESCE(sum(valor_omie),0)   FROM rc WHERE estado_match='CASADO' AND codigo_contrato_omie IS NOT NULL),
     'mrr_divergencia',   (SELECT COALESCE(sum(valor_mrr_ds),0)-COALESCE(sum(valor_omie),0) FROM rc WHERE estado_match='CASADO' AND codigo_contrato_omie IS NOT NULL),
     'divergencia_valor_qtd',      (SELECT count(*) FROM rc WHERE acao_sugerida='resolver'),
     'divergencia_valor_montante', (SELECT COALESCE(sum(valor_omie - valor_mrr_ds),0) FROM rc WHERE acao_sugerida='resolver'),
     'pendente_assuncao_mrr_omie', (SELECT COALESCE(sum(valor_omie),0) FROM rc WHERE acao_sugerida='pendente_assuncao' AND codigo_contrato_omie IS NOT NULL),
     -- NOVO: o pedaco do conciliado que o Omie nao esta faturando.
     'suspenso_qtd',      (SELECT count(*) FROM rc WHERE estado_match='CASADO' AND codigo_contrato_omie IS NOT NULL AND situacao_contrato='90'),
     'suspenso_mrr_ds',   (SELECT COALESCE(sum(valor_mrr_ds),0) FROM rc WHERE estado_match='CASADO' AND codigo_contrato_omie IS NOT NULL AND situacao_contrato='90')
  ),
  'baldes', (SELECT COALESCE(jsonb_object_agg(acao_sugerida, qtd),'{}'::jsonb)
             FROM (SELECT acao_sugerida, count(*) qtd FROM rc GROUP BY acao_sugerida) b),
  'total_contratos', (SELECT count(*) FROM rc)
);
$function$;

revoke all on function public.reconciliacao_visao_geral(uuid, uuid) from public;
grant execute on function public.reconciliacao_visao_geral(uuid, uuid) to authenticated, service_role;

commit;
