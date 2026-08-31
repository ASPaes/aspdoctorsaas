-- O portal tem DUAS verdades sobre dinheiro, e eu só estava usando uma.
--
--  • extrato mensal — o que foi faturado num mês fechado. É o que a API mandava.
--  • cadastro da conta — os valores VIGENTES. É o que o Cliente 360 do portal
--    mostra, e o que se compara com um contrato de hoje.
--
-- A conta cujo último extrato não é o do lote global voltava com tudo nulo (26
-- das 622 ativas da ASP), e a API ainda convertia nulo em zero: virava "custo
-- R$ 0,00", divergência falsa, e teria zerado R$ 2.317 de custo real se
-- aplicada. O cadastro dela, porém, sempre teve mensalidade e custo.
alter table public.hiper_espelho_cadastro
  add column if not exists cad_mensalidade  numeric,
  add column if not exists cad_custo        numeric,
  add column if not exists cad_repasse      numeric,
  add column if not exists cad_taxa_central numeric;

comment on column public.hiper_espelho_cadastro.cad_custo is
  'Custo vigente da conta no portal (end_clients.custo_cliente). Em Central de Cobrança ele JÁ inclui a taxa da central — mensalidade menos repasse. Preferido ao extrato, que é do último mês fechado.';
