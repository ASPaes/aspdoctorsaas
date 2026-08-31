-- Integração Hiper — schema.
-- Espelha a anatomia do OEM com uma diferença que atravessa tudo: o Hiper é
-- SOMENTE LEITURA. Onde o OEM tem fila de escrita, aqui há histórico de leitura.
-- Nada nestas tabelas escreve em dado de negócio: o recon só grava aqui, e toda
-- correção em `clientes`/`cliente_produtos` é ação humana na aba Divergências.
-- Spec: docs/superpowers/specs/2026-08-30-integracao-hiper-design.md

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. hiper_integration — identidade do portal e trava de isolamento
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.hiper_integration
  add column if not exists portal_tenant_id    uuid,
  add column if not exists portal_tenant_nome  text,
  add column if not exists ultimo_pull_at      timestamptz,
  add column if not exists ultimo_pull_run_id  uuid;

comment on column public.hiper_integration.portal_tenant_id is
  'Tenant do PortalHiper a que o token pertence, lido em /api/integ/v1/me. Sem isto, um token colado no tenant errado espelharia a carteira de outra revenda sem erro nenhum.';

-- Um tenant do portal não pode estar conectado a dois tenants do DoctorSaaS.
-- A tentativa falha no banco, não no julgamento de quem está na tela.
create unique index if not exists hiper_integration_portal_tenant_unico
  on public.hiper_integration (portal_tenant_id)
  where portal_tenant_id is not null;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. hiper_espelho_cadastro — o que a assinatura contrata
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.hiper_espelho_cadastro
  add column if not exists plano_qt_usuarios integer,
  add column if not exists plano_qt_caixas   integer,
  add column if not exists plano_qt_filiais  integer,
  add column if not exists pull_run_id       uuid;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. hiper_espelho_modulo — um módulo do portal por conta
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.hiper_espelho_modulo (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null,
  id_portal     text not null,
  app_nome      text not null,
  custo         numeric,
  comprado_por  text,
  ativo         boolean not null default true,
  pull_run_id   uuid,
  pulled_at     timestamptz not null default now()
);
create unique index if not exists hiper_espelho_modulo_unico
  on public.hiper_espelho_modulo (tenant_id, id_portal, app_nome);
create index if not exists hiper_espelho_modulo_app
  on public.hiper_espelho_modulo (tenant_id, app_nome);

comment on table public.hiper_espelho_modulo is
  'Módulos (apps) que o portal diz que cada conta tem. Só custo, nunca MRR — o Hiper não vende módulo, cobra por ele. custo=0 é comum e legítimo (app gratuito ou bonificado), não é ausência de dado.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. hiper_espelho_filial — estabelecimento com CNPJ próprio
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.hiper_espelho_filial (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null,
  id_portal    text not null,          -- da CONTA-MÃE; a filial não tem id no portal
  cnpj         text,
  cnpj_norm    text not null,
  nome         text,
  cidade       text,
  uf           text,
  ativo        boolean not null default true,
  pull_run_id  uuid,
  pulled_at    timestamptz not null default now()
);
-- Unicidade inclui id_portal de propósito: um mesmo CNPJ aparece como
-- estabelecimento de DUAS contas na base de hoje. Apagar um dos dois esconderia
-- o problema em vez de mostrá-lo.
create unique index if not exists hiper_espelho_filial_unica
  on public.hiper_espelho_filial (tenant_id, id_portal, cnpj_norm);
create index if not exists hiper_espelho_filial_cnpj
  on public.hiper_espelho_filial (tenant_id, cnpj_norm);

comment on table public.hiper_espelho_filial is
  'Estabelecimento cujo CNPJ difere do cadastro da conta. Sem coluna de dinheiro porque não existe: o Hiper cobra da conta, nunca do estabelecimento. A chave é o CNPJ — client_branches.id_portal é NULL em todas as linhas do portal.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. hiper_catalogo_vinculo — a aba Módulos (plano, módulo e tipo de contrato)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.hiper_catalogo_vinculo (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null,
  tipo                text not null check (tipo in ('plano','modulo','contrato')),
  chave               text not null,   -- plano_nome, app_nome ou responsavel_tipo
  produto_id          bigint,
  modulo_id           uuid,
  modelo_contrato_id  bigint,
  criado_em           timestamptz not null default now(),
  atualizado_em       timestamptz not null default now(),
  criado_por          uuid,
  constraint hiper_catalogo_vinculo_alvo check (
       (tipo = 'plano'    and produto_id is not null and modulo_id is null)
    or (tipo = 'modulo'   and modulo_id is not null)
    or (tipo = 'contrato' and modelo_contrato_id is not null)
  )
);
create unique index if not exists hiper_catalogo_vinculo_unico
  on public.hiper_catalogo_vinculo (tenant_id, tipo, chave);

comment on table public.hiper_catalogo_vinculo is
  'De-para entre o catálogo do portal e o do DoctorSaaS. A chave é o NOME porque é o que o portal tem: app_nome e plano_nome são texto, não código. Renomeação no Hiper derruba o vínculo e o item volta como "não vinculado" — falha visível, nunca silenciosa. É por tenant porque cada revenda batiza seus modelos de contrato como quer.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. hiper_filial_decisao — o que faz a decisão do operador sobreviver ao recon
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.hiper_filial_decisao (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null,
  cliente_id    uuid not null,
  decisao       text not null check (decisao in ('consolida_na_matriz','paga_propria_conta','cliente_proprio')),
  observacao    text,
  decidido_em   timestamptz not null default now(),
  decidido_por  uuid
);
create unique index if not exists hiper_filial_decisao_unica
  on public.hiper_filial_decisao (tenant_id, cliente_id);

comment on table public.hiper_filial_decisao is
  'Filial que paga a própria conta existe na operação, então consolidar na matriz não é regra automática. Sem esta tabela a divergência voltaria todo dia e a lista viraria ruído até ninguém mais abrir a aba.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. reconciliacao_hiper — o retrato do cruzamento
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.reconciliacao_hiper (
  id                     uuid primary key default gen_random_uuid(),
  tenant_id              uuid not null,
  gerado_em              timestamptz not null default now(),
  -- lado Hiper
  id_portal              text,
  cnpj_norm              text,
  razao_social_hiper     text,
  situacao_hiper         text,
  plano_hiper            text,
  responsavel_tipo       text,
  mrr_hiper              numeric,   -- NULL no Hiperador: o portal não sabe o preço
  custo_hiper            numeric,   -- calculado, não copiado (ver hiper_reconciliar)
  cancelada_em           date,
  cancelada_por          text,
  -- lado DoctorSaaS
  ds_cliente_id          uuid,
  ds_cliente_produto_id  uuid,
  razao_social_ds        text,
  cnpj_ds                text,
  modelo_contrato_id_ds  bigint,
  modelo_contrato_ds     text,
  mensalidade_ds         numeric,
  custo_ds               numeric,
  cancelado_ds           boolean,
  qtd_candidatos_ds      integer not null default 0,
  candidato_escolhido    uuid,
  criterio_match         text,
  -- veredito
  estado_match           text not null,
  divergencias           text[] not null default '{}',
  detalhe                jsonb  not null default '{}'::jsonb,
  margem                 numeric,
  status_usuario         text not null default 'pendente'
                           check (status_usuario in ('pendente','resolvido','ignorado')),
  observacao             text,
  resolvido_em           timestamptz,
  resolvido_por          uuid
);
-- Duas chaves porque há dois tipos de linha: a da conta do portal e a do cliente
-- do DoctorSaaS que não tem conta nenhuma lá.
create unique index if not exists reconciliacao_hiper_conta
  on public.reconciliacao_hiper (tenant_id, id_portal) where id_portal is not null;
create unique index if not exists reconciliacao_hiper_cliente
  on public.reconciliacao_hiper (tenant_id, ds_cliente_id) where id_portal is null;
create index if not exists reconciliacao_hiper_pendentes
  on public.reconciliacao_hiper (tenant_id, status_usuario);
create index if not exists reconciliacao_hiper_estado
  on public.reconciliacao_hiper (tenant_id, estado_match);

comment on column public.reconciliacao_hiper.detalhe is
  'O que está divergindo, item a item: quais módulos, quais filiais, quais valores. O array `divergencias` diz o QUE; este jsonb diz QUAL.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. hiper_sync_run — a aba Sincronização. NÃO é fila de escrita: nada sai daqui
--    para o Hiper.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.hiper_sync_run (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null,
  iniciado_em      timestamptz not null default now(),
  terminado_em     timestamptz,
  disparado_por    uuid,
  origem           text not null default 'manual' check (origem in ('manual','cron')),
  status           text not null default 'rodando' check (status in ('rodando','ok','erro')),
  erro             text,
  contas           integer,
  modulos          integer,
  filiais          integer,
  paginas          integer,
  truncado         boolean not null default false,
  recon_pendentes  integer,
  recon_novas      integer
);
create index if not exists hiper_sync_run_tenant_inicio
  on public.hiper_sync_run (tenant_id, iniciado_em desc);

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. Índice do match — clientes por CNPJ normalizado dentro do tenant
-- ─────────────────────────────────────────────────────────────────────────────
create index if not exists idx_clientes_tenant_cnpj_digits
  on public.clientes (tenant_id, cnpj_digits) where cnpj_digits <> '';

-- ─────────────────────────────────────────────────────────────────────────────
-- 10. RLS — mesmo padrão de hiper_integration, que já está em produção.
--     Toda policy carrega `is_super_admin()` porque o super admin simula tenant.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array[
    'hiper_espelho_modulo','hiper_espelho_filial','hiper_catalogo_vinculo',
    'hiper_filial_decisao','reconciliacao_hiper','hiper_sync_run'
  ] loop
    execute format('alter table public.%I enable row level security', t);

    -- SELECT: admin e head do tenant leem; super admin sempre.
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using ('
      || '(select public.is_super_admin()) or (tenant_id = (select public.current_tenant_id())'
      || ' and (select public.is_tenant_admin_or_head())))',
      t || '_select', t);

    -- Escrita: só admin ativo do próprio tenant. O edge function usa
    -- service_role e passa por fora da RLS, como as demais integrações.
    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format(
      'create policy %I on public.%I for insert to authenticated with check ('
      || '(select public.is_super_admin()) or ((select public.is_tenant_active_member())'
      || ' and tenant_id = (select public.current_tenant_id())'
      || ' and (select public.is_tenant_admin())))',
      t || '_insert', t);

    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format(
      'create policy %I on public.%I for update to authenticated using ('
      || '(select public.is_super_admin()) or ((select public.is_tenant_active_member())'
      || ' and tenant_id = (select public.current_tenant_id())'
      || ' and (select public.is_tenant_admin())))',
      t || '_update', t);

    execute format('drop policy if exists %I on public.%I', t || '_delete', t);
    execute format(
      'create policy %I on public.%I for delete to authenticated using ('
      || '(select public.is_super_admin()) or ((select public.is_tenant_active_member())'
      || ' and tenant_id = (select public.current_tenant_id())'
      || ' and (select public.is_tenant_admin())))',
      t || '_delete', t);
  end loop;
end $$;
