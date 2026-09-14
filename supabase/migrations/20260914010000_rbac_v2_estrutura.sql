-- ============================================================================
-- RBAC v2 — Parte 1 de 3: ESTRUTURA
-- Grupos criáveis por tenant + nível de controle por módulo.
--
-- GARANTIA DESTA MIGRATION: nenhuma permissão resolvida muda de valor.
-- Tudo aqui é aditivo e a flag `rbac_v2_enabled` nasce FALSE em todos os tenants.
-- Referência: docs/rbac/RBAC_DEVELOPMENT_PLAN.md (D1–D10, seção 5-A)
-- ============================================================================
begin;

-- ---------------------------------------------------------------- flag (C1)
alter table public.tenants
  add column if not exists rbac_v2_enabled boolean not null default false;

comment on column public.tenants.rbac_v2_enabled is
  'Liga o motor de grupos (RBAC v2). Separada de rbac_enabled de proposito: aquela diz se o tenant usa permissoes, esta diz qual motor resolve. Padrao false.';

-- ------------------------------------------------- modulos normalizados (B6)
-- `resources.module` e texto livre com 19 valores distintos e hierarquia
-- embutida na string. Nivel por modulo sobre isso seriam 19 configuracoes,
-- e um recurso novo com o modulo escrito diferente viraria orfao sem nivel.
create table if not exists public.permission_modules (
  id            text primary key,
  nome          text not null,
  descricao     text,
  ordem         integer not null default 100,
  created_at    timestamptz not null default now()
);

insert into public.permission_modules (id, nome, descricao, ordem) values
  ('menu',          'Menu principal',           'Quais itens aparecem no menu lateral.',                      10),
  ('dashboard',     'Dashboard',                'Indicadores de negocio, incluindo faturamento.',             20),
  ('clientes',      'Clientes',                 'Cadastro, contratos, custos e exportacao.',                  30),
  ('financeiro',    'Financeiro',               'MRR, percentuais e despesas.',                               40),
  ('atendimento',   'Atendimento',              'Chat, historico e acoes sobre conversas.',                   50),
  ('configuracoes', 'Configuracoes',            'Cadastros e parametros da operacao.',                        60),
  ('equipe',        'Equipe e seguranca',       'Usuarios, papeis, permissoes e convites.',                   70),
  ('integracoes',   'Integracoes e canais',     'Omie, Hiper, instancias de WhatsApp e IA.',                  80),
  ('dados',         'Dados',                    'Importacao e duplicidades.',                                 90),
  ('super',         'Super admin',              'Visao cross-tenant. Fora do RBAC por desenho (D4).',        100)
on conflict (id) do nothing;

-- ---------------------------------------------- nivel e modulo nos recursos
alter table public.resources
  add column if not exists module_id text references public.permission_modules(id),
  add column if not exists nivel smallint not null default 1;

alter table public.resources
  drop constraint if exists resources_nivel_check;
alter table public.resources
  add constraint resources_nivel_check check (nivel between 1 and 3);

comment on column public.resources.nivel is
  'Em que nivel de controle o recurso aparece. 1=Normal (a tela de hoje), 2=Moderado, 3=Completo.';

-- Mapeamento dos 19 textos livres para os 10 modulos-raiz.
update public.resources set module_id = case
  when key like 'nav.%'                                  then 'menu'
  when key in ('clientes','clientes.custos','clientes.exportar',
               'clientes.modulos','clientes.oem_aprovacao')then 'clientes'
  when key in ('lancamentos','receita_mrr')              then 'financeiro'
  when key in ('cfg.percentuais','cfg.despesas_cac')     then 'financeiro'
  when key like 'dashboard%'                             then 'dashboard'
  when key in ('atendimento_chat','atendimento_filtros','atendimento_transferir',
               'atendimento_grupo_participantes','parametros_atendimento',
               'base_conhecimento')                      then 'atendimento'
  when key in ('cfg.acessos','cfg.permissoes','cfg.seguranca',
               'usuarios_convites','usuarios_roles')     then 'equipe'
  when key in ('cfg.integracoes_omie','cfg.integracoes_hiper',
               'whatsapp_instancias','ia_configuracoes','cfg.ia',
               'cfg.canais','cfg.email','cfg.whatsapp')  then 'integracoes'
  when key in ('cfg.importacao','cfg.duplicidades')      then 'dados'
  when key = 'super_monitor'                             then 'super'
  else 'configuracoes'
end
where module_id is null;

alter table public.resources alter column module_id set not null;

-- Nivel 1 = exatamente o que a tela mostra hoje.
-- (PermissoesPapeisContent.tsx: SCREEN_ONLY filtra nav.*, cfg.* e clientes.custos)
update public.resources set nivel = 1
 where key like 'nav.%' or key like 'cfg.%' or key = 'clientes.custos';

update public.resources set nivel = 2
 where key in ('clientes','clientes.exportar','clientes.modulos','clientes.oem_aprovacao',
               'usuarios_roles','usuarios_convites','whatsapp_instancias',
               'ia_configuracoes','dashboard_operacional','dashboard_conselho',
               'atendimento_chat');

update public.resources set nivel = 3
 where key in ('atendimento_filtros','atendimento_transferir','atendimento_grupo_participantes',
               'parametros_atendimento','base_conhecimento','super_monitor',
               'lancamentos','receita_mrr','dashboard_financeiro','cfg.whatsapp');

-- ------------------------------------------------------ nivel por tenant/modulo
create table if not exists public.tenant_module_levels (
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  module_id   text not null references public.permission_modules(id) on delete cascade,
  nivel       smallint not null default 1 check (nivel between 1 and 3),
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users(id) on delete set null,
  primary key (tenant_id, module_id)
);

-- Todo tenant comeca no nivel 1 em todos os modulos = a tela de hoje.
insert into public.tenant_module_levels (tenant_id, module_id, nivel)
select t.id, m.id, 1 from public.tenants t cross join public.permission_modules m
on conflict do nothing;

-- ------------------------------------------------------------------- grupos
create table if not exists public.permission_groups (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  nome        text not null,
  slug        text not null,
  -- D8: o nivel base mantem `profiles.role` coerente para as 27 funcoes do
  -- banco que leem o papel direto (is_admin_or_head, is_tenant_admin, ...).
  nivel_base  text not null check (nivel_base in ('admin','head','user')),
  is_system   boolean not null default false,
  ordem       integer not null default 100,
  created_at  timestamptz not null default now(),
  created_by  uuid references auth.users(id) on delete set null,
  unique (tenant_id, slug)
);

comment on column public.permission_groups.nivel_base is
  'Papel legado que este grupo representa. Imutavel. E o que mantem funcionando as 27 funcoes que leem profiles.role direto.';

create table if not exists public.group_permissions (
  group_id     uuid not null references public.permission_groups(id) on delete cascade,
  resource_key text not null references public.resources(key) on delete cascade,
  can_view     boolean not null default false,
  can_insert   boolean not null default false,
  can_update   boolean not null default false,
  can_delete   boolean not null default false,
  -- Escopo so e aplicado no nivel 3, e so por policies da F5.
  escopo       text not null default 'todos'
                 check (escopo in ('nenhum','proprio','setor','unidade','todos')),
  updated_at   timestamptz not null default now(),
  updated_by   uuid references auth.users(id) on delete set null,
  primary key (group_id, resource_key)
);

-- D6: um grupo por usuario. A tabela nasce N:N para que virar multi-grupo
-- depois seja mudar a consulta, nao a estrutura.
-- ATENCAO: referencia `profiles`, NAO `auth.users`. Medido em 13/09/2026:
-- producao tem 6 profiles cujo user_id nao existe em auth.users. Com FK para
-- auth.users esta migration FALHA em producao.
create table if not exists public.user_groups (
  user_id    uuid not null references public.profiles(user_id) on delete cascade,
  group_id   uuid not null references public.permission_groups(id) on delete cascade,
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, group_id)
);
create unique index if not exists uq_user_groups_um_por_usuario
  on public.user_groups (user_id);           -- D6; derrubar este indice libera multi-grupo
create index if not exists idx_user_groups_group on public.user_groups (group_id);

-- --------------------------------------------------------- auditoria (B4)
-- `permission_audit.role` e text NOT NULL com 220 registros historicos.
-- Gravar o slug do grupo ali misturaria duas coisas na mesma coluna.
alter table public.permission_audit
  add column if not exists group_id uuid references public.permission_groups(id) on delete set null,
  add column if not exists escopo_old text,
  add column if not exists escopo_new text;

commit;
