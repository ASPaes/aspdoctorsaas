-- ============================================================================
-- fn_mrr_do_modulo estava somando um valor que nunca chegou ao MRR.
--
-- Caso, em 28/08/2026 (NECTAR DA SERRA VALEMAR - LOJA, DigiOffice): o módulo
-- IFood tem vlr_mensal = 48,00 na linha E um upsell de R$ 48,00 amarrado a
-- ela. A janela de cancelar somava os dois e sugeria baixar R$ 96,00 de um
-- módulo que vale R$ 48,00.
--
-- Não são duas receitas: é a mesma, contada duas vezes. Quem decide onde a
-- receita mora é a fn_receita_vem_dos_modulos — a receita só é a soma dos
-- módulos quando TODOS têm valor. Como os outros módulos do OEM entram com
-- zero, a receita deste produto continua sendo a digitada em cliente_produtos
-- (R$ 850,68, conferido: o gatilho fn_sync_produto_valores não a reescreveu),
-- e a venda do IFood existe só como movimento. O 48,00 da linha é cadastro,
-- não MRR.
--
-- A fn_sync_produto_valores já foi corrigida para essa régua (v_todos_pagos) e
-- a fn_cancelar_modulo_aplicar também a usa. A fn_mrr_do_modulo ficou para
-- trás, somando a linha sempre. Passa a usar a mesma fonte.
--
-- Blast radius medido antes de aplicar: 7 linhas de módulo ativas com valor,
-- 2 em produto misto, 1 com movimento junto (esta, R$ 48,00). Nenhum
-- cancelamento chegou a ser aplicado com o valor inflado — os únicos downsells
-- de módulo em produção são de R$ 1,00, de teste.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_mrr_do_modulo(p_modulo_linha_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row       public.cliente_produto_modulos;
  v_da_linha  boolean;
  v_cadastro  numeric;
  v_linha     numeric;
  v_movs      numeric;
BEGIN
  SELECT * INTO v_row FROM public.cliente_produto_modulos WHERE id = p_modulo_linha_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Módulo não encontrado.' USING ERRCODE = 'P0002';
  END IF;

  IF NOT coalesce(
       v_row.tenant_id = public.current_tenant_id() OR coalesce(public.is_super_admin(), false),
       false) THEN
    RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = '42501';
  END IF;

  v_cadastro := coalesce(v_row.vlr_mensal, 0) * greatest(coalesce(v_row.quantidade, 1), 1);

  -- A mesma pergunta que a fn_sync_produto_valores faz antes de reescrever a
  -- receita do produto: ela vem dos módulos? Se não vem, o valor da linha é
  -- cadastro e nunca entrou no MRR — somá-lo aqui conta a venda duas vezes,
  -- porque ela já está no movimento.
  v_da_linha := coalesce(public.fn_receita_vem_dos_modulos(v_row.cliente_produto_id), false);
  v_linha    := CASE WHEN v_da_linha THEN v_cadastro ELSE 0 END;

  -- Mesma régua do saldo (fn_mrr_cliente_em): só movimento recorrente vigente,
  -- não estornado. Soma com sinal, então um downsell anterior já entra como
  -- desconto e o número não conta duas vezes a mesma baixa.
  SELECT coalesce(SUM(mv.valor_delta), 0) INTO v_movs
    FROM public.movimentos_mrr mv
   WHERE mv.cliente_produto_modulo_id = p_modulo_linha_id
     AND mv.tipo IN ('upsell','cross_sell','downsell','reajuste')
     AND mv.status = 'ativo'
     AND mv.estornado_por IS NULL
     AND mv.estorno_de IS NULL
     AND mv.encerrado_em IS NULL;

  RETURN jsonb_build_object(
    'quantidade',      greatest(coalesce(v_row.quantidade, 1), 1),
    'na_linha',        v_linha,
    'movimentos',      v_movs,
    'total',           v_linha + v_movs,
    -- Para a tela poder explicar por que o valor da linha ficou de fora, em vez
    -- de mostrar um zero sem motivo.
    'linha_conta',     v_da_linha,
    'valor_cadastro',  v_cadastro
  );
END;
$$;

COMMENT ON FUNCTION public.fn_mrr_do_modulo(uuid) IS
  'Quanto o modulo soma no MRR hoje. O valor da linha so entra quando a receita do produto vem dos modulos (fn_receita_vem_dos_modulos); caso contrario ele e cadastro e a receita esta no movimento. Movimentos somam com sinal, so os vigentes e nao estornados.';

ALTER FUNCTION public.fn_mrr_do_modulo(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.fn_mrr_do_modulo(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_mrr_do_modulo(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_mrr_do_modulo(uuid) TO authenticated, service_role;
