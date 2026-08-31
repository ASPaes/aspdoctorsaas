-- O valor do portal pode ser do MÊS ou do PERÍODO INTEIRO, e o portal não diz
-- qual. O plano de quem paga anual continua escrito "Mensal".
--
-- Os dois clientes anuais da ASP se comportam de forma OPOSTA lá:
--   351 Fernanda  — 12 lançamentos mensais de R$ 92,76   → valor do MÊS
--   335 Alcidinei — 1 lançamento de R$ 1.798,00 em março → valor do ANO
--
-- Então a recorrência do contrato sozinha não decide o divisor. Decisão do dono
-- (31/08/2026): só divide quando as DUAS coisas batem — contrato não-mensal
-- AQUI e cobrança esparsa LÁ.
alter table public.hiper_espelho_cadastro
  add column if not exists ult_lancamentos_12m integer;

comment on column public.hiper_espelho_cadastro.ult_lancamentos_12m is
  'Lançamentos do cliente no extrato nos últimos 12 meses. Único sinal de que a cobrança não é mensal — o portal não tem campo de periodicidade.';

alter table public.reconciliacao_hiper
  add column if not exists divisor_periodo integer not null default 1;

comment on column public.reconciliacao_hiper.divisor_periodo is
  'Quantos meses o valor do portal cobre. 1 = mensal. 12 num contrato anual cujo portal cobra de uma vez — aí o valor do mês é o do portal dividido por ele.';
