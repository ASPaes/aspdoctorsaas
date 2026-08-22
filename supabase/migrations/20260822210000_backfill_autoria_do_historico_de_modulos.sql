-- Backfill: devolver o autor aos eventos de módulo que a fila do OEM escreveu.
--
-- Complemento de `20260822200000_historico_de_modulos_registra_quem_pediu`, que
-- conserta daqui para a frente. Estes já estavam gravados sem dono e a tela os
-- atribuía à "Sincronização OEM".
--
-- O casamento é por tempo, e por isso é estreito de propósito: o evento tem de
-- ter caído DENTRO da janela de uma única linha da fila do mesmo produto do
-- cliente — de `enfileirado_em` (com 1s de folga para o relógio) até 2 min
-- depois de `processado_em`. Duas linhas candidatas para o mesmo evento? Não
-- mexe. Chutar autoria é pior do que não ter autoria.
--
-- O que NÃO é tocado, e não deve ser: os ~4.086 eventos da carga do espelho de
-- 19/08. Aqueles não têm dono mesmo — foi a máquina, e "Sincronização OEM" é a
-- resposta certa para eles.
--
-- Medido em 22/08/2026 contra a produção antes de escrever: 4.111 eventos no
-- total, 4.098 sem autor, e exatamente **5** casam com uma única linha da fila
-- — todos do mesmo usuário. A primeira linha da fila (21/08 13:44) tem
-- `usuario_id` nulo, porque foi enfileirada por script e não pela tela; o
-- evento dela continua sem autor, como deve.
--
-- Statement único: no SQL Editor cada statement pode cair numa conexão
-- diferente do pooler, e uma tabela temporária entre eles não sobreviveria.

WITH candidato AS (
  SELECT
    e.id                                        AS evento_id,
    -- Uma linha só, ou nenhuma. count() > 1 é ambiguidade e sai fora abaixo.
    count(*)                                    AS quantas,
    min(f.usuario_id::text)::uuid               AS usuario_id
  FROM public.cliente_produto_modulo_eventos e
  JOIN public.oem_sync_fila f
    ON f.cliente_produto_id = e.cliente_produto_id
   AND f.usuario_id     IS NOT NULL
   AND f.processado_em  IS NOT NULL
   AND e.created_at >= f.enfileirado_em - interval '1 second'
   AND e.created_at <= f.processado_em  + interval '2 minutes'
  WHERE e.usuario_id IS NULL
  GROUP BY e.id
),
alvo AS (
  SELECT c.evento_id, c.usuario_id, f.nome AS usuario_nome
    FROM candidato c
    LEFT JOIN public.profiles p     ON p.user_id = c.usuario_id
    LEFT JOIN public.funcionarios f ON f.id = p.funcionario_id
   WHERE c.quantas = 1
)
UPDATE public.cliente_produto_modulo_eventos e
   SET usuario_id   = a.usuario_id,
       usuario_nome = a.usuario_nome
  FROM alvo a
 WHERE e.id = a.evento_id
   AND e.usuario_id IS NULL
RETURNING e.created_at, e.acao, e.modulo_nome, e.usuario_nome;
