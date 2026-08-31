-- O último extrato DO PRÓPRIO cliente, seja de que mês for.
--
-- Os campos do mês vêm da view do portal, que junta o extrato de UM mês só — o
-- último fechado da carteira. Quem não teve lançamento naquele mês voltava nulo
-- mesmo tendo faturamento: 9 contas de Central de Leads e 14 de Central de
-- Cobrança da ASP. O painel do portal mostra o último de cada um, e é esse o
-- número que a conferência precisa.
alter table public.hiper_espelho_cadastro
  add column if not exists ult_mes         date,
  add column if not exists ult_mensalidade numeric,
  add column if not exists ult_custo       numeric,
  add column if not exists ult_a_pagar     numeric,
  add column if not exists ult_a_receber   numeric;

comment on column public.hiper_espelho_cadastro.ult_mes is
  'Mês do último extrato desta conta. Pode ser anterior ao lote da carteira — é justamente esse o caso que fazia o valor chegar zerado.';
