-- ============================================================================
-- O custo consolidado do produto passa a seguir os módulos quando eles vêm do
-- OEM, mesmo com receita zerada.
--
-- A fn_sync_produto_valores tinha uma trava só: "se a soma mensal dos módulos
-- for 0, preserva o que foi digitado e não escreve nada". Ela existe para
-- proteger a RECEITA digitada no produto quando os módulos são informativos —
-- e isso continua certo. O problema é que ela travava o CUSTO junto.
--
-- Módulo espelhado do OEM entra sempre com vlr_mensal = 0 (a receita é nossa,
-- fica no produto). Ou seja: para praticamente todo cliente do OEM a trava
-- disparava SEMPRE, e cliente_produtos.vlr_custo nunca era atualizado desde que
-- foi digitado ou importado. Medido em 20/08/2026, depois de corrigir o custo
-- por módulo: 692 de 748 produtos ativos ligados ao OEM estavam defasados —
-- R$ 92.190,17 gravados contra R$ 70.731,46 reais, R$ 21.458,71/mês de custo
-- que não existe. É esse número que a Margem de Contribuição lê.
--
-- A regra nova é estreita de propósito: o custo só passa a seguir os módulos
-- quando há pelo menos um módulo ATIVO vindo do OEM. Produto com módulo
-- informativo digitado à mão continua exatamente como estava.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_sync_produto_valores() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cliente_produto_id uuid;
  v_soma_mensal numeric;
  v_soma_custo numeric;
  v_count_ativos integer;
  v_tem_oem boolean;
BEGIN
  IF current_setting('doctorsaas.skip_valor_sync', true) = 'true' THEN
    RETURN NULL;
  END IF;

  IF TG_OP = 'DELETE' THEN
    v_cliente_produto_id := OLD.cliente_produto_id;
  ELSE
    v_cliente_produto_id := NEW.cliente_produto_id;
  END IF;

  SELECT
    COALESCE(SUM(COALESCE(vlr_mensal, 0) * quantidade), 0),
    -- O total do parceiro manda; sem ele, multiplica.
    COALESCE(SUM(COALESCE(vlr_custo_total, COALESCE(vlr_custo, 0) * quantidade)), 0),
    COUNT(*),
    COALESCE(bool_or(origem = 'oem'), false)
  INTO v_soma_mensal, v_soma_custo, v_count_ativos, v_tem_oem
  FROM cliente_produto_modulos
  WHERE cliente_produto_id = v_cliente_produto_id
    AND ativo = true;

  -- Sem módulo ativo não há de onde tirar número: preserva o que está gravado.
  IF v_count_ativos = 0 THEN
    UPDATE cliente_produtos SET updated_at = now() WHERE id = v_cliente_produto_id;
    RETURN NULL;
  END IF;

  -- Módulos sem receita. A receita digitada no produto fica de pé; o custo, se
  -- vier do OEM, é do parceiro e vale mais que o que está gravado.
  IF v_soma_mensal = 0 THEN
    IF v_tem_oem THEN
      UPDATE cliente_produtos
         SET vlr_custo = v_soma_custo,
             updated_at = now()
       WHERE id = v_cliente_produto_id;
    ELSE
      UPDATE cliente_produtos SET updated_at = now() WHERE id = v_cliente_produto_id;
    END IF;
    RETURN NULL;
  END IF;

  UPDATE cliente_produtos
  SET
    vlr_mensal = v_soma_mensal,
    vlr_custo = v_soma_custo,
    updated_at = now()
  WHERE id = v_cliente_produto_id;

  RETURN NULL;
END;
$$;

ALTER FUNCTION public.fn_sync_produto_valores() OWNER TO postgres;

COMMENT ON FUNCTION public.fn_sync_produto_valores() IS
  'Sincroniza vlr_mensal/vlr_custo de cliente_produtos a partir dos modulos ativos. Custo usa vlr_custo_total quando o parceiro manda um. Sem modulo ativo, preserva tudo. Com soma mensal = 0, preserva a receita digitada e so atualiza o custo se houver modulo do OEM. Skip via doctorsaas.skip_valor_sync=true.';

-- ============================================================================
-- Backfill do custo consolidado.
--
-- SEM skip_valor_sync de propósito: é a trg_sync_cliente_mensalidade que leva o
-- número para clientes.custo_operacao, e ela obedece ao skip. Com o skip ligado
-- o produto ficaria certo e o cliente continuaria errado.
--
-- O gatilho do Omie não entra: valor_produto_enfileirar_omie só escuta
-- vlr_mensal e ativo, e nenhum dos dois é tocado aqui.
-- ============================================================================
DO $backfill$
DECLARE
  v_produtos int;
BEGIN
  WITH alvo AS (
    SELECT c.cliente_produto_id AS id,
           SUM(COALESCE(c.vlr_custo_total, COALESCE(c.vlr_custo, 0) * c.quantidade)) AS custo
      FROM public.cliente_produto_modulos c
     WHERE c.ativo = true
     GROUP BY c.cliente_produto_id
    HAVING bool_or(c.origem = 'oem')
  )
  UPDATE public.cliente_produtos cp
     SET vlr_custo = alvo.custo,
         updated_at = now()
    FROM alvo
   WHERE cp.id = alvo.id
     AND cp.vlr_custo IS DISTINCT FROM alvo.custo;
  GET DIAGNOSTICS v_produtos = ROW_COUNT;

  RAISE NOTICE 'backfill custo do produto: % produtos', v_produtos;
END
$backfill$;
