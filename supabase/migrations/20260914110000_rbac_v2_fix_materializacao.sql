-- ============================================================================
-- CORREÇÃO — a materialização ao descer de nível podia REBAIXAR acesso
--
-- A primeira versão calculava o valor do filho como `coalesce(gp.can_view,false)`.
-- Quando o recurso não tinha linha própria de grupo, o valor real dele vinha da
-- herança (regra do tenant, senão padrão global) — e a materialização gravava
-- `false` por cima.
--
-- Medido: ao descer o módulo Clientes para o nível 1, os 5 admins do ASP
-- perderam `clientes.oem_aprovacao`, que o padrão global liberava.
--
-- O bug B1 dizia "descer de nível nunca pode AUMENTAR acesso". Faltava a outra
-- metade: também não pode DIMINUIR. Descer de nível esconde item da tela — não
-- é uma decisão de acesso. O valor gravado tem que ser o EFETIVO de hoje,
-- apenas limitado pelo pai.
--
-- Esta migration também passa a registrar a troca de nível em permission_audit:
-- sem isso, uma mudança que mexe em dezenas de linhas não deixava rastro.
-- ============================================================================
begin;

create or replace function public.rbac_set_module_level(
  p_tenant_id uuid, p_module_id text, p_nivel smallint)
returns jsonb language plpgsql security definer set search_path='public','pg_catalog' as $$
declare v_tenant uuid; v_uid uuid := auth.uid(); v_atual smallint; v_mat int := 0;
begin
  v_tenant := public.rbac_assert_admin(p_tenant_id);
  if p_nivel not between 1 and 3 then raise exception 'Nivel invalido: %', p_nivel; end if;

  select nivel into v_atual from public.tenant_module_levels
   where tenant_id = v_tenant and module_id = p_module_id;

  if v_atual is not null and p_nivel < v_atual then
    with saindo as (
      select r.key, r.parent_key
      from public.resources r
      where r.module_id = p_module_id and r.nivel > p_nivel
    ),
    -- Valor EFETIVO de hoje, pela mesma cadeia que o motor usa.
    efetivo as (
      select g.id as group_id, s.key, s.parent_key,
             coalesce(gpf.can_view, trpf.can_view, rpf.can_view, false) as filho,
             case when s.parent_key is null then true
                  else coalesce(gpp.can_view, trpp.can_view, rpp.can_view, false) end as pai
      from public.permission_groups g
      cross join saindo s
      left join public.group_permissions gpf
        on gpf.group_id = g.id and gpf.resource_key = s.key
      left join public.tenant_role_permissions trpf
        on trpf.tenant_id = g.tenant_id and trpf.role = g.nivel_base and trpf.resource_key = s.key
      left join public.role_permissions rpf
        on rpf.role = g.nivel_base and rpf.resource_key = s.key
      left join public.group_permissions gpp
        on gpp.group_id = g.id and gpp.resource_key = s.parent_key
      left join public.tenant_role_permissions trpp
        on trpp.tenant_id = g.tenant_id and trpp.role = g.nivel_base and trpp.resource_key = s.parent_key
      left join public.role_permissions rpp
        on rpp.role = g.nivel_base and rpp.resource_key = s.parent_key
      where g.tenant_id = v_tenant
    )
    insert into public.group_permissions (group_id, resource_key, can_view, updated_by)
    -- mais restritivo entre o efetivo do filho e o do pai: nao aumenta (B1)
    -- e nao diminui o que a heranca ja dava.
    select e.group_id, e.key, (e.filho and e.pai), v_uid from efetivo e
    on conflict (group_id, resource_key) do update
      set can_view = excluded.can_view, updated_at = now(), updated_by = v_uid;
    get diagnostics v_mat = row_count;
  end if;

  insert into public.tenant_module_levels (tenant_id, module_id, nivel, updated_by)
  values (v_tenant, p_module_id, p_nivel, v_uid)
  on conflict (tenant_id, module_id) do update set nivel=excluded.nivel, updated_at=now(), updated_by=v_uid;

  insert into public.permission_audit
    (tenant_id, role, resource_key, action, old_value, new_value, changed_by)
  values (v_tenant, 'n/a', '(nivel do modulo '||p_module_id||')', 'nivel',
          jsonb_build_object('nivel', v_atual),
          jsonb_build_object('nivel', p_nivel, 'materializados', v_mat), v_uid);

  perform public.rbac_assert_sem_lockout(v_tenant);
  return jsonb_build_object('status','ok','materializados',v_mat);
end $$;

-- Desfaz o estrago: onde a materializacao gravou `false` mas a heranca daria
-- `true`, e o pai permite, devolve o valor efetivo.
update public.group_permissions gp
   set can_view = true, updated_at = now()
  from public.permission_groups g, public.resources r
 where g.id = gp.group_id
   and r.key = gp.resource_key
   and gp.can_view = false
   and coalesce(
        (select trp.can_view from public.tenant_role_permissions trp
          where trp.tenant_id=g.tenant_id and trp.role=g.nivel_base and trp.resource_key=r.key),
        (select rp.can_view from public.role_permissions rp
          where rp.role=g.nivel_base and rp.resource_key=r.key),
        false) = true
   and (r.parent_key is null or coalesce(
        (select gpp.can_view from public.group_permissions gpp
          where gpp.group_id=g.id and gpp.resource_key=r.parent_key),
        (select trp.can_view from public.tenant_role_permissions trp
          where trp.tenant_id=g.tenant_id and trp.role=g.nivel_base and trp.resource_key=r.parent_key),
        (select rp.can_view from public.role_permissions rp
          where rp.role=g.nivel_base and rp.resource_key=r.parent_key),
        false) = true);

commit;
