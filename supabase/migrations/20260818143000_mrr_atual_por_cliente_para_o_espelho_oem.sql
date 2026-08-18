-- ============================================================================
-- MRR atual por cliente, em lote — para o espelho do OEM parar de mostrar a base
--
-- O QUE ESTAVA ERRADO (18/08/2026)
--   A aba Integrações › OEM › Custos mostrava, em "Mensalidade DS", o valor de
--   `clientes.mensalidade` — que é o **MRR Base**. O valor certo é o **MRR
--   Atual**: base mais os movimentos vigentes (upsell, cross-sell, downsell,
--   reajuste). No TROPEIRÃO DO JUCÃO a diferença é gritante: base R$ 3.113,84,
--   atual R$ 1.869,99, porque ele tem um downsell de R$ 1.568,31 e um reajuste
--   de R$ 324,46. O markup saía 12,07 quando o real é 7,25.
--
--   Não era só a aba Custos: `reconciliacao_oem.mensalidade_ds` alimenta também
--   a aba Margem (como receita), o card de licenças na ficha do cliente e a
--   janela de escolher candidato. Os quatro liam a base. Medido: das 1.063
--   clientes vivos da conta, **359 têm MRR atual diferente do base**, e a soma
--   sai R$ 415.572,16 contra R$ 425.705,94.
--
-- POR QUE UMA FUNÇÃO NOVA
--   A `fn_mrr_cliente_em` já é a fonte canônica do saldo e devolve exatamente o
--   número que a ficha mostra — mas é UM cliente por chamada. A edge function do
--   espelho precisa dos 1.063 de uma vez; seriam 1.063 idas ao banco.
--
--   Esta aqui não recalcula nada: ela CHAMA a canônica por linha, dentro do
--   banco. Duplicar a regra do MRR num segundo lugar é exatamente como as duas
--   bases passam a discordar.
--
--   Devolve um objeto jsonb (id → valor) em vez de um conjunto de linhas de
--   propósito: RPC que devolve linhas é cortada em 1000 pelo PostgREST, sem
--   avisar, e a conta sairia faltando cliente.
--
-- CANCELADO MANTÉM O VALOR HISTÓRICO
--   Regra do projeto: cancelamento não zera mensalidade. Para cliente cancelado
--   devolve `clientes.mensalidade` como está — o saldo dele hoje é zero, e
--   gravar zero apagaria o histórico que a tela usa para explicar a baixa.
--
-- Medido: 1.063 clientes em ~7s. Roda a cada 6h, junto com o espelho.
-- ============================================================================

create or replace function public.fn_mrr_por_cliente_em(
  p_tenant uuid,
  p_data   date default current_date
)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $fn$
  select coalesce(jsonb_object_agg(x.id::text, x.mrr), '{}'::jsonb)
    from (
      select c.id,
             case
               when coalesce(c.cancelado, false) then c.mensalidade
               else public.fn_mrr_cliente_em(p_tenant, c.id, p_data)
             end as mrr
        from public.clientes c
       where c.tenant_id = p_tenant
    ) x
$fn$;

-- SÓ o service_role. A função é SECURITY DEFINER e recebe o tenant por
-- parâmetro: liberada para `authenticated`, qualquer usuário logado leria o
-- faturamento de outra empresa passando o id dela. Quem chama é a edge function
-- do espelho, com a chave de serviço.
revoke all on function public.fn_mrr_por_cliente_em(uuid, date) from public;
revoke all on function public.fn_mrr_por_cliente_em(uuid, date) from anon;
revoke all on function public.fn_mrr_por_cliente_em(uuid, date) from authenticated;
grant execute on function public.fn_mrr_por_cliente_em(uuid, date) to service_role;

-- ---------------------------------------------------------------------------
-- CONFERÊNCIA (só leitura)
--
--   -- o TROPEIRÃO tem que sair 1869.99, e não 3113.84:
--   select public.fn_mrr_por_cliente_em('955178ba-b367-498d-8443-cc5b7d1ee163')
--          -> (select id::text from public.clientes where cnpj_digits = '46892849000118');
--
--   -- quantos clientes mudam de valor com a troca:
--   select count(*) from public.clientes c
--    where c.tenant_id = '955178ba-b367-498d-8443-cc5b7d1ee163'
--      and not c.cancelado
--      and public.fn_mrr_cliente_em(c.tenant_id, c.id, current_date)
--          is distinct from c.mensalidade;
-- ---------------------------------------------------------------------------
