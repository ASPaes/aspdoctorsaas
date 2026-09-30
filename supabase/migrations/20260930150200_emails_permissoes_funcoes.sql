-- =============================================================================
-- E-mails — as ações de dentro da tela viram permissão (2/3: funções)
--
-- Cada função é a de PRODUÇÃO de 30/09/2026 (md5 conferido antes de aplicar),
-- com UMA mudança: a checagem de papel vira `rbac_pode(<chave>, <papel de hoje>)`.
-- Na empresa sem sistema de permissões, `rbac_pode` responde pelo papel — ou
-- seja, nada muda lá.
--
--   fn_email_envios_lixeira / fn_email_recebidos_lixeira   admin            -> email.lixeira
--   fn_email_triagem_resolver                              admin ou gestor  -> email.triagem
--   fn_email_arquivar / fn_email_mover_pasta /
--   fn_email_recebidos_marcar_lido  (v_tudo)               admin ou gestor  -> email.ver_todos
--   fn_email_agendado_acao                                 admin ou gestor  -> email.agendados_outros
--
-- `fn_email__quem_agenda` NÃO muda: o campo `gestor` dela só é lido pela
-- fn_email_agendado_acao, que agora pergunta à permissão.
-- =============================================================================

create or replace function public.fn_email_envios_lixeira(p_ids uuid[], p_acao text)
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
  v_ids      uuid[];
  v_afetados integer := 0;
begin
  if v_uid is null then
    raise exception 'Sessão sem usuário identificado.' using errcode = '28000';
  end if;
  if p_acao not in ('lixeira', 'restaurar', 'excluir') then
    raise exception 'Ação inválida: %', p_acao;
  end if;

  select p.role, p.tenant_id into v_role, v_tenant
    from public.profiles p where p.user_id = v_uid limit 1;

  -- permissão "Lixeira de e-mails" (30/09/2026); sem sistema de permissões, só admin
  if not v_super and not public.rbac_pode('email.lixeira', array['admin']) then
    raise exception 'Você não tem permissão para mexer na lixeira de e-mails.' using errcode = '42501';
  end if;

  -- restaurar não tem trava: devolver para a lista nunca apaga nada
  if p_acao = 'restaurar' then
    with alvo as (
      update public.email_envios e
         set deleted_at = null
       where e.id = any(p_ids)
         and (v_super or e.tenant_id = v_tenant)
      returning 1
    )
    select count(*) into v_afetados from alvo;
    return query select v_afetados, 0;
    return; -- sem isto a execução continuava e caía no ramo de exclusão
  end if;

  -- os que podem sair: sem vínculo com atendimento ou ticket
  select array_agg(e.id) into v_ids
    from public.email_envios e
   where e.id = any(p_ids)
     and (v_super or e.tenant_id = v_tenant)
     and e.referencia_id is null;
  v_ids := coalesce(v_ids, array[]::uuid[]);

  if p_acao = 'lixeira' then
    with alvo as (
      update public.email_envios e set deleted_at = now()
       where e.id = any(v_ids) and e.deleted_at is null
      returning 1
    )
    select count(*) into v_afetados from alvo;
  else
    with alvo as (
      delete from public.email_envios e where e.id = any(v_ids) returning 1
    )
    select count(*) into v_afetados from alvo;
  end if;

  return query select v_afetados, cardinality(p_ids) - cardinality(v_ids);
end;
$function$;


create or replace function public.fn_email_recebidos_lixeira(p_ids uuid[], p_acao text)
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
  v_ids      uuid[];
  v_afetados integer := 0;
begin
  if v_uid is null then
    raise exception 'Sessão sem usuário identificado.' using errcode = '28000';
  end if;
  if p_acao not in ('lixeira', 'restaurar', 'excluir') then
    raise exception 'Ação inválida: %', p_acao;
  end if;

  select p.role, p.tenant_id into v_role, v_tenant
    from public.profiles p where p.user_id = v_uid limit 1;

  -- permissão "Lixeira de e-mails" (30/09/2026); sem sistema de permissões, só admin
  if not v_super and not public.rbac_pode('email.lixeira', array['admin']) then
    raise exception 'Você não tem permissão para mexer na lixeira de e-mails.' using errcode = '42501';
  end if;

  if p_acao = 'restaurar' then
    with alvo as (
      update public.email_recebidos e set deleted_at = null
       where e.id = any(p_ids) and (v_super or e.tenant_id = v_tenant)
      returning 1
    )
    select count(*) into v_afetados from alvo;
    return query select v_afetados, 0;
    return;
  end if;

  select array_agg(e.id) into v_ids
    from public.email_recebidos e
   where e.id = any(p_ids)
     and (v_super or e.tenant_id = v_tenant)
     and e.referencia_id is null;
  v_ids := coalesce(v_ids, array[]::uuid[]);

  if p_acao = 'lixeira' then
    with alvo as (
      update public.email_recebidos e set deleted_at = now()
       where e.id = any(v_ids) and e.deleted_at is null
      returning 1
    )
    select count(*) into v_afetados from alvo;
  else
    with alvo as (
      delete from public.email_recebidos e where e.id = any(v_ids) returning 1
    )
    select count(*) into v_afetados from alvo;
  end if;

  return query select v_afetados, cardinality(p_ids) - cardinality(v_ids);
end;
$function$;


create or replace function public.fn_email_triagem_resolver(p_recebido_id uuid, p_acao text, p_cliente_id uuid default null::uuid, p_department_id uuid default null::uuid)
 returns jsonb
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
  r        public.email_recebidos%rowtype;
  v_setor  uuid;
  v_ticket uuid;
begin
  if v_uid is null then
    raise exception 'Sessão sem usuário identificado.' using errcode = '28000';
  end if;

  select p.role, p.tenant_id, (p.access_status = 'active' and coalesce(p.status, 'ativo') = 'ativo')
    into v_role, v_tenant, v_ativo
    from public.profiles p
   where p.user_id = v_uid
   limit 1;

  -- permissão "Resolver a triagem" (30/09/2026); sem sistema de permissões, admin e gestor
  if not v_super and (not public.rbac_pode('email.triagem', array['admin', 'head']) or not coalesce(v_ativo, false)) then
    raise exception 'Você não tem permissão para resolver a triagem de e-mails.' using errcode = '42501';
  end if;

  select * into r from public.email_recebidos where id = p_recebido_id for update;
  if not found or (not v_super and r.tenant_id is distinct from v_tenant) then
    raise exception 'E-mail não encontrado.' using errcode = '42501';
  end if;
  if r.acao is distinct from 'triagem' then
    raise exception 'Este e-mail já saiu da triagem.';
  end if;

  if p_acao = 'ignorar' then
    update public.email_recebidos
       set acao = 'ignorado', acao_detalhe = 'Ignorado na triagem.',
           triagem_resolvida_por = v_uid, triagem_resolvida_em = now()
     where id = r.id;
    return jsonb_build_object('ok', true, 'acao', 'ignorado');
  end if;

  if p_acao is distinct from 'abrir_ticket' then
    raise exception 'Ação inválida: %', p_acao;
  end if;

  if p_cliente_id is null or not exists (
    select 1 from public.clientes c where c.id = p_cliente_id and c.tenant_id = r.tenant_id
  ) then
    raise exception 'Escolha um cliente deste tenant.';
  end if;

  v_setor := coalesce(p_department_id, r.department_id);
  if v_setor is null or not exists (
    select 1 from public.support_departments d where d.id = v_setor and d.tenant_id = r.tenant_id
  ) then
    raise exception 'Escolha o setor do ticket.';
  end if;

  begin
    v_ticket := public.fn_email__criar_ticket(r.tenant_id, p_cliente_id, null, v_setor, r.assunto, v_uid);
  exception when others then
    if sqlerrm = 'EMAIL_SETOR_SEM_STATUS' then
      raise exception 'O setor escolhido não tem status inicial de ticket. Defina um em Tickets e status.';
    end if;
    raise;
  end;

  perform public.fn_email__evento_cliente(v_ticket, r.tenant_id, r.id, r.de_email, r.assunto, r.corpo_texto);

  update public.email_recebidos
     set acao = 'ticket_aberto',
         acao_detalhe = 'Aberto na triagem.',
         ticket_id = v_ticket,
         referencia_id = v_ticket,
         cliente_id = p_cliente_id,
         department_id = v_setor,
         status = case when status = 'desconhecido' then 'avulso' else status end,
         triagem_resolvida_por = v_uid,
         triagem_resolvida_em = now(),
         processado_em = now()
   where id = r.id;

  return jsonb_build_object(
    'ok', true, 'acao', 'ticket_aberto', 'ticket_id', v_ticket,
    'ticket_code', (select t.ticket_code from public.support_tickets t where t.id = v_ticket)
  );
end;
$function$;


create or replace function public.fn_email_arquivar(p_tabela text, p_ids uuid[], p_arquivar boolean default true)
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

  -- quem vê os e-mails de todos mexe em tudo do tenant; os outros, só no que é
  -- deles. Mesma regra do RLS (permissão "Ver e-mails de todas as pessoas",
  -- 30/09/2026), repetida aqui porque SECURITY DEFINER passa por cima.
  v_tudo := v_super or public.rbac_pode('email.ver_todos', array['admin', 'head']);

  if not v_tudo and v_tenant is null then
    raise exception 'Perfil sem tenant.' using errcode = '42501';
  end if;

  if p_tabela = 'enviados' then
    with alvo as (
      update public.email_envios e
         set arquivado_em = v_quando
       where e.id = any(p_ids)
         and (v_super or e.tenant_id = v_tenant)
         and (v_tudo or e.enviado_por = v_uid)
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
         and (
           v_tudo
           or exists (
             select 1 from public.email_envios e
              where e.id = r.envio_id and e.enviado_por = v_uid
           )
         )
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


create or replace function public.fn_email_mover_pasta(p_tabela text, p_ids uuid[], p_pasta_id uuid default null::uuid)
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

  -- permissão "Ver e-mails de todas as pessoas" (30/09/2026), igual ao RLS
  v_tudo := v_super or public.rbac_pode('email.ver_todos', array['admin', 'head']);

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

  if p_tabela = 'enviados' then
    with alvo as (
      update public.email_envios e
         set pasta_id = p_pasta_id
       where e.id = any(p_ids)
         and (v_super or e.tenant_id = v_tenant)
         and (v_tudo or e.enviado_por = v_uid)
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
         and (
           v_tudo
           or exists (
             select 1 from public.email_envios e
              where e.id = r.envio_id and e.enviado_por = v_uid
           )
         )
         and r.deleted_at is null
         and r.pasta_id is distinct from p_pasta_id
      returning 1
    )
    select count(*) into v_afetados from alvo;
  end if;

  return query select v_afetados, cardinality(p_ids) - v_afetados;
end;
$function$;


create or replace function public.fn_email_recebidos_marcar_lido(p_ids uuid[] default null::uuid[], p_ticket_id uuid default null::uuid)
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
  v_tudo   boolean;
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

  -- mesma regra do RLS: quem vê os e-mails de todos enxerga a caixa toda; os
  -- outros, só o recebido que responde a um envio deles (permissão "Ver e-mails
  -- de todas as pessoas", 30/09/2026)
  v_tudo := v_super or public.rbac_pode('email.ver_todos', array['admin', 'head']);

  if not v_tudo and v_tenant is null then
    raise exception 'Perfil sem tenant.' using errcode = '42501';
  end if;

  with alvo as (
    update public.email_recebidos r
       set lido_em = now(), lido_por = v_uid
     where (p_ids is null or r.id = any(p_ids))
       and (p_ticket_id is null or r.ticket_id = p_ticket_id)
       and r.lido_em is null
       and (v_super or r.tenant_id = v_tenant)
       and (
         v_tudo
         or exists (
           select 1 from public.email_envios e
            where e.id = r.envio_id and e.enviado_por = v_uid
         )
       )
    returning 1
  )
  select count(*) into v_n from alvo;

  return v_n;
end;
$function$;


create or replace function public.fn_email_agendado_acao(p_id uuid, p_acao text, p_quando timestamp with time zone default null::timestamp with time zone)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  a record;
  q record;
begin
  select * into a from public.email_agendados where id = p_id for update;
  if not found then
    raise exception 'E-mail agendado não encontrado.' using errcode = 'P0002';
  end if;

  select * into q from public.fn_email__quem_agenda(a.tenant_id);
  -- permissão "Mexer no agendamento de outra pessoa" (30/09/2026); sem sistema
  -- de permissões, admin e gestor. No próprio agendamento, cada um sempre mexe.
  if not q.super and a.agendado_por <> q.user_id
     and not public.rbac_pode('email.agendados_outros', array['admin', 'head']) then
    raise exception 'Só quem agendou, ou quem tem permissão para mexer no agendamento de outra pessoa, mexe neste e-mail.' using errcode = '42501';
  end if;
  if a.status <> 'agendado' then
    raise exception 'Este e-mail não está mais agendado (situação: %).', a.status using errcode = '22023';
  end if;

  if p_acao = 'reagendar' then
    if p_quando is null or p_quando < now() + interval '1 minute' then
      raise exception 'Escolha um horário a partir de daqui a 1 minuto.' using errcode = '22023';
    end if;
    if p_quando > now() + interval '180 days' then
      raise exception 'Dá para agendar até 180 dias à frente.' using errcode = '22023';
    end if;
    update public.email_agendados set agendar_para = p_quando, updated_at = now() where id = p_id;
  elsif p_acao = 'enviar_agora' then
    update public.email_agendados set agendar_para = now(), updated_at = now() where id = p_id;
  elsif p_acao = 'cancelar' then
    update public.email_agendados
       set status = 'cancelado', cancelado_por = q.user_id, cancelado_em = now(), updated_at = now()
     where id = p_id;
  else
    raise exception 'Ação inválida: %', p_acao using errcode = '22023';
  end if;
end;
$function$;
