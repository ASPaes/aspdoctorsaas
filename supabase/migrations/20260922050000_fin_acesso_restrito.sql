-- =============================================================================
-- Financeiro — portão de acesso enquanto o módulo está em desenvolvimento.
--
-- Decisão do Alexandre em 22/09/2026: se isto for para produção antes de estar
-- pronto, o módulo só pode aparecer para o tenant liberado (Digi Office) E só
-- para super admin. Para mais ninguém.
--
-- São duas condições, e as duas são verificadas NO BANCO, não só na tela:
--   1. `tenants.financeiro_enabled` liga o módulo para um tenant específico.
--   2. A policy exige super admin.
--
-- A condição 2 é a que fecha de verdade: sem ela, bastaria a tela mentir para um
-- operador do tenant liberado ler títulos. Este projeto já tem o problema de
-- portão que só existe na UI, e aqui isso não se repete.
--
-- ⚠️ NO DIA DA LIBERAÇÃO: trocar as duas policies abaixo pela versão de
-- `20260922041500_fin_titulos_base.sql` (membro ativo do tenant), deixando a
-- flag `financeiro_enabled` como o controle de quem tem o módulo. Enquanto esta
-- migration estiver valendo, nenhum operador lê título nenhum.
-- =============================================================================

alter table public.tenants
  add column if not exists financeiro_enabled boolean not null default false;

comment on column public.tenants.financeiro_enabled is
  'Liga o módulo Financeiro (títulos a receber e régua de cobrança) para este tenant. Padrão false. Enquanto o módulo está em desenvolvimento, além desta flag a leitura exige super admin.';

-- Nenhum tenant é ligado aqui de propósito: quem liga é o Alexandre, um a um.
-- Para a Digi Office, em produção:
--   update public.tenants set financeiro_enabled = true where nome ilike 'Digi Office%';

drop policy if exists fin_titulos_select on public.fin_titulos;
create policy fin_titulos_select on public.fin_titulos
  for select
  using (
    (select public.is_super_admin()) is true
    and exists (
      select 1 from public.tenants t
       where t.id = fin_titulos.tenant_id
         and t.financeiro_enabled is true
    )
  );

drop policy if exists fin_sync_estado_select on public.fin_sync_estado;
create policy fin_sync_estado_select on public.fin_sync_estado
  for select
  using (
    (select public.is_super_admin()) is true
    and exists (
      select 1 from public.tenants t
       where t.id = fin_sync_estado.tenant_id
         and t.financeiro_enabled is true
    )
  );

-- `is true` em vez de confiar no valor cru: `is_super_admin()` devolve NULL para
-- quem não é, e NULL dentro de AND/OR já cegou portão neste projeto.
