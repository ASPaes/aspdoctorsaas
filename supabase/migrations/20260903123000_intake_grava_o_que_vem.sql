-- Intake da proposta: gravar fiel o que o sistema comercial manda.
--
-- Antes desta versao a fn_intake_proposta descartava dado que ja chegava ou que
-- a tela do cliente mostra:
--
--   * O bloco do contrato montava 9 chaves das 20 que a
--     create_cliente_produto_with_contract aceita. Ficavam de fora fornecedor,
--     codigo/link do fornecedor, custo, modelo de contrato, recorrencia, as
--     quatro datas (venda, ativacao, fim, proximo reajuste) e as observacoes
--     contratuais. Nenhuma mudanca de schema: a RPC de baixo sempre soube ler
--     essas chaves, o intake e que nunca as passou.
--
--   * O INSERT em clientes ignorava data_cadastro, contato_fone,
--     observacao_cliente e area_atuacao_id.
--
-- A regra e fidelidade: nada aqui deriva, compoe ou normaliza valor. O que nao
-- vem no payload continua NULL, e passa a sair um aviso dizendo o que faltou —
-- lacuna visivel no log em vez de campo em branco descoberto semanas depois.
--
-- Campo de contrato pode vir no produto ou em comercial; o produto vence. Antes
-- so comercial era lido, e continua funcionando — o fallback e superset.
--
-- Catalogo por ID passa a ser conferido. As FKs existem
-- (clientes.segmento_id -> segmentos, cliente_produtos.fornecedor_id ->
-- fornecedores, e mais 12), mas NENHUMA filtra tenant: um ID de outra empresa
-- passava pela FK e entrava em silencio. E nome no lugar do ID — o
-- "Restaurante" em vez do 74 — estourava no cast e voltava 500 sem dizer qual
-- campo errou.

CREATE OR REPLACE FUNCTION public.fn_intake_proposta(p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  -- conferencia de catalogo e de formato, e o aviso das lacunas do cadastro
  v_chk jsonb; v_chks jsonb; v_ok boolean; v_faltando text[] := '{}';
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
  -- clientes tem CHECK (unidade_base_id IS NOT NULL). Sem esta linha, venda nova
  -- sem unidade estoura no INSERT e volta 500 cru, sem dizer o que faltou.
  IF v_modo = 'venda_nova' AND v_unidade IS NULL THEN
    v_erros := v_erros || jsonb_build_object('campo','unidade_base_id','motivo','obrigatorio_no_modo_venda_nova');
  END IF;

  -- Os outros catalogos, num lugar so. A lista de tabelas e literal aqui — o
  -- format(%I) nunca ve texto de payload.
  v_chks := jsonb_build_array(
    jsonb_build_object('campo','cliente.segmento_id',      'valor',v_cli->>'segmento_id',      'tabela','segmentos'),
    jsonb_build_object('campo','cliente.area_atuacao_id',  'valor',v_cli->>'area_atuacao_id',  'tabela','areas_atuacao'),
    jsonb_build_object('campo','comercial.funcionario_id', 'valor',v_com->>'funcionario_id',   'tabela','funcionarios'),
    jsonb_build_object('campo','comercial.origem_venda_id','valor',v_com->>'origem_venda_id',  'tabela','origens_venda'),
    jsonb_build_object('campo','comercial.forma_pagamento_ativacao_id',    'valor',v_com->>'forma_pagamento_ativacao_id',    'tabela','formas_pagamento'),
    jsonb_build_object('campo','comercial.forma_pagamento_mensalidade_id', 'valor',v_com->>'forma_pagamento_mensalidade_id', 'tabela','formas_pagamento')
  );
  FOR v_prod IN SELECT jsonb_array_elements(coalesce(p_payload->'produtos','[]'::jsonb)) LOOP
    v_chks := v_chks
      || jsonb_build_object('campo','produtos[].fornecedor_id',      'valor',v_prod->>'fornecedor_id',      'tabela','fornecedores')
      || jsonb_build_object('campo','produtos[].modelo_contrato_id', 'valor',v_prod->>'modelo_contrato_id', 'tabela','modelos_contrato')
      || jsonb_build_object('campo','produtos[].funcionario_id',     'valor',v_prod->>'funcionario_id',     'tabela','funcionarios')
      || jsonb_build_object('campo','produtos[].origem_venda_id',    'valor',v_prod->>'origem_venda_id',    'tabela','origens_venda')
      || jsonb_build_object('campo','produtos[].forma_pagamento_ativacao_id',    'valor',v_prod->>'forma_pagamento_ativacao_id',    'tabela','formas_pagamento')
      || jsonb_build_object('campo','produtos[].forma_pagamento_mensalidade_id', 'valor',v_prod->>'forma_pagamento_mensalidade_id', 'tabela','formas_pagamento');

    IF nullif(btrim(coalesce(v_prod->>'recorrencia','')),'') IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
                        WHERE t.typname = 'recorrencia_tipo' AND e.enumlabel = v_prod->>'recorrencia') THEN
      v_erros := v_erros || jsonb_build_object('campo','produtos[].recorrencia','valor',v_prod->>'recorrencia',
        'motivo','valor_invalido: aceita mensal, anual, semestral ou semanal');
    END IF;
  END LOOP;

  FOR v_chk IN SELECT jsonb_array_elements(v_chks) LOOP
    CONTINUE WHEN nullif(btrim(coalesce(v_chk->>'valor','')),'') IS NULL;
    IF (v_chk->>'valor') !~ '^[0-9]+$' THEN
      v_erros := v_erros || jsonb_build_object('campo',v_chk->>'campo','valor',v_chk->>'valor',
        'motivo','id_invalido: envie o ID numerico do catalogo, nao o nome');
      CONTINUE;
    END IF;
    EXECUTE format('SELECT EXISTS (SELECT 1 FROM public.%I WHERE id = $1 AND tenant_id = $2)', v_chk->>'tabela')
      INTO v_ok USING (v_chk->>'valor')::bigint, v_tenant;
    IF NOT v_ok THEN
      v_erros := v_erros || jsonb_build_object('campo',v_chk->>'campo','valor',v_chk->>'valor','motivo','nao_existe_no_tenant');
    END IF;
  END LOOP;

  -- Formato de data e de numero. Sem isto, um "31/08/2026" ou um "1.234,00"
  -- estoura no cast e volta 500, sem dizer qual campo.
  v_chks := jsonb_build_array(
    jsonb_build_object('campo','cliente.data_cadastro',        'valor',v_cli->>'data_cadastro',        'tipo','data'),
    jsonb_build_object('campo','comercial.data_inicio_prevista','valor',v_com->>'data_inicio_prevista','tipo','data')
  );
  FOR v_prod IN SELECT jsonb_array_elements(coalesce(p_payload->'produtos','[]'::jsonb)) LOOP
    v_chks := v_chks
      || jsonb_build_object('campo','produtos[].data_venda',            'valor',v_prod->>'data_venda',            'tipo','data')
      || jsonb_build_object('campo','produtos[].data_ativacao',         'valor',v_prod->>'data_ativacao',         'tipo','data')
      || jsonb_build_object('campo','produtos[].data_fim',              'valor',v_prod->>'data_fim',              'tipo','data')
      || jsonb_build_object('campo','produtos[].data_proximo_reajuste', 'valor',v_prod->>'data_proximo_reajuste', 'tipo','data')
      || jsonb_build_object('campo','produtos[].vlr_custo',             'valor',v_prod->>'vlr_custo',             'tipo','numero');
  END LOOP;

  FOR v_chk IN SELECT jsonb_array_elements(v_chks) LOOP
    CONTINUE WHEN nullif(btrim(coalesce(v_chk->>'valor','')),'') IS NULL;
    BEGIN
      IF v_chk->>'tipo' = 'data'
        THEN PERFORM (v_chk->>'valor')::date;
        ELSE PERFORM (v_chk->>'valor')::numeric;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_erros := v_erros || jsonb_build_object('campo',v_chk->>'campo','valor',v_chk->>'valor',
        'motivo', CASE WHEN v_chk->>'tipo' = 'data'
                       THEN 'data_invalida: use AAAA-MM-DD'
                       ELSE 'numero_invalido: use ponto decimal, sem separador de milhar' END);
    END;
  END LOOP;

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
      endereco, numero, bairro, complemento, cep, cidade_id, estado_id, cancelado,
      -- gravados a partir de 03/09/2026; antes a tela mostrava em branco mesmo
      -- quando o dado existia do outro lado
      data_cadastro, contato_fone, observacao_cliente, area_atuacao_id
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
      v_cidade_id, v_estado_id, false,
      nullif(v_cli->>'data_cadastro','')::date,
      -- so a pontuacao sai; o numero e o que veio, digito por digito
      nullif(regexp_replace(coalesce(v_cli->>'contato_fone', v_cli->>'contato_telefone', ''),'\D','','g'),''),
      nullif(btrim(coalesce(v_cli->>'observacao_cliente', v_cli->>'observacao', '')),''),
      nullif(v_cli->>'area_atuacao_id','')::bigint
    ) RETURNING id INTO v_cliente;

    -- Lacuna do cadastro fica visivel no log em vez de virar campo em branco
    -- descoberto semanas depois. Nao e erro: a venda entra.
    IF nullif(v_cli->>'data_cadastro','')      IS NULL THEN v_faltando := array_append(v_faltando, 'data_cadastro'); END IF;
    IF nullif(btrim(coalesce(v_cli->>'nome_fantasia', v_cli->>'fantasia','')),'') IS NULL THEN v_faltando := array_append(v_faltando, 'nome_fantasia'); END IF;
    IF nullif(v_cli->>'segmento_id','')        IS NULL THEN v_faltando := array_append(v_faltando, 'segmento_id'); END IF;
    IF nullif(v_cli->>'area_atuacao_id','')    IS NULL THEN v_faltando := array_append(v_faltando, 'area_atuacao_id'); END IF;
    IF nullif(btrim(coalesce(v_cli->>'observacao_cliente', v_cli->>'observacao','')),'') IS NULL THEN v_faltando := array_append(v_faltando, 'observacao_cliente'); END IF;
    IF nullif(btrim(coalesce(v_cli->>'contato_fone', v_cli->>'contato_telefone','')),'') IS NULL THEN v_faltando := array_append(v_faltando, 'contato_fone'); END IF;
    IF array_length(v_faltando,1) > 0 THEN
      v_avisos := v_avisos || jsonb_build_object('campo','cliente','aviso',
        'cadastro_incompleto: o cliente foi criado sem ' || array_to_string(v_faltando, ', ') ||
        '. O payload nao trouxe esses campos e nada e preenchido por conta propria');
    END IF;
  END IF;

  SELECT o.nome INTO v_origem_txt FROM origens_venda o
   WHERE o.id = nullif(v_com->>'origem_venda_id','')::bigint AND o.tenant_id = v_tenant;

  ------------------------------------------------- modo A: contrato + modulos
  IF v_modo = 'venda_nova' THEN
    v_data_inicio := nullif(v_com->>'data_inicio_prevista','')::timestamptz;
    FOR v_prod IN SELECT jsonb_array_elements(p_payload->'produtos') LOOP
      -- Campo de contrato pode vir no produto ou em comercial; o produto vence.
      -- A create_cliente_produto_with_contract sempre soube ler as 20 chaves —
      -- e o intake que passava 9.
      v_cp := public.create_cliente_produto_with_contract(
        v_cliente, (v_prod->>'produto_id')::bigint,
        jsonb_build_object(
          'vlr_mensal',(v_prod->>'vlr_mensal')::numeric,
          'vlr_ativacao',(v_prod->>'vlr_ativacao')::numeric,
          'descricao',v_prod->>'descricao',
          'funcionario_id',                 nullif(coalesce(v_prod->>'funcionario_id',                 v_com->>'funcionario_id'),'')::bigint,
          'origem_venda_id',                nullif(coalesce(v_prod->>'origem_venda_id',                v_com->>'origem_venda_id'),'')::bigint,
          'forma_pagamento_ativacao_id',    nullif(coalesce(v_prod->>'forma_pagamento_ativacao_id',    v_com->>'forma_pagamento_ativacao_id'),'')::bigint,
          'forma_pagamento_mensalidade_id', nullif(coalesce(v_prod->>'forma_pagamento_mensalidade_id', v_com->>'forma_pagamento_mensalidade_id'),'')::bigint,
          'prazo_meses',                    nullif(coalesce(v_prod->>'prazo_meses',                    v_com->>'prazo_meses'),'')::int,
          'dia_vencimento',                 nullif(coalesce(v_prod->>'dia_vencimento',                 v_com->>'dia_vencimento'),'')::int,
          'fornecedor_id',                  nullif(coalesce(v_prod->>'fornecedor_id',                  v_com->>'fornecedor_id'),'')::bigint,
          'codigo_fornecedor',              nullif(btrim(coalesce(v_prod->>'codigo_fornecedor',        v_com->>'codigo_fornecedor','')),''),
          'link_portal_fornecedor',         nullif(btrim(coalesce(v_prod->>'link_portal_fornecedor',   v_com->>'link_portal_fornecedor','')),''),
          'modelo_contrato_id',             nullif(coalesce(v_prod->>'modelo_contrato_id',             v_com->>'modelo_contrato_id'),'')::bigint,
          'recorrencia',                    nullif(btrim(coalesce(v_prod->>'recorrencia',              v_com->>'recorrencia','')),''),
          'vlr_custo',                      nullif(v_prod->>'vlr_custo','')::numeric,
          'data_venda',                     nullif(coalesce(v_prod->>'data_venda',                     v_com->>'data_venda'),'')::date,
          'data_ativacao',                  nullif(coalesce(v_prod->>'data_ativacao',                  v_com->>'data_ativacao'),'')::date,
          'data_fim',                       nullif(coalesce(v_prod->>'data_fim',                       v_com->>'data_fim'),'')::date,
          'data_proximo_reajuste',          nullif(coalesce(v_prod->>'data_proximo_reajuste',          v_com->>'data_proximo_reajuste'),'')::date,
          'observacoes_contratuais',        nullif(btrim(coalesce(v_prod->>'observacoes_contratuais',  v_com->>'observacoes_contratuais','')),'')),
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
END $function$;
