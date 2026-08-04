-- Reativação de contrato volta a chegar no Omie: a origem 'reativacao' era apagada dentro da
-- própria transação que a criou.
--
-- MEDIDO (04/08/2026 — ETHOS COMERCIO DE LIVROS, CT-2026-1503, tenant Digi Office)
--   omie_sync_fila 60358df2-fa3d-4a2b-b490-d6ed7a82d999:
--     enfileirado_em   = 11:40:30.939305
--     origem           = 'valor'
--     campos_alterados = {vigencia_final}
--     morta 11:42 em  bloqueio:depara_aponta_cancelado
--   contrato_eventos acao='reativacao' do MESMO contrato: created_at = 11:40:30.939305.
--   Timestamp idêntico = mesma transação. E 'vigencia_final' em campos_alterados é a assinatura
--   EXCLUSIVA do ramo `p_origem IN (...,'reativacao')` daqui de baixo — nenhuma outra origem
--   daquela transação escreve esse campo. A linha nasceu 'reativacao' e virou 'valor' antes de
--   alguém ler. Sobreviveu a prova, não a intenção: campos_alterados faz UNIÃO, origem não.
--
-- A SEQUÊNCIA, dentro de reativar_contrato
--   1. UPDATE contratos SET status='ativo'
--        -> trg_contrato_status_enfileirar_omie -> enfileirar_sync_omie(..., 'reativacao')
--   2. set_config('doctorsaas.skip_valor_sync','true')   <- a trava que já existia PARA ISTO
--   3. UPDATE cliente_produtos SET ativo=true
--        -> valor_produto_enfileirar_omie -> trg_valor_enfileirar_omie -> ... 'valor'
--        O gatilho nasceu em 03/08 (20260803235000) e NÃO lê a trava. Só cancelar_contrato,
--        editar_cancelamento, fn_sync_produto_valores e fn_sync_cliente_mensalidade a leem.
--   4. enfileirar_sync_omie coalesce por contrato:  origem = COALESCE(p_origem, origem) -> 'valor'
--
--   Com origem='valor' o omie-sync-processar não pede situação (ORIGENS_COM_SITUACAO = churn,
--   reativacao) e não manda permitir_reativacao. O payload sai sem situacao='10'; o
--   ds-omie-contrato-alterar (v14) vê o contrato em situação 99 no Omie e barra com
--   depara_aponta_cancelado. Nada é escrito, e a linha morre em 'invalido' (terminal).
--
-- POR QUE O CANCELAMENTO NÃO QUEBROU JUNTO
--   Ordem inversa: cancelar_contrato desativa os produtos ANTES de mudar o status, então 'valor'
--   entra primeiro e 'churn' sobrescreve depois. É o mesmo defeito — só que do lado que ganhou o
--   sorteio. Confirmado no banco: a linha de churn do ETHOS (31/07 19:19) processou 'ok'.
--
-- DOIS CONSERTOS, DELIBERADAMENTE REDUNDANTES
--   (1) trg_valor_enfileirar_omie passa a respeitar doctorsaas.skip_valor_sync. Reativar e cancelar
--       não são edição de valor: o produto voltar a ativo é CONSEQUÊNCIA da mudança de status. A
--       linha de 'reativacao' já leva o MRR novo sozinha — montar_payload_contrato_omie chama
--       calcular_mrr_cliente no momento do PROCESSAMENTO, não no enqueue. Nada de valor se perde.
--   (2) 'churn' e 'reativacao' viram origem PEGAJOSA: não são mais sobrescritas por 'valor',
--       'cadastro', 'movimento_*'. Só o conserto (1) não bastaria — editar o valor de um produto
--       dentro da janela de coalescência (a linha fica 'pendente' até o cron pegar, ~2min) cairia
--       exatamente no mesmo buraco, aí sem trava nenhuma para segurar.
--   Entre churn e reativacao a regra continua last-wins: é o estado FINAL do DS que vale, e
--   montar_payload_contrato_omie lê contratos.status ao vivo para decidir entre situação 99 e 10.
--
-- NÃO MEXE em campos_alterados nem em nenhuma edge function. O caminho da reativação já existe
-- inteiro e está no ar: ds-omie-contrato-alterar v14 reativa 99->10 quando recebe situacao='10' +
-- permitir_reativacao=true, e o omie-sync-processar v11 manda os dois quando a origem é
-- 'reativacao' e a reconciliação não é ambígua. O que faltava era a origem chegar viva.

BEGIN;

-- CREATE OR REPLACE nestas duas funções pega lock exclusivo em objeto chamado por gatilho de
-- tabela quente (clientes, contratos, cliente_produtos, movimentos_mrr). Se alguma transação
-- estiver executando a função nesse instante, o DDL entra na fila de lock -- e TODO mundo que
-- chegar depois enfileira atrás dele, o que derruba a escrita do sistema inteiro enquanto durar.
-- Com lock_timeout ele desiste em 5s e a transação inteira faz rollback: melhor falhar e tentar
-- de novo do que segurar o banco. SET LOCAL = vale só nesta transação, não vaza para a sessão.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- ===========================================================================================
-- (1) O gatilho de valor respeita a trava de sincronização.
--     Corpo idêntico ao de 20260803235000, com o early-return novo. current_setting(..., true)
--     devolve NULL quando a GUC nunca foi setada na sessão; o reset de reativar_contrato grava
--     string vazia. Nos dois casos o COALESCE resolve para '' e o gatilho segue normalmente.
-- ===========================================================================================
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
  -- 0) 04/08/2026: mudança de status já enfileirou ('churn'/'reativacao') e essa origem é que
  --    carrega a situação para o Omie. Enfileirar 'valor' aqui sobrescrevia aquela origem e
  --    matava a reativação. Ver cabeçalho da migration.
  IF COALESCE(current_setting('doctorsaas.skip_valor_sync', true), '') = 'true' THEN
    RETURN NULL;
  END IF;

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

-- ===========================================================================================
-- (2) Origem de SITUAÇÃO não é mais sobrescrita na coalescência.
--     Corpo idêntico ao que está em produção (md5 fb3a0c717591808835e206c8e29c5fe0, conferido
--     em 04/08/2026), com uma única mudança: a atribuição de `origem` no UPDATE.
-- ===========================================================================================
CREATE OR REPLACE FUNCTION public.enfileirar_sync_omie(p_contrato_id uuid, p_origem text DEFAULT NULL::text, p_campos text[] DEFAULT NULL::text[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant_id uuid;
  v_unidade_id bigint;
  v_ativa boolean;
  v_pausada boolean;
  v_escopo bigint[];
  v_id_pendente uuid;
  v_campos text[] := p_campos;
  v_sincroniza boolean;
  v_conta_id uuid;
BEGIN
  SELECT c.tenant_id, cl.unidade_base_id, COALESCE(mc.sincroniza_omie, true)
    INTO v_tenant_id, v_unidade_id, v_sincroniza
  FROM contratos c
  LEFT JOIN clientes cl ON cl.id = c.cliente_id
  LEFT JOIN modelos_contrato mc ON mc.id = c.modelo_contrato_id
  WHERE c.id = p_contrato_id;
  IF v_tenant_id IS NULL THEN RETURN; END IF;

  -- 17/07/2026 (portao 1): modelo marcado para nao sincronizar nao entra na fila. Sem isso,
  -- editar o cadastro desses clientes geraria linha -> sem de/para -> 'ignorado' terminal, que
  -- so sai no Reprocessar -- que reenfileiraria e daria 'ignorado' de novo. Trabalho manual
  -- eterno para contrato que nunca deveria ir ao Omie.
  IF v_sincroniza IS NOT TRUE THEN RETURN; END IF;

  SELECT id, sync_automatica_ativa, integracao_pausada, unidades_base_ids
    INTO v_conta_id, v_ativa, v_pausada, v_escopo
  FROM omie_integration
  WHERE tenant_id = v_tenant_id
    AND (unidades_base_ids IS NULL OR v_unidade_id = ANY(unidades_base_ids))
  LIMIT 1;
  IF NOT FOUND THEN RETURN; END IF;
  IF v_ativa IS NOT TRUE OR v_pausada IS TRUE THEN RETURN; END IF;

  -- 16/07/2026: TRADUZ ORIGEM -> CAMPO 'vigencia_final'. Ver v8 do omie-sync-processar.
  IF p_origem IN ('reajuste', 'movimento_reajuste', 'reativacao') THEN
    v_campos := COALESCE(v_campos, '{}'::text[]) || ARRAY['vigencia_final'];
  END IF;

  SELECT id INTO v_id_pendente
  FROM omie_sync_fila
  WHERE tenant_id = v_tenant_id AND contrato_id = p_contrato_id
    AND status IN ('pendente','processando')
  LIMIT 1;

  IF v_id_pendente IS NOT NULL THEN
    UPDATE omie_sync_fila
    SET enfileirado_em = now(), proxima_tentativa_em = now(),
        -- 04/08/2026: origem de SITUACAO e pegajosa. Ver cabecalho da migration
        -- 20260804140000. Era `COALESCE(p_origem, origem)`, e o ultimo a enfileirar vencia --
        -- o que fazia o 'valor' disparado por reativar_contrato apagar a 'reativacao' que a
        -- propria transacao tinha acabado de criar, 3 linhas antes.
        origem = CASE
                   WHEN p_origem IN ('churn','reativacao') THEN p_origem
                   WHEN omie_sync_fila.origem IN ('churn','reativacao') THEN omie_sync_fila.origem
                   ELSE COALESCE(p_origem, omie_sync_fila.origem)
                 END,
        status = 'pendente', ultimo_erro = NULL,
        conta_integration_id = v_conta_id,
        campos_alterados = CASE
          WHEN v_campos IS NULL THEN campos_alterados
          ELSE (SELECT array_agg(DISTINCT x)
                  FROM unnest(COALESCE(campos_alterados, '{}'::text[]) || v_campos) x)
        END
    WHERE id = v_id_pendente;
  ELSE
    INSERT INTO omie_sync_fila (tenant_id, contrato_id, origem, campos_alterados, conta_integration_id)
    VALUES (v_tenant_id, p_contrato_id, p_origem, v_campos, v_conta_id);
  END IF;
END;
$function$;

-- Sem REVOKE/GRANT aqui de proposito: CREATE OR REPLACE preserva o ACL, e o ACL atual desta
-- funcao e {postgres, service_role} -- sem 'authenticated'. Reescrever os grants aqui alargaria
-- a permissao sem ninguem ter pedido.

COMMIT;
