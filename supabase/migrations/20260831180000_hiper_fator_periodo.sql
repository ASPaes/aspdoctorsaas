-- O portal informa valor MENSAL. O contrato daqui pode ser de outro período, e
-- comparar os dois crus produzia divergência falsa: um contrato anual aparecia
-- como "R$ 574,90 → R$ 51,09", que parece um abismo quando 51,09 × 12 = 613,08.
--
-- custo_hiper e mrr_hiper continuam MENSAIS de propósito — é o que a Visão geral
-- soma, e anualizar dois clientes distorceria o custo da carteira inteira. Quem
-- carrega o período é o fator, usado na comparação e na gravação.
--
-- Semanal fica de fora: mês não é número inteiro de semanas e 4,33 seria chute.

alter table public.reconciliacao_hiper
  add column if not exists fator_periodo integer;

comment on column public.reconciliacao_hiper.fator_periodo is
  'Quantos meses do portal cabem em um período do contrato daqui: 1 mensal, 6 semestral, 12 anual. NULL = recorrência sem conversão segura (semanal) — sem comparação de valor e sem gravação automática.';

create or replace function public.hiper_fator_periodo(p_recorrencia text)
returns integer language sql immutable parallel safe as $$
  select case coalesce(p_recorrencia, 'mensal')
           when 'mensal'    then 1
           when 'semestral' then 6
           when 'anual'     then 12
           else null            -- semanal e o que vier depois: sem chute
         end;
$$;

revoke all on function public.hiper_fator_periodo(text) from public;
grant execute on function public.hiper_fator_periodo(text) to authenticated, service_role;
