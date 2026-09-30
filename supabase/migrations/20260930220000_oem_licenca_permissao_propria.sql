-- ============================================================================
-- Licença OEM ganha permissão própria (`clientes.oem_licenca`), separada de
-- Módulos. Vale para Trocar licença, Ativar/Desativar e Bloquear/Desbloquear
-- na ficha do cliente.
--
-- Até aqui essas ações usavam `clientes.modulos` (decisão de 01/09/2026). Em
-- 30/09 o Alexandre pediu a caixa separada na coluna Integração, nascendo com
-- o MESMO valor de Módulos em cada nível: no dia da troca ninguém ganha nem
-- perde acesso, e o ajuste é feito pessoa a pessoa depois.
--
--   1. A chave, filha de `clientes.modulos` (aparece na matriz de Perfis).
--   2. Cópia de `clientes.modulos` em papel global, papel no tenant, perfil e
--      pessoa.
--   3. `pode_mexer_licenca_oem` (portão de `trocar_filial_oem`) passa a ler a
--      chave nova. A edge function `oem-licenca-estado` muda junto.
--   4. A descrição de Módulos deixa de falar da licença.
--
-- ORDEM: esta migration ANTES do deploy da edge function. Sem a chave no
-- banco, `get_my_permissions` não devolve a linha e a function recusa todos.
-- ============================================================================

-- ----------------------------------------------------------------- 1) chave
INSERT INTO public.resources
  (key, module, label, description, parent_key, display_order, hidden,
   is_navigation, where_it_appears, module_id, nivel, acoes, secao, grupo, grupo_ordem)
SELECT 'clientes.oem_licenca', r.module, 'Licença OEM',
       'Trocar, ativar/desativar e bloquear/desbloquear a licença do cliente no OEM, pela ficha do cliente.',
       'clientes.modulos', r.display_order + 2, false,
       false, 'Ficha do cliente › Integração › OEM',
       r.module_id, (r.nivel + 1)::smallint, '{view}'::text[], 'acao', r.grupo, r.grupo_ordem
  FROM public.resources r
 WHERE r.key = 'clientes.modulos'
ON CONFLICT (key) DO NOTHING;

-- ------------------------------------------------- 2) cópia de Módulos
INSERT INTO public.role_permissions (role, resource_key, can_view, can_insert, can_update, can_delete)
SELECT rp.role, 'clientes.oem_licenca', rp.can_view, rp.can_insert, rp.can_update, rp.can_delete
  FROM public.role_permissions rp
 WHERE rp.resource_key = 'clientes.modulos'
ON CONFLICT DO NOTHING;

INSERT INTO public.tenant_role_permissions
  (tenant_id, role, resource_key, can_view, can_insert, can_update, can_delete, updated_by)
SELECT t.tenant_id, t.role, 'clientes.oem_licenca', t.can_view, t.can_insert, t.can_update, t.can_delete, t.updated_by
  FROM public.tenant_role_permissions t
 WHERE t.resource_key = 'clientes.modulos'
ON CONFLICT DO NOTHING;

INSERT INTO public.group_permissions
  (group_id, resource_key, can_view, can_insert, can_update, can_delete, updated_by)
SELECT g.group_id, 'clientes.oem_licenca', g.can_view, g.can_insert, g.can_update, g.can_delete, g.updated_by
  FROM public.group_permissions g
 WHERE g.resource_key = 'clientes.modulos'
ON CONFLICT DO NOTHING;

INSERT INTO public.user_permissions
  (tenant_id, user_id, resource_key, can_view, can_insert, can_update, can_delete, updated_by)
SELECT u.tenant_id, u.user_id, 'clientes.oem_licenca', u.can_view, u.can_insert, u.can_update, u.can_delete, u.updated_by
  FROM public.user_permissions u
 WHERE u.resource_key = 'clientes.modulos'
ON CONFLICT DO NOTHING;

-- ------------------------------------------------------------ 3) portão
CREATE OR REPLACE FUNCTION public.pode_mexer_licenca_oem(p_tenant_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(public.is_super_admin(), false)
      or (
        exists (select 1 from public.get_my_permissions() gp
                 where gp.resource_key = 'clientes.oem_licenca' and gp.can_view = true)
        and exists (select 1 from public.profiles p
                     where p.user_id = auth.uid() and p.tenant_id = p_tenant_id)
      );
$function$;

COMMENT ON FUNCTION public.pode_mexer_licenca_oem(uuid) IS
  'Mesma regua de Bloquear/Desativar licenca: clientes.oem_licenca (can_view) no mesmo tenant, ou super admin.';

-- ------------------------------------------------- 4) descrição de Módulos
UPDATE public.resources
   SET description = 'Ligado, a pessoa pode alterar os produtos e módulos do cliente.'
 WHERE key = 'clientes.modulos';
