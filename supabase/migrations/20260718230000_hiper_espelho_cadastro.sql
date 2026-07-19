-- Espelho cru da carteira do PortalHiper (um registro por cliente do Hiper).
-- Preenchido pelo puller (hiper-integration-call, ação "puxar"), NUNCA escreve em
-- clientes direto. A reconciliação por CNPJ lê daqui. Chave de upsert: id_portal.
create table if not exists public.hiper_espelho_cadastro (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null,
  id_portal            text not null,
  cnpj                 text,
  cnpj_norm            text,            -- só dígitos — chave de match com clientes
  razao_social         text,
  nome_fantasia        text,
  cidade               text,
  uf                   text,
  situacao             text,            -- ativo | bloqueado | inativo
  responsavel_tipo     text,
  plano                text,
  cliente_desde        date,
  cancelada_em         date,
  cancelada_por        text,
  saude                integer,
  ultimo_acesso        date,
  mrr                  numeric,
  a_pagar              numeric,
  bruto_mes            numeric,
  custo_mes            numeric,
  mensalidade_ultima   numeric,
  a_pagar_ultima       numeric,
  extrato_mes_ultima   date,
  usuarios_contratados integer,
  usuarios_ativos_30d  integer,
  qt_modulos           integer,
  atraso_dias          integer,
  total_aberto         numeric,
  last_scraped_at      timestamptz,
  raw                  jsonb,
  pulled_at            timestamptz not null default now(),
  constraint hiper_espelho_tenant_idportal_key unique (tenant_id, id_portal)
);

create index if not exists hiper_espelho_tenant_cnpj_idx
  on public.hiper_espelho_cadastro (tenant_id, cnpj_norm);

alter table public.hiper_espelho_cadastro enable row level security;

-- Leitura: super admin, ou admin/head do próprio tenant. Escrita = service_role
-- (puller) — sem policy de write, RLS bloqueia dashboard.
drop policy if exists hiper_espelho_select on public.hiper_espelho_cadastro;
create policy hiper_espelho_select on public.hiper_espelho_cadastro
  for select using (
    (select is_super_admin())
    or (tenant_id = (select current_tenant_id()) and (select is_tenant_admin_or_head()))
  );

grant select on public.hiper_espelho_cadastro to authenticated;
grant select, insert, update, delete on public.hiper_espelho_cadastro to service_role;
