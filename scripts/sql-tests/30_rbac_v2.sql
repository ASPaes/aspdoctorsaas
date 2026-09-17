-- Testes do RBAC v2. Cada bloco corresponde a um bug do pré-mortem.
-- Rodar: docker exec -i supabase_db_... psql -U postgres -d postgres < este arquivo
\set ON_ERROR_STOP on
\timing off
begin;

create temp table res(t text, ok boolean, detalhe text);
do $$
declare
  v_tenant uuid; v_admin uuid; v_gadm uuid; v_gope uuid; v_novo uuid;
  v_ok boolean; v_msg text; v_view boolean; v_n int; v_outro uuid; v_alvo uuid; v_role text;
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
  -- Usa OUTRA pessoa: ninguém pode trocar o próprio grupo (ver T12).
  select p.user_id into v_outro from public.profiles p
   where p.tenant_id=v_tenant and p.user_id <> v_admin
     and coalesce(p.status,'ativo')='ativo' and p.role='user' limit 1;
  perform public.rbac_assign_user_group(v_outro, v_novo);
  select count(*) into v_n from public.user_groups where user_id=v_outro;
  perform public.rbac_assign_user_group(v_outro, v_gope);
  insert into res values ('T6 um grupo por pessoa', v_n = 1, v_n||' vinculo(s)');

  -- T7 · grupo com membros não pode ser excluído
  perform public.rbac_assign_user_group(v_outro, v_novo);
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

  perform set_config('request.jwt.claims', json_build_object('sub', v_admin)::text, true);

  -- T11 · vincular pessoa a grupo atualiza o papel legado (D8)
  select user_id into v_alvo from public.profiles
   where tenant_id=v_tenant and user_id <> v_admin and role='user'
     and coalesce(status,'ativo')='ativo' limit 1;
  perform public.rbac_assign_user_group(v_alvo, v_gadm);
  select role into v_role from public.profiles where user_id=v_alvo;
  insert into res values ('T11 vinculo atualiza profiles.role (D8)', v_role='admin', 'role='||coalesce(v_role,'null'));

  -- T12 · ninguem troca o proprio grupo
  begin
    perform public.rbac_assign_user_group(v_admin, v_gope);
    insert into res values ('T12 nao troca o proprio grupo', false, 'NAO bloqueou');
  exception when others then
    insert into res values ('T12 nao troca o proprio grupo', sqlerrm ilike '%proprio%', sqlerrm);
  end;

  -- T13 · o escopo de linha saiu por inteiro (15/09): nenhuma coluna, função
  -- ou policy dele pode voltar sem decisão nova.
  select (select count(*) from information_schema.columns
           where table_schema='public' and column_name ilike 'escopo%'
             and table_name in ('group_permissions','resources','permission_audit'))
       + (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
           where n.nspname='public' and p.proname in ('perm_scope','my_departments','rbac_set_group_scope'))
       + (select count(*) from pg_policies
           where schemaname='public' and policyname in ('rbac_conversas_escopo','rbac_tickets_escopo'))
    into v_n;
  insert into res values ('T13 escopo de linha removido', v_n = 0, v_n||' sobras');

  -- T15 · descer de nível também não pode DIMINUIR o que a herança dava
  -- (o filho sem linha propria herda do tenant/global; materializar como
  --  `false` rebaixava quem estava liberado)
  delete from public.group_permissions
   where group_id=v_gadm and resource_key='clientes.oem_aprovacao';
  perform public.rbac_set_module_level(v_tenant,'clientes',3::smallint);
  perform public.rbac_set_module_level(v_tenant,'clientes',1::smallint);
  select can_view into v_view from public.group_permissions
   where group_id=v_gadm and resource_key='clientes.oem_aprovacao';
  insert into res values ('T15 descer de nivel NAO diminui heranca',
    v_view is true, 'admin/oem_aprovacao='||coalesce(v_view::text,'null'));

  -- T10 · F4 aplicada: has_perm protege as tabelas sensiveis, e SEMPRE restritiva
  select count(*) into v_n from pg_policies
   where schemaname='public' and (coalesce(qual,'')||coalesce(with_check,'')) ilike '%has_perm%';
  insert into res values ('T10 F4: has_perm no RLS', v_n >= 10, v_n||' policies');

  -- T10b · policy de RBAC NOVA nasce RESTRICTIVE: PERMISSIVE soma com OU e
  -- AMPLIA o acesso, em silêncio.
  -- As 3 da lista são a exceção conhecida, e o motivo importa: nelas o has_perm
  -- não criou ramo novo — ele SUBSTITUIU o `is_admin_or_head()` dentro da policy
  -- original, que já concedia ("vê todos os setores"). O ramo ficou mais
  -- estreito (empresa + permissão), então restringe. Qualquer OUTRA permissiva
  -- citando has_perm continua sendo falha.
  select count(*) into v_n from pg_policies
   where schemaname='public' and permissive='PERMISSIVE'
     and (coalesce(qual,'')||coalesce(with_check,'')) ilike '%has_perm%'
     and policyname not in ('whatsapp_conversations_select','support_attendances_select','whatsapp_messages_select');
  insert into res values ('T10b nenhuma permissiva de RBAC fora da lista', v_n = 0, v_n||' permissivas');

  -- T10d · o Chat continua decidindo por PERMISSÃO, e nas 3 tabelas.
  -- Se alguém recolocar o papel no lugar da permissão, isto fica vermelho.
  select count(*) into v_n from pg_policies
   where schemaname='public'
     and policyname in ('whatsapp_conversations_select','support_attendances_select','whatsapp_messages_select')
     and coalesce(qual,'') ilike '%atend.todos_setores%';
  insert into res values ('T10d chat: ver todos os setores e permissao', v_n = 3, v_n||' de 3 policies');

  -- T10c · as funcoes de RLS sao PARALLEL SAFE (senao desligam o scan paralelo)
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname = 'has_perm'
     and p.proparallel <> 's';
  insert into res values ('T10c funcoes de RLS sao parallel safe', v_n = 0, v_n||' inseguras');
end $$;

select case when ok then '✅' else '❌' end as st, t as teste, detalhe from res order by t;
select count(*) filter (where ok) as passou, count(*) filter (where not ok) as falhou from res;
rollback;
