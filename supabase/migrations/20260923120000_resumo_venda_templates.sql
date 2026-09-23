-- ============================================================================
-- Resumo da venda — 23/09/2026
--
-- A aba "Resumo da venda" do ticket de onboarding só existia para jornada
-- importada do sistema comercial (proposta_payload não nulo): 44 das 342
-- jornadas. As outras 298 não tinham onde registrar o que foi vendido.
--
-- Esta migration cria o lugar: um texto livre na jornada e templates por
-- pipeline para o vendedor não começar de uma folha em branco.
-- ============================================================================
begin;

create table if not exists public.onboarding_sale_summary_templates (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  pipeline_id uuid references public.onboarding_pipelines(id) on delete cascade,
  nome        text not null,
  corpo       text not null default '',
  ativo       boolean not null default true,
  "position"  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.onboarding_sale_summary_templates is
  'Textos-modelo do resumo da venda, oferecidos no ticket conforme o pipeline de onboarding da jornada.';
comment on column public.onboarding_sale_summary_templates.pipeline_id is
  'NULL = template serve a qualquer pipeline.';
comment on column public.onboarding_sale_summary_templates.corpo is
  'Texto puro inserido no campo de observação. Não é vínculo vivo: editar aqui não muda o que já foi escrito numa jornada.';

create index if not exists idx_onb_sale_tpl_tenant
  on public.onboarding_sale_summary_templates (tenant_id, pipeline_id, ativo, "position");

alter table public.onboarding_sale_summary_templates enable row level security;

drop policy if exists onboarding_sale_summary_templates_sel on public.onboarding_sale_summary_templates;
create policy onboarding_sale_summary_templates_sel
  on public.onboarding_sale_summary_templates for select to authenticated
  using (public.can_access_tenant_row(tenant_id));
drop policy if exists onboarding_sale_summary_templates_ins on public.onboarding_sale_summary_templates;
create policy onboarding_sale_summary_templates_ins
  on public.onboarding_sale_summary_templates for insert to authenticated
  with check (public.can_access_tenant_row(tenant_id));
drop policy if exists onboarding_sale_summary_templates_upd on public.onboarding_sale_summary_templates;
create policy onboarding_sale_summary_templates_upd
  on public.onboarding_sale_summary_templates for update to authenticated
  using (public.can_access_tenant_row(tenant_id))
  with check (public.can_access_tenant_row(tenant_id));
drop policy if exists onboarding_sale_summary_templates_del on public.onboarding_sale_summary_templates;
create policy onboarding_sale_summary_templates_del
  on public.onboarding_sale_summary_templates for delete to authenticated
  using (public.can_access_tenant_row(tenant_id));

-- As tabelas irmãs de configuração herdaram grant de `anon` do default do
-- schema e sobrevivem só pela RLS. Esta não: uma camada a menos para errar.
revoke all on public.onboarding_sale_summary_templates from anon;
grant select, insert, update, delete
  on public.onboarding_sale_summary_templates to authenticated, service_role;

drop trigger if exists trg_onb_sale_tpl_upd on public.onboarding_sale_summary_templates;
create trigger trg_onb_sale_tpl_upd
  before update on public.onboarding_sale_summary_templates
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------------ jornada
-- `resumo_venda_updated_by` guarda auth.uid() e vai SEM FK, como o
-- responsavel_user_id desta mesma tabela.
alter table public.onboarding_journeys
  add column if not exists resumo_venda_texto text,
  add column if not exists resumo_venda_template_id uuid
      references public.onboarding_sale_summary_templates(id) on delete set null,
  add column if not exists resumo_venda_updated_at timestamptz,
  add column if not exists resumo_venda_updated_by uuid;

comment on column public.onboarding_journeys.resumo_venda_texto is
  'Resumo da venda escrito à mão. Só usado quando proposta_payload é nulo.';

-- ------------------------------------------------------------------- RBAC
insert into public.resources
  (key, module, module_id, label, description, where_it_appears, parent_key, display_order,
   is_navigation, hidden, nivel, secao, acoes)
select v.key, m.nome, v.module_id, v.label, v.descr, v.caminho, v.pai, v.ordem,
       false, false, v.nivel, v.secao, v.acoes::text[]
from (values
 ('onb.cfg.resumo_venda','onboarding','Aba Resumo da venda',
  'Templates de resumo da venda oferecidos no ticket, por pipeline.',
  'Implantação › Configuração › Resumo da venda',null,490,3,'config','{view,insert,update,delete}')
) as v(key, module_id, label, descr, caminho, pai, ordem, nivel, secao, acoes)
join public.permission_modules m on m.id = v.module_id
on conflict (key) do nothing;

update public.resources
   set grupo = 'Configuração', grupo_ordem = 30, parent_key = null
 where key = 'onb.cfg.resumo_venda';

-- Nasce com o mesmo acesso que o grupo já tem em Pipelines & Etapas: a aba nova
-- não pode tirar nem dar acesso que ninguém decidiu.
insert into public.group_permissions (group_id, resource_key, can_view, can_insert, can_update, can_delete)
select g.id, 'onb.cfg.resumo_venda',
       coalesce(gp.can_view, trp.can_view, rp.can_view, false),
       false, false, false
from public.permission_groups g
left join public.group_permissions gp
  on gp.group_id = g.id and gp.resource_key = 'onb.cfg.pipelines'
left join public.tenant_role_permissions trp
  on trp.tenant_id = g.tenant_id and trp.role = g.nivel_base and trp.resource_key = 'onb.cfg.pipelines'
left join public.role_permissions rp
  on rp.role = g.nivel_base and rp.resource_key = 'onb.cfg.pipelines'
on conflict (group_id, resource_key) do nothing;

commit;
