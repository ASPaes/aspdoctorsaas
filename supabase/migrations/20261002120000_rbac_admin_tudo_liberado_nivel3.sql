-- Decisão do Alexandre (02/10/2026): em todas as empresas, na tela de Permissões,
-- (1) todo módulo fica no nível 3 e (2) o perfil Administrador tem tudo liberado.
--
-- (1) O nível é só de exibição: get_my_permissions / has_perm / rbac_pode não leem
--     tenant_module_levels, e SUBIR de nível não materializa nada
--     (rbac_set_module_level só grava quando desce). Ninguém muda de acesso por isso.
-- (2) Só grupos nivel_base='admin' e só itens visíveis (hidden=false) — nav.financeiro
--     é escondido e fica como está. Fica gravado em permission_audit em nome do
--     Alexandre, para que nenhuma semeadura futura trate como valor de máquina.

-- Auditoria antes, enquanto o valor antigo ainda existe.
insert into public.permission_audit
  (tenant_id, role, resource_key, action, old_value, new_value, changed_by, group_id)
select g.tenant_id, 'admin', r.key, 'granted',
       jsonb_build_object(a.acao, a.antes),
       jsonb_build_object(a.acao, true),
       (select id from auth.users where email = 'asp@aspsoftwares.com.br'),
       g.id
from public.permission_groups g
cross join public.resources r
left join public.group_permissions gp
  on gp.group_id = g.id and gp.resource_key = r.key
left join public.tenant_role_permissions trp
  on trp.tenant_id = g.tenant_id and trp.role = 'admin' and trp.resource_key = r.key
left join public.role_permissions rp
  on rp.role = 'admin' and rp.resource_key = r.key
cross join lateral (values
  ('view',   coalesce(gp.can_view,   trp.can_view,   rp.can_view,   false)),
  ('insert', coalesce(gp.can_insert, trp.can_insert, rp.can_insert, false)),
  ('update', coalesce(gp.can_update, trp.can_update, rp.can_update, false)),
  ('delete', coalesce(gp.can_delete, trp.can_delete, rp.can_delete, false))
) as a(acao, antes)
where g.nivel_base = 'admin'
  and not r.hidden
  and a.acao = any(r.acoes)
  and not a.antes;

insert into public.group_permissions
  (group_id, resource_key, can_view, can_insert, can_update, can_delete, updated_by)
select g.id, r.key, true, true, true, true,
       (select id from auth.users where email = 'asp@aspsoftwares.com.br')
from public.permission_groups g
cross join public.resources r
where g.nivel_base = 'admin'
  and not r.hidden
on conflict (group_id, resource_key) do update
  set can_view = true, can_insert = true, can_update = true, can_delete = true,
      updated_at = now(), updated_by = excluded.updated_by
  where not (group_permissions.can_view and group_permissions.can_insert
             and group_permissions.can_update and group_permissions.can_delete);

insert into public.tenant_module_levels (tenant_id, module_id, nivel, updated_by)
select t.id, m.id, 3, (select id from auth.users where email = 'asp@aspsoftwares.com.br')
from public.tenants t
cross join public.permission_modules m
on conflict (tenant_id, module_id) do update
  set nivel = 3, updated_at = now(), updated_by = excluded.updated_by
  where tenant_module_levels.nivel <> 3;
