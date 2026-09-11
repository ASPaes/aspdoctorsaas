-- ============================================================================
-- Os 6 casos do "Vínculo sem o código na ficha" — conta Digi Office, 10/09/2026.
--
-- Cada cliente abaixo tem 2 ou 3 lojas no OEM e UMA linha de produto na ficha.
-- Este script dá a cada loja que sobrou a SUA linha de produto (mesmo produto
-- e fornecedor da linha que já existe, mensalidade ZERO, custo = o da licença)
-- e grava o código da filial nela.
--
-- COMO RODAR
--   1. Rode como está (v_aplicar = false). NADA é gravado: o script faz tudo,
--      mostra o antes e o depois de cada cliente, e desfaz no fim.
--   2. Confira. Se alguma loja NÃO é da mesma empresa (tem cadastro próprio),
--      apague a linha dela da lista `casos` e resolva pela tela, em
--      Divergências › Escolher o cliente.
--   3. Troque para v_aplicar = true e rode de novo. A tabela do fim mostra
--      como os 5 clientes ficaram.
--
-- É TUDO OU NADA: se qualquer gravação falhar, o bloco inteiro desfaz.
--
-- O QUE MUDA EM CADA CLIENTE
--   mensalidade    : não muda. A linha nova entra com vlr_mensal = 0, e o
--                    espelho do OEM cria os módulos dela também com preço 0.
--   custo_operacao : vira a soma das linhas ativas, que é o que o sistema
--                    calcula a cada mudança de produto. Em 4 dos 5 clientes
--                    ele já estava defasado ANTES disto (o espelho atualiza o
--                    custo da linha sem recalcular o cliente), então o número
--                    muda um pouco mais do que o valor da licença somada.
--   contrato/Omie  : nada. A linha nova não entra em contrato, e a fila do
--                    Omie só enfileira contrato que contenha a linha.
--
-- POR QUE O set_config(... 'false') ANTES DE CADA INSERT
--   Gravar o código dispara o espelho de módulos do OEM, e ele liga o
--   doctorsaas.skip_valor_sync até o FIM da transação. Sem religar, do segundo
--   caso em diante o cliente não seria recalculado.
--
-- PARA DESFAZER depois de aplicado: apague as linhas criadas (os ids saem no
-- aviso do bloco). São linhas sem contrato, e a ficha também deixa excluir.
-- ============================================================================
DO $caso$
DECLARE
  v_aplicar boolean := false;   -- << troque para true para gravar de verdade

  c       record;
  v_rec   record;
  v_base  record;
  v_antes record;
  v_novo  uuid;
  v_ret   int;
  v_rel   text := '';
  v_ids   text := '';
BEGIN
  FOR c IN
    SELECT * FROM (VALUES
      -- ALENTO FICA DE FORA por enquanto. O OEM manda o módulo "Gestao" dessas
      -- duas lojas com quantidade 0, e desde 20260907020000 o espelho tenta
      -- gravar esse zero numa coluna que o banco exige >= 1: gravar o código
      -- quebra com cliente_produto_modulos_quantidade_check (medido na prévia
      -- de 10/09/2026). Volta para a lista depois que o espelho for corrigido,
      -- e se as lojas forem mesmo da mesma empresa (o cadastro se chama
      -- "MATRIZ", o que sugere que as outras duas podem ter cadastro próprio).
      -- ('47d60d01-a35b-423e-a13b-3234faeef70e'::uuid, '36728'),  -- ALENTO SORVETES (loja 2 de 3)
      -- ('47d60d01-a35b-423e-a13b-3234faeef70e'::uuid, '36729'),  -- ALENTO SORVETES (loja 3 de 3)
      ('d5f2f09e-70af-4922-918d-f5e4ca908ae0'::uuid, '28299'),  -- BERNINI SORVETES
      ('322b0dc8-5d32-460e-8047-d2a5099c135f'::uuid, '21291'),  -- DORIAN CACAO VENEZUELA
      ('4b145190-7a05-4f52-ad03-8ca71724506d'::uuid, '36873'),  -- PAROQUIA N. S. DO CARMO
      ('1c53319b-71e5-4f82-85e5-a33b33e64569'::uuid, '13988')   -- RESERVA BAMBU
    ) AS casos(cliente_id, filial)
  LOOP
    -- A licença ainda é deste cliente, ainda está ativa e ainda está sem
    -- código? Se alguém resolveu pela tela nesse meio tempo, pula em vez de
    -- duplicar.
    SELECT r.id, r.tenant_id, r.empresa_codigo, r.custo_oem, r.status_oem
      INTO v_rec
      FROM public.reconciliacao_oem r
     WHERE r.filial_codigo = c.filial AND r.ds_customer_id = c.cliente_id
     LIMIT 1;
    IF v_rec.id IS NULL THEN
      v_rel := v_rel || E'\n  PULADO filial ' || c.filial || ': a licença não aponta mais para este cliente';
      CONTINUE;
    END IF;
    IF v_rec.status_oem IS DISTINCT FROM 'Ativo' THEN
      v_rel := v_rel || E'\n  PULADO filial ' || c.filial || ': a licença não está mais ativa no OEM';
      CONTINUE;
    END IF;
    IF EXISTS (SELECT 1 FROM public.cliente_produtos
                WHERE tenant_id = v_rec.tenant_id AND oem_codigo_filial = c.filial) THEN
      v_rel := v_rel || E'\n  PULADO filial ' || c.filial || ': o código já está em alguma ficha';
      CONTINUE;
    END IF;

    -- A linha que já existe é o molde: mesmo produto, mesmo fornecedor.
    SELECT cp.produto_id, cp.fornecedor_id
      INTO v_base
      FROM public.cliente_produtos cp
     WHERE cp.cliente_id = c.cliente_id AND cp.ativo AND cp.oem_codigo_filial IS NOT NULL
     LIMIT 1;
    IF v_base.produto_id IS NULL THEN
      RAISE EXCEPTION 'filial %: o cliente não tem linha do OEM para servir de molde', c.filial;
    END IF;

    SELECT mensalidade, custo_operacao INTO v_antes FROM public.clientes WHERE id = c.cliente_id;

    PERFORM set_config('doctorsaas.skip_valor_sync', 'false', true);
    INSERT INTO public.cliente_produtos
      (tenant_id, cliente_id, produto_id, fornecedor_id, ativo, vlr_mensal, vlr_custo)
    VALUES
      (v_rec.tenant_id, c.cliente_id, v_base.produto_id, v_base.fornecedor_id, true, 0, v_rec.custo_oem)
    RETURNING id INTO v_novo;

    v_ret := public.oem_gravar_codigos_no_produto(c.cliente_id, v_rec.empresa_codigo, c.filial);
    IF v_ret <> 1 THEN
      RAISE EXCEPTION 'filial %: a gravação do código devolveu % (nada foi gravado, o bloco inteiro desfaz)', c.filial, v_ret;
    END IF;

    v_ids := v_ids || v_novo::text || ' ';
    v_rel := v_rel || E'\n  '
      || (SELECT coalesce(nullif(btrim(nome_fantasia), ''), razao_social) FROM public.clientes WHERE id = c.cliente_id)
      || ' · filial ' || c.filial
      || ' · mensalidade ' || coalesce(v_antes.mensalidade::text, 'null')
      || ' -> ' || coalesce((SELECT mensalidade FROM public.clientes WHERE id = c.cliente_id)::text, 'null')
      || ' · custo ' || coalesce(v_antes.custo_operacao::text, 'null')
      || ' -> ' || coalesce((SELECT custo_operacao FROM public.clientes WHERE id = c.cliente_id)::text, 'null')
      || ' · códigos ' || coalesce((SELECT string_agg(oem_codigo_filial, '+' ORDER BY oem_codigo_filial)
                                      FROM public.cliente_produtos
                                     WHERE cliente_id = c.cliente_id AND ativo), '-');
  END LOOP;

  PERFORM set_config('doctorsaas.skip_valor_sync', 'false', true);

  IF v_aplicar THEN
    RAISE NOTICE 'APLICADO.% | linhas criadas: %', v_rel, v_ids;
  ELSE
    RAISE EXCEPTION 'PREVIA, nada foi gravado:%', v_rel;
  END IF;
END $caso$;

-- Só chega aqui com v_aplicar = true (na prévia o bloco acima para com erro).
SELECT coalesce(nullif(btrim(c.nome_fantasia), ''), c.razao_social) AS cliente,
       c.mensalidade, c.custo_operacao,
       string_agg(cp.oem_codigo_filial, '+' ORDER BY cp.oem_codigo_filial) AS codigos,
       count(*) AS linhas_ativas
  FROM public.clientes c
  JOIN public.cliente_produtos cp ON cp.cliente_id = c.id AND cp.ativo
 WHERE c.id IN ('47d60d01-a35b-423e-a13b-3234faeef70e', 'd5f2f09e-70af-4922-918d-f5e4ca908ae0',
                '322b0dc8-5d32-460e-8047-d2a5099c135f', '4b145190-7a05-4f52-ad03-8ca71724506d',
                '1c53319b-71e5-4f82-85e5-a33b33e64569')
 GROUP BY 1, 2, 3
 ORDER BY 1;
