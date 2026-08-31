-- O valor guardado no contrato é MENSAL, sempre — inclusive num contrato anual
-- ou semestral, onde a recorrência descreve a cadência da cobrança e não o
-- valor. É o que o resto do sistema já assume: fn_mrr_cliente_em,
-- calcular_mrr_cliente, get_mrr_bridge e get_mrr_monthly_snapshots somam
-- vlr_mensal direto, sem olhar recorrência.
--
-- O valor do ano passa a ser CALCULADO. Coluna gerada, não campo digitado:
-- é assim que ele não pode divergir do mensal.
--
-- Decisão do dono em 31/08/2026, depois de a integração Hiper mostrar dois
-- contratos anuais da ASP que discordavam entre si — um guardava o total do
-- ano, o outro nem isso.

alter table public.cliente_produtos
  add column if not exists vlr_anual numeric
    generated always as (coalesce(vlr_mensal, 0) * 12) stored,
  add column if not exists vlr_custo_anual numeric
    generated always as (coalesce(vlr_custo, 0) * 12) stored;

comment on column public.cliente_produtos.vlr_anual is
  'Doze vezes a mensalidade. Calculado, nunca digitado — não pode divergir do mensal.';
comment on column public.cliente_produtos.vlr_custo_anual is
  'Doze vezes o custo mensal. Calculado, nunca digitado.';

-- A reconciliação volta a comparar mês contra mês: era o fator que estava
-- sobrando, não o valor. O que a linha ganha é a recorrência do contrato, como
-- CONTEXTO — ela explica por que um valor pode estar digitado como total do ano.
alter table public.reconciliacao_hiper
  drop column if exists fator_periodo,
  add  column if not exists recorrencia_ds text;

comment on column public.reconciliacao_hiper.recorrencia_ds is
  'Cadência de cobrança do contrato daqui. Não altera a comparação — o valor é mensal dos dois lados —, mas explica na tela um contrato anual cujo campo ficou com o total do ano.';

drop function if exists public.hiper_fator_periodo(text);
