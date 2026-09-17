-- Correção dos dados que a 20260917010000 não alcança (ela só vale para venda
-- nova daqui em diante). Rodar DEPOIS dela.
--
-- 1) DE-PARA. PDV Legal Anual (17), PDV Legal - Servidor (18) e PDV Legal -
--    Suspenso (19) estavam ligados a GESTAO LEGAL e FULL no OEM. Nenhuma
--    licença ativa desses três é FULL (conferido em 17/09/2026: FULL = 10
--    licenças, todas em PDV Legal e Raspberry). Sai o FULL só desses três;
--    PDV Legal e Raspberry ficam com os dois. Decisão do Alexandre, 17/09/2026.
--
-- 2) MÓDULOS DA CALCULADORA COM CUSTO ZERO. 44 linhas 'intake' ativas (12
--    clientes, 5 já com licença vinculada). Passam a 'oem', com o custo
--    unitário da tabela da conta. A ficha soma pelo fn_sync_produto_valores;
--    nas vinculadas, a próxima carga do espelho troca o custo do módulo pelo
--    que a licença cobra e a diferença para a ficha aparece na conferência.
--    Omie não é tocado: custo não vai para o Omie e o gatilho de lá só olha
--    vlr_mensal/quantidade/ativo — o hold é cinto de segurança.

BEGIN;

SELECT set_config('doctorsaas.intake_hold_omie', 'true', true);

DELETE FROM public.oem_produto_vinculo v
 USING public.oem_integration i
 WHERE i.id = v.conta_integration_id
   AND v.produto_id IN (17, 18, 19)
   AND v.produto_nome = 'FULL'
   AND NOT EXISTS (
     SELECT 1 FROM public.cliente_produtos cp
       JOIN public.oem_espelho_filial f
         ON f.filial_codigo = cp.oem_codigo_filial AND f.tenant_id = cp.tenant_id
      WHERE cp.produto_id = v.produto_id AND cp.ativo
        AND f.status = 'Ativo' AND f.produto_principal = 'FULL');

WITH alvo AS (
  SELECT m.id, m.modulo_id, cp.produto_id, oc.conta_id
    FROM public.cliente_produto_modulos m
    JOIN public.cliente_produtos cp ON cp.id = m.cliente_produto_id
    JOIN public.clientes cl ON cl.id = cp.cliente_id
    CROSS JOIN LATERAL (
      SELECT i.id AS conta_id FROM public.oem_integration i
       WHERE i.tenant_id = cp.tenant_id AND i.ativo = true
         AND i.unidades_base_ids @> ARRAY[cl.unidade_base_id]
       ORDER BY i.criado_em LIMIT 1) oc
   WHERE m.origem = 'intake' AND m.ativo AND cp.ativo
), com_produto AS (
  SELECT a.*, op.produto_codigo
    FROM alvo a
    CROSS JOIN LATERAL (
      SELECT v.produto_codigo FROM public.oem_produto_vinculo v
        LEFT JOIN LATERAL (
          SELECT count(*) AS n FROM public.oem_espelho_filial f
           WHERE f.conta_integration_id = v.conta_integration_id
             AND f.status = 'Ativo' AND f.produto_principal = v.produto_nome) u ON true
       WHERE v.conta_integration_id = a.conta_id AND v.produto_id = a.produto_id
       ORDER BY u.n DESC, v.produto_codigo LIMIT 1) op
)
UPDATE public.cliente_produto_modulos m
   SET origem     = 'oem',
       vlr_custo  = CASE WHEN coalesce(m.vlr_custo, 0) = 0
                         THEN coalesce(pr.valor_unitario, 0) ELSE m.vlr_custo END,
       updated_at = now()
  FROM com_produto c
  JOIN public.produto_modulos pm ON pm.id = c.modulo_id
  LEFT JOIN public.oem_espelho_modulo_preco pr
         ON pr.conta_integration_id = c.conta_id
        AND pr.produto_codigo = c.produto_codigo
        AND pr.modulo_codigo = pm.oem_modulo_codigo
 WHERE m.id = c.id
RETURNING m.cliente_produto_id, pm.nome, m.quantidade, m.vlr_custo;

COMMIT;
