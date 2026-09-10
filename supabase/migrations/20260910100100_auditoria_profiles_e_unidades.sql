-- Auditoria completa das acoes da tela Acessos da Equipe, parte 1: profiles.
--
-- O que ja existia: trg_profiles_audit_and_guard registrava role, access_status,
-- funcionario_id e tenant_id. Sao 164 linhas desde marco/2026. O que ficava de
-- fora e aparece na mesma tela: status ativo/inativo, limite de chats
-- simultaneos, competencias e acesso a todas as unidades.
--
-- Duas correcoes de fundo em relacao ao que estava aqui antes:
--
--   1. auth.uid() vira fn_acting_user(). Escrita vinda de edge function roda
--      como service_role, onde auth.uid() e NULL: o registro nascia sem autor e
--      a coluna "quem fez" ficava vazia justamente nas acoes automatizadas.
--
--   2. O tenant sai da propria linha, nao de current_tenant_id(). Pelo mesmo
--      motivo: em contexto service_role ele volta NULL, a linha nasce com
--      tenant_id NULL e SOME no RLS -- auditoria gravada e invisivel e pior do
--      que auditoria ausente, porque ninguem percebe.
--
-- O formato do metadata muda para um par de/para por campo:
--   {"changes": {"role": {"de": "user", "para": "head"}}}
-- As linhas antigas seguem no formato {"old": {...}, "new": {...}}; a tela le
-- os dois.

create or replace function public.trg_profiles_audit_and_guard()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_ch jsonb := '{}'::jsonb;
begin
  -- Guarda original, inalterada: ativar sem funcionario_id volta para pending,
  -- exceto admin/super_admin, que nao precisam de vinculo.
  if (new.access_status = 'active')
     and (new.funcionario_id is null)
     and (new.role not in ('admin', 'super_admin'))
     and (new.is_super_admin = false) then
    new.access_status := 'pending';
  end if;

  -- Auditoria nunca derruba o fluxo: quem grava perfil nao pode falhar porque
  -- o registro do historico falhou.
  begin
    if tg_op = 'INSERT' then
      insert into public.audit_events
        (tenant_id, actor_user_id, target_user_id, event_type, metadata)
      values (
        new.tenant_id, public.fn_acting_user(), new.user_id, 'profiles.insert',
        jsonb_build_object(
          'role', new.role,
          'access_status', new.access_status,
          'status', new.status,
          'funcionario_id', new.funcionario_id,
          'tenant_id', new.tenant_id
        )
      );
      return new;
    end if;

    if old.role is distinct from new.role then
      v_ch := v_ch || jsonb_build_object('role',
        jsonb_build_object('de', old.role, 'para', new.role));
    end if;
    if old.access_status is distinct from new.access_status then
      v_ch := v_ch || jsonb_build_object('access_status',
        jsonb_build_object('de', old.access_status, 'para', new.access_status));
    end if;
    if old.status is distinct from new.status then
      v_ch := v_ch || jsonb_build_object('status',
        jsonb_build_object('de', old.status, 'para', new.status));
    end if;
    if old.funcionario_id is distinct from new.funcionario_id then
      v_ch := v_ch || jsonb_build_object('funcionario_id',
        jsonb_build_object('de', old.funcionario_id, 'para', new.funcionario_id));
    end if;
    if old.tenant_id is distinct from new.tenant_id then
      v_ch := v_ch || jsonb_build_object('tenant_id',
        jsonb_build_object('de', old.tenant_id, 'para', new.tenant_id));
    end if;
    if old.max_concurrent_chats is distinct from new.max_concurrent_chats then
      v_ch := v_ch || jsonb_build_object('max_concurrent_chats',
        jsonb_build_object('de', old.max_concurrent_chats, 'para', new.max_concurrent_chats));
    end if;
    if old.skills is distinct from new.skills then
      v_ch := v_ch || jsonb_build_object('skills',
        jsonb_build_object('de', to_jsonb(old.skills), 'para', to_jsonb(new.skills)));
    end if;
    if old.acesso_todas_unidades is distinct from new.acesso_todas_unidades then
      v_ch := v_ch || jsonb_build_object('acesso_todas_unidades',
        jsonb_build_object('de', old.acesso_todas_unidades, 'para', new.acesso_todas_unidades));
    end if;
    if old.is_super_admin is distinct from new.is_super_admin then
      v_ch := v_ch || jsonb_build_object('is_super_admin',
        jsonb_build_object('de', old.is_super_admin, 'para', new.is_super_admin));
    end if;

    if v_ch <> '{}'::jsonb then
      insert into public.audit_events
        (tenant_id, actor_user_id, target_user_id, event_type, metadata)
      values (
        coalesce(new.tenant_id, old.tenant_id), public.fn_acting_user(),
        new.user_id, 'profiles.update',
        jsonb_build_object('changes', v_ch)
      );
    end if;
  exception when others then
    null;
  end;

  return new;
end;
$function$;


-- Unidades: a lista vive em profile_unidades e e reescrita inteira pela RPC.
-- Auditar por trigger de linha daria uma linha de historico por unidade; o que
-- interessa e a lista antes e a lista depois, entao o registro sai daqui.
create or replace function public.admin_set_user_unidades(
  p_target_user_id uuid,
  p_todas boolean,
  p_unidade_ids bigint[] default array[]::bigint[]
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_target_tenant uuid;
  v_caller_tenant uuid;
  v_todas_antes boolean;
  v_ids_antes bigint[];
  v_ids_depois bigint[];
begin
  select tenant_id, acesso_todas_unidades
    into v_target_tenant, v_todas_antes
    from profiles where user_id = p_target_user_id;
  if v_target_tenant is null then
    raise exception 'Usuário não encontrado';
  end if;

  select tenant_id into v_caller_tenant from profiles where user_id = auth.uid();

  -- Gate: super admin, ou admin do MESMO tenant do alvo
  if not (
    public.is_super_admin()
    or (public.is_tenant_admin() and v_target_tenant = v_caller_tenant)
  ) then
    raise exception 'Sem permissão para alterar acesso de unidade';
  end if;

  select coalesce(array_agg(unidade_base_id order by unidade_base_id), '{}')
    into v_ids_antes
    from profile_unidades where user_id = p_target_user_id;

  if p_todas then
    update profiles set acesso_todas_unidades = true where user_id = p_target_user_id;
    delete from profile_unidades where user_id = p_target_user_id;
    v_ids_depois := '{}';
  else
    if coalesce(array_length(p_unidade_ids, 1), 0) = 0 then
      raise exception 'Selecione ao menos uma unidade';
    end if;
    -- todas as unidades devem pertencer ao tenant do alvo
    if exists (
      select 1 from unnest(p_unidade_ids) uid
      where uid not in (select id from unidades_base where tenant_id = v_target_tenant)
    ) then
      raise exception 'Unidade inválida para o tenant do usuário';
    end if;
    update profiles set acesso_todas_unidades = false where user_id = p_target_user_id;
    delete from profile_unidades where user_id = p_target_user_id;
    insert into profile_unidades (user_id, unidade_base_id, tenant_id)
    select p_target_user_id, uid, v_target_tenant from unnest(p_unidade_ids) uid;

    select coalesce(array_agg(unidade_base_id order by unidade_base_id), '{}')
      into v_ids_depois
      from profile_unidades where user_id = p_target_user_id;
  end if;

  begin
    if (coalesce(v_todas_antes, false) is distinct from coalesce(p_todas, false))
       or (v_ids_antes is distinct from v_ids_depois) then
      insert into public.audit_events
        (tenant_id, actor_user_id, target_user_id, event_type, metadata)
      values (
        v_target_tenant, public.fn_acting_user(), p_target_user_id, 'unidades.update',
        jsonb_build_object('changes', jsonb_build_object(
          'unidades', jsonb_build_object(
            'de', jsonb_build_object('todas', coalesce(v_todas_antes, false),
                                     'ids', to_jsonb(v_ids_antes)),
            'para', jsonb_build_object('todas', coalesce(p_todas, false),
                                       'ids', to_jsonb(v_ids_depois))
          )
        ))
      );
    end if;
  exception when others then
    null;
  end;
end;
$function$;
