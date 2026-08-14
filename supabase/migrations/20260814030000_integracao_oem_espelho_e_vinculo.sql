-- ============================================================================
-- Integração OEM no DoctorSaaS — fase 1: espelho + de/para
--
-- Espelha o desenho que o Omie já usa em produção:
--   omie_espelho_cadastro  (2.470 linhas)  ->  oem_espelho_filial
--   reconciliacao_cadastro (1.016 linhas)  ->  reconciliacao_oem
--
-- POR QUE ESPELHO E NÃO LEITURA DIRETA
-- Os dados do OEM vivem em OUTRO projeto Supabase (furohpfhukwajhvnnbiw).
-- Cruzamento não atravessa projetos: para juntar filial com `clientes` em SQL,
-- a cópia precisa estar aqui. É exatamente o que o Omie faz.
--
-- POR QUE O GRÃO É A FILIAL, E NÃO O CNPJ
-- Medido em 14/08/2026 sobre as 2.564 filiais reais: 188 CNPJs têm mais de uma
-- filial, somando 633. Um CNPJ chega a ter 38 filiais (rede Bem Doçado) e um
-- CPF de teste ("01234567890") aparece em 29 cadastros distintos. Cada filial é
-- uma licença com custo próprio, então o vínculo é filial↔cliente, um a um, e
-- o CNPJ só sugere candidatos.
--
-- COBERTURA ESPERADA (medida contra a base real)
--   865 filiais ativas no OEM -> 855 casam por CNPJ com cliente Digi Office (98,8%)
--   1.699 desativadas         -> 496 casam (29,2%)
-- ============================================================================

begin;

-- ---------------------------------------------------- espelho das filiais OEM
create table if not exists public.oem_espelho_filial (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.tenants(id) on delete cascade,

  -- identidade no OEM
  empresa_codigo      text not null,          -- codgrupo (grupo econômico)
  filial_codigo       text not null,          -- codfilial — é a chave da licença
  grupo_economico     text,
  nome_fantasia       text,
  razao_social        text,
  cnpj_oem            text,
  cnpj_norm           text,                   -- só dígitos; é por aqui que casa
  produto_principal   text,

  -- estado da licença: duas dimensões INDEPENDENTES
  status              text,                   -- 'Ativo' | 'Desativado'
  bloqueado           boolean not null default false,

  -- números
  custo_total         numeric(12,2),
  qtd_pdv             integer,
  qtd_comandas        integer,
  usuarios_adicionais integer,
  numero_filiais      integer,
  modulos             jsonb,                  -- lista completa, com ativo/valor

  last_sync_oem       timestamptz,            -- quando o DoctorOEM leu do OEM
  atualizado_em       timestamptz not null default now(),

  constraint oem_espelho_filial_unica unique (tenant_id, filial_codigo)
);

create index if not exists idx_oem_espelho_cnpj    on public.oem_espelho_filial (tenant_id, cnpj_norm);
create index if not exists idx_oem_espelho_status  on public.oem_espelho_filial (tenant_id, status, bloqueado);
create index if not exists idx_oem_espelho_grupo   on public.oem_espelho_filial (tenant_id, empresa_codigo);

-- --------------------------------------------------------------- o de/para
create table if not exists public.reconciliacao_oem (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.tenants(id) on delete cascade,
  gerado_em           timestamptz not null default now(),
  cnpj_norm           text,

  -- lado OEM
  empresa_codigo      text,
  filial_codigo       text,
  razao_oem           text,
  custo_oem           numeric(12,2),
  status_oem          text,
  bloqueado_oem       boolean,

  -- lado DoctorSaaS
  ds_customer_id      uuid references public.clientes(id) on delete set null,
  razao_ds            text,
  mensalidade_ds      numeric(12,2),
  cancelado_ds        boolean,

  -- decisão
  qtd_candidatos_ds   integer not null default 0,
  estado_match        text,   -- CASADO | AMBIGUO | SO_NO_OEM | SO_NO_DS
  acao_sugerida       text,   -- vinculo_auto_ok | escolher_candidato | fora_do_escopo | criar_cliente
  status_usuario      text not null default 'novo',  -- novo | vinculado | resolvido | ignorado
  candidato_escolhido uuid,
  observacao          text,
  resolvido_em        timestamptz,
  resolvido_por       uuid,

  -- margem: o que a Digi Office cobra menos o que paga ao OEM.
  -- Diferente do Omie, aqui os dois valores NÃO deveriam ser iguais — medido
  -- em 845 pares ativo-ativo, 100% divergem, porque um é preço de venda e o
  -- outro é custo de licença. A diferença é o resultado, não um erro.
  margem              numeric(12,2) generated always as
                        (coalesce(mensalidade_ds, 0) - coalesce(custo_oem, 0)) stored,

  constraint reconciliacao_oem_unica unique (tenant_id, filial_codigo, ds_customer_id)
);

create index if not exists idx_recon_oem_estado  on public.reconciliacao_oem (tenant_id, estado_match, status_usuario);
create index if not exists idx_recon_oem_cnpj    on public.reconciliacao_oem (tenant_id, cnpj_norm);
create index if not exists idx_recon_oem_cliente on public.reconciliacao_oem (tenant_id, ds_customer_id);
create index if not exists idx_recon_oem_filial  on public.reconciliacao_oem (tenant_id, filial_codigo);

-- ------------------------------------------------------------------ RLS
alter table public.oem_espelho_filial enable row level security;
alter table public.reconciliacao_oem  enable row level security;

grant select                         on public.oem_espelho_filial to authenticated;
grant select, insert, update, delete on public.reconciliacao_oem  to authenticated;
grant all on public.oem_espelho_filial, public.reconciliacao_oem to service_role;

-- Convenção do projeto: toda policy por tenant_id inclui o bypass do super admin.
drop policy if exists oem_espelho_select on public.oem_espelho_filial;
create policy oem_espelho_select on public.oem_espelho_filial for select to authenticated
  using (
    public.is_super_admin()
    or tenant_id = (select p.tenant_id from public.profiles p where p.user_id = auth.uid())
  );

drop policy if exists recon_oem_select on public.reconciliacao_oem;
create policy recon_oem_select on public.reconciliacao_oem for select to authenticated
  using (
    public.is_super_admin()
    or tenant_id = (select p.tenant_id from public.profiles p where p.user_id = auth.uid())
  );

drop policy if exists recon_oem_update on public.reconciliacao_oem;
create policy recon_oem_update on public.reconciliacao_oem for update to authenticated
  using (
    public.is_super_admin()
    or tenant_id = (select p.tenant_id from public.profiles p where p.user_id = auth.uid())
  );

commit;

-- ---------------------------------------------------------------------------
-- CONFERÊNCIA (só leitura)
--
--   select to_regclass('public.oem_espelho_filial') as espelho,
--          to_regclass('public.reconciliacao_oem')  as vinculo;
--
-- Depois da primeira carga:
--   select estado_match, acao_sugerida, count(*)
--     from public.reconciliacao_oem group by 1,2 order by 3 desc;
-- ---------------------------------------------------------------------------
