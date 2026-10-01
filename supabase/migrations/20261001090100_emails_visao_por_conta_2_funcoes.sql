-- =============================================================================
-- E-mails — quem vê o quê passa a depender da CONTA (2/3: funções)
--
-- Regra (ver 1/3): admin/super veem tudo; conta com usuário ligado = só ele e o
-- head do setor ligado; conta só com setor = o setor; sem vínculo = permissões.
--
-- Uma regra só, em três peças que o RLS e as RPCs usam do mesmo jeito:
--   fn_email_contas_vinculadas()        contas do tenant com usuário OU setor
--   fn_email_contas_visiveis(direcao)   contas cujas linhas a pessoa vê INTEIRAS
--   fn_email_pode(direcao, 'todos'|'proprios')  admin ou a permissão
-- e fn_email_pode_ver(direcao, conta, dono), que monta as três para UMA linha
-- (usada pelas RPCs; o RLS escreve a mesma expressão com initplan).
--
-- direcao: 'saida' (email_envios, email_agendados) | 'entrada' (email_recebidos)
--
-- As 3 RPCs (arquivar, mover de pasta, marcar lido) são as de PRODUÇÃO de
-- 30/09/2026 com UMA troca: o `v_tudo` por `email.ver_todos` vira
-- fn_email_pode_ver por linha. SECURITY DEFINER passa por cima do RLS, então a
-- regra precisa estar aqui também.
-- =============================================================================

begin;

-- ------------------------------------------------- contas com algum vínculo
create or replace function public.fn_email_contas_vinculadas()
 returns uuid[]
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select coalesce(array_agg(a.id), '{}'::uuid[])
    from public.email_accounts a
   where a.tenant_id = (select p.tenant_id from public.profiles p
                         where p.user_id = public.fn_acting_user() limit 1)
     and (exists (select 1 from public.email_account_usuarios u where u.account_id = a.id)
       or exists (select 1 from public.email_account_setores s where s.account_id = a.id));
$function$;

-- --------------------------------------- admin ou a permissão da direção
create or replace function public.fn_email_pode(p_direcao text, p_alcance text)
 returns boolean
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  v_role  text;
  v_chave text;
begin
  select p.role into v_role from public.profiles p
   where p.user_id = public.fn_acting_user() limit 1;
  if v_role = 'admin' then return true; end if;

  v_chave := case
    when p_direcao = 'saida'   and p_alcance = 'todos'    then 'email.ver_todos_enviados'
    when p_direcao = 'saida'   and p_alcance = 'proprios' then 'email.ver_saidas'
    when p_direcao = 'entrada' and p_alcance = 'todos'    then 'email.ver_todas_entradas'
    when p_direcao = 'entrada' and p_alcance = 'proprios' then 'email.ver_entradas'
  end;
  if v_chave is null then
    raise exception 'Direção/alcance inválidos: % / %', p_direcao, p_alcance;
  end if;

  -- sem sistema de permissões, responde pelo papel: o próprio é de todos,
  -- o de todos é de admin e gestor (o que era email.ver_todos)
  return coalesce(public.rbac_pode(
    v_chave,
    case when p_alcance = 'todos' then array['admin', 'head'] else array['admin', 'head', 'user'] end
  ), false);
end;
$function$;

-- ------------------------------- contas cujas linhas a pessoa vê inteiras
create or replace function public.fn_email_contas_visiveis(p_direcao text)
 returns uuid[]
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  v_uid    uuid := public.fn_acting_user();
  v_role   text;
  v_tenant uuid;
  v_todos  boolean;
begin
  if v_uid is null then return '{}'::uuid[]; end if;
  select p.role, p.tenant_id into v_role, v_tenant
    from public.profiles p where p.user_id = v_uid limit 1;
  if v_tenant is null then return '{}'::uuid[]; end if;

  v_todos := public.fn_email_pode(p_direcao, 'todos');

  return coalesce((
    select array_agg(a.id)
      from public.email_accounts a
     cross join lateral (
       select exists (select 1 from public.email_account_usuarios u where u.account_id = a.id) as tem_usuario,
              exists (select 1 from public.email_account_setores s where s.account_id = a.id) as tem_setor,
              exists (select 1 from public.email_account_usuarios u
                       where u.account_id = a.id and u.user_id = v_uid) as sou_ligado,
              exists (select 1 from public.email_account_setores s
                        join public.support_department_members m
                          on m.department_id = s.setor_id and m.user_id = v_uid and m.is_active
                       where s.account_id = a.id) as sou_do_setor,
              exists (select 1 from public.email_account_setores s
                        join public.support_department_members m
                          on m.department_id = s.setor_id and m.user_id = v_uid and m.is_active
                       where s.account_id = a.id and (m.is_head or v_role = 'head')) as sou_head_do_setor
     ) v
     where a.tenant_id = v_tenant
       and (
         v_role = 'admin'
         -- usuário ligado: só ele e o head do setor ligado
         or (v.tem_usuario and (v.sou_ligado or v.sou_head_do_setor))
         -- só setor ligado: o setor inteiro
         or (not v.tem_usuario and v.tem_setor and v.sou_do_setor)
         -- sem vínculo: a permissão decide
         or (not v.tem_usuario and not v.tem_setor and v_todos)
       )
  ), '{}'::uuid[]);
end;
$function$;

-- ------------------------------------------------ uma linha (para as RPCs)
-- Mesma expressão do RLS (3/3). Mudou uma, mude a outra.
create or replace function public.fn_email_pode_ver(p_direcao text, p_account_id uuid, p_dono uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select coalesce(public.is_super_admin(), false)
      or coalesce(p_account_id = any(public.fn_email_contas_visiveis(p_direcao)), false)
      or (p_account_id is null and public.fn_email_pode(p_direcao, 'todos'))
      or (p_dono is not null and p_dono = public.fn_acting_user()
          and not coalesce(p_account_id = any(public.fn_email_contas_vinculadas()), false)
          and public.fn_email_pode(p_direcao, 'proprios'));
$function$;

revoke all on function public.fn_email_contas_vinculadas()            from public, anon;
revoke all on function public.fn_email_pode(text, text)               from public, anon;
revoke all on function public.fn_email_contas_visiveis(text)          from public, anon;
revoke all on function public.fn_email_pode_ver(text, uuid, uuid)     from public, anon;
grant execute on function public.fn_email_contas_vinculadas()         to authenticated, service_role;
grant execute on function public.fn_email_pode(text, text)            to authenticated, service_role;
grant execute on function public.fn_email_contas_visiveis(text)       to authenticated, service_role;
grant execute on function public.fn_email_pode_ver(text, uuid, uuid)  to authenticated, service_role;

-- ------------------------------------------------------------ arquivar
create or replace function public.fn_email_arquivar(p_tabela text, p_ids uuid[], p_arquivar boolean DEFAULT true)
 returns table(afetados integer, bloqueados integer)
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_uid      uuid := public.fn_acting_user();
  v_super    boolean := coalesce(public.is_super_admin(), false);
  v_role     text;
  v_tenant   uuid;
  v_ativo    boolean;
  v_quando   timestamptz := case when p_arquivar then now() else null end;
  v_afetados integer := 0;
begin
  if v_uid is null then
    raise exception 'Sessão sem usuário identificado.' using errcode = '28000';
  end if;
  if p_tabela not in ('enviados', 'recebidos') then
    raise exception 'Tabela inválida: %', p_tabela;
  end if;
  if p_ids is null or cardinality(p_ids) = 0 then
    return query select 0, 0;
    return; -- sem isto a execução seguiria e o update rodaria com lista vazia
  end if;

  select p.role, p.tenant_id,
         coalesce(p.access_status, '') in ('active', 'ativo') and coalesce(p.status, 'ativo') in ('ativo', 'active')
    into v_role, v_tenant, v_ativo
    from public.profiles p where p.user_id = v_uid limit 1;

  -- SECURITY DEFINER passa por cima do RLS, então a checagem de membro ATIVO
  -- precisa estar aqui: sem ela, perfil pendente arquivava e-mail que nem vê.
  if not v_super and not coalesce(v_ativo, false) then
    raise exception 'Seu acesso ainda não está liberado neste tenant.' using errcode = '42501';
  end if;
  if not v_super and v_tenant is null then
    raise exception 'Perfil sem tenant.' using errcode = '42501';
  end if;

  -- mexe em quem a pessoa VÊ: mesma regra do RLS, por conta (01/10/2026)
  if p_tabela = 'enviados' then
    with alvo as (
      update public.email_envios e
         set arquivado_em = v_quando
       where e.id = any(p_ids)
         and (v_super or e.tenant_id = v_tenant)
         and public.fn_email_pode_ver('saida', e.account_id, e.enviado_por)
         and e.deleted_at is null
         and (e.arquivado_em is null) = p_arquivar
      returning 1
    )
    select count(*) into v_afetados from alvo;
  else
    with alvo as (
      update public.email_recebidos r
         set arquivado_em = v_quando
       where r.id = any(p_ids)
         and (v_super or r.tenant_id = v_tenant)
         and public.fn_email_pode_ver(
               'entrada', r.account_id,
               (select e.enviado_por from public.email_envios e where e.id = r.envio_id))
         and r.deleted_at is null
         and (r.arquivado_em is null) = p_arquivar
      returning 1
    )
    select count(*) into v_afetados from alvo;
  end if;

  -- bloqueados = o que a pessoa pediu e não podia (de outro, na lixeira, ou já
  -- no estado pedido). A tela usa esse número para avisar em vez de mentir.
  return query select v_afetados, cardinality(p_ids) - v_afetados;
end;
$function$;

-- ------------------------------------------------------- mover de pasta
create or replace function public.fn_email_mover_pasta(p_tabela text, p_ids uuid[], p_pasta_id uuid DEFAULT NULL::uuid)
 returns table(afetados integer, bloqueados integer)
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_uid      uuid := public.fn_acting_user();
  v_super    boolean := coalesce(public.is_super_admin(), false);
  v_role     text;
  v_tenant   uuid;
  v_ativo    boolean;
  v_tudo     boolean;
  v_afetados integer := 0;
begin
  if v_uid is null then
    raise exception 'Sessão sem usuário identificado.' using errcode = '28000';
  end if;
  if p_tabela not in ('enviados', 'recebidos') then
    raise exception 'Tabela inválida: %', p_tabela;
  end if;
  if p_ids is null or cardinality(p_ids) = 0 then
    return query select 0, 0;
    return; -- sem isto seguiria e rodaria o update com lista vazia
  end if;

  select p.role, p.tenant_id,
         coalesce(p.access_status, '') in ('active', 'ativo') and coalesce(p.status, 'ativo') in ('ativo', 'active')
    into v_role, v_tenant, v_ativo
    from public.profiles p where p.user_id = v_uid limit 1;
  if not v_super and not coalesce(v_ativo, false) then
    raise exception 'Seu acesso ainda não está liberado neste tenant.' using errcode = '42501';
  end if;

  -- pasta de qualquer setor: admin, super, ou quem vê tudo da direção
  v_tudo := v_super or public.fn_email_pode(
    case when p_tabela = 'enviados' then 'saida' else 'entrada' end, 'todos');

  -- a pasta precisa existir, ser do mesmo tenant e ser DELA (ou do setor dela):
  -- senão daria para esconder e-mail numa pasta que a pessoa nem enxerga
  if p_pasta_id is not null then
    if not exists (
      select 1 from public.email_pastas f
       where f.id = p_pasta_id
         and (v_super or f.tenant_id = v_tenant)
         and (
           v_tudo
           or (f.escopo = 'pessoal' and f.criado_por = v_uid)
           or (f.escopo = 'setor' and exists (
                select 1 from public.support_department_members m
                 where m.department_id = f.department_id and m.user_id = v_uid and m.is_active
              ))
         )
    ) then
      raise exception 'Pasta não encontrada, ou você não pode usá-la.' using errcode = '42501';
    end if;
  end if;

  -- mexe em quem a pessoa VÊ: mesma regra do RLS, por conta (01/10/2026)
  if p_tabela = 'enviados' then
    with alvo as (
      update public.email_envios e
         set pasta_id = p_pasta_id
       where e.id = any(p_ids)
         and (v_super or e.tenant_id = v_tenant)
         and public.fn_email_pode_ver('saida', e.account_id, e.enviado_por)
         and e.deleted_at is null
         and e.pasta_id is distinct from p_pasta_id
      returning 1
    )
    select count(*) into v_afetados from alvo;
  else
    with alvo as (
      update public.email_recebidos r
         set pasta_id = p_pasta_id
       where r.id = any(p_ids)
         and (v_super or r.tenant_id = v_tenant)
         and public.fn_email_pode_ver(
               'entrada', r.account_id,
               (select e.enviado_por from public.email_envios e where e.id = r.envio_id))
         and r.deleted_at is null
         and r.pasta_id is distinct from p_pasta_id
      returning 1
    )
    select count(*) into v_afetados from alvo;
  end if;

  return query select v_afetados, cardinality(p_ids) - v_afetados;
end;
$function$;

-- --------------------------------------------------------- marcar lido
create or replace function public.fn_email_recebidos_marcar_lido(p_ids uuid[] DEFAULT NULL::uuid[], p_ticket_id uuid DEFAULT NULL::uuid)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_uid    uuid := public.fn_acting_user();
  v_super  boolean := coalesce(public.is_super_admin(), false);
  v_role   text;
  v_tenant uuid;
  v_ativo  boolean;
  v_n      integer := 0;
begin
  if v_uid is null then
    raise exception 'Sessão sem usuário identificado.' using errcode = '28000';
  end if;
  -- sem esta saída, o update rodaria com lista vazia E ticket nulo, marcando
  -- lido o tenant inteiro
  if (p_ids is null or cardinality(p_ids) = 0) and p_ticket_id is null then
    return 0;
  end if;

  select p.role, p.tenant_id,
         coalesce(p.access_status, '') in ('active', 'ativo') and coalesce(p.status, 'ativo') in ('ativo', 'active')
    into v_role, v_tenant, v_ativo
    from public.profiles p where p.user_id = v_uid limit 1;

  -- SECURITY DEFINER passa por cima do RLS: a checagem de membro ativo mora aqui
  if not v_super and not coalesce(v_ativo, false) then
    raise exception 'Seu acesso ainda não está liberado neste tenant.' using errcode = '42501';
  end if;
  if not v_super and v_tenant is null then
    raise exception 'Perfil sem tenant.' using errcode = '42501';
  end if;

  -- mesma regra do RLS, por conta (01/10/2026)
  with alvo as (
    update public.email_recebidos r
       set lido_em = now(), lido_por = v_uid
     where (p_ids is null or r.id = any(p_ids))
       and (p_ticket_id is null or r.ticket_id = p_ticket_id)
       and r.lido_em is null
       and (v_super or r.tenant_id = v_tenant)
       and public.fn_email_pode_ver(
             'entrada', r.account_id,
             (select e.enviado_por from public.email_envios e where e.id = r.envio_id))
    returning 1
  )
  select count(*) into v_n from alvo;

  return v_n;
end;
$function$;

commit;
