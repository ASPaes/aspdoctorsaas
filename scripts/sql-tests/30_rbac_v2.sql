-- Testes do RBAC v2. Cada bloco corresponde a um bug do pré-mortem.
-- Rodar: docker exec -i supabase_db_... psql -U postgres -d postgres < este arquivo
\set ON_ERROR_STOP on
\timing off
begin;

create temp table res(t text, ok boolean, detalhe text);
do $$
declare
  v_tenant uuid; v_admin uuid; v_gadm uuid; v_gope uuid; v_novo uuid;
  v_ok boolean; v_msg text; v_view boolean; v_n int;
begin
  select id into v_tenant from public.tenants where nome='ASP';
  select p.user_id into v_admin from public.profiles p
   where p.tenant_id=v_tenant and p.role='admin' and coalesce(p.status,'ativo')='ativo'
     and not p.is_super_admin limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin)::text, true);

  select id into v_gadm from public.permission_groups where tenant_id=v_tenant and slug='administrador';
  select id into v_gope from public.permission_groups where tenant_id=v_tenant and slug='operador';

  -- T1 · D7 cascata: negar o pai nega os filhos
  perform public.rbac_set_group_permission(v_gope, 'clientes', 'view', true);
  perform public.rbac_set_group_permission(v_gope, 'clientes.custos', 'view', true);
  perform public.rbac_set_group_permission(v_gope, 'clientes', 'view', false);
  select can_view into v_view from public.group_permissions
   where group_id=v_gope and resource_key='clientes.custos';
  insert into res values ('T1 cascata pai→filho nega o filho', v_view is false, 'custos='||v_view::text);

  -- T2 · anti-lockout de célula
  begin
    perform public.rbac_set_group_permission(v_gadm, 'cfg.permissoes', 'update', false);
    insert into res values ('T2 anti-lockout bloqueia', false, 'NAO bloqueou');
  exception when others then
    insert into res values ('T2 anti-lockout bloqueia', sqlerrm ilike '%anti-lockout%', sqlerrm);
  end;

  -- T3 · B1: descer de nível não pode aumentar acesso
  perform public.rbac_set_module_level(v_tenant,'clientes',3::smallint);
  perform public.rbac_set_group_permission(v_gope, 'clientes', 'view', true);
  perform public.rbac_set_group_permission(v_gope, 'clientes.oem_aprovacao', 'view', false);
  perform public.rbac_set_module_level(v_tenant,'clientes',1::smallint);
  select can_view into v_view from public.group_permissions
   where group_id=v_gope and resource_key='clientes.oem_aprovacao';
  insert into res values ('T3 descer de nivel NAO concede acesso', v_view is false, 'oem_aprovacao='||coalesce(v_view::text,'null'));

  -- T4 · B2: duplicar copia todas as regras
  v_novo := public.rbac_duplicate_group(v_gope, 'Operador Financeiro');
  select count(*) into v_n from public.group_permissions where group_id=v_novo;
  insert into res values ('T4 duplicar copia as regras', v_n > 0, v_n||' regras copiadas');

  -- T5 · grupo de sistema não pode ser excluído
  begin
    perform public.rbac_delete_group(v_gadm);
    insert into res values ('T5 grupo base nao e excluivel', false, 'NAO bloqueou');
  exception when others then
    insert into res values ('T5 grupo base nao e excluivel', sqlerrm ilike '%base%', sqlerrm);
  end;

  -- T6 · D6: um grupo por pessoa (atribuir substitui, não acumula)
  perform public.rbac_assign_user_group(v_admin, v_novo);
  select count(*) into v_n from public.user_groups where user_id=v_admin;
  perform public.rbac_assign_user_group(v_admin, v_gadm);
  insert into res values ('T6 um grupo por pessoa', v_n = 1, v_n||' vinculo(s)');

  -- T7 · grupo com membros não pode ser excluído
  perform public.rbac_assign_user_group(
    (select user_id from public.profiles where tenant_id=v_tenant and role='user' limit 1), v_novo);
  begin
    perform public.rbac_delete_group(v_novo);
    insert into res values ('T7 grupo com gente nao e excluivel', false, 'NAO bloqueou');
  exception when others then
    insert into res values ('T7 grupo com gente nao e excluivel', sqlerrm ilike '%pessoa%', sqlerrm);
  end;

  -- T8 · quem não é admin não edita
  perform set_config('request.jwt.claims', json_build_object('sub',
    (select user_id from public.profiles where tenant_id=v_tenant and role='user' limit 1))::text, true);
  begin
    perform public.rbac_set_group_permission(v_gope, 'nav.clientes', 'view', false);
    insert into res values ('T8 operador nao edita permissao', false, 'NAO bloqueou');
  exception when others then
    insert into res values ('T8 operador nao edita permissao', sqlerrm ilike '%admin%', sqlerrm);
  end;

  -- T9 · escopo só existe no motor v2
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin)::text, true);
  insert into res values ('T9 perm_scope responde', public.perm_scope('clientes','view') is not null,
                          'escopo='||public.perm_scope('clientes','view'));

  -- T10 · has_perm dormente: nenhuma policy usa
  select count(*) into v_n from pg_policies
   where schemaname='public' and (coalesce(qual,'')||coalesce(with_check,'')) ilike '%has_perm%';
  insert into res values ('T10 has_perm ainda dormente (0 policies)', v_n = 0, v_n||' policies');
end $$;

select case when ok then '✅' else '❌' end as st, t as teste, detalhe from res order by t;
select count(*) filter (where ok) as passou, count(*) filter (where not ok) as falhou from res;
rollback;
