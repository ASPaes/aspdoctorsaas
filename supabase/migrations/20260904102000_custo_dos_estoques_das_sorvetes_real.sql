-- ============================================================================
-- Passo 5, parte 2: o custo dos dois Estoque que a calculadora criou.
--
-- Eu deixei `vlr_custo` de fora da correção de 03/09 dizendo que a próxima
-- carga do espelho preencheria. **Não preenche.** `trg_oem_espelhar_modulos` só
-- roda quando a lista de módulos do parceiro MUDA, e o espelho das duas filiais
-- foi relido em 04/09 00:17 sem alteração — as linhas seguiram com custo zero e
-- `updated_at` de 03/09 23:41.
--
-- O valor não é digitado aqui: sai de `fn_oem_custo_do_modulo`, que lê o mesmo
-- espelho que a tela lê. Se por algum motivo ele não souber responder, a linha
-- não é tocada e a conferência no fim aborta a transação.
--
-- `intake_hold_omie` de novo: o que muda é custo, não o valor do contrato, e
-- mandar o contrato ao ERP por causa disso é ruído para alguém conferir depois.
-- ============================================================================

BEGIN;

SELECT set_config('doctorsaas.intake_hold_omie', 'true', true);

UPDATE public.cliente_produto_modulos c
   SET vlr_custo  = public.fn_oem_custo_do_modulo(c.tenant_id, c.cliente_produto_id, c.oem_modulo_codigo),
       updated_at = now()
 WHERE c.id IN ('8077478a-2c54-431b-954c-c3ac2c8ed029',
                '4da9d52f-8cf5-4319-92a1-cb4ade66c729')
   AND coalesce(c.vlr_custo, 0) = 0
   AND public.fn_oem_custo_do_modulo(c.tenant_id, c.cliente_produto_id, c.oem_modulo_codigo) > 0;

DO $$
DECLARE
  v_n int;
BEGIN
  SELECT count(*) INTO v_n
    FROM public.cliente_produto_modulos
   WHERE id IN ('8077478a-2c54-431b-954c-c3ac2c8ed029',
                '4da9d52f-8cf5-4319-92a1-cb4ade66c729')
     AND vlr_custo > 0;
  IF v_n <> 2 THEN
    RAISE EXCEPTION 'Correcao incompleta: % de 2 modulos com custo. Nada foi gravado.', v_n;
  END IF;
END $$;

COMMIT;
