-- ============================================================================
-- DEM-0438 — quem pode mudar `support_departments.visible_department_ids`
--
-- A policy `support_departments_rw` deixa QUALQUER membro do tenant gravar no
-- setor (medido em produção em 01/10/2026). Com a coluna nova isso virou
-- escalada de acesso: um operador marcaria todos os setores no próprio, pela
-- API, e passaria a ler o chat inteiro — o RLS do chat confia nessa coluna.
--
-- A tela (Configurações › Distribuição) é guardada por `cfg.distribuicao`; aqui
-- o banco exige o mesmo, mais o papel: admin/head E a permissão de alterar.
-- `has_perm` devolve true para todo mundo quando o RBAC do tenant está
-- desligado — por isso o papel entra junto. Sem usuário (SQL Editor,
-- service_role) passa: é operação de sistema.
--
-- Só esta coluna é travada. O resto do setor segue com a policy de hoje;
-- endurecê-la é outra conversa (afeta todas as telas que gravam setor).
-- ============================================================================
begin;
set local lock_timeout = '5s';

create or replace function public.fn_guard_visible_department_ids()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if tg_op = 'UPDATE'
     and new.visible_department_ids is not distinct from old.visible_department_ids then
    return new;
  end if;
  if tg_op = 'INSERT' and coalesce(cardinality(new.visible_department_ids), 0) = 0 then
    return new;
  end if;

  if auth.uid() is null then
    return new;
  end if;

  -- coalesce: is_super_admin()/has_perm podem devolver NULL, e `not NULL` não barra.
  if coalesce(public.is_super_admin(), false) then
    return new;
  end if;
  if not (coalesce(public.is_admin_or_head(), false)
          and coalesce(public.has_perm('cfg.distribuicao', 'update'), false)) then
    raise exception 'Sem permissão para alterar quais setores este setor enxerga'
      using errcode = '42501';
  end if;

  -- Só setores do mesmo tenant, e nunca o próprio.
  new.visible_department_ids := coalesce(array(
    select distinct d.id
    from unnest(new.visible_department_ids) as v(id)
    join public.support_departments d on d.id = v.id
    where d.tenant_id = new.tenant_id
      and d.id <> new.id
  ), '{}'::uuid[]);

  return new;
end $$;

revoke all on function public.fn_guard_visible_department_ids() from public, anon, authenticated;

drop trigger if exists trg_guard_visible_department_ids on public.support_departments;
create trigger trg_guard_visible_department_ids
  before insert or update of visible_department_ids on public.support_departments
  for each row execute function public.fn_guard_visible_department_ids();

commit;
