-- Cliente de evento unico: paga so o setup, nao tem mensalidade nem contrato.
-- A marca existe para os relatorios de recorrencia (clientes ativos, novos,
-- ticket medio, churn de logos) deixarem esse cliente de fora, enquanto o
-- setup continua entrando na Receita de Ativacao pelo movimentos_mrr.
-- Quem grava: fn_intake_proposta (calculadora, comercial.tipo_venda =
-- 'evento_unico'). Cliente de evento que depois fecha mensalidade volta a false.
-- ADD COLUMN com DEFAULT constante nao reescreve a tabela. O lock_timeout faz
-- desistir em 5s em vez de enfileirar todo mundo atras do ALTER; se cair, rode
-- de novo (idempotente).
SET lock_timeout = '5s';
ALTER TABLE public.clientes
  ADD COLUMN IF NOT EXISTS evento_unico boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.clientes.evento_unico IS
  'Cliente de evento unico: so setup, sem mensalidade e sem contrato. Fica fora das contagens de recorrencia.';
