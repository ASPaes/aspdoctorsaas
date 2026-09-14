-- A tela passa a mostrar O CAMINHO ate a funcionalidade no lugar da chave
-- tecnica. `where_it_appears` e `description` ja estavam preenchidos nos 143
-- recursos — a informacao que responde "onde eu acho isso?" existia e nao
-- estava sendo usada.
begin;

-- Acentuacao que faltou nas migrations anteriores.
update public.resources set where_it_appears = replace(where_it_appears,'Implantacao','Implantação') where where_it_appears like '%Implantacao%';
update public.resources set where_it_appears = replace(where_it_appears,'Configuracoes','Configurações') where where_it_appears like '%Configuracoes%';
update public.resources set where_it_appears = replace(where_it_appears,'Aprovacao','Aprovação') where where_it_appears like '%Aprovacao%';
update public.resources set where_it_appears = replace(where_it_appears,'Mencoes','Menções') where where_it_appears like '%Mencoes%';
update public.resources set where_it_appears = replace(where_it_appears,'Historico','Histórico') where where_it_appears like '%Historico%';
update public.resources set where_it_appears = replace(where_it_appears,'Satisfacao','Satisfação') where where_it_appears like '%Satisfacao%';
update public.resources set where_it_appears = replace(where_it_appears,'Distribuicao','Distribuição') where where_it_appears like '%Distribuicao%';
update public.resources set where_it_appears = replace(where_it_appears,'Configuracao','Configuração') where where_it_appears like '%Configuracao%';
update public.resources set where_it_appears = replace(where_it_appears,'Papeis','Papéis') where where_it_appears like '%Papeis%';
update public.resources set where_it_appears = replace(where_it_appears,'Visao','Visão') where where_it_appears like '%Visao%';
-- ">" vira "›" para o caminho parecer navegacao, nao codigo.
update public.resources set where_it_appears = replace(where_it_appears,' > ',' › ') where where_it_appears like '% > %';

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
                  'module_id',r.module_id,'parent_key',r.parent_key,'nivel',r.nivel,'ordem',r.display_order,
                  'acoes',r.acoes,'escopo_aplicavel',r.escopo_aplicavel,'escopos_validos',r.escopos_validos
                ) order by r.display_order),'[]'::jsonb)
                from public.resources r where not r.hidden),
    'permissoes', (select coalesce(jsonb_agg(jsonb_build_object(
                  'group_id',gp.group_id,'key',gp.resource_key,'view',gp.can_view,
                  'insert',gp.can_insert,'update',gp.can_update,'delete',gp.can_delete,'escopo',gp.escopo)),'[]'::jsonb)
                from public.group_permissions gp
                join public.permission_groups g on g.id=gp.group_id where g.tenant_id=v_tenant)
  );
end $$;
commit;
