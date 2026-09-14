-- ============================================================================
-- Bug B5 — compensação para a remoção do RequireRole em /atendimento/dashboard
--
-- A rota tinha portão duplo: RequirePermission + RequireRole(admin,head).
-- O RequireRole anulava a permissão concedida. Removê-lo sozinho ABRE a tela
-- para quem já tem o recurso liberado.
--
-- Medido em 13/09/2026 contra produção:
--   padrão global para `user` .................... false
--   tenants que liberam para `user` .............. 1 (Digi Office Sistemas)
--   usuários `user` ativos na Digi Office ........ 14
--
-- Sem esta migration, esses 14 ganhariam no dia 1 as abas Agentes
-- (produtividade individual) e Satisfação (nota individual) — num dos dois
-- tenants-piloto. Aqui o acesso efetivo de hoje é gravado por escrito;
-- liberar passa a ser decisão explícita do admin.
--
-- ⚠️ ESTA MIGRATION MUDA 14 LINHAS DA FOTO DE PERMISSÕES, DE PROPÓSITO.
--    Ela só pode ser aplicada NO MESMO DEPLOY da remoção do RequireRole.
--    Aplicada sozinha: 14 pessoas perdem o menu (que hoje veem e não abre).
--    O frontend sozinho: 14 pessoas ganham a tela.
-- ============================================================================
begin;

insert into public.tenant_role_permissions (tenant_id, role, resource_key, can_view, can_insert, can_update, can_delete)
select t.id, 'user', 'nav.atendimento_dashboard', false, false, false, false
from public.tenants t
where exists (
  select 1 from public.tenant_role_permissions x
  where x.tenant_id = t.id and x.role = 'user'
    and x.resource_key = 'nav.atendimento_dashboard' and x.can_view
)
on conflict (tenant_id, role, resource_key) do update
  set can_view = false, can_insert = false, can_update = false, can_delete = false;

-- Espelha nos grupos, para os tenants que já estiverem no motor v2.
update public.group_permissions gp
   set can_view = false, can_insert = false, can_update = false, can_delete = false, updated_at = now()
  from public.permission_groups g
 where g.id = gp.group_id
   and gp.resource_key = 'nav.atendimento_dashboard'
   and g.nivel_base = 'user'
   and gp.can_view;

commit;
