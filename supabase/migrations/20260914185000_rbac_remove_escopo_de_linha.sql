-- ============================================================================
-- RBAC — remove o escopo de linha ("Quais linhas")
--
-- Decisao do owner em 15/09/2026. O escopo estava errado nos dois pontos que
-- importam:
--   · "Todas" nunca abria outro setor: a policy de conversas que ja existe e
--     PERMISSIVE e continua valendo por baixo; a RESTRICTIVE so conseguia tirar.
--   · `my_departments()` lia `support_department_members`, mas o setor da
--     pessoa, na tela e no banco, e `funcionarios.department_id`
--     (`current_user_department_id()`).
--
-- O que vem no lugar: permissoes com o nome do que acontece na tela (ver
-- "Ver conversas de todos os setores" etc.), semeadas igual a hoje.
--
-- Nada se perde: no banco local as 5.162 linhas de group_permissions estavam
-- em 'todos' (o seletor nunca foi usado) e produção nunca teve escopo.
-- ============================================================================
begin;

-- --------------------------------------------------------------- policies
drop policy if exists rbac_conversas_escopo on public.whatsapp_conversations;
drop policy if exists rbac_tickets_escopo   on public.support_tickets;

-- --------------------------------------------------------------- funções
drop function if exists public.rbac_set_group_scope(uuid, text, text);
drop function if exists public.perm_scope(text, text);
drop function if exists public.my_departments();

-- ------------------------------------------ duplicar grupo, sem o escopo
create or replace function public.rbac_duplicate_group(p_source_group_id uuid, p_nome text)
returns uuid language plpgsql security definer set search_path='public','pg_catalog' as $$
declare v_tenant uuid; v_base text; v_novo uuid; v_slug text; v_uid uuid := auth.uid();
begin
  select tenant_id, nivel_base into v_tenant, v_base
  from public.permission_groups where id = p_source_group_id;
  if v_tenant is null then raise exception 'Grupo de origem inexistente'; end if;
  perform public.rbac_assert_admin(v_tenant);
  if coalesce(trim(p_nome),'') = '' then raise exception 'Informe o nome do grupo'; end if;

  v_slug := regexp_replace(lower(trim(p_nome)), '[^a-z0-9]+', '-', 'g');
  if exists (select 1 from public.permission_groups where tenant_id=v_tenant and slug=v_slug) then
    v_slug := v_slug || '-' || substr(md5(random()::text),1,4);
  end if;

  insert into public.permission_groups (tenant_id, nome, slug, nivel_base, is_system, ordem, created_by)
  values (v_tenant, trim(p_nome), v_slug, v_base, false,
          coalesce((select max(ordem)+10 from public.permission_groups where tenant_id=v_tenant),100), v_uid)
  returning id into v_novo;

  insert into public.group_permissions (group_id, resource_key, can_view, can_insert, can_update, can_delete, updated_by)
  select v_novo, gp.resource_key, gp.can_view, gp.can_insert, gp.can_update, gp.can_delete, v_uid
  from public.group_permissions gp where gp.group_id = p_source_group_id;

  return v_novo;
end $$;

-- ------------------------------------------- leitura da tela, sem o escopo
create or replace function public.rbac_get_config(p_tenant_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path='public','pg_catalog' as $$
declare v_tenant uuid;
begin
  v_tenant := public.rbac_assert_admin(p_tenant_id);
  return jsonb_build_object(
    'tenant_id', v_tenant,
    'v2_ligado', (select rbac_v2_enabled from public.tenants where id=v_tenant),
    'modulos', (select coalesce(jsonb_agg(jsonb_build_object(
                  'id',m.id,'nome',m.nome,'descricao',m.descricao,'ordem',m.ordem,
                  'nivel', coalesce(l.nivel,1)) order by m.ordem),'[]'::jsonb)
                from public.permission_modules m
                left join public.tenant_module_levels l on l.module_id=m.id and l.tenant_id=v_tenant),
    'grupos', (select coalesce(jsonb_agg(jsonb_build_object(
                  'id',g.id,'nome',g.nome,'slug',g.slug,'nivel_base',g.nivel_base,
                  'is_system',g.is_system,'ordem',g.ordem,
                  'membros',(select count(*) from public.user_groups ug where ug.group_id=g.id)
                ) order by g.ordem),'[]'::jsonb)
               from public.permission_groups g where g.tenant_id=v_tenant),
    'recursos', (select coalesce(jsonb_agg(jsonb_build_object(
                  'key',r.key,'label',r.label,'descricao',r.description,
                  'caminho',r.where_it_appears,'secao',r.secao,
                  'grupo',r.grupo,'grupo_ordem',r.grupo_ordem,
                  'module_id',r.module_id,'parent_key',r.parent_key,'nivel',r.nivel,'ordem',r.display_order,
                  'acoes',r.acoes
                ) order by r.display_order),'[]'::jsonb)
                from public.resources r where not r.hidden),
    'permissoes', (select coalesce(jsonb_agg(jsonb_build_object(
                  'group_id',gp.group_id,'key',gp.resource_key,'view',gp.can_view,
                  'insert',gp.can_insert,'update',gp.can_update,'delete',gp.can_delete)),'[]'::jsonb)
                from public.group_permissions gp
                join public.permission_groups g on g.id=gp.group_id where g.tenant_id=v_tenant)
  );
end $$;

-- --------------------------------------------------------------- colunas
-- Auditoria de escopo so existe de teste no local; sem as colunas ela nao
-- diz mais nada.
delete from public.permission_audit where action = 'escopo';
alter table public.permission_audit
  drop column if exists escopo_old,
  drop column if exists escopo_new;

alter table public.group_permissions drop column if exists escopo;

alter table public.resources
  drop column if exists escopo_aplicavel,
  drop column if exists escopos_validos;

commit;
