-- O plano da conta implica módulos que o portal NÃO lista como addon.
--
-- Regra do dono (31/08/2026): o PLANO é o produto — "Hiper Gestão" e "Hiper
-- Mini" são produtos, não módulos. O que o plano gera de módulo é o que vem dos
-- contadores da conta: 1 caixa no portal = 1 módulo Hiper Caixa. "Hiper Gestão
-- (Retaguarda Cloud)" é outro módulo, não a base.
--
-- Custo: o portal informa o total da conta e o custo de cada addon, e não separa
-- o que é caixa. O módulo de plano entra com ZERO e a sobra continua no produto
-- — a soma dos módulos nunca passa do que a Hiper cobra, e nenhum número é
-- inventado.

create table if not exists public.hiper_plano_modulo (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null,
  plano            text not null,          -- plano_nome como vem do portal
  modulo_id        uuid not null,
  produto_id       bigint not null,        -- dono do módulo; casa com o contrato do cliente
  quantidade_de    text not null default 'fixo'
                     check (quantidade_de in ('fixo','qt_caixas','qt_usuarios','qt_filiais')),
  quantidade_fixa  integer not null default 1,
  criado_em        timestamptz not null default now(),
  criado_por       uuid
);
create unique index if not exists hiper_plano_modulo_unico
  on public.hiper_plano_modulo (tenant_id, plano, modulo_id);
create index if not exists hiper_plano_modulo_plano
  on public.hiper_plano_modulo (tenant_id, plano);

comment on table public.hiper_plano_modulo is
  'Módulos que o plano implica e o portal não lista: a quantidade sai de um contador da conta (qt_caixas, qt_usuarios, qt_filiais) ou é fixa. Editável por tenant porque a regra vale "na maioria" — e maioria precisa de exceção.';

alter table public.hiper_plano_modulo enable row level security;

create policy hiper_plano_modulo_select on public.hiper_plano_modulo for select to authenticated
using ((select public.is_super_admin())
    or (tenant_id = (select public.current_tenant_id()) and (select public.is_tenant_admin_or_head())));

create policy hiper_plano_modulo_insert on public.hiper_plano_modulo for insert to authenticated
with check ((select public.is_super_admin())
    or ((select public.is_tenant_active_member()) and tenant_id = (select public.current_tenant_id())
        and (select public.is_tenant_admin())));

create policy hiper_plano_modulo_update on public.hiper_plano_modulo for update to authenticated
using ((select public.is_super_admin())
    or ((select public.is_tenant_active_member()) and tenant_id = (select public.current_tenant_id())
        and (select public.is_tenant_admin())));

create policy hiper_plano_modulo_delete on public.hiper_plano_modulo for delete to authenticated
using ((select public.is_super_admin())
    or ((select public.is_tenant_active_member()) and tenant_id = (select public.current_tenant_id())
        and (select public.is_tenant_admin())));

-- ── seed da ASP ─────────────────────────────────────────────────────────────
do $$
declare
  v_tenant uuid := 'a0000000-0000-0000-0000-000000000001';
  v_caixa_gestao uuid;
  v_caixa_mini   uuid;
begin
  -- O Caixa de Hiper Gestão já existe e tem contrato apontando para ele.
  select id into v_caixa_gestao from public.produto_modulos
   where tenant_id = v_tenant and produto_id = 3 and nome = 'Hiper Caixa (PDV / Frente de Caixa)';

  -- O Hiper Mini não tinha o dele. Custo zero: quem carrega o valor é o produto.
  insert into public.produto_modulos (tenant_id, produto_id, nome, ativo, vlr_custo, vlr_venda)
  select v_tenant, 4, 'Hiper Caixa (PDV / Frente de Caixa)', true, 0, 0
  where not exists (
    select 1 from public.produto_modulos
    where tenant_id = v_tenant and produto_id = 4 and nome = 'Hiper Caixa (PDV / Frente de Caixa)');

  select id into v_caixa_mini from public.produto_modulos
   where tenant_id = v_tenant and produto_id = 4 and nome = 'Hiper Caixa (PDV / Frente de Caixa)';

  insert into public.hiper_plano_modulo (tenant_id, plano, modulo_id, produto_id, quantidade_de)
  values
    (v_tenant, 'Hiper Gestão - Mensal', v_caixa_gestao, 3, 'qt_caixas'),
    (v_tenant, 'Hiper Gestão - Anual',  v_caixa_gestao, 3, 'qt_caixas'),
    (v_tenant, 'Hiper Mini - Mensal',   v_caixa_mini,   4, 'qt_caixas'),
    (v_tenant, 'Hiper Mini - Anual',    v_caixa_mini,   4, 'qt_caixas')
  on conflict (tenant_id, plano, modulo_id) do nothing;
end $$;
