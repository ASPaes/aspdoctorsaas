-- ============================================================================
-- Vincular uma filial do OEM a um produto passa a espelhar os módulos na hora.
--
-- O espelho de módulos roda por trg_oem_espelhar_modulos, um gatilho em
-- oem_espelho_filial que só dispara QUANDO O JSON DE MÓDULOS MUDA. Ele nasceu
-- pensando no fluxo "a licença mudou, atualize a ficha" e não cobre o outro:
-- a licença já estava no espelho, parada, e o VÍNCULO é que veio depois.
--
-- Nesse caso o espelho nunca roda para aquela filial — e nunca vai rodar,
-- a não ser que o parceiro mexa nos módulos dela. A ficha fica com zero módulo
-- e o custo permanece o que alguém digitou.
--
-- Medido em 20/08/2026: 1 caso em 749 produtos vinculados (filial 39821, 8
-- módulos no OEM somando R$ 85,90 contra R$ 70,90 digitados). Número pequeno
-- hoje, mas é o caminho por onde TODO vínculo novo entra.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.trg_oem_espelhar_ao_vincular() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_modulos jsonb;
BEGIN
  -- O espelho mais recente da filial. Mais de uma conta do OEM pode conhecer o
  -- mesmo código de filial; vale a leitura mais nova do tenant.
  SELECT ef.modulos INTO v_modulos
    FROM public.oem_espelho_filial ef
   WHERE ef.tenant_id = NEW.tenant_id
     AND ef.filial_codigo = NEW.oem_codigo_filial
   ORDER BY ef.atualizado_em DESC
   LIMIT 1;

  -- Vínculo feito antes de a filial existir no espelho: não há o que espelhar
  -- agora, e a próxima carga resolve pelo gatilho de oem_espelho_filial.
  IF v_modulos IS NULL OR jsonb_typeof(v_modulos) <> 'array' THEN
    RETURN NULL;
  END IF;

  PERFORM public.fn_oem_espelhar_modulos_no_contrato(
    NEW.tenant_id, NEW.oem_codigo_filial, v_modulos);

  -- O espelho roda com skip_valor_sync ligado, então fn_sync_produto_valores
  -- não recalcula nada. Sem esta linha o produto ficaria com os módulos certos
  -- e o custo antigo — que é exatamente a divergência que estamos fechando.
  UPDATE public.cliente_produtos cp
     SET vlr_custo = soma.custo,
         updated_at = now()
    FROM (
      SELECT SUM(COALESCE(c.vlr_custo_total, COALESCE(c.vlr_custo, 0) * c.quantidade)) AS custo
        FROM public.cliente_produto_modulos c
       WHERE c.cliente_produto_id = NEW.id
         AND c.ativo = true
    ) soma
   WHERE cp.id = NEW.id
     AND soma.custo IS NOT NULL
     AND cp.vlr_custo IS DISTINCT FROM soma.custo;

  RETURN NULL;
END;
$$;

ALTER FUNCTION public.trg_oem_espelhar_ao_vincular() OWNER TO postgres;

DROP TRIGGER IF EXISTS trg_oem_espelhar_ao_vincular ON public.cliente_produtos;
DROP TRIGGER IF EXISTS trg_oem_espelhar_ao_vincular_ins ON public.cliente_produtos;
DROP TRIGGER IF EXISTS trg_oem_espelhar_ao_vincular_upd ON public.cliente_produtos;

-- São dois gatilhos, não um: a cláusula WHEN de um gatilho de INSERT não pode
-- citar OLD, e `TG_OP` não existe dentro de WHEN. Juntar os dois eventos numa
-- declaração só custaria o guard do UPDATE.
CREATE TRIGGER trg_oem_espelhar_ao_vincular_ins
  AFTER INSERT ON public.cliente_produtos
  FOR EACH ROW
  WHEN (NEW.oem_codigo_filial IS NOT NULL)
  EXECUTE FUNCTION public.trg_oem_espelhar_ao_vincular();

-- `UPDATE OF oem_codigo_filial` já limita bastante, mas o WHEN é o que garante
-- que uma escrita que só repete o mesmo código não refaça o espelho inteiro.
CREATE TRIGGER trg_oem_espelhar_ao_vincular_upd
  AFTER UPDATE OF oem_codigo_filial ON public.cliente_produtos
  FOR EACH ROW
  WHEN (
    NEW.oem_codigo_filial IS NOT NULL
    AND NEW.oem_codigo_filial IS DISTINCT FROM OLD.oem_codigo_filial
  )
  EXECUTE FUNCTION public.trg_oem_espelhar_ao_vincular();

-- ============================================================================
-- Backfill: as filiais que já estão vinculadas e nunca foram espelhadas.
-- ============================================================================
DO $backfill$
DECLARE
  r record;
  v_filiais int := 0;
  v_produtos int := 0;
BEGIN
  FOR r IN
    SELECT DISTINCT cp.tenant_id, cp.oem_codigo_filial
      FROM public.cliente_produtos cp
     WHERE cp.ativo = true
       AND cp.oem_codigo_filial IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM public.cliente_produto_modulos c
          WHERE c.cliente_produto_id = cp.id AND c.origem = 'oem'
       )
       AND EXISTS (
         SELECT 1 FROM public.oem_espelho_filial ef
          WHERE ef.tenant_id = cp.tenant_id
            AND ef.filial_codigo = cp.oem_codigo_filial
            AND jsonb_typeof(ef.modulos) = 'array'
            AND jsonb_array_length(ef.modulos) > 0
       )
  LOOP
    PERFORM public.fn_oem_espelhar_modulos_no_contrato(
      r.tenant_id, r.oem_codigo_filial,
      (SELECT ef.modulos FROM public.oem_espelho_filial ef
        WHERE ef.tenant_id = r.tenant_id AND ef.filial_codigo = r.oem_codigo_filial
        ORDER BY ef.atualizado_em DESC LIMIT 1));
    v_filiais := v_filiais + 1;
  END LOOP;

  -- Recálculo do custo, pelo mesmo motivo do gatilho: o espelho roda com skip.
  -- Sem skip aqui, para que trg_sync_cliente_mensalidade leve o número até
  -- clientes.custo_operacao.
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

  RAISE NOTICE 'espelho ao vincular: % filiais espelhadas, % produtos com custo recalculado',
               v_filiais, v_produtos;
END
$backfill$;
