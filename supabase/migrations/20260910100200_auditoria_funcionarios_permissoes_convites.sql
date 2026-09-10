-- Auditoria completa das acoes da tela Acessos da Equipe, parte 2: o que nao
-- mora em profiles.
--
--   Setor      -> funcionarios.department_id
--   Modulos    -> user_permissions
--   Cancelar convite -> delete em access_invites
--
-- Todas as tres gravam com fn_acting_user() e com o tenant tirado da propria
-- linha, pelos motivos explicados na migration 20260910100100.
--
-- O nome do setor vai gravado junto com o id de proposito: setor renomeado ou
-- apagado deixaria o historico antigo apontando para um id que nao diz mais
-- nada a quem for ler daqui a um ano.

-- ── Setor do funcionario ──────────────────────────────────────────────────
create or replace function public.fn_audit_funcionario_changes()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_ch jsonb := '{}'::jsonb;
  v_user_id uuid;
begin
  begin
    if old.department_id is distinct from new.department_id then
      v_ch := v_ch || jsonb_build_object('department_id', jsonb_build_object(
        'de', jsonb_build_object(
          'id', old.department_id,
          'nome', (select name from support_departments where id = old.department_id)),
        'para', jsonb_build_object(
          'id', new.department_id,
          'nome', (select name from support_departments where id = new.department_id))
      ));
    end if;
    if old.email is distinct from new.email then
      v_ch := v_ch || jsonb_build_object('funcionario_email',
        jsonb_build_object('de', old.email, 'para', new.email));
    end if;
    if old.ativo is distinct from new.ativo then
      v_ch := v_ch || jsonb_build_object('funcionario_ativo',
        jsonb_build_object('de', old.ativo, 'para', new.ativo));
    end if;
    if old.nome is distinct from new.nome then
      v_ch := v_ch || jsonb_build_object('funcionario_nome',
        jsonb_build_object('de', old.nome, 'para', new.nome));
    end if;
    if old.cargo is distinct from new.cargo then
      v_ch := v_ch || jsonb_build_object('funcionario_cargo',
        jsonb_build_object('de', old.cargo, 'para', new.cargo));
    end if;

    if v_ch = '{}'::jsonb then
      return new;
    end if;

    -- Pode nao existir usuario para este funcionario. A linha entra assim mesmo,
    -- identificada pelo funcionario_id no metadata.
    select user_id into v_user_id
      from profiles
     where funcionario_id = new.id and tenant_id = new.tenant_id
     limit 1;

    insert into public.audit_events
      (tenant_id, actor_user_id, target_user_id, event_type, metadata)
    values (
      new.tenant_id, public.fn_acting_user(), v_user_id, 'funcionarios.update',
      jsonb_build_object(
        'funcionario_id', new.id,
        'funcionario_nome', new.nome,
        'changes', v_ch
      )
    );
  exception when others then
    null;
  end;

  return new;
end;
$function$;

drop trigger if exists trg_audit_funcionario_changes on public.funcionarios;
create trigger trg_audit_funcionario_changes
  after update on public.funcionarios
  for each row execute function public.fn_audit_funcionario_changes();


-- ── Permissoes por usuario (coluna Modulos da tela) ───────────────────────
create or replace function public.fn_audit_user_permissions()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_ch jsonb := '{}'::jsonb;
  v_row record;
begin
  begin
    v_row := coalesce(new, old);

    if tg_op = 'INSERT' then
      v_ch := jsonb_build_object('permissao', jsonb_build_object(
        'de', null,
        'para', jsonb_build_object('view', new.can_view, 'insert', new.can_insert,
                                   'update', new.can_update, 'delete', new.can_delete)));
    elsif tg_op = 'DELETE' then
      v_ch := jsonb_build_object('permissao', jsonb_build_object(
        'de', jsonb_build_object('view', old.can_view, 'insert', old.can_insert,
                                 'update', old.can_update, 'delete', old.can_delete),
        'para', null));
    else
      if (old.can_view, old.can_insert, old.can_update, old.can_delete)
         is distinct from (new.can_view, new.can_insert, new.can_update, new.can_delete) then
        v_ch := jsonb_build_object('permissao', jsonb_build_object(
          'de', jsonb_build_object('view', old.can_view, 'insert', old.can_insert,
                                   'update', old.can_update, 'delete', old.can_delete),
          'para', jsonb_build_object('view', new.can_view, 'insert', new.can_insert,
                                     'update', new.can_update, 'delete', new.can_delete)));
      end if;
    end if;

    if v_ch <> '{}'::jsonb then
      insert into public.audit_events
        (tenant_id, actor_user_id, target_user_id, event_type, metadata)
      values (
        v_row.tenant_id, public.fn_acting_user(), v_row.user_id, 'user_permissions.update',
        jsonb_build_object('resource_key', v_row.resource_key, 'changes', v_ch)
      );
    end if;
  exception when others then
    null;
  end;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_audit_user_permissions on public.user_permissions;
create trigger trg_audit_user_permissions
  after insert or update or delete on public.user_permissions
  for each row execute function public.fn_audit_user_permissions();


-- ── Convite cancelado ─────────────────────────────────────────────────────
-- Criacao e aceite ja gravam (ACCESS_INVITE_CREATED / _ACCEPTED). O cancelamento
-- e um delete direto da tela e ate agora nao deixava rastro nenhum.
create or replace function public.fn_audit_access_invite_deleted()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  begin
    insert into public.audit_events
      (tenant_id, actor_user_id, target_user_id, event_type, metadata)
    values (
      old.tenant_id, public.fn_acting_user(), old.auth_user_id, 'ACCESS_INVITE_CANCELED',
      jsonb_build_object(
        'invite_id', old.id,
        'email', old.email,
        'funcionario_id', old.funcionario_id,
        'status_no_cancelamento', old.status
      )
    );
  exception when others then
    null;
  end;

  return old;
end;
$function$;

drop trigger if exists trg_audit_access_invite_deleted on public.access_invites;
create trigger trg_audit_access_invite_deleted
  after delete on public.access_invites
  for each row execute function public.fn_audit_access_invite_deleted();
