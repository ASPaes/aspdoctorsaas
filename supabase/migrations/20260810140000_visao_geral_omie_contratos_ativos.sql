-- Retrato das bases: o lado Omie contava o campo errado.
--
-- 'contratos_ativos' e 'mrr_total_ativos' saiam de:
--     WHERE codigo_contrato_omie IS NOT NULL
-- Isso e "clientes do espelho que tem ALGUM contrato no Omie", nao contrato ativo. Dois defeitos
-- somados:
--   1. ignora situacao_contrato -- '90' (suspenso) e '99' (cancelado) contavam como ativos, e o
--      valor deles entrava no "MRR ativo". Os codigos sao os mesmos da deteccao
--      (20260807013000_omie_deteccao_por_conta.sql): '10' ativo, '90' suspenso, '99' cancelado.
--   2. conta CLIENTE, nao contrato. codigo_contrato_omie/valor_omie sao o "melhor contrato" da
--      linha -- 1 por cliente. A lista completa vive em contratos_omie (JSON), gravada pelo
--      recon-espelho-pull v4; e dela que recon-candidatos-listar tira os ativos.
--
-- Medido em producao em 10/08/2026, antes x depois:
--   Digi Up      156 / R$  52.642,28  ->  93 / R$  31.634,52   (DS: 93 / R$ 31.638,96)
--   Digi Office 1482 / R$ 574.736,46  -> 863 / R$ 324.069,87
-- Os 93 da Digi Up batem contrato a contrato com o DoctorSaaS; os R$ 4,44 de diferenca sao as 2
-- divergencias de valor que a propria Conferencia ja aponta.
--
-- Filtro estrito `= '10'` de proposito: e exatamente o que foi medido acima. A deteccao usa
-- COALESCE(situacao_contrato,'10') porque la o default cobre a coluna achatada antiga; aqui as
-- entradas do JSON vem sempre com a situacao preenchida (sem_json_contratos = 0 nas duas contas).
--
-- Corpo byte a byte igual ao pg_get_functiondef de producao fora o bloco 'omie'.

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
     'pendente_assuncao_mrr_omie', (SELECT COALESCE(sum(valor_omie),0) FROM rc WHERE acao_sugerida='pendente_assuncao' AND codigo_contrato_omie IS NOT NULL)
  ),
  'baldes', (SELECT COALESCE(jsonb_object_agg(acao_sugerida, qtd),'{}'::jsonb)
             FROM (SELECT acao_sugerida, count(*) qtd FROM rc GROUP BY acao_sugerida) b),
  'total_contratos', (SELECT count(*) FROM rc)
);
$function$;

revoke all on function public.reconciliacao_visao_geral(uuid, uuid) from public;
grant execute on function public.reconciliacao_visao_geral(uuid, uuid) to authenticated, service_role;

commit;
