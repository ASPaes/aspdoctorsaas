-- ============================================================================
-- Inativar um movimento de MRR passa a enfileirar o contrato para o Omie.
--
-- O gatilho `movimento_mrr_enfileirar_omie` já escuta `UPDATE OF status` — ele
-- dispara quando alguém inativa o movimento. Só que a primeira coisa que ele
-- fazia era:
--
--     IF NEW.status IS DISTINCT FROM 'ativo' THEN RETURN NULL; END IF;
--
-- A intenção era "não sincronizar movimento inativo". O efeito é o contrário:
-- **é justamente a inativação que precisa ir ao Omie**, porque é ela que muda o
-- valor do contrato. O gatilho ignorava exatamente o evento para o qual foi
-- criado.
--
-- Medido no CAMPINA VERDE em 21/08/2026: um upsell de R$ 1,00 foi inativado, o
-- MRR do DoctorSaaS caiu de 566,28 para 565,28 e o contrato no Omie ficou no
-- valor antigo. Divergência silenciosa, do tipo que só aparece na cobrança.
--
-- A regra nova distingue os dois casos que estavam no mesmo IF:
--   nasceu inativo   -> nada mudou no contrato, não enfileira
--   DEIXOU de ser ativo -> é alteração de valor, enfileira
-- ============================================================================
CREATE OR REPLACE FUNCTION public.trg_movimento_mrr_enfileirar_omie() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_contrato record;
  v_origem   text;
  v_saiu     boolean;
BEGIN
  -- Mesma regra do calcular_mrr_cliente: estes tipos nao entram no MRR sincronizado.
  IF NEW.tipo IN ('venda_avulsa','churn','reactivation') THEN RETURN NULL; END IF;

  -- Saiu do MRR agora: inativado, estornado ou encerrado. É alteração de valor
  -- no contrato tanto quanto a entrada dele foi.
  v_saiu := TG_OP = 'UPDATE' AND (
              (OLD.status = 'ativo'          AND NEW.status IS DISTINCT FROM 'ativo')
           OR (OLD.estornado_por IS NULL     AND NEW.estornado_por IS NOT NULL)
           OR (OLD.encerrado_em  IS NULL     AND NEW.encerrado_em  IS NOT NULL)
          );

  -- Nasceu inativo, ou continua inativo sem mudar nada: não há o que sincronizar.
  IF NEW.status IS DISTINCT FROM 'ativo' AND NOT coalesce(v_saiu, false) THEN
    RETURN NULL;
  END IF;

  v_origem := 'movimento_' || NEW.tipo::text;

  IF NEW.contrato_id IS NOT NULL THEN
    -- reajuste grava contrato_id explicitamente
    PERFORM public.enfileirar_sync_omie(NEW.contrato_id, v_origem);
  ELSE
    -- upsell/downsell sao gravados so no nivel do cliente
    FOR v_contrato IN
      SELECT c.id FROM contratos c
      WHERE c.cliente_id = NEW.cliente_id
        AND c.tenant_id  = NEW.tenant_id
        AND c.status     = 'ativo'
    LOOP
      PERFORM public.enfileirar_sync_omie(v_contrato.id, v_origem);
    END LOOP;
  END IF;

  RETURN NULL;  -- AFTER trigger: retorno ignorado
END;
$$;

ALTER FUNCTION public.trg_movimento_mrr_enfileirar_omie() OWNER TO postgres;

-- `encerrado_em` também precisa estar na lista de colunas escutadas: é por ele
-- que um movimento recorrente sai do saldo, e sem isso a baixa não chegaria ao
-- Omie.
DROP TRIGGER IF EXISTS movimento_mrr_enfileirar_omie ON public.movimentos_mrr;
CREATE TRIGGER movimento_mrr_enfileirar_omie
  AFTER INSERT OR UPDATE OF status, valor_delta, estornado_por, estorno_de, encerrado_em
  ON public.movimentos_mrr
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_movimento_mrr_enfileirar_omie();
