-- ============================================================================
-- CORREÇÃO URGENTE de um defeito introduzido em 20260902101000 e 20260902102000.
--
-- As duas gravam `vlr_ativacao` no movimento de MRR com `nullif(x, 0)` — e a
-- coluna é `numeric DEFAULT 0 NOT NULL`. Ativação ZERO, que é o caso comum
-- (todo up-sell de módulo sem taxa de setup), virava NULL e o INSERT batia na
-- constraint.
--
-- O estrago: `fn_oem_fila_aplicar` levanta exceção ao APLICAR um pedido
-- aprovado sem setup. Como a aprovação e a aplicação estão na mesma transação,
-- a aprovação inteira falha — o módulo não entra na ficha, o MRR não é lançado
-- e o admin vê um erro. Vale para QUALQUER pedido, inclusive os que a tela do
-- cliente enfileira, não só os da calculadora.
--
-- Pego pelo teste de comportamento do passo 3, não em produção. `nullif` estava
-- ali para não escrever zero à toa; a coluna já resolve isso com o DEFAULT, e a
-- diferença entre 0 e NULL não existe para quem lê — só para a constraint.
--
-- Nada mais muda nas duas funções: é `nullif` → `coalesce`, nos dois lugares.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_oem_fila_aplicar(p_id uuid) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_l        public.oem_sync_fila;
  v_mod      public.cliente_produto_modulos;
  v_cliente  uuid;
  v_nome     text;
  v_antes    numeric;
  v_delta    numeric;
  v_mensal   numeric;
  v_ativ     numeric := 0;
  v_origem   text;
  v_dos_mod  boolean;
  v_novo     uuid;
  v_mov      uuid;
  v_res      jsonb;
BEGIN
  SELECT * INTO v_l FROM public.oem_sync_fila WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Linha da fila não encontrada.' USING ERRCODE = 'P0002';
  END IF;

  -- Quem pediu isto foi gente, na ficha do cliente; o cron e a edge function só
  -- entregam o recado. Sem este carimbo, tudo o que a linha escrever daqui para
  -- baixo — histórico de módulos, cancelado_por — nasce órfão, porque
  -- service_role não tem auth.uid(). Vale só nesta transação.
  IF v_l.usuario_id IS NOT NULL THEN
    PERFORM set_config('doctorsaas.acting_user', v_l.usuario_id::text, true);
  END IF;

  -- Pedido sem gente por trás não é necessariamente da máquina: pode ser uma
  -- venda que chegou por integração. A fonte diz qual das duas.
  IF nullif(v_l.payload->>'fonte', '') IS NOT NULL THEN
    PERFORM set_config('doctorsaas.acting_source', v_l.payload->>'fonte', true);
  END IF;

  SELECT cp.cliente_id INTO v_cliente
    FROM public.cliente_produtos cp WHERE cp.id = v_l.cliente_produto_id;
  SELECT pm.nome INTO v_nome
    FROM public.produto_modulos pm WHERE pm.id = v_l.modulo_catalogo_id;

  v_dos_mod := public.fn_receita_vem_dos_modulos(v_l.cliente_produto_id);
  v_mensal  := coalesce(nullif(v_l.payload->>'vlr_mensal', '')::numeric, 0);
  v_origem  := coalesce(nullif(v_l.payload->>'origem', ''), 'oem');

  IF v_l.acao = 'cancelar' THEN
    IF v_l.modulo_linha_id IS NULL THEN
      RETURN jsonb_build_object('aplicado', false, 'motivo', 'linha sem módulo');
    END IF;
    IF EXISTS (SELECT 1 FROM public.cliente_produto_modulos
                WHERE id = v_l.modulo_linha_id AND ativo = false) THEN
      RETURN jsonb_build_object('aplicado', false, 'motivo', 'módulo já estava cancelado');
    END IF;
    v_res := public.fn_cancelar_modulo_aplicar(
      v_l.modulo_linha_id,
      nullif(v_l.payload->>'quantidade_cancelar', '')::numeric,
      v_l.payload->>'motivo',
      nullif(v_l.payload->>'motivo_id', '')::bigint,
      nullif(v_l.payload->>'data', '')::date,
      nullif(v_l.payload->>'valor_downsell', '')::numeric
    );
    RETURN jsonb_build_object('aplicado', true, 'ficha', v_res);
  END IF;

  IF v_l.acao = 'quantidade' THEN
    SELECT * INTO v_mod FROM public.cliente_produto_modulos WHERE id = v_l.modulo_linha_id;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('aplicado', false, 'motivo', 'linha da ficha não existe mais');
    END IF;
    v_antes := greatest(coalesce(v_mod.quantidade, 1), 1);
    v_delta := coalesce(v_l.quantidade, v_antes) - v_antes;
    v_ativ  := coalesce(nullif(v_l.payload->>'vlr_ativacao_somar', '')::numeric, 0);

    UPDATE public.cliente_produto_modulos
       SET quantidade        = v_l.quantidade,
           quantidade_manual = v_l.quantidade,
           -- 22/08/2026: ativação digitada ao SOMAR quantidade é cobrança nova,
           -- então soma na linha em vez de ser descartada. Só o botão de
           -- adicionar manda `vlr_ativacao_somar`; a edição pelo lápis grava o
           -- valor direto na linha e não pode somar de novo.
           vlr_ativacao      = coalesce(vlr_ativacao, 0) + v_ativ,
           updated_at        = now()
     WHERE id = v_l.modulo_linha_id;

    v_res := jsonb_build_object('quantidade_antes', v_antes, 'quantidade_depois', v_l.quantidade);
    v_novo := v_l.modulo_linha_id;

  ELSIF v_l.acao = 'ativar' THEN
    IF v_l.modulo_catalogo_id IS NULL THEN
      RETURN jsonb_build_object('aplicado', false, 'motivo', 'linha sem módulo do catálogo');
    END IF;
    v_ativ := coalesce(nullif(v_l.payload->>'vlr_ativacao', '')::numeric, 0);

    SELECT id INTO v_novo FROM public.cliente_produto_modulos
     WHERE cliente_produto_id = v_l.cliente_produto_id
       AND modulo_id = v_l.modulo_catalogo_id
       AND ativo = true
     LIMIT 1;

    IF v_novo IS NULL THEN
      INSERT INTO public.cliente_produto_modulos (
        tenant_id, cliente_produto_id, modulo_id, quantidade,
        vlr_mensal, vlr_custo, vlr_ativacao, data_ativacao,
        data_venda, funcionario_id, origem_venda_id,
        ativo, origem, oem_modulo_codigo
      ) VALUES (
        v_l.tenant_id, v_l.cliente_produto_id, v_l.modulo_catalogo_id,
        greatest(coalesce(v_l.quantidade, 1), 1),
        v_mensal,
        coalesce(nullif(v_l.payload->>'vlr_custo', '')::numeric, 0),
        v_ativ,
        nullif(v_l.payload->>'data_ativacao', '')::date,
        nullif(v_l.payload->>'data_venda', '')::date,
        nullif(v_l.payload->>'funcionario_id', '')::bigint,
        nullif(v_l.payload->>'origem_venda_id', '')::bigint,
        true, v_origem, v_l.oem_modulo_codigo
      )
      RETURNING id INTO v_novo;
    END IF;

    v_delta := greatest(coalesce(v_l.quantidade, 1), 1);
    v_res := jsonb_build_object('modulo_criado', v_novo, 'quantidade', v_l.quantidade);

    UPDATE public.oem_sync_fila SET modulo_linha_id = v_novo WHERE id = p_id;
  ELSE
    RETURN jsonb_build_object('aplicado', false, 'motivo', 'ação sem efeito na ficha');
  END IF;

  IF NOT v_dos_mod AND v_mensal > 0 AND coalesce(v_delta, 0) > 0 AND v_cliente IS NOT NULL THEN
    INSERT INTO public.movimentos_mrr (
      tenant_id, cliente_id, tipo, data_movimento,
      valor_delta, custo_delta, vlr_ativacao, descricao,
      cliente_produto_modulo_id, funcionario_id, origem_venda, status
    ) VALUES (
      v_l.tenant_id, v_cliente, 'upsell',
      -- A data é a da VENDA, não a da aprovação: um pedido aprovado três dias
      -- depois continua pertencendo ao mês em que foi vendido.
      coalesce(nullif(v_l.payload->>'data_venda', '')::date, current_date),
      v_mensal * v_delta,
      coalesce(nullif(v_l.payload->>'vlr_custo', '')::numeric, 0) * v_delta,
      coalesce(v_ativ, 0),
      CASE WHEN v_delta > 1
           THEN format('Adição de %s %s', v_delta::text, coalesce(v_nome, 'módulo'))
           ELSE format('Adição de %s', coalesce(v_nome, 'módulo')) END,
      v_novo,
      nullif(v_l.payload->>'funcionario_id', '')::bigint,
      nullif(v_l.payload->>'origem_venda', ''),
      'ativo'
    )
    RETURNING id INTO v_mov;
  END IF;

  RETURN jsonb_build_object('aplicado', true, 'ficha', v_res, 'movimento_mrr', v_mov);
END;
$$;

ALTER FUNCTION public.fn_oem_fila_aplicar(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.fn_oem_fila_aplicar(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_oem_fila_aplicar(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.fn_intake_proposta(p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid; v_ext text; v_demand uuid; v_unidade bigint; v_assunto text;
  v_modo text; v_blocos int := 0; v_erros jsonb := '[]'::jsonb; v_avisos jsonb := '[]'::jsonb;
  v_cli jsonb; v_com jsonb; v_alt jsonb; v_avu jsonb; v_cnpj text;
  v_cliente uuid; v_reusado boolean := false;
  v_cidade_id bigint; v_estado_id bigint;
  v_prod jsonb; v_mod jsonb; v_cp uuid; v_contrato uuid;
  v_soma_m numeric := 0; v_soma_a numeric := 0;
  v_tot_m numeric; v_tot_a numeric;
  v_journey uuid; v_ticket_code text; v_primeiro_produto bigint;
  v_data_inicio timestamptz; v_pm numeric; v_pa numeric;
  v_delta numeric; v_tipo text; v_mov uuid; v_origem_txt text;
  v_prod_alvo bigint; v_cpm uuid; v_qtd_atual int; v_qd int;
  -- modo B pela fila do OEM
  v_tem_lic boolean := false; v_n_mod int := 0; v_ativ_tot numeric := 0;
  v_tipo_prop text; v_qtd_pos int := 0; v_soma_mod numeric := 0;
  v_todos_com_valor boolean := false;
  v_mvm numeric; v_mva numeric; v_nome_mod text;
  v_data_venda date; v_motivo_txt text; v_motivo_id bigint;
  v_pl jsonb; v_fila uuid; v_filas jsonb := '[]'::jsonb;
BEGIN
  PERFORM set_config('doctorsaas.intake_hold_omie', 'true', true);
  -- Nada do que esta função escreve tem gente por trás: `auth.uid()` é NULL sob
  -- service_role. A fonte é o que sobra para o histórico não ter que escolher
  -- entre mentir ("Sincronização OEM") e ficar em branco.
  PERFORM set_config('doctorsaas.acting_source', 'calculadora', true);

  ---------------------------------------------------------------- raiz
  BEGIN
    v_tenant  := nullif(p_payload->>'tenant_id','')::uuid;
    v_demand  := nullif(p_payload->>'demand_type_id','')::uuid;
    v_unidade := nullif(p_payload->>'unidade_base_id','')::bigint;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION '%', jsonb_build_object('error','payload_mal_formatado','detail',SQLERRM)::text;
  END;
  v_ext     := nullif(btrim(coalesce(p_payload->>'external_ticket_id','')),'');
  v_assunto := nullif(btrim(coalesce(p_payload->>'assunto','')),'');
  v_cli     := coalesce(p_payload->'cliente','{}'::jsonb);
  v_com     := coalesce(p_payload->'comercial','{}'::jsonb);
  v_alt     := p_payload->'alteracao';
  v_avu     := p_payload->'avulso';

  IF v_tenant IS NULL OR NOT EXISTS (SELECT 1 FROM tenants WHERE id = v_tenant) THEN
    RAISE EXCEPTION '%', jsonb_build_object('error','tenant_not_found')::text;
  END IF;
  IF v_ext IS NULL THEN
    v_erros := v_erros || jsonb_build_object('campo','external_ticket_id','motivo','obrigatorio');
  END IF;

  ---------------------------------------------------------------- modo
  IF coalesce(jsonb_array_length(p_payload->'produtos'),0) > 0 THEN v_blocos := v_blocos+1; v_modo := 'venda_nova'; END IF;
  IF p_payload ? 'alteracao' THEN v_blocos := v_blocos+1; v_modo := 'alteracao'; END IF;
  IF p_payload ? 'avulso'    THEN v_blocos := v_blocos+1; v_modo := 'avulso';    END IF;
  IF v_blocos = 0 THEN v_modo := 'jornada'; END IF;
  IF v_blocos > 1 THEN
    RAISE EXCEPTION '%', jsonb_build_object('error','blocos_conflitantes',
      'detail','enviar no maximo um entre produtos, alteracao e avulso')::text;
  END IF;

  ---------------------------------------------------------- catalogos
  IF v_demand IS NULL OR NOT EXISTS (
       SELECT 1 FROM onboarding_demand_types WHERE id = v_demand AND tenant_id = v_tenant AND ativo) THEN
    v_erros := v_erros || jsonb_build_object('campo','demand_type_id','valor',p_payload->>'demand_type_id','motivo','nao_existe_no_tenant');
  END IF;
  IF v_unidade IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM unidades_base WHERE id = v_unidade AND tenant_id = v_tenant AND is_active) THEN
    v_erros := v_erros || jsonb_build_object('campo','unidade_base_id','valor',p_payload->>'unidade_base_id','motivo','nao_existe_no_tenant');
  END IF;

  v_cnpj := regexp_replace(coalesce(v_cli->>'cnpj',''), '\D', '', 'g');
  IF length(v_cnpj) < 11 THEN
    v_erros := v_erros || jsonb_build_object('campo','cliente.cnpj','valor',v_cli->>'cnpj','motivo','documento_invalido');
  END IF;

  ------------------------------------------------------ validacao modo A
  IF v_modo = 'venda_nova' THEN
    IF EXISTS (
         SELECT 1 FROM jsonb_array_elements(p_payload->'produtos') e
         GROUP BY e->>'produto_id' HAVING count(*) > 1)
    THEN
      v_erros := v_erros || jsonb_build_object('campo','produtos[].produto_id','motivo',
        'produto_repetido: o mesmo produto aparece mais de uma vez. Envie UM produto com o valor total e cada item da venda como um modulo dele');
    END IF;

    FOR v_prod IN SELECT jsonb_array_elements(p_payload->'produtos') LOOP
      IF NOT EXISTS (SELECT 1 FROM produtos WHERE id = (v_prod->>'produto_id')::bigint AND tenant_id = v_tenant) THEN
        v_erros := v_erros || jsonb_build_object('campo','produtos[].produto_id','valor',v_prod->>'produto_id','motivo','nao_existe_no_tenant');
        CONTINUE;
      END IF;
      v_pm := (v_prod->>'vlr_mensal')::numeric;
      v_pa := (v_prod->>'vlr_ativacao')::numeric;
      IF v_pm IS NULL OR v_pa IS NULL THEN
        v_erros := v_erros || jsonb_build_object('campo','produtos[].vlr_mensal/vlr_ativacao','valor',v_prod->>'produto_id','motivo','produto_sem_valor');
      END IF;
      v_soma_m := v_soma_m + coalesce(v_pm,0);
      v_soma_a := v_soma_a + coalesce(v_pa,0);
      IF coalesce(jsonb_array_length(v_prod->'modulos'),0) = 0 THEN
        v_avisos := v_avisos || jsonb_build_object('campo','produtos[].modulos','produto_id',v_prod->>'produto_id','aviso','sem_modulo: o contrato foi criado, mas nao registra o que foi vendido. Se havia itens, o de-para item->modulo esta vazio para eles');
      END IF;
      FOR v_mod IN SELECT jsonb_array_elements(coalesce(v_prod->'modulos','[]'::jsonb)) LOOP
        IF (v_mod ? 'vlr_mensal') OR (v_mod ? 'vlr_ativacao') THEN
          v_erros := v_erros || jsonb_build_object('campo','produtos[].modulos[].vlr_mensal','valor',v_mod->>'modulo_id',
            'motivo','modulo_com_valor: o preco vai no produto, nunca no modulo');
        END IF;
        IF NOT EXISTS (SELECT 1 FROM produto_modulos WHERE id = (v_mod->>'modulo_id')::uuid
                        AND tenant_id = v_tenant AND produto_id = (v_prod->>'produto_id')::bigint AND ativo) THEN
          v_erros := v_erros || jsonb_build_object('campo','produtos[].modulos[].modulo_id','valor',v_mod->>'modulo_id','motivo','nao_existe_neste_produto');
        END IF;
        IF coalesce((v_mod->>'quantidade')::int,0) < 1 THEN
          v_erros := v_erros || jsonb_build_object('campo','produtos[].modulos[].quantidade','valor',v_mod->>'quantidade','motivo','minimo_1');
        END IF;
      END LOOP;
    END LOOP;

    v_tot_m := (v_com->>'vlr_mensal')::numeric;
    v_tot_a := (v_com->>'vlr_ativacao')::numeric;
    IF v_tot_m IS NULL OR v_tot_a IS NULL THEN
      v_erros := v_erros || jsonb_build_object('campo','comercial.vlr_mensal/vlr_ativacao','motivo','obrigatorio_no_modo_venda_nova');
    ELSE
      IF round(v_soma_m,2) <> round(v_tot_m,2) THEN
        v_erros := v_erros || jsonb_build_object('campo','comercial.vlr_mensal','motivo','total_nao_confere',
          'soma_dos_produtos',round(v_soma_m,2),'total_declarado',round(v_tot_m,2));
      END IF;
      IF round(v_soma_a,2) <> round(v_tot_a,2) THEN
        v_erros := v_erros || jsonb_build_object('campo','comercial.vlr_ativacao','motivo','total_nao_confere',
          'soma_dos_produtos',round(v_soma_a,2),'total_declarado',round(v_tot_a,2));
      END IF;
    END IF;
  END IF;

  ------------------------------------------------------ validacao modo B
  IF v_modo = 'alteracao' THEN
    v_prod_alvo := nullif(v_alt->>'produto_id','')::bigint;
    v_delta     := nullif(v_alt->>'valor_delta','')::numeric;
    v_ativ_tot  := coalesce(nullif(v_alt->>'vlr_ativacao','')::numeric, 0);
    v_n_mod     := coalesce(jsonb_array_length(v_alt->'modulos'), 0);
    v_tipo_prop := lower(nullif(btrim(coalesce(p_payload->'proposta'->>'ticket_type','')),''));
    v_todos_com_valor := (v_n_mod > 0);

    IF v_prod_alvo IS NULL OR NOT EXISTS (SELECT 1 FROM produtos WHERE id=v_prod_alvo AND tenant_id=v_tenant) THEN
      v_erros := v_erros || jsonb_build_object('campo','alteracao.produto_id','valor',v_alt->>'produto_id','motivo','nao_existe_no_tenant');
    END IF;
    IF v_delta IS NULL OR v_delta = 0 THEN
      v_erros := v_erros || jsonb_build_object('campo','alteracao.valor_delta','valor',v_alt->>'valor_delta',
        'motivo','valor_zerado: se nao ha variacao de mensalidade, omita o bloco alteracao');
    END IF;
    IF nullif(btrim(coalesce(v_alt->>'descricao','')),'') IS NULL THEN
      v_erros := v_erros || jsonb_build_object('campo','alteracao.descricao','motivo','obrigatorio');
    END IF;
    IF v_ativ_tot < 0 THEN
      v_erros := v_erros || jsonb_build_object('campo','alteracao.vlr_ativacao','motivo','nao_pode_ser_negativo');
    END IF;

    -- O cabecalho da proposta e o bloco tem que contar a mesma historia.
    IF v_tipo_prop IN ('upsell','up-sell','up_sell') AND coalesce(v_delta,0) < 0 THEN
      v_erros := v_erros || jsonb_build_object('campo','alteracao.valor_delta','valor',v_alt->>'valor_delta',
        'motivo','sinal_contradiz_a_proposta: proposta.ticket_type diz up-sell e o valor_delta e negativo. Um dos dois esta errado e aplicar qualquer um cancela ou cobra o que nao foi vendido');
    END IF;
    IF v_tipo_prop IN ('downsell','down-sell','down_sell') AND coalesce(v_delta,0) > 0 THEN
      v_erros := v_erros || jsonb_build_object('campo','alteracao.valor_delta','valor',v_alt->>'valor_delta',
        'motivo','sinal_contradiz_a_proposta: proposta.ticket_type diz down-sell e o valor_delta e positivo');
    END IF;

    FOR v_mod IN SELECT jsonb_array_elements(coalesce(v_alt->'modulos','[]'::jsonb)) LOOP
      v_qd := coalesce((v_mod->>'quantidade_delta')::int, 0);

      IF v_qd = 0 THEN
        v_erros := v_erros || jsonb_build_object('campo','alteracao.modulos[].quantidade_delta','valor',v_mod->>'quantidade_delta','motivo','nao_pode_ser_zero');
      END IF;
      IF v_qd > 0 THEN v_qtd_pos := v_qtd_pos + 1; END IF;
      IF v_tipo_prop IN ('upsell','up-sell','up_sell') AND v_qd < 0 THEN
        v_erros := v_erros || jsonb_build_object('campo','alteracao.modulos[].quantidade_delta','valor',v_mod->>'quantidade_delta',
          'motivo','sinal_contradiz_a_proposta: proposta.ticket_type diz up-sell e a quantidade_delta e negativa (cancelaria o modulo)');
      END IF;
      IF NOT EXISTS (SELECT 1 FROM produto_modulos WHERE id=(v_mod->>'modulo_id')::uuid
                      AND tenant_id=v_tenant AND produto_id=v_prod_alvo AND ativo) THEN
        v_erros := v_erros || jsonb_build_object('campo','alteracao.modulos[].modulo_id','valor',v_mod->>'modulo_id','motivo','nao_existe_neste_produto');
      END IF;

      v_mvm := nullif(v_mod->>'vlr_mensal','')::numeric;
      IF v_mvm IS NULL THEN
        v_todos_com_valor := false;
        IF v_n_mod = 1 AND v_qd <> 0 AND v_delta IS NOT NULL THEN
          v_mvm := round(abs(v_delta) / abs(v_qd), 2);
        END IF;
      END IF;
      IF v_mvm IS NULL THEN
        v_erros := v_erros || jsonb_build_object('campo','alteracao.modulos[].vlr_mensal','valor',v_mod->>'modulo_id',
          'motivo','valor_por_modulo_obrigatorio: com mais de um modulo o payload precisa dizer o vlr_mensal UNITARIO de cada um. Dividir o total pela quantidade seria inventar preco, e e esse numero que fica na ficha e no cancelamento futuro');
      ELSIF v_mvm <= 0 THEN
        v_erros := v_erros || jsonb_build_object('campo','alteracao.modulos[].vlr_mensal','valor',v_mod->>'vlr_mensal','motivo','valor_zerado');
      ELSE
        v_soma_mod := v_soma_mod + v_mvm * v_qd;
      END IF;
    END LOOP;

    -- So confere quando o payload informou TODOS os valores: no caso derivado a
    -- soma e o proprio valor_delta, a menos do arredondamento do unitario.
    IF v_n_mod > 0 AND v_todos_com_valor AND v_delta IS NOT NULL
       AND round(v_soma_mod,2) <> round(v_delta,2) THEN
      v_erros := v_erros || jsonb_build_object('campo','alteracao.valor_delta','motivo','total_nao_confere',
        'soma_dos_modulos',round(v_soma_mod,2),'total_declarado',round(v_delta,2));
    END IF;

    -- Setup so entra junto de modulo que ENTRA. Numa alteracao que so cancela
    -- nao existe linha onde lanca-lo, e gravar mesmo assim inventa faturamento.
    IF v_ativ_tot > 0 AND v_n_mod > 0 AND v_qtd_pos = 0 THEN
      v_erros := v_erros || jsonb_build_object('campo','alteracao.vlr_ativacao','valor',v_alt->>'vlr_ativacao',
        'motivo','ativacao_sem_modulo_novo: nenhum modulo entra nesta alteracao. Se ha setup a cobrar, mande o bloco avulso');
    END IF;
  END IF;

  ------------------------------------------------------ validacao modo C
  IF v_modo = 'avulso' THEN
    IF coalesce((v_avu->>'valor')::numeric,0) <= 0 THEN
      v_erros := v_erros || jsonb_build_object('campo','avulso.valor','valor',v_avu->>'valor',
        'motivo','valor_zerado: se nao ha cobranca, omita o bloco avulso');
    END IF;
    IF nullif(btrim(coalesce(v_avu->>'descricao','')),'') IS NULL THEN
      v_erros := v_erros || jsonb_build_object('campo','avulso.descricao','motivo','obrigatorio');
    END IF;
  END IF;

  IF jsonb_array_length(v_erros) > 0 THEN
    RAISE EXCEPTION '%', jsonb_build_object('error','validacao','invalidos',v_erros)::text;
  END IF;

  ---------------------------------------------------------------- cliente
  SELECT id INTO v_cliente FROM clientes
   WHERE tenant_id = v_tenant AND regexp_replace(coalesce(cnpj,''),'\D','','g') = v_cnpj LIMIT 1;

  IF v_cliente IS NOT NULL THEN
    v_reusado := true;
  ELSIF v_modo <> 'venda_nova' THEN
    RAISE EXCEPTION '%', jsonb_build_object('error','cliente_nao_encontrado','cnpj',v_cnpj,
      'detail','so venda nova cria cliente')::text;
  ELSE
    IF nullif(btrim(coalesce(v_cli->>'cidade','')),'') IS NOT NULL THEN
      SELECT c.id, c.estado_id INTO v_cidade_id, v_estado_id
        FROM cidades c JOIN estados e ON e.id = c.estado_id
       WHERE extensions.unaccent(lower(c.nome)) = extensions.unaccent(lower(btrim(v_cli->>'cidade')))
         AND upper(e.sigla) = upper(coalesce(v_cli->>'uf','')) LIMIT 1;
    END IF;
    INSERT INTO clientes (
      tenant_id, cnpj, razao_social, nome_fantasia, email, contato_nome,
      telefone_contato, telefone_whatsapp, segmento_id, unidade_base_id,
      endereco, numero, bairro, complemento, cep, cidade_id, estado_id, cancelado
    ) VALUES (
      v_tenant, v_cnpj,
      nullif(btrim(coalesce(v_cli->>'razao_social', v_cli->>'nome', '')),''),
      nullif(btrim(coalesce(v_cli->>'nome_fantasia', v_cli->>'fantasia', '')),''),
      nullif(btrim(coalesce(v_cli->>'email','')),''),
      nullif(btrim(coalesce(v_cli->>'contato_nome', v_cli->>'nome_responsavel', '')),''),
      nullif(regexp_replace(coalesce(v_cli->>'telefone',''),'\D','','g'),''),
      nullif(regexp_replace(coalesce(v_cli->>'telefone',''),'\D','','g'),''),
      nullif(v_cli->>'segmento_id','')::bigint, v_unidade,
      nullif(btrim(coalesce(v_cli->>'endereco', v_cli->>'logradouro', '')),''),
      nullif(btrim(coalesce(v_cli->>'numero','')),''),
      nullif(btrim(coalesce(v_cli->>'bairro','')),''),
      nullif(btrim(coalesce(v_cli->>'complemento','')),''),
      nullif(regexp_replace(coalesce(v_cli->>'cep',''),'\D','','g'),''),
      v_cidade_id, v_estado_id, false
    ) RETURNING id INTO v_cliente;
  END IF;

  SELECT o.nome INTO v_origem_txt FROM origens_venda o
   WHERE o.id = nullif(v_com->>'origem_venda_id','')::bigint AND o.tenant_id = v_tenant;

  ------------------------------------------------- modo A: contrato + modulos
  IF v_modo = 'venda_nova' THEN
    v_data_inicio := nullif(v_com->>'data_inicio_prevista','')::timestamptz;
    FOR v_prod IN SELECT jsonb_array_elements(p_payload->'produtos') LOOP
      v_cp := public.create_cliente_produto_with_contract(
        v_cliente, (v_prod->>'produto_id')::bigint,
        jsonb_build_object(
          'vlr_mensal',(v_prod->>'vlr_mensal')::numeric,
          'vlr_ativacao',(v_prod->>'vlr_ativacao')::numeric,
          'descricao',v_prod->>'descricao',
          'funcionario_id',                 nullif(v_com->>'funcionario_id','')::bigint,
          'origem_venda_id',                nullif(v_com->>'origem_venda_id','')::bigint,
          'forma_pagamento_ativacao_id',    nullif(v_com->>'forma_pagamento_ativacao_id','')::bigint,
          'forma_pagamento_mensalidade_id', nullif(v_com->>'forma_pagamento_mensalidade_id','')::bigint,
          'prazo_meses',                    nullif(v_com->>'prazo_meses','')::int,
          'dia_vencimento',                 nullif(v_com->>'dia_vencimento','')::int),
        v_contrato);
      IF v_contrato IS NULL THEN
        SELECT ci.contrato_id INTO v_contrato FROM contrato_itens ci WHERE ci.cliente_produto_id = v_cp LIMIT 1;
      END IF;
      IF v_primeiro_produto IS NULL THEN v_primeiro_produto := (v_prod->>'produto_id')::bigint; END IF;
      FOR v_mod IN SELECT jsonb_array_elements(v_prod->'modulos') LOOP
        INSERT INTO cliente_produto_modulos (tenant_id, cliente_produto_id, modulo_id, quantidade, vlr_mensal, vlr_ativacao, ativo, origem)
        VALUES (v_tenant, v_cp, (v_mod->>'modulo_id')::uuid, (v_mod->>'quantidade')::int, 0, 0, true, 'intake');
      END LOOP;
    END LOOP;
  END IF;

  ------------------------------------------------- modo B: fila do OEM ou ficha
  IF v_modo = 'alteracao' THEN
    v_primeiro_produto := v_prod_alvo;
    SELECT cp.id, (cp.oem_codigo_filial IS NOT NULL)
      INTO v_cp, v_tem_lic
      FROM cliente_produtos cp
     WHERE cp.cliente_id = v_cliente AND cp.produto_id = v_prod_alvo AND cp.ativo LIMIT 1;
    IF v_cp IS NULL THEN
      RAISE EXCEPTION '%', jsonb_build_object('error','produto_nao_contratado','produto_id',v_prod_alvo,
        'detail','o cliente nao tem esse produto ativo; up-sell precisa de contrato vigente')::text;
    END IF;
    SELECT ci.contrato_id INTO v_contrato FROM contrato_itens ci
      JOIN contratos c ON c.id = ci.contrato_id AND c.status='ativo'
     WHERE ci.cliente_produto_id = v_cp LIMIT 1;

    v_tipo       := CASE WHEN v_delta > 0 THEN 'upsell' ELSE 'downsell' END;
    v_data_venda := coalesce(nullif(v_alt->>'data_venda','')::date, current_date);
    v_motivo_txt := coalesce(nullif(btrim(coalesce(v_alt->>'motivo','')),''),
                             left(btrim(v_alt->>'descricao'), 2000));
    v_motivo_id  := nullif(v_alt->>'motivo_cancelamento_id','')::bigint;

    FOR v_mod IN SELECT jsonb_array_elements(coalesce(v_alt->'modulos','[]'::jsonb)) LOOP
      v_qd  := (v_mod->>'quantidade_delta')::int;
      v_mvm := coalesce(nullif(v_mod->>'vlr_mensal','')::numeric,
                        round(abs(v_delta) / abs(v_qd), 2));
      v_mva := coalesce(nullif(v_mod->>'vlr_ativacao','')::numeric,
                        CASE WHEN v_n_mod = 1 THEN v_ativ_tot ELSE 0 END);

      SELECT m.id, m.quantidade INTO v_cpm, v_qtd_atual
        FROM cliente_produto_modulos m
       WHERE m.cliente_produto_id = v_cp
         AND m.modulo_id = (v_mod->>'modulo_id')::uuid
         AND m.ativo
       LIMIT 1;

      IF v_tem_lic THEN
        -- ------------------------------------------------------------------
        -- Produto COM licenca: OEM primeiro, ficha depois. Nada e gravado aqui
        -- e nenhum movimento e lancado — quem faz as duas coisas e a
        -- fn_oem_fila_aplicar, depois que um admin aprovar e o parceiro aceitar.
        -- ------------------------------------------------------------------
        v_pl := jsonb_build_object(
          'vlr_mensal',         v_mvm,
          'vlr_ativacao',       v_mva,
          'vlr_ativacao_somar', v_mva,
          'data_venda',         v_data_venda,
          'funcionario_id',     nullif(v_com->>'funcionario_id','')::bigint,
          'origem_venda_id',    nullif(v_com->>'origem_venda_id','')::bigint,
          'origem_venda',       v_origem_txt,
          -- A linha nasce marcada como veio: a ficha e o historico precisam
          -- saber que foi venda, nao carga do espelho.
          'origem',             'intake',
          'fonte',              'calculadora');

        BEGIN
          IF v_qd > 0 THEN
            IF v_cpm IS NULL THEN
              v_fila := public.fn_oem_enfileirar_novo(v_cp, (v_mod->>'modulo_id')::uuid, v_qd, v_pl);
            ELSE
              v_fila := public.fn_oem_enfileirar(v_cpm, 'quantidade', coalesce(v_qtd_atual,0) + v_qd, v_pl);
            END IF;
          ELSE
            IF v_cpm IS NULL THEN
              RAISE EXCEPTION '%', jsonb_build_object('error','validacao','invalidos',
                jsonb_build_array(jsonb_build_object('campo','alteracao.modulos[].modulo_id',
                  'valor', v_mod->>'modulo_id',
                  'motivo','modulo_nao_contratado: nao ha o que cancelar nesta ficha')))::text;
            END IF;
            v_fila := public.fn_oem_enfileirar(v_cpm, 'cancelar', abs(v_qd),
                        v_pl || jsonb_build_object(
                          'quantidade_cancelar', abs(v_qd),
                          'motivo',              v_motivo_txt,
                          'motivo_id',           v_motivo_id,
                          'data',                v_data_venda,
                          'valor_downsell',      v_mvm * abs(v_qd)));
          END IF;
        EXCEPTION WHEN OTHERS THEN
          -- A mensagem ja e o nosso JSON quando fomos nos que a levantamos.
          IF SQLERRM LIKE '{%' THEN RAISE; END IF;
          RAISE EXCEPTION '%', jsonb_build_object('error','validacao','invalidos',
            jsonb_build_array(jsonb_build_object('campo','alteracao.modulos[].modulo_id',
              'valor', v_mod->>'modulo_id', 'motivo','oem_fila: ' || SQLERRM)))::text;
        END;

        -- O unico NULL legitimo e o de produto sem licenca, e aqui ele tem uma.
        -- Seguir sem a linha de fila gravaria na ficha um modulo que o parceiro
        -- nunca vai ter — a divergencia que este caminho existe para impedir.
        IF v_fila IS NULL THEN
          RAISE EXCEPTION '%', jsonb_build_object('error','validacao','invalidos',
            jsonb_build_array(jsonb_build_object('campo','alteracao.modulos[].modulo_id',
              'valor', v_mod->>'modulo_id',
              'motivo','oem_fila: o produto tem licenca e o pedido nao entrou na fila')))::text;
        END IF;
        v_filas := v_filas || to_jsonb(v_fila);

      ELSE
        -- ------------------------------------------------------------------
        -- Sem licenca no parceiro: grava aqui, no mesmo desenho da tela do
        -- cliente — valor na linha, movimento ligado ao modulo, descricao dita
        -- pelo nome do modulo e nao pelo texto da proposta.
        -- ------------------------------------------------------------------
        SELECT pm.nome INTO v_nome_mod FROM produto_modulos pm WHERE pm.id = (v_mod->>'modulo_id')::uuid;

        IF v_qd > 0 THEN
          IF v_cpm IS NULL THEN
            INSERT INTO cliente_produto_modulos (
              tenant_id, cliente_produto_id, modulo_id, quantidade,
              vlr_mensal, vlr_custo, vlr_ativacao, data_venda,
              funcionario_id, origem_venda_id, ativo, origem)
            VALUES (
              v_tenant, v_cp, (v_mod->>'modulo_id')::uuid, v_qd,
              v_mvm, 0, v_mva, v_data_venda,
              nullif(v_com->>'funcionario_id','')::bigint,
              nullif(v_com->>'origem_venda_id','')::bigint, true, 'intake')
            RETURNING id INTO v_cpm;
          ELSE
            UPDATE cliente_produto_modulos
               SET quantidade        = coalesce(quantidade,0) + v_qd,
                   quantidade_manual = coalesce(quantidade,0) + v_qd,
                   vlr_ativacao      = coalesce(vlr_ativacao,0) + v_mva,
                   updated_at        = now()
             WHERE id = v_cpm;
          END IF;

          -- Medido DEPOIS de gravar: e o modulo novo que pode mudar a resposta.
          -- Se todos os modulos ativos passarem a ter valor, o gatilho de
          -- sincronia ja reescreveu a receita do produto com a soma deles e o
          -- movimento contaria a mesma venda duas vezes.
          IF NOT public.fn_receita_vem_dos_modulos(v_cp) THEN
            INSERT INTO movimentos_mrr (
              tenant_id, cliente_id, tipo, data_movimento, valor_delta, custo_delta,
              vlr_ativacao, descricao, cliente_produto_modulo_id, funcionario_id,
              origem_venda, contrato_id, status)
            VALUES (
              v_tenant, v_cliente, 'upsell', v_data_venda, v_mvm * v_qd, 0,
              coalesce(v_mva, 0),
              CASE WHEN v_qd > 1
                   THEN format('Adição de %s %s', v_qd::text, coalesce(v_nome_mod,'módulo'))
                   ELSE format('Adição de %s', coalesce(v_nome_mod,'módulo')) END,
              v_cpm, nullif(v_com->>'funcionario_id','')::bigint,
              v_origem_txt, v_contrato, 'ativo')
            RETURNING id INTO v_mov;
          END IF;

        ELSE
          IF v_cpm IS NULL THEN
            RAISE EXCEPTION '%', jsonb_build_object('error','validacao','invalidos',
              jsonb_build_array(jsonb_build_object('campo','alteracao.modulos[].modulo_id',
                'valor', v_mod->>'modulo_id',
                'motivo','modulo_nao_contratado: nao ha o que cancelar nesta ficha')))::text;
          END IF;
          -- O miolo do cancelamento: baixa a linha, carimba motivo e autoria e
          -- lanca o downsell com o valor que a proposta declarou.
          PERFORM public.fn_cancelar_modulo_aplicar(
            v_cpm, abs(v_qd), v_motivo_txt, v_motivo_id, v_data_venda, v_mvm * abs(v_qd));
        END IF;
      END IF;
    END LOOP;

    -- Alteracao sem modulo e mudanca de preco pura: continua virando um
    -- movimento so, com a descricao que veio. Com modulos, cada um lanca o seu
    -- (aqui ou depois da aprovacao) e um movimento de cabecalho contaria a mesma
    -- venda duas vezes.
    IF v_n_mod = 0 THEN
      INSERT INTO movimentos_mrr (
        cliente_id, tenant_id, tipo, data_movimento, valor_delta, vlr_ativacao,
        descricao, funcionario_id, origem_venda, contrato_id, status
      ) VALUES (
        v_cliente, v_tenant, v_tipo::text::"public"."movimento_mrr_tipo", v_data_venda, v_delta,
        v_ativ_tot,
        left(btrim(v_alt->>'descricao'),2000),
        nullif(v_com->>'funcionario_id','')::bigint, v_origem_txt, v_contrato, 'ativo'
      ) RETURNING id INTO v_mov;
    END IF;

    IF jsonb_array_length(v_filas) > 0 THEN
      v_avisos := v_avisos || jsonb_build_object(
        'campo','alteracao.modulos',
        'aviso', format('aguardando_aprovacao: %s pedido(s) entraram na fila do OEM. O modulo, a licenca e o MRR so mudam depois que um admin aprovar em Integracoes > OEM > Aprovacao e o parceiro aceitar.',
                        jsonb_array_length(v_filas)));
    END IF;
  END IF;

  ------------------------------------------------- modo C: cobranca avulsa
  IF v_modo = 'avulso' THEN
    v_primeiro_produto := nullif(v_avu->>'produto_id','')::bigint;
    IF v_primeiro_produto IS NOT NULL THEN
      SELECT ci.contrato_id INTO v_contrato FROM cliente_produtos cp
        JOIN contrato_itens ci ON ci.cliente_produto_id = cp.id
        JOIN contratos c ON c.id = ci.contrato_id AND c.status='ativo'
       WHERE cp.cliente_id = v_cliente AND cp.produto_id = v_primeiro_produto AND cp.ativo LIMIT 1;
    END IF;
    -- valor_delta ZERO de proposito: avulso nao muda a mensalidade.
    INSERT INTO movimentos_mrr (
      cliente_id, tenant_id, tipo, data_movimento, valor_delta, valor_venda_avulsa,
      descricao, funcionario_id, origem_venda, contrato_id, status
    ) VALUES (
      v_cliente, v_tenant, 'venda_avulsa'::text::"public"."movimento_mrr_tipo", current_date, 0,
      (v_avu->>'valor')::numeric, left(btrim(v_avu->>'descricao'),2000),
      nullif(v_com->>'funcionario_id','')::bigint, v_origem_txt, v_contrato, 'ativo'
    ) RETURNING id INTO v_mov;
  END IF;

  ---------------------------------------------------------------- jornada
  v_journey := public.create_onboarding_journey(
    p_tenant_id             => v_tenant,
    p_cliente_id            => v_cliente,
    p_assunto               => coalesce(v_assunto, 'Implantacao'),
    p_produto_id            => v_primeiro_produto,
    p_data_inicio_planejado => coalesce(v_data_inicio, nullif(v_com->>'data_inicio_prevista','')::timestamptz),
    p_descricao             => nullif(btrim(coalesce(p_payload->'proposta'->>'sobre_o_cliente','')),''),
    p_demand_type_id        => v_demand,
    p_unidade_base_id       => NULL   -- a unidade vem do CLIENTE, nunca do ticket
  );

  UPDATE onboarding_journeys SET proposta_payload = p_payload WHERE id = v_journey;

  SELECT st.ticket_code INTO v_ticket_code
    FROM onboarding_journeys j JOIN support_tickets st ON st.id = j.ticket_id WHERE j.id = v_journey;

  RETURN jsonb_build_object(
    'ok', true, 'modo', v_modo,
    'cliente_id', v_cliente, 'cliente_reusado', v_reusado,
    'contrato_id', v_contrato, 'movimento_id', v_mov,
    'fila_ids', v_filas,
    'journey_id', v_journey, 'ticket_code', v_ticket_code, 'avisos', v_avisos
  );
END $$;

ALTER FUNCTION public.fn_intake_proposta(jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.fn_intake_proposta(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_intake_proposta(jsonb) TO service_role;

COMMENT ON FUNCTION public.fn_intake_proposta(jsonb) IS
'Intake de proposta comercial: cliente + contrato + modulos + jornada numa transacao. Modos A (venda nova), B (alteracao), C (avulso) e D (so jornada). No modo B, produto com licenca no OEM nao e gravado aqui: vira pedido em oem_sync_fila e quem aplica a ficha e lanca o MRR e a fn_oem_fila_aplicar, depois da aprovacao. Chamada apenas pela edge function onboarding-intake-webhook com service_role.';
