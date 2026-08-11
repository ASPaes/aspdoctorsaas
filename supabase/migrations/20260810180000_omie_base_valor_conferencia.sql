-- Conferencia Omie: escolher qual valor do Omie vale como base do de/para.
--
-- O Omie NAO manda bloco de totais no payload do contrato -- a caixa "Total dos Servicos /
-- Total de Descontos / Total do Contrato" da tela dele e calculada. O desconto mora so no item
-- (itensContrato[].itemCabecalho.valorDesconto / aliqDesconto), nunca no cabecalho.
--
-- Medido em producao em 10/08/2026 (DoctorOMIE, tenant Digi Office), 4 contratos com desconto:
--   cabecalho.nValTotMes = Sum(itens.valorTotal)              = TOTAL DO CONTRATO (liquido)
--   Sum(itens.quant x itens.valorUnit)                        = TOTAL DOS SERVICOS (bruto)
--   contrato 7618191606: bruto 354,70 · desconto 102,45 · nValTotMes 252,25
--   contrato 7672135189: bruto 418,00 · desconto 109,10 · nValTotMes 308,90
--   contrato 7626271548: bruto 324,70 · desconto  87,45 · nValTotMes 237,25
--   contrato 7672717182: bruto 269,90 · desconto  70,00 · nValTotMes 199,90
-- O MRR do DoctorSaaS e o BRUTO. Por isso os 4 batiam centavo a centavo no bruto e apareciam
-- como "divergencia de valor" contra o liquido. Nao era erro de cadastro: era base diferente.
--
-- O valor_omie CONTINUA sendo fielmente o Total do Contrato -- ele nao pode passar a mentir
-- sobre o que esta no Omie, senao o painel deixa de ser auditavel. O que entra e:
--   valor_servicos_omie  = o bruto (vem do espelho_snapshot do DoctorOMIE, via recon-espelho-pull v6)
--   valor_omie_efetivo   = o que a deteccao DE FATO comparou, ja resolvido pela chave
-- A tela e o "alinhar valor no DS" leem valor_omie_efetivo. Uma coluna, uma verdade -- e ninguem
-- reimplementa a regra do seu jeito.
--
-- ESCOPO: a chave muda a CONFERENCIA (estado_valor, diffs, acao_sugerida). Ela NAO muda o
-- "Retrato das bases" da reconciliacao_visao_geral (mrr_total_ativos / mrr_casado_omie /
-- mrr_divergencia), que continua refletindo o que o Omie realmente fatura. Sao perguntas
-- diferentes: "o cadastro confere?" e "quanto cada base tem?".

BEGIN;

-- ---------------------------------------------------------------------------
-- Colunas (idempotente -- aplicado em producao em 10/08/2026)
-- ---------------------------------------------------------------------------
ALTER TABLE public.omie_espelho_cadastro
  ADD COLUMN IF NOT EXISTS valor_servicos_omie numeric;

ALTER TABLE public.omie_integration
  ADD COLUMN IF NOT EXISTS base_valor_conferencia text NOT NULL DEFAULT 'total_contrato';

ALTER TABLE public.omie_integration
  DROP CONSTRAINT IF EXISTS omie_integration_base_valor_conferencia_check;
ALTER TABLE public.omie_integration
  ADD CONSTRAINT omie_integration_base_valor_conferencia_check
  CHECK (base_valor_conferencia IN ('total_contrato','total_servicos'));

ALTER TABLE public.reconciliacao_cadastro
  ADD COLUMN IF NOT EXISTS valor_servicos_omie numeric,
  ADD COLUMN IF NOT EXISTS valor_omie_efetivo  numeric;

-- ---------------------------------------------------------------------------
-- rodar_deteccao_reconciliacao — passa a comparar pela base escolhida
-- Corpo identico ao que estava no ar (conferido por pg_get_functiondef em 10/08/2026),
-- fora os pontos marcados com "10/08".
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rodar_deteccao_reconciliacao(
  p_tenant_id uuid,
  p_conta_integration_id uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_afetados integer;
  v_base     text;      -- 10/08: 'total_contrato' | 'total_servicos'
BEGIN
  PERFORM public.assert_tenant_scope(p_tenant_id);

  -- F2b: a conta tem de ser deste tenant. Sem isso, um id de outro tenant faria a deteccao rodar
  -- com escopo vazio e o DELETE do fim limparia a reconciliacao inteira.
  -- 10/08: o SELECT INTO faz as duas coisas (valida o escopo e le a chave) numa varredura so.
  -- 0 linhas deixa v_base NULL, que e exatamente o caso "conta nao e deste tenant".
  SELECT COALESCE(base_valor_conferencia,'total_contrato') INTO v_base
  FROM omie_integration
  WHERE id = p_conta_integration_id AND tenant_id = p_tenant_id;

  IF v_base IS NULL THEN
    RAISE EXCEPTION 'Conta Omie % nao pertence ao tenant %', p_conta_integration_id, p_tenant_id;
  END IF;

  WITH ds  AS (SELECT * FROM snapshot_reconciliacao_ds(p_tenant_id, p_conta_integration_id)), -- F2b (a)
       om  AS (SELECT * FROM omie_espelho_cadastro
                WHERE conta_integration_id = p_conta_integration_id                           -- F2b (b)
                  AND length(cnpj_norm) IN (11,14)),
       dsn AS (SELECT cnpj_norm, count(*) c FROM ds WHERE length(cnpj_norm) IN (11,14) GROUP BY cnpj_norm),
       omn AS (SELECT cnpj_norm, count(*) c FROM om GROUP BY cnpj_norm),
       m AS (
         SELECT ds.*, COALESCE(dsn.c,0) ds_mult, COALESCE(omn.c,0) om_mult,
                clf.fornecedor_id AS fornecedor_id, frn.nome AS fornecedor_ds,
                o.codigo_cliente_omie, o.codigo_contrato_omie, o.valor_omie, o.razao_social_omie, o.situacao_contrato, o.tem_cancelado_omie,
                o.valor_servicos_omie,                                                        -- 10/08
                o.vigencia_inicial_omie, o.vigencia_final_omie, o.dia_venc_omie,
                o.origem_codigo, o.omie_inativo
         FROM ds
         LEFT JOIN clientes clf ON clf.id = ds.ds_customer_id
         LEFT JOIN fornecedores frn ON frn.id = clf.fornecedor_id
         LEFT JOIN dsn ON dsn.cnpj_norm=ds.cnpj_norm
         LEFT JOIN omn ON omn.cnpj_norm=ds.cnpj_norm
         LEFT JOIN LATERAL (
           SELECT * FROM om o2
           WHERE o2.cnpj_norm=ds.cnpj_norm AND COALESCE(dsn.c,0)=1 AND COALESCE(omn.c,0)=1
           LIMIT 1
         ) o ON true
       ),
       f AS (
         SELECT m.*,
           -- 23/07/2026: CASADO_INATIVO. Contraparte CANCELADA ('99') no Omie nao e vinculo vivo.
           -- SO '99', DE PROPOSITO. '90' (suspenso) fica como CASADO: suspenso pode ser reativado,
           -- e trata-lo como nao-vinculado faria criar um SEGUNDO contrato para quem ja tem um vivo
           -- no Omie -- cobranca em duplicidade.
           CASE WHEN om_mult=0 THEN 'SO_NO_DS'
                WHEN om_mult=1 AND ds_mult=1 AND COALESCE(situacao_contrato,'10')='99' THEN 'CASADO_INATIVO'
                WHEN om_mult=1 AND ds_mult=1 THEN 'CASADO'
                ELSE 'AMBIGUO' END AS estado_match,
           (om_mult=1 AND ds_mult=1) AS eh_casado,
           (COALESCE(origem_codigo,'vazio') NOT IN ('vazio','DS')) AS eh_alheio,
           (COALESCE(situacao_contrato,'10')='10') AS contrato_ativo10,
           -- 10/08: o valor que esta deteccao comparou.
           -- O COALESCE nao e enfeite: enquanto o espelho nao for repuxado pela v6 do
           -- recon-espelho-pull, valor_servicos_omie esta NULO em todas as linhas. Sem ele, ligar
           -- a chave faria a base inteira virar divergencia contra R$ 0,00.
           CASE WHEN v_base = 'total_servicos' THEN COALESCE(valor_servicos_omie, valor_omie)
                ELSE valor_omie END AS valor_omie_efetivo
         FROM m
       )
  INSERT INTO reconciliacao_cadastro AS r (
    tenant_id, conta_integration_id, ds_contract_id, ds_customer_id, gerado_em,                 -- F2b (c)
    cnpj_norm, razao_ds, razao_omie, fornecedor_id, fornecedor_ds, valor_mrr_ds, vigencia_inicial_ds, vigencia_final_ds, dia_venc_ds, modelo_ds, passa_validacao, multi_contrato,
    codigo_cliente_omie, codigo_contrato_omie, valor_omie, vigencia_inicial_omie, vigencia_final_omie, dia_venc_omie, origem_codigo, omie_inativo, situacao_contrato, tem_cancelado_omie, qtd_candidatos_omie,
    valor_servicos_omie, valor_omie_efetivo,                                                   -- 10/08
    estado_match, estado_valor, diffs, acao_sugerida)
  SELECT p_tenant_id, p_conta_integration_id, ds_contract_id, ds_customer_id, now(),            -- F2b (c)
    cnpj_norm, razao_social, razao_social_omie, fornecedor_id, fornecedor_ds, valor_mrr, vigencia_inicial, vigencia_final, dia_vencimento, modelo, passa_validacao, multi_contrato,
    codigo_cliente_omie, codigo_contrato_omie, valor_omie, vigencia_inicial_omie, vigencia_final_omie, dia_venc_omie, origem_codigo, omie_inativo, situacao_contrato, tem_cancelado_omie, om_mult,
    valor_servicos_omie, valor_omie_efetivo,                                                   -- 10/08
    estado_match,
    CASE WHEN NOT eh_casado THEN NULL
         WHEN multi_contrato OR codigo_contrato_omie IS NULL OR NOT contrato_ativo10 THEN 'NAO_COMPARAVEL'
         WHEN abs(COALESCE(valor_mrr,0)-COALESCE(valor_omie_efetivo,0))>0.01                   -- 10/08
           OR (origem_codigo='DS' AND vigencia_inicial IS DISTINCT FROM vigencia_inicial_omie)
           OR (origem_codigo='DS' AND vigencia_final   IS DISTINCT FROM vigencia_final_omie)
           OR (origem_codigo='DS' AND dia_venc_omie IS NOT NULL AND dia_vencimento IS NOT NULL AND dia_vencimento<>dia_venc_omie)
         THEN 'DIVERGENTE' ELSE 'OK' END,
    CASE WHEN eh_casado AND NOT multi_contrato AND codigo_contrato_omie IS NOT NULL AND contrato_ativo10 THEN jsonb_strip_nulls(jsonb_build_object(
      -- 10/08: 'omie' passa a ser o valor comparado. Os outros 3 campos existem para o humano
      -- que abre a linha entender POR QUE o numero e aquele -- sem eles, "Omie 354,70" nao bate
      -- com o que ele ve na tela do Omie (252,25) e vira chamado.
      'valor', CASE WHEN abs(COALESCE(valor_mrr,0)-COALESCE(valor_omie_efetivo,0))>0.01 THEN jsonb_build_object(
                 'ds',   valor_mrr,
                 'omie', valor_omie_efetivo,
                 'base', v_base,
                 'omie_total_contrato', valor_omie,
                 'omie_total_servicos', valor_servicos_omie) END,
      'vigencia_inicial', CASE WHEN origem_codigo='DS' AND vigencia_inicial IS DISTINCT FROM vigencia_inicial_omie THEN jsonb_build_object('ds',vigencia_inicial,'omie',vigencia_inicial_omie) END,
      'vigencia_final', CASE WHEN origem_codigo='DS' AND vigencia_final IS DISTINCT FROM vigencia_final_omie THEN jsonb_build_object('ds',vigencia_final,'omie',vigencia_final_omie) END,
      'dia_venc', CASE WHEN origem_codigo='DS' AND dia_venc_omie IS NOT NULL AND dia_vencimento IS NOT NULL AND dia_vencimento<>dia_venc_omie THEN jsonb_build_object('ds',dia_vencimento,'omie',dia_venc_omie) END
    )) END,
    CASE
      -- 17/07/2026: PRIMEIRO de tudo, de proposito. Regra do Ale: Cobranca Fornecedor nao vai
      -- para o Omie. Alarme por desenho treina a ignorar o painel.
      WHEN NOT sincroniza_omie                   THEN 'fora_do_escopo'
      WHEN estado_match='SO_NO_DS' THEN CASE WHEN NOT tem_modelo THEN 'atribuir_modelo' WHEN passa_validacao THEN 'criar' ELSE 'corrigir_ds' END
      WHEN estado_match='AMBIGUO' THEN 'escolher_candidato'
      ELSE CASE
        WHEN codigo_contrato_omie IS NULL          THEN 'criar_contrato'
        WHEN COALESCE(situacao_contrato,'10')='90' THEN 'contrato_suspenso'
        WHEN COALESCE(situacao_contrato,'10')='99' THEN 'contrato_cancelado'
        WHEN COALESCE(situacao_contrato,'10')='10'
             AND vigencia_final_omie IS NOT NULL
             AND vigencia_final_omie < CURRENT_DATE
                                                   THEN 'vigencia_vencida_no_omie'
        WHEN multi_contrato                        THEN 'revisar_multi'
        WHEN abs(COALESCE(valor_mrr,0)-COALESCE(valor_omie_efetivo,0))<=0.01                   -- 10/08
             AND (origem_codigo<>'DS' OR vigencia_inicial IS NOT DISTINCT FROM vigencia_inicial_omie)
             AND (origem_codigo<>'DS' OR vigencia_final   IS NOT DISTINCT FROM vigencia_final_omie)
             AND (origem_codigo<>'DS' OR dia_venc_omie IS NULL OR dia_vencimento IS NULL OR dia_vencimento=dia_venc_omie)
                                                   THEN 'vinculo_auto_ok'
        ELSE 'resolver' END
    END
  FROM f
  ON CONFLICT (tenant_id, ds_contract_id) DO UPDATE SET
    conta_integration_id=EXCLUDED.conta_integration_id,                                          -- F2b (c)
    gerado_em=EXCLUDED.gerado_em, ds_customer_id=EXCLUDED.ds_customer_id,
    cnpj_norm=EXCLUDED.cnpj_norm, razao_ds=EXCLUDED.razao_ds, razao_omie=EXCLUDED.razao_omie,
    fornecedor_id=EXCLUDED.fornecedor_id, fornecedor_ds=EXCLUDED.fornecedor_ds,
    valor_mrr_ds=EXCLUDED.valor_mrr_ds,
    vigencia_inicial_ds=EXCLUDED.vigencia_inicial_ds, vigencia_final_ds=EXCLUDED.vigencia_final_ds, dia_venc_ds=EXCLUDED.dia_venc_ds,
    modelo_ds=EXCLUDED.modelo_ds, passa_validacao=EXCLUDED.passa_validacao, multi_contrato=EXCLUDED.multi_contrato,
    codigo_cliente_omie=EXCLUDED.codigo_cliente_omie, codigo_contrato_omie=EXCLUDED.codigo_contrato_omie, valor_omie=EXCLUDED.valor_omie,
    valor_servicos_omie=EXCLUDED.valor_servicos_omie, valor_omie_efetivo=EXCLUDED.valor_omie_efetivo,  -- 10/08
    vigencia_inicial_omie=EXCLUDED.vigencia_inicial_omie, vigencia_final_omie=EXCLUDED.vigencia_final_omie, dia_venc_omie=EXCLUDED.dia_venc_omie,
    origem_codigo=EXCLUDED.origem_codigo, omie_inativo=EXCLUDED.omie_inativo, situacao_contrato=EXCLUDED.situacao_contrato, tem_cancelado_omie=EXCLUDED.tem_cancelado_omie, qtd_candidatos_omie=EXCLUDED.qtd_candidatos_omie,
    estado_match=EXCLUDED.estado_match, estado_valor=EXCLUDED.estado_valor, diffs=EXCLUDED.diffs, acao_sugerida=EXCLUDED.acao_sugerida;

  GET DIAGNOSTICS v_afetados = ROW_COUNT;

  -- F2b (d): orfaos DESTA conta. Sem o filtro, rodar a deteccao de uma unidade apagaria a
  -- reconciliacao inteira da outra -- inclusive a decisao humana (status_usuario,
  -- candidato_escolhido, resolvido_por), que nao volta.
  DELETE FROM reconciliacao_cadastro
  WHERE tenant_id=p_tenant_id
    AND conta_integration_id = p_conta_integration_id
    AND ds_contract_id NOT IN (
      SELECT ds_contract_id FROM snapshot_reconciliacao_ds(p_tenant_id, p_conta_integration_id)
    );

  RETURN v_afetados;
END;
$function$;

COMMIT;
