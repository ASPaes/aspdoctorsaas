-- ============================================================================
-- Passo 5, parte 1: os dois módulos Estoque que a calculadora criou em 31/08.
--
-- Só estes dois entram aqui porque só neles a ficha e o parceiro já concordam.
-- Conferido no espelho, sincronizado do OEM em 03/09/2026:
--
--   filial 23272 (SORVETES REAL 2) — Estoque cód 16, Ativo, qtd 1, R$ 3/un
--   filial 16390 (SORVETES REAL)   — Estoque cód 16, Ativo, qtd 1, R$ 3/un
--
-- O módulo existe no parceiro; o que está errado é só o registro daqui. Nada
-- nesta migration fala com o OEM.
--
-- Três coisas mudam em cada caso:
--
-- 1. `origem` de 'intake' para 'oem'. É a mais importante e a menos visível: a
--    carga do espelho só mantém linha 'oem'. Enquanto estas duas ficarem
--    'intake', o custo continua parado em zero, o código do módulo continua
--    nulo, e se o cliente cancelar o Estoque no parceiro a ficha vai seguir
--    dizendo que ele tem. Duas cargas já passaram por cima delas sem tocá-las.
--
-- 2. Os valores da venda, que a integração não gravava: mensal R$ 30 e ativação
--    R$ 160 — os mesmos que estão no movimento de MRR de cada uma, não números
--    novos. `vlr_custo` fica de fora de propósito: quem sabe quanto o parceiro
--    cobra é o espelho, e ele preenche na próxima carga agora que a linha é
--    dele.
--
-- 3. O movimento de MRR ganha o vínculo com a linha do módulo e a descrição do
--    padrão da casa. Sem `cliente_produto_modulo_id`, um cancelamento futuro
--    não acha o valor a baixar e o downsell sai zerado — e a modal de MRR
--    deixa o movimento aberto para desativar à mão, coisa que movimento de
--    módulo não pode.
--
-- O `intake_hold_omie` segura a fila do Omie: o valor do contrato não muda
-- aqui, e mandar o contrato para o ERP por causa de uma arrumação de cadastro
-- é ruído que alguém vai ter que conferir depois.
-- ============================================================================

BEGIN;

SELECT set_config('doctorsaas.intake_hold_omie', 'true', true);

-- ── SORVETES REAL 2 · cliente 7315b6e1 · filial 23272 ───────────────────────
UPDATE public.cliente_produto_modulos
   SET vlr_mensal        = 30,
       vlr_ativacao      = 160,
       data_venda        = date '2026-08-31',
       oem_modulo_codigo = 16,
       origem            = 'oem',
       updated_at        = now()
 WHERE id = '8077478a-2c54-431b-954c-c3ac2c8ed029'
   AND origem = 'intake';

UPDATE public.movimentos_mrr
   SET cliente_produto_modulo_id = '8077478a-2c54-431b-954c-c3ac2c8ed029',
       descricao                 = 'Adição de Estoque'
 WHERE id = 'd5b98937-7418-49e0-9f37-2eede712eab5'
   AND cliente_produto_modulo_id IS NULL;

-- ── SORVETES REAL · cliente 192ff0e5 · filial 16390 ─────────────────────────
UPDATE public.cliente_produto_modulos
   SET vlr_mensal        = 30,
       vlr_ativacao      = 160,
       data_venda        = date '2026-08-31',
       oem_modulo_codigo = 16,
       origem            = 'oem',
       updated_at        = now()
 WHERE id = '4da9d52f-8cf5-4319-92a1-cb4ade66c729'
   AND origem = 'intake';

UPDATE public.movimentos_mrr
   SET cliente_produto_modulo_id = '4da9d52f-8cf5-4319-92a1-cb4ade66c729',
       descricao                 = 'Adição de Estoque'
 WHERE id = 'c5e4f46a-54b3-4d62-9f94-716a077f913a'
   AND cliente_produto_modulo_id IS NULL;

-- ── conferência: aborta se algum dos quatro não pegou ───────────────────────
DO $$
DECLARE
  v_mod int;
  v_mov int;
BEGIN
  SELECT count(*) INTO v_mod
    FROM public.cliente_produto_modulos
   WHERE id IN ('8077478a-2c54-431b-954c-c3ac2c8ed029','4da9d52f-8cf5-4319-92a1-cb4ade66c729')
     AND origem = 'oem' AND vlr_mensal = 30 AND vlr_ativacao = 160 AND oem_modulo_codigo = 16;

  SELECT count(*) INTO v_mov
    FROM public.movimentos_mrr
   WHERE id IN ('d5b98937-7418-49e0-9f37-2eede712eab5','c5e4f46a-54b3-4d62-9f94-716a077f913a')
     AND descricao = 'Adição de Estoque'
     AND cliente_produto_modulo_id IS NOT NULL;

  IF v_mod <> 2 OR v_mov <> 2 THEN
    RAISE EXCEPTION 'Correcao incompleta: % de 2 modulos e % de 2 movimentos. Nada foi gravado.', v_mod, v_mov;
  END IF;
END $$;

COMMIT;
