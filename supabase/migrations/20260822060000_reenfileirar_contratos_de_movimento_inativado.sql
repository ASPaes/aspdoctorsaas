-- ============================================================================
-- Acerta no Omie os contratos que ficaram para trás.
--
-- O conserto do gatilho (20260822040000) só vale para eventos NOVOS. Movimento
-- de MRR inativado ANTES dele saiu do MRR do DoctorSaaS e não avisou o Omie —
-- o contrato lá continua no valor antigo.
--
-- Caso concreto: o upsell de R$ 1,00 do CAMPINA VERDE, inativado em 21/08/2026.
--
-- A janela é curta de propósito (2 dias). Enfileirar tudo que já foi inativado
-- na história reprocessaria centenas de contratos que provavelmente já estão
-- certos, e a fila do Omie não é lugar para varredura especulativa.
-- ============================================================================
DO $reenfileira$
DECLARE
  r     record;
  v_n   int := 0;
BEGIN
  FOR r IN
    SELECT DISTINCT c.id AS contrato_id,
           coalesce(cl.nome_fantasia, cl.razao_social) AS cliente
      FROM public.movimentos_mrr mv
      JOIN public.clientes  cl ON cl.id = mv.cliente_id
      JOIN public.contratos c  ON c.cliente_id = mv.cliente_id
                              AND c.tenant_id  = mv.tenant_id
                              AND c.status     = 'ativo'
     WHERE mv.tipo IN ('upsell','cross_sell','downsell','reajuste')
       -- Saiu do MRR por qualquer um dos três caminhos.
       AND (mv.status IS DISTINCT FROM 'ativo'
            OR mv.estornado_por IS NOT NULL
            OR mv.encerrado_em IS NOT NULL)
       AND mv.inativado_em >= now() - interval '2 days'
  LOOP
    PERFORM public.enfileirar_sync_omie(r.contrato_id, 'movimento_inativado_retroativo');
    v_n := v_n + 1;
    RAISE NOTICE 'enfileirado: % (contrato %)', r.cliente, r.contrato_id;
  END LOOP;

  RAISE NOTICE 'total: % contrato(s) enfileirado(s) para o Omie', v_n;
END
$reenfileira$;
