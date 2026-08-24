-- ============================================================================
-- A aba do OEM é POR UNIDADE, e o quadro de mudança de preço não era
--
-- REGRA (Alexandre, 23/08/2026): cada conta do OEM pertence a UMA unidade base,
-- e a aba mostra só o que é daquela unidade. Vale para qualquer tenant e para
-- todas as abas — Módulos, Visão geral, Custos, Divergências. Hoje só a Digi
-- Office tem integração ativa; quando a Digi Up entrar, uma não pode ver o
-- número da outra.
--
-- O FURO
-- Tudo na aba já era por conta: a reconciliação, a grade de preços, os vínculos
-- de produto, a contagem de contratos. A view de mudanças de preço, criada hoje
-- mais cedo, ficou por TENANT — ela sai de `cliente_produto_modulo_eventos`, que
-- não tem coluna de conta nem de unidade. Com duas contas conectadas, a Digi Up
-- veria o reajuste que atingiu clientes da Digi Office.
--
-- O CONSERTO
-- A unidade vem do CLIENTE (`clientes.unidade_base_id`), pelo caminho que já é
-- o padrão do projeto: evento -> cliente_produtos -> clientes. Ela entra na
-- view e vira mais uma dimensão do agrupamento, então cada conta soma só os
-- seus clientes.
--
-- DROP e CREATE, não CREATE OR REPLACE: a coluna nova entra no meio da lista, e
-- o REPLACE só aceita colunas acrescentadas no fim. Nada depende desta view
-- além da aba — ela nasceu hoje.
-- ============================================================================

begin;

drop view if exists public.v_oem_mudanca_custo_modulo;

create view public.v_oem_mudanca_custo_modulo
  with (security_invoker = true) as
select
  e.tenant_id,
  cl.unidade_base_id,
  e.modulo_id,
  e.modulo_nome,
  (e.created_at at time zone 'America/Sao_Paulo')::date as dia,
  e.vlr_custo_anterior                                  as valor_anterior,
  e.vlr_custo                                           as valor_novo,
  count(*)                                              as clientes,
  -- O que o aumento pesa por mês: a diferença vale por unidade de licença, e o
  -- cliente pode ter 8 do mesmo módulo.
  sum((coalesce(e.vlr_custo, 0) - coalesce(e.vlr_custo_anterior, 0))
      * greatest(coalesce(e.quantidade, 1), 1))         as variacao_mensal,
  max(e.created_at)                                     as ocorrido_em
from public.cliente_produto_modulo_eventos e
join public.cliente_produtos cp on cp.id = e.cliente_produto_id
join public.clientes         cl on cl.id = cp.cliente_id
where e.acao = 'preco'
group by 1, 2, 3, 4, 5, 6, 7;

comment on view public.v_oem_mudanca_custo_modulo is
  'Reajustes de custo que o OEM aplicou, por módulo, valor, dia e UNIDADE do cliente. A aba filtra pela unidade da conta conectada: cada conta vê só o que mexeu nos clientes dela.';

grant select on public.v_oem_mudanca_custo_modulo to authenticated, service_role;

commit;

-- ---------------------------------------------------------------------------
-- CONFERÊNCIA (só leitura). Zero linhas até o parceiro mexer no primeiro preço:
--   select unidade_base_id, modulo_nome, valor_anterior, valor_novo, clientes
--     from public.v_oem_mudanca_custo_modulo order by ocorrido_em desc;
-- ---------------------------------------------------------------------------
