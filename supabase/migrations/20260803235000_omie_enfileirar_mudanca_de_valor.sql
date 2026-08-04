-- DEM-0237 — parte 1: mudanca de valor no DS passa a enfileirar sync com o Omie.
--
-- BURACO QUE ISTO FECHA (e so este):
--   Editar o valor de um produto do cliente (cliente_produtos.vlr_mensal) ou mexer num modulo
--   (cliente_produto_modulos: valor, quantidade, ativo, incluir, excluir) muda o MRR do DS -- e
--   nao existia gatilho nenhum enfileirando isso para o Omie. Nenhuma linha em omie_sync_fila,
--   nenhum log, nenhum erro. O Omie ficava no valor antigo para sempre.
--   No toggle de modulo a tela ainda SUGERE um movimento de MRR num dialogo; se o usuario fecha
--   o dialogo, o valor ja mudou no banco e a sugestao era a unica ponte para o Omie.
--
-- O QUE ISTO **NAO** COBRE: upsell/downsell/cross/reajuste, que ja tem gatilho proprio
--   (trg_movimento_mrr_enfileirar_omie). Se um upsell nao chegou no Omie, o problema esta
--   DEPOIS da fila, nao aqui.
--
-- DECISOES DE DESENHO
--   * origem='valor', campos_alterados = NULL (nao passa p_campos). Isso e proposital:
--       - omie-sync-processar v10: sem 'vigencia_final' em campos_alterados, p_incluir_vigencia
--         = false -> dVigFinal NAO e escrita no Omie. Evita repetir o incidente de 13/07
--         (vigencia final no passado -> contrato para de faturar).
--       - omie-sync-processar v11: com campos_alterados vazio o CADASTRO do cliente nao viaja;
--         so o contrato e alterado. Que e exatamente o que muda aqui.
--   * So contrato ATIVO, e so o contrato que realmente contem este cliente_produto
--     (via contrato_itens). Contrato cancelado nao entra: montar_payload_contrato_omie
--     traduziria para operacao 'cancelar' e mandaria um cancelamento que ninguem pediu.
--   * GUARDA DE ZERO: escrever modulo com vlr_mensal=0 dispara fn_sync_produto_valores, que
--     zera os totais. Sem esta guarda, esse acidente viraria uma escrita de R$ 0,00 no contrato
--     do cliente no Omie. Se o MRR resultante nao for > 0, nao enfileira.
--   * Ordem de gatilho e irrelevante: o payload e montado no processamento (~2min depois),
--     lendo o estado ja consolidado -- nao no momento do enqueue.
--   * enfileirar_sync_omie ja e idempotente por contrato (coalesce da linha pendente), entao
--     N edicoes seguidas viram 1 envio.

BEGIN;

CREATE OR REPLACE FUNCTION public.trg_valor_enfileirar_omie()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_cliente_produto_id uuid;
  v_cliente_id uuid;
  v_tenant_id  uuid;
  v_mrr        numeric;
  v_contrato_id uuid;
BEGIN
  -- 1) Qual cliente_produto foi afetado.
  IF TG_TABLE_NAME = 'cliente_produtos' THEN
    v_cliente_produto_id := NEW.id;                       -- so UPDATE neste gatilho
  ELSIF TG_OP = 'DELETE' THEN
    v_cliente_produto_id := OLD.cliente_produto_id;
  ELSE
    v_cliente_produto_id := NEW.cliente_produto_id;
  END IF;

  SELECT cp.cliente_id, cp.tenant_id
    INTO v_cliente_id, v_tenant_id
  FROM public.cliente_produtos cp
  WHERE cp.id = v_cliente_produto_id;

  IF v_cliente_id IS NULL THEN
    RETURN NULL;  -- produto ja removido (cascade); nada a sincronizar
  END IF;

  -- 2) GUARDA DE ZERO. Ver cabecalho. Espelha calcular_mrr_cliente, sem assert_tenant_scope
  --    (aqui o caller pode ser cron/service_role agindo sobre outro tenant).
  SELECT COALESCE((
           SELECT SUM(cp.vlr_mensal) FROM public.cliente_produtos cp
            WHERE cp.cliente_id = v_cliente_id AND cp.ativo = true
         ), 0)
       + COALESCE((
           SELECT SUM(mv.valor_delta) FROM public.movimentos_mrr mv
            WHERE mv.cliente_id = v_cliente_id AND mv.tenant_id = v_tenant_id
              AND mv.status = 'ativo'
              AND mv.estornado_por IS NULL AND mv.estorno_de IS NULL
              AND mv.tipo NOT IN ('venda_avulsa','churn','reactivation')
         ), 0)
    INTO v_mrr;

  IF v_mrr IS NULL OR v_mrr <= 0 THEN
    RETURN NULL;
  END IF;

  -- 3) Enfileira so os contratos ATIVOS que contem este produto.
  FOR v_contrato_id IN
    SELECT DISTINCT ci.contrato_id
      FROM public.contrato_itens ci
      JOIN public.contratos c ON c.id = ci.contrato_id
     WHERE ci.cliente_produto_id = v_cliente_produto_id
       AND c.tenant_id = v_tenant_id
       AND c.status = 'ativo'
  LOOP
    PERFORM public.enfileirar_sync_omie(v_contrato_id, 'valor');
  END LOOP;

  RETURN NULL;  -- AFTER trigger: retorno ignorado
END;
$function$;

REVOKE ALL ON FUNCTION public.trg_valor_enfileirar_omie() FROM PUBLIC;

-- Valor do produto e ativacao/desativacao do produto.
DROP TRIGGER IF EXISTS valor_produto_enfileirar_omie ON public.cliente_produtos;
CREATE TRIGGER valor_produto_enfileirar_omie
AFTER UPDATE OF vlr_mensal, ativo ON public.cliente_produtos
FOR EACH ROW
WHEN (NEW.vlr_mensal IS DISTINCT FROM OLD.vlr_mensal
      OR NEW.ativo IS DISTINCT FROM OLD.ativo)
EXECUTE FUNCTION public.trg_valor_enfileirar_omie();

-- Modulos: incluir, excluir, mudar valor/quantidade, ativar/inativar.
DROP TRIGGER IF EXISTS valor_modulo_enfileirar_omie ON public.cliente_produto_modulos;
CREATE TRIGGER valor_modulo_enfileirar_omie
AFTER INSERT OR DELETE OR UPDATE OF vlr_mensal, quantidade, ativo
ON public.cliente_produto_modulos
FOR EACH ROW
EXECUTE FUNCTION public.trg_valor_enfileirar_omie();

COMMIT;
