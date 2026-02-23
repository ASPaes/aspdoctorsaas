
-- =========================
-- Helper: updated_at trigger
-- =========================
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- =========================
-- Lookup tables
-- =========================
create table if not exists public.estados (
  id bigserial primary key,
  codigo_ibge text,
  sigla text not null,
  nome text not null
);
create unique index if not exists ux_estados_sigla on public.estados(sigla);

create table if not exists public.cidades (
  id bigserial primary key,
  codigo_ibge text,
  nome text not null,
  estado_id bigint not null references public.estados(id) on delete restrict
);
create index if not exists idx_cidades_estado_id on public.cidades(estado_id);
create unique index if not exists ux_cidades_codigo_ibge on public.cidades(codigo_ibge);

create table if not exists public.areas_atuacao (
  id bigserial primary key,
  nome text not null unique
);

create table if not exists public.segmentos (
  id bigserial primary key,
  nome text not null unique
);

create table if not exists public.verticais (
  id bigserial primary key,
  nome text not null unique
);

create table if not exists public.funcionarios (
  id bigserial primary key,
  nome text not null,
  email text unique,
  cargo text,
  ativo boolean not null default true
);

create table if not exists public.fornecedores (
  id bigserial primary key,
  nome text not null unique,
  site text
);

create table if not exists public.produtos (
  id bigserial primary key,
  nome text not null,
  fornecedor_id bigint references public.fornecedores(id) on delete set null,
  codigo_fornecedor text,
  link_portal text
);
create index if not exists idx_produtos_fornecedor_id on public.produtos(fornecedor_id);

create table if not exists public.motivos_cancelamento (
  id bigserial primary key,
  descricao text not null unique
);

create table if not exists public.formas_pagamento (
  id bigserial primary key,
  nome text not null unique
);

-- =========================
-- Configurações globais
-- =========================
create table if not exists public.configuracoes (
  id bigserial primary key,
  imposto_percentual numeric not null default 0.135,
  custo_fixo_percentual numeric not null default 0.08,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_configuracoes_updated_at on public.configuracoes;
create trigger trg_configuracoes_updated_at
before update on public.configuracoes
for each row execute function public.set_updated_at();

-- =========================
-- Enum recorrência
-- =========================
do $$
begin
  if not exists (select 1 from pg_type where typname = 'recorrencia_tipo') then
    create type public.recorrencia_tipo as enum ('mensal','anual','semestral','semanal');
  end if;
end$$;

-- =========================
-- Tabela principal: clientes
-- =========================
create table if not exists public.clientes (
  id uuid primary key default gen_random_uuid(),
  data_cadastro date,
  razao_social text,
  nome_fantasia text,
  cnpj text unique,
  email text,
  telefone_contato text,
  telefone_whatsapp text,
  observacao_cliente text,
  estado_id bigint references public.estados(id) on delete set null,
  cidade_id bigint references public.cidades(id) on delete set null,
  area_atuacao_id bigint references public.areas_atuacao(id) on delete set null,
  segmento_id bigint references public.segmentos(id) on delete set null,
  vertical_id bigint references public.verticais(id) on delete set null,
  data_venda date,
  funcionario_id bigint references public.funcionarios(id) on delete set null,
  origem_venda text,
  recorrencia public.recorrencia_tipo,
  observacao_negociacao text,
  produto_id bigint references public.produtos(id) on delete set null,
  valor_ativacao numeric,
  forma_pagamento_ativacao_id bigint references public.formas_pagamento(id) on delete set null,
  mensalidade numeric,
  forma_pagamento_mensalidade_id bigint references public.formas_pagamento(id) on delete set null,
  custo_operacao numeric,
  imposto_percentual numeric,
  custo_fixo_percentual numeric,
  cancelado boolean not null default false,
  data_cancelamento date,
  motivo_cancelamento_id bigint references public.motivos_cancelamento(id) on delete set null,
  observacao_cancelamento text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_clientes_data_cadastro on public.clientes(data_cadastro);
create index if not exists idx_clientes_cancelado on public.clientes(cancelado);
create index if not exists idx_clientes_segmento on public.clientes(segmento_id);
create index if not exists idx_clientes_vertical on public.clientes(vertical_id);
create index if not exists idx_clientes_funcionario on public.clientes(funcionario_id);

drop trigger if exists trg_clientes_updated_at on public.clientes;
create trigger trg_clientes_updated_at
before update on public.clientes
for each row execute function public.set_updated_at();

-- =========================
-- View financeiro
-- =========================
create or replace view public.vw_clientes_financeiro as
select
  c.*,
  (c.mensalidade - c.custo_operacao) as valor_repasse,
  (c.mensalidade * c.imposto_percentual) as impostos_rs,
  (c.mensalidade * c.custo_fixo_percentual) as fixos_rs,
  (c.mensalidade - c.custo_operacao - (c.mensalidade * c.imposto_percentual)) as lucro_bruto,
  case when c.mensalidade is null or c.mensalidade = 0 then null
       else ((c.mensalidade - c.custo_operacao - (c.mensalidade * c.imposto_percentual)) / c.mensalidade) * 100 end as margem_bruta_percent,
  case when c.custo_operacao is null or c.custo_operacao = 0 then null
       else ((c.mensalidade / c.custo_operacao) - 1) * 100 end as markup_cogs_percent,
  case when c.custo_operacao is null or c.custo_operacao = 0 then null
       else (c.mensalidade / c.custo_operacao) end as fator_preco_cogs_x,
  (c.mensalidade - c.custo_operacao - (c.mensalidade * c.imposto_percentual) - (c.mensalidade * c.custo_fixo_percentual)) as margem_contribuicao,
  (c.mensalidade - c.custo_operacao - (c.mensalidade * c.imposto_percentual) - (c.mensalidade * c.custo_fixo_percentual)) as lucro_real
from public.clientes c;

-- =========================
-- RLS
-- =========================
alter table public.estados enable row level security;
alter table public.cidades enable row level security;
alter table public.areas_atuacao enable row level security;
alter table public.segmentos enable row level security;
alter table public.verticais enable row level security;
alter table public.funcionarios enable row level security;
alter table public.fornecedores enable row level security;
alter table public.produtos enable row level security;
alter table public.motivos_cancelamento enable row level security;
alter table public.formas_pagamento enable row level security;
alter table public.configuracoes enable row level security;
alter table public.clientes enable row level security;

-- authenticated pode tudo (por enquanto)
do $$
declare
  t text;
begin
  foreach t in array array[
    'estados','cidades','areas_atuacao','segmentos','verticais',
    'funcionarios','fornecedores','produtos','motivos_cancelamento',
    'formas_pagamento','configuracoes','clientes'
  ]
  loop
    execute format('drop policy if exists "auth_read_%s" on public.%s', t, t);
    execute format('drop policy if exists "auth_write_%s" on public.%s', t, t);
    execute format(
      'create policy "auth_read_%s" on public.%s for select to authenticated using (true)',
      t, t
    );
    execute format(
      'create policy "auth_write_%s" on public.%s for all to authenticated using (true) with check (true)',
      t, t
    );
  end loop;
end$$;
