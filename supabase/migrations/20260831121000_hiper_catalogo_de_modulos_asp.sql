-- Troca o catálogo de módulos de Hiper Gestão e Hiper Mini (tenant ASP) pelo
-- que a Hiper realmente COBRA.
--
-- Os 47 que existiam eram lista de FUNCIONALIDADES ("Gestão de Estoque",
-- "Cadastro de Clientes", "Contas a Receber"), todos com custo e venda zerados,
-- e 45 deles nunca foram usados. Os 14 apps do portal são os que geram custo.
-- Decisão do dono em 31/08/2026: apagar os sem uso e recriar pelo portal.
--
-- O custo sai da MODA do que as contas pagam hoje, calculada do próprio espelho
-- — não de uma tabela digitada, que foi como os 47 acabaram todos em zero. App
-- gratuito em 100% das contas entra com zero, que é o valor certo dele.
--
-- Módulo do Hiper NÃO tem preço de venda: vlr_venda fica 0 de propósito.

do $$
declare
  v_tenant  uuid := 'a0000000-0000-0000-0000-000000000001';
  v_apagados integer;
  v_criados  integer;
  v_vinculos integer;
begin
  -- 1. Fora os que ninguém usa. As 4 FKs são NO ACTION, então qualquer módulo
  --    referenciado faria o DELETE falhar; o `not exists` tira essa chance e
  --    deixa explícito o que está sendo preservado.
  delete from public.produto_modulos pm
  where pm.tenant_id = v_tenant
    and pm.produto_id in (3, 4)
    and not exists (select 1 from public.cliente_produto_modulos x where x.modulo_id = pm.id)
    and not exists (select 1 from public.contrato_itens x where x.modulo_id = pm.id)
    and not exists (select 1 from public.onboarding_journey_modules x where x.produto_modulo_id = pm.id)
    and not exists (select 1 from public.oem_sync_fila x where x.modulo_catalogo_id = pm.id);
  get diagnostics v_apagados = row_count;

  -- 2. Os 14 apps do portal, em CADA um dos dois produtos. O mesmo app existe
  --    nos dois planos e o módulo daqui pertence a um produto só.
  with custo as (
    select m.app_nome,
           coalesce(mode() within group (order by m.custo) filter (where m.custo > 0), 0) as vlr
    from public.hiper_espelho_modulo m
    where m.tenant_id = v_tenant and m.ativo
    group by m.app_nome
  ),
  alvo as (select unnest(array[3, 4]) as produto_id)
  insert into public.produto_modulos (tenant_id, produto_id, nome, ativo, vlr_custo, vlr_venda)
  select v_tenant, a.produto_id, c.app_nome, true, c.vlr, 0
  from custo c cross join alvo a
  where not exists (
    select 1 from public.produto_modulos pm
    where pm.tenant_id = v_tenant and pm.produto_id = a.produto_id and pm.nome = c.app_nome
  );
  get diagnostics v_criados = row_count;

  -- 3. Já deixa vinculado: o nome vem do portal, então não há o que adivinhar.
  --    Continua editável na aba Módulos.
  insert into public.hiper_catalogo_vinculo (tenant_id, tipo, chave, modulo_id, produto_id)
  select v_tenant, 'modulo', pm.nome, pm.id, pm.produto_id
  from public.produto_modulos pm
  where pm.tenant_id = v_tenant and pm.produto_id in (3, 4)
    and exists (
      select 1 from public.hiper_espelho_modulo m
      where m.tenant_id = v_tenant and m.app_nome = pm.nome
    )
  on conflict do nothing;
  get diagnostics v_vinculos = row_count;

  raise notice 'apagados=% criados=% vinculos=%', v_apagados, v_criados, v_vinculos;
end $$;
