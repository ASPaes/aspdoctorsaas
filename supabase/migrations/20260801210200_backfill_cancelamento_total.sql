-- Backfill dos cancelamentos feitos antes da regra "cancelou tudo -> zera tudo".
--
-- Depende de 20260801210000 (encerrado_em) e 20260801210100 (RPCs).
--
-- A mudança de fórmula em fn_mrr_cliente_em já zera 830 dos 858 cancelados.
-- Sobram 28, em dois formatos:
--   (a) 8  — produto nunca foi inativado (contrato implícito, sem contrato_itens)
--   (b) 20 — movimento recorrente solto nunca foi baixado
-- E nos 20 de (b) o churn gravado foi só o valor do contrato, então o total de
-- cancelamento do dashboard está subnotificado em R$ 332,70.
--
-- SEGURANÇA
-- - clientes.mensalidade NÃO é tocada (regra: cancelamento não zera valores).
-- - encerrado_em não dispara movimento_mrr_enfileirar_omie (trigger só escuta
--   status/valor_delta/estorno*), e o churn é ignorado por esse trigger na
--   primeira linha. Nada vai para a fila do Omie.
-- - O saldo da véspera é estável: produto passa de ativo=true para
--   data_cancelamento > véspera, e movimento de encerrado_em NULL para
--   encerrado_em > véspera. Os dois seguem contando. Por isso o churn corrigido
--   pode ser calculado antes ou depois — o backfill é ordem-independente.

BEGIN;

-- ---------------------------------------------------------------------------
-- (a) Produtos e módulos que ficaram ativos em cliente cancelado
-- ---------------------------------------------------------------------------

CREATE TEMP TABLE _bf_produtos ON COMMIT DROP AS
SELECT cp.id AS cp_id, cp.cliente_id, cp.vlr_mensal,
       COALESCE(c.data_cancelamento,
                (SELECT max(ct.cancelado_em) FROM contratos ct
                  WHERE ct.cliente_id = c.id AND ct.status = 'cancelado')) AS dt
FROM cliente_produtos cp
JOIN clientes c ON c.id = cp.cliente_id
WHERE c.cancelado = true AND cp.ativo = true;

SELECT set_config('doctorsaas.skip_valor_sync', 'true', true);

UPDATE cliente_produto_modulos m
   SET ativo = false, data_inativacao = b.dt
  FROM _bf_produtos b
 WHERE m.cliente_produto_id = b.cp_id AND m.ativo = true;

UPDATE cliente_produtos cp
   SET ativo = false, data_cancelamento = b.dt
  FROM _bf_produtos b
 WHERE cp.id = b.cp_id;

SELECT set_config('doctorsaas.skip_valor_sync', '', true);

-- ---------------------------------------------------------------------------
-- (b) Movimentos recorrentes que ficaram vivos em cliente cancelado
-- ---------------------------------------------------------------------------

CREATE TEMP TABLE _bf_movs ON COMMIT DROP AS
SELECT m.id AS mov_id, m.cliente_id, m.valor_delta,
       COALESCE(c.data_cancelamento,
                (SELECT max(ct.cancelado_em) FROM contratos ct
                  WHERE ct.cliente_id = c.id AND ct.status = 'cancelado')) AS dt,
       (SELECT ct.id FROM contratos ct
         WHERE ct.cliente_id = c.id AND ct.status = 'cancelado'
         ORDER BY ct.cancelado_em DESC NULLS LAST LIMIT 1) AS contrato_id
FROM movimentos_mrr m
JOIN clientes c ON c.id = m.cliente_id
WHERE c.cancelado = true
  AND m.tipo IN ('upsell','cross_sell','downsell','reajuste')
  AND m.status = 'ativo'
  AND m.estornado_por IS NULL AND m.estorno_de IS NULL
  AND m.encerrado_em IS NULL;

UPDATE movimentos_mrr m
   SET encerrado_em = b.dt,
       encerrado_por_contrato_id = b.contrato_id
  FROM _bf_movs b
 WHERE m.id = b.mov_id;

-- ---------------------------------------------------------------------------
-- (c) Churn subnotificado: soma o recorrente que ficou de fora
-- ---------------------------------------------------------------------------
-- Ajusta o ÚLTIMO churn de cada cliente afetado. Só mexe onde o recorrente
-- líquido é diferente de zero, e só em cliente que tem churn no extrato.

-- O marcador na descrição também é a trava de reexecução: rodar de novo não
-- desconta o delta duas vezes.
CREATE TEMP TABLE _bf_churn ON COMMIT DROP AS
WITH falta AS (
  SELECT b.cliente_id, SUM(b.valor_delta) AS delta
  FROM _bf_movs b
  GROUP BY b.cliente_id
  HAVING SUM(b.valor_delta) <> 0
),
alvo AS (
  SELECT DISTINCT ON (m.cliente_id) m.id, f.delta
  FROM movimentos_mrr m
  JOIN falta f ON f.cliente_id = m.cliente_id
  WHERE m.tipo = 'churn' AND m.status = 'ativo'
    AND m.estornado_por IS NULL AND m.estorno_de IS NULL
    AND COALESCE(m.descricao, '') NOT LIKE '%[ajuste 01/08%'
  ORDER BY m.cliente_id, m.data_movimento DESC, m.criado_em DESC
),
upd AS (
  UPDATE movimentos_mrr m
     SET valor_delta = ROUND(m.valor_delta - a.delta, 2),
         descricao = COALESCE(m.descricao, '') || ' [ajuste 01/08: inclui movimento recorrente não baixado]'
    FROM alvo a
   WHERE m.id = a.id
  RETURNING m.id AS mov_id, m.valor_delta
)
SELECT mov_id, valor_delta FROM upd;

-- O card "Histórico de Eventos" da ficha lê contrato_eventos, não o extrato.
-- Sem isto ele continuaria mostrando MRR Cliente: R$ 219,65 num cancelamento
-- de R$ 279,65.
UPDATE contrato_eventos e
   SET mensalidade_cliente_snapshot = ABS(c.valor_delta)
  FROM _bf_churn c
 WHERE e.movimento_mrr_id = c.mov_id
   AND e.acao = 'cancelamento';

COMMIT;
