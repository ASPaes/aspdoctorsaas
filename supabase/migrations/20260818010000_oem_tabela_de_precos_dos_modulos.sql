-- ============================================================================
-- Integração OEM — a TABELA DE PREÇOS dos módulos (regras comerciais)
--
-- O QUE É, E O QUE NÃO É
-- Isto é a grade de "Dados da empresa › Regras comerciais › Tabela de preços"
-- do portal do OEM: quanto CADA MÓDULO custa em CADA PRODUTO do catálogo do
-- parceiro. Não tem cliente nenhum dentro — é preço de tabela.
--
-- NÃO confundir com `oem_espelho_filial.modulos`, que é outra coisa: os
-- módulos que UMA FILIAL tem ligados e o que ela é faturada. Os dois números
-- diferem de propósito. Medido em 17/08/2026 no grupo 8201: o módulo "Gestao"
-- é R$ 39,90 na tabela e sai R$ 25,12 naquela loja. A tabela é o de-lista; a
-- filial é o negociado.
--
-- DE ONDE VEM
-- GET /licenciamento/minhaslicencas/modulos/{produto}/0/0 na API do OEM —
-- grupo e loja ZERO. É assim que a API entende "novo licenciamento" e devolve
-- o valor de tabela em vez do valor de uma loja específica. Quem chama é o
-- DoctorOEM (oem-exportar); aqui só chega a cópia, como todo o resto do OEM.
--
-- GRÃO: A CONTA, NÃO O TENANT
-- Cada conta OEM é uma unidade base com credencial própria (a Digi Office tem
-- 4 unidades), e cada credencial é um parceiro no OEM com a SUA tabela de
-- preços. Duas contas do mesmo tenant podem ter grades diferentes — por isso
-- a chave única é por conta, e não por tenant.
-- ============================================================================

begin;

create table if not exists public.oem_espelho_modulo_preco (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references public.tenants(id) on delete cascade,
  conta_integration_id uuid not null references public.oem_integration(id) on delete cascade,

  -- produto do catálogo do parceiro (GESTAO LEGAL, FULL, WATO...)
  produto_codigo       text    not null,
  produto_nome         text    not null,

  -- módulo dentro daquele produto. O mesmo código de módulo aparece em vários
  -- produtos com valores diferentes — daí o par (produto, módulo) na chave.
  modulo_codigo        integer not null,
  modulo_nome          text    not null,

  quantidade           numeric(12,2),
  valor_unitario       numeric(12,2),
  valor_total          numeric(12,2),

  atualizado_em        timestamptz not null default now(),

  constraint oem_preco_modulo_unico unique (conta_integration_id, produto_codigo, modulo_codigo)
);

create index if not exists idx_oem_preco_tenant
  on public.oem_espelho_modulo_preco (tenant_id, produto_nome, modulo_nome);

-- ------------------------------------------------------------------ RLS
alter table public.oem_espelho_modulo_preco enable row level security;

grant select on public.oem_espelho_modulo_preco to authenticated;
grant all    on public.oem_espelho_modulo_preco to service_role;

-- Convenção do projeto: toda policy por tenant_id inclui o bypass do super
-- admin, senão ele deixa de enxergar o tenant que está simulando.
drop policy if exists oem_preco_modulo_select on public.oem_espelho_modulo_preco;
create policy oem_preco_modulo_select on public.oem_espelho_modulo_preco for select to authenticated
  using (
    public.is_super_admin()
    or tenant_id = (select p.tenant_id from public.profiles p where p.user_id = auth.uid())
  );

commit;

-- ---------------------------------------------------------------------------
-- CONFERÊNCIA (só leitura, depois da primeira carga)
--
--   select to_regclass('public.oem_espelho_modulo_preco') as tabela;
--
--   select produto_nome, count(*) modulos, sum(valor_unitario) soma
--     from public.oem_espelho_modulo_preco group by 1 order by 2 desc;
--
-- Esperado na Digi Office: 6 produtos e ~120 pares produto×módulo. Em
-- GESTAO LEGAL, "Gestao" = 39,90 · "PDV/Comandas" = 15,00 · "NFCE" = 5,00.
-- ---------------------------------------------------------------------------
