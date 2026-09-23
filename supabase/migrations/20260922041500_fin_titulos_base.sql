-- =============================================================================
-- Financeiro / Régua de Cobrança — Fase 1: a tabela única de títulos.
--
-- Uma tabela só, separada por tenant. A régua, o painel, a ficha do cliente e o
-- bot do chat leem SEMPRE daqui e nunca sabem de onde o título veio. O que muda
-- por sistema de origem é apenas quem escreve: um conector por origem.
--
-- Por que "origem" existe: levantado em 22/09/2026, cada tenant cobra por um
-- lugar diferente — Digi Office e DIGIUP pelo Omie, ASP pelo FlyERP, Athuz e CTM
-- pelo Asaas, DELVALE pelo fornecedor do software. Amarrar a tabela ao Omie
-- deixaria de fora justamente quem mais pede 2ª via no chat.
--
-- Ninguém escreve aqui pelo app: a escrita é do conector, que roda com
-- service_role (e service_role não passa por RLS). As policies abaixo só liberam
-- LEITURA, e só para membro ativo do tenant.
-- =============================================================================

create table if not exists public.fin_titulos (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,

  -- De onde o título veio. `origem_conta_id` separa duas contas do mesmo sistema
  -- no mesmo tenant (a Digi Office tem duas contas no Omie, uma por unidade).
  origem text not null check (origem in ('omie', 'asaas', 'flyerp', 'manual')),
  origem_conta_id uuid null,
  origem_id text not null,

  -- Cliente do DoctorSaaS. Fica nulo enquanto o título não casa com ninguém:
  -- título sem cliente aparece como pendência de vínculo, nunca vira cobrança.
  cliente_id uuid null references public.clientes(id) on delete set null,
  origem_cliente_id text null,
  cnpj_cpf_digits text null,

  numero_documento text null,
  parcela text null,
  emissao date null,
  vencimento date not null,
  valor numeric(14, 2) not null check (valor >= 0),
  valor_pago numeric(14, 2) null,
  pago_em date null,

  -- Situação normalizada. Cada conector traduz o rótulo dele para cá e guarda o
  -- original em `situacao_origem` (o Omie, por exemplo, devolve "VENCE HOJE").
  -- 'desconhecida' é para título que a origem parou de confirmar: ver `visto_em`.
  situacao text not null check (
    situacao in ('a_vencer', 'vence_hoje', 'atrasado', 'pago', 'parcial', 'cancelado', 'desconhecida')
  ),
  situacao_origem text null,

  -- O que o cliente recebe. Nem todo título tem boleto gerado na origem: medido
  -- em 22/09/2026, 53 dos 92 atrasados da Digi Office tinham (74%).
  link_boleto text null,
  boleto_gerado boolean not null default false,
  codigo_barras text null,
  pix_copia_cola text null,
  link_nfse text null,

  -- ⚠️ A trava que impede cobrar título que não existe mais.
  -- `visto_em` é a última vez que a ORIGEM confirmou este título. O espelho do
  -- Omie não sabe apagar: em 22/09/2026 tinha 198 linhas da Digi Office que a
  -- API não devolve mais (título excluído no ERP, confirmado com
  -- ConsultarContaReceber: "Lançamento não cadastrado"), e 9 delas constavam
  -- como atrasadas, R$ 3.583,88. Título com `visto_em` anterior à última leitura
  -- boa da origem é suspeito e fica fora de vw_fin_titulos_abertos.
  visto_em timestamptz not null default now(),
  origem_atualizado_em timestamptz null,

  raw jsonb null,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),

  unique (tenant_id, origem, origem_id)
);

comment on table public.fin_titulos is
  'Títulos a receber de todas as origens (Omie, Asaas, FlyERP, manual), um registro por título e por tenant. Fonte única de leitura da régua de cobrança, do painel e da 2ª via no chat. Escrita só por conector com service_role.';
comment on column public.fin_titulos.visto_em is
  'Última vez que a origem confirmou o título. Anterior à última leitura boa = a origem não devolve mais este título (provável exclusão no ERP): não cobrar.';

-- Índices pelos 3 caminhos de leitura reais: o painel (situação + vencimento),
-- a ficha do cliente e a 2ª via no chat (cliente), e o conector (o que ficou
-- para trás na última leitura).
create index if not exists idx_fin_titulos_tenant_situacao_venc
  on public.fin_titulos (tenant_id, situacao, vencimento);
create index if not exists idx_fin_titulos_tenant_cliente_venc
  on public.fin_titulos (tenant_id, cliente_id, vencimento desc)
  where cliente_id is not null;
create index if not exists idx_fin_titulos_tenant_origem_visto
  on public.fin_titulos (tenant_id, origem, visto_em);
-- Casamento de título sem cliente, feito por CNPJ.
create index if not exists idx_fin_titulos_cnpj
  on public.fin_titulos (tenant_id, cnpj_cpf_digits)
  where cliente_id is null;

-- =============================================================================
-- Estado de cada conector. É o que diz se dá para confiar no que está na tabela:
-- sem uma leitura boa recente, o painel avisa em vez de mostrar número errado.
-- =============================================================================
create table if not exists public.fin_sync_estado (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  origem text not null check (origem in ('omie', 'asaas', 'flyerp', 'manual')),
  origem_conta_id uuid null,
  ultima_leitura_ok timestamptz null,
  ultima_tentativa timestamptz null,
  ultimo_status text null check (ultimo_status in ('sucesso', 'erro', 'executando')),
  ultimo_erro text null,
  titulos_lidos integer null,
  atualizado_em timestamptz not null default now(),
  primary key (tenant_id, origem)
);

comment on table public.fin_sync_estado is
  'Uma linha por tenant e origem: quando a origem foi lida com sucesso pela última vez. É a referência do visto_em de fin_titulos.';

-- =============================================================================
-- Gatilho de atualizado_em. Não mexe em visto_em: quem carimba visto_em é o
-- conector, e só quando a origem confirma o título.
-- =============================================================================
create or replace function public.fn_fin_titulos_touch()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.atualizado_em := now();
  return new;
end;
$$;

drop trigger if exists trg_fin_titulos_touch on public.fin_titulos;
create trigger trg_fin_titulos_touch
  before update on public.fin_titulos
  for each row execute function public.fn_fin_titulos_touch();

-- =============================================================================
-- RLS — leitura por membro ativo do tenant, bypass de super admin.
-- Sem policy de insert/update/delete de propósito: escrita só com service_role.
-- =============================================================================
alter table public.fin_titulos enable row level security;
alter table public.fin_sync_estado enable row level security;

drop policy if exists fin_titulos_select on public.fin_titulos;
create policy fin_titulos_select on public.fin_titulos
  for select
  using (
    (select public.is_super_admin())
    or (
      (select public.is_tenant_active_member())
      and tenant_id = (select public.current_tenant_id())
    )
  );

drop policy if exists fin_sync_estado_select on public.fin_sync_estado;
create policy fin_sync_estado_select on public.fin_sync_estado
  for select
  using (
    (select public.is_super_admin())
    or (
      (select public.is_tenant_active_member())
      and tenant_id = (select public.current_tenant_id())
    )
  );

-- =============================================================================
-- A view que a régua e o painel leem. Só título em aberto E confirmado pela
-- origem na última leitura boa. `security_invoker` para a view respeitar o RLS
-- de quem consulta, em vez dos direitos do dono.
--
-- A margem de 10 minutos existe porque a leitura demora: o título lido no início
-- de uma varredura de 4 minutos tem visto_em anterior ao fim dela.
-- =============================================================================
create or replace view public.vw_fin_titulos_abertos
with (security_invoker = true) as
select
  t.*,
  (t.vencimento < current_date) as vencido,
  greatest(0, current_date - t.vencimento) as dias_atraso
from public.fin_titulos t
join public.fin_sync_estado e
  on e.tenant_id = t.tenant_id
 and e.origem = t.origem
where t.situacao in ('a_vencer', 'vence_hoje', 'atrasado')
  and e.ultima_leitura_ok is not null
  and t.visto_em >= e.ultima_leitura_ok - interval '10 minutes';

comment on view public.vw_fin_titulos_abertos is
  'Títulos em aberto que a origem confirmou na última leitura boa. É daqui que a régua decide cobrar. Título que a origem parou de devolver fica de fora, para não cobrar por título excluído no ERP.';

-- =============================================================================
-- Grants. O Supabase dá ALL para `anon` e `authenticated` em tabela nova por
-- privilégio padrão, então aqui se REVOGA antes de conceder. O RLS já barraria a
-- escrita (não existe policy de insert/update/delete), mas grant e policy são
-- duas camadas e a lição do projeto é revogar de `authenticated` de forma
-- explícita: revogar de PUBLIC não restringe nada.
-- =============================================================================
revoke all on public.fin_titulos from anon, authenticated;
revoke all on public.fin_sync_estado from anon, authenticated;
revoke all on public.vw_fin_titulos_abertos from anon, authenticated;

grant select on public.fin_titulos to authenticated, service_role;
grant select on public.fin_sync_estado to authenticated, service_role;
grant select on public.vw_fin_titulos_abertos to authenticated, service_role;
grant insert, update, delete on public.fin_titulos to service_role;
grant insert, update, delete on public.fin_sync_estado to service_role;
