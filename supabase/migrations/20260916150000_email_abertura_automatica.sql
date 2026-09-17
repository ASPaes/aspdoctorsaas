-- ============================================================================
-- E-mail do cliente vira ticket: abertura Automática, com responsável
--
-- Pedido do Alexandre (16/09/2026, mockup aprovado): a coluna "Abre ticket" de
-- Parâmetros de Recebidos deixa de ser Sim/Não e passa a ter 3 opções:
--   Não             abre_ticket = false
--   Manual na fila  abre_ticket = true,  distribuicao is null  (o "Sim" de antes)
--   Automática      abre_ticket = true,  distribuicao preenchida
-- Nenhum endereço já configurado muda: quem estava em Sim continua sem
-- responsável, agora com o nome Manual na fila.
--
-- Como distribuir (escolhido por endereço):
--   menor_carga  agente ativo do setor com menos tickets em aberto; empate por
--                sorteio, como no chat (least_loaded desempata por random()).
--   rodizio      um de cada vez, na ordem do user_id, sem olhar a carga.
--   fixo         sempre agente_fixo_user_id, se ele for agente ativo do setor.
-- Quem entra: membro ativo do setor (support_department_members, a tabela que o
-- motor de distribuição lê) com perfil ativo no mesmo tenant. Sem ninguém, ou
-- agente fixo fora do setor: o ticket nasce sem responsável, como no Manual.
-- Distribui a qualquer hora, inclusive fora do horário (decisão dele).
--
-- O setor que vale é o FINAL: se uma regra por assunto mandar o e-mail para
-- outro setor, a escolha acontece entre os agentes desse outro setor.
--
-- O responsável entra no INSERT do ticket, e não num UPDATE depois: assim o
-- trg_notify_ticket_responsavel manda "Novo chamado em seu nome", e não
-- "Chamado transferido para você".
--
-- Nada muda na edge function ler-emails-recebidos: ela só lê abre_ticket e
-- aceita_copia. A tela nova grava as colunas novas: esta migration vem ANTES
-- do push.
--
-- Corpos de fn_email_processar_recebido e fn_email__criar_ticket copiados da
-- PRODUÇÃO (db dump de 16/09/2026), não do repositório.
--
-- Aplicar pelo SQL Editor. Uma transação só.
-- ============================================================================

begin;

alter table public.email_enderecos_destino
  add column if not exists distribuicao           text,
  add column if not exists agente_fixo_user_id    uuid references auth.users(id) on delete set null,
  add column if not exists rodizio_ultimo_user_id uuid;

alter table public.email_enderecos_destino
  drop constraint if exists email_enderecos_destino_distribuicao,
  add constraint email_enderecos_destino_distribuicao check (
    distribuicao is null
    or (distribuicao in ('menor_carga', 'rodizio', 'fixo') and abre_ticket and destino = 'suporte')
  ),
  drop constraint if exists email_enderecos_destino_fixo,
  add constraint email_enderecos_destino_fixo check (
    distribuicao is distinct from 'fixo' or agente_fixo_user_id is not null
  );

comment on column public.email_enderecos_destino.distribuicao is
  'Abertura Automática: menor_carga, rodizio ou fixo. Nulo com abre_ticket = Manual na fila (ticket sem responsável).';
comment on column public.email_enderecos_destino.agente_fixo_user_id is
  'Responsável quando distribuicao = fixo. Só vale se for agente ativo do setor do ticket.';
comment on column public.email_enderecos_destino.rodizio_ultimo_user_id is
  'Último agente que recebeu pelo rodízio deste endereço. Controle interno.';

/**
 * Escolhe o responsável do ticket aberto por e-mail, pela forma de distribuir
 * do endereço. Devolve null quando o endereço é Manual ou não há agente elegível.
 * Nunca derruba o processamento: qualquer erro vira "sem responsável".
 */
create or replace function public.fn_email__escolher_responsavel(
  p_rota_id   uuid,
  p_tenant_id uuid,
  p_setor_id  uuid
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_modo   text;
  v_fixo   uuid;
  v_ultimo uuid;
  v_quem   uuid;
begin
  if p_rota_id is null or p_setor_id is null then
    return null;
  end if;

  -- trava a linha do endereço: dois e-mails ao mesmo tempo não pegam o mesmo
  -- ponto do rodízio
  select d.distribuicao, d.agente_fixo_user_id, d.rodizio_ultimo_user_id
    into v_modo, v_fixo, v_ultimo
    from public.email_enderecos_destino d
   where d.id = p_rota_id and d.tenant_id = p_tenant_id
     for update;

  if v_modo is null then
    return null;
  end if;

  with agentes as (
    select distinct m.user_id
      from public.support_department_members m
      join public.profiles p on p.user_id = m.user_id and p.tenant_id = m.tenant_id
     where m.tenant_id = p_tenant_id
       and m.department_id = p_setor_id
       and m.is_active
       and coalesce(p.access_status, '') in ('active', 'ativo')
       and coalesce(p.status, 'ativo') in ('ativo', 'active')
  ),
  escolha as (
    select a.user_id,
           case v_modo
             when 'fixo' then case when a.user_id = v_fixo then 0 else null end
             when 'rodizio' then case when v_ultimo is null or a.user_id > v_ultimo then 0 else 1 end
             else (
               select count(*)
                 from public.support_tickets t
                 left join public.ticket_statuses s on s.id = t.status_id
                where t.tenant_id = p_tenant_id
                  and t.responsavel_user_id = a.user_id
                  and t.deleted_at is null
                  and t.concluido_em is null
                  and not coalesce(s.is_terminal, false)
             )
           end as ordem
      from agentes a
  )
  select e.user_id into v_quem
    from escolha e
   where e.ordem is not null
   order by e.ordem,
            case when v_modo = 'rodizio' then e.user_id end,
            random()
   limit 1;

  if v_modo = 'rodizio' and v_quem is not null then
    update public.email_enderecos_destino set rodizio_ultimo_user_id = v_quem where id = p_rota_id;
  end if;

  return v_quem;

exception when others then
  raise log '[fn_email__escolher_responsavel] rota %: %', p_rota_id, sqlerrm;
  return null;
end;
$$;

revoke all on function public.fn_email__escolher_responsavel(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.fn_email__escolher_responsavel(uuid, uuid, uuid) to service_role;

-- A assinatura ganha p_responsavel com default null. Precisa DROP: com as duas
-- versões no banco, a chamada de 6 argumentos (triagem manual) ficaria ambígua.
drop function if exists public.fn_email__criar_ticket(uuid, uuid, uuid, uuid, text, uuid);

create function public.fn_email__criar_ticket(
  p_tenant_id uuid, p_cliente_id uuid, p_cliente_contato_id uuid, p_department_id uuid,
  p_assunto text, p_criado_por uuid, p_responsavel uuid default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status uuid;
  v_tipo   text;
  v_id     uuid;
begin
  select s.id into v_status
    from public.ticket_statuses s
   where s.tenant_id = p_tenant_id
     and s.department_id = p_department_id
     and s.is_initial and s.is_active
   order by s.position
   limit 1;

  if v_status is null then
    raise exception 'EMAIL_SETOR_SEM_STATUS';
  end if;

  v_tipo := case when public.is_within_business_hours(p_tenant_id, p_department_id, now())
                 then 'comercial' else 'plantao' end;

  insert into public.support_tickets (
    tenant_id, cliente_id, cliente_contato_id, department_id,
    canal_origem, tipo_horario, assunto, prioridade, status_id,
    responsavel_user_id, criado_por, aberto_em, tipo, origem_criacao, contexto,
    horario_inicio
  ) values (
    p_tenant_id, p_cliente_id, p_cliente_contato_id, p_department_id,
    'email', v_tipo, left(coalesce(nullif(btrim(p_assunto), ''), '(sem assunto)'), 300),
    'media'::support_ticket_prioridade, v_status,
    p_responsavel, p_criado_por, now(), 'cliente'::support_ticket_tipo, 'email', 'suporte',
    case when v_tipo = 'plantao' then now() end
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.fn_email__criar_ticket(uuid, uuid, uuid, uuid, text, uuid, uuid) from public, anon, authenticated;
grant all on function public.fn_email__criar_ticket(uuid, uuid, uuid, uuid, text, uuid, uuid) to service_role;

-- Corpo de produção de 16/09/2026 com 3 linhas a mais: v_responsavel e a
-- escolha antes de criar o ticket, no ramo "e-mail novo". Os outros dois
-- lugares que criam ticket (continuação fora do prazo e triagem manual) seguem
-- sem responsável, como antes.

create or replace function public.fn_email_processar_recebido(p_recebido_id uuid) returns jsonb
    language plpgsql security definer
    set search_path to public
    AS $$
declare
  r               public.email_recebidos%rowtype;
  v_aceitar_dom   boolean;
  v_dias          integer;
  v_confirmar     boolean;
  v_rota_id       uuid;
  v_rota_abre     boolean;
  v_rota_destino  text;
  v_rota_setor    uuid;
  v_regra_destino text;
  v_regra_setor   uuid;
  v_destino       text;
  v_setor         uuid;
  v_cliente       uuid;
  v_contato       uuid;
  v_motivo        text;
  v_ref           uuid;
  v_t_id          uuid;
  v_t_cliente     uuid;
  v_t_setor       uuid;
  v_t_contexto    text;
  v_t_code        text;
  v_t_concluido   timestamptz;
  v_t_excluido    timestamptz;
  v_t_encerrado   boolean;
  v_status_ini    uuid;
  v_jornada       uuid;
  v_ticket        uuid;
  v_novo_code     text;
  v_acao          text;
  v_detalhe       text;
  v_status        text;
  v_responsavel   uuid;
begin
  select * into r from public.email_recebidos where id = p_recebido_id for update skip locked;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'ocupado_ou_inexistente');
  end if;
  if r.acao is not null and r.acao not in ('pendente', 'erro') then
    return jsonb_build_object('ok', true, 'repetido', true, 'acao', r.acao, 'ticket_id', r.ticket_id);
  end if;

  select p.aceitar_dominio_cliente, p.dias_reabrir, p.confirmar_abertura
    into v_aceitar_dom, v_dias, v_confirmar
    from public.email_recebidos_parametros p
   where p.tenant_id = r.tenant_id;
  v_aceitar_dom := coalesce(v_aceitar_dom, true);
  v_dias        := coalesce(v_dias, 7);
  v_confirmar   := coalesce(v_confirmar, true);

  v_status  := r.status;
  v_cliente := r.cliente_id;
  v_setor   := r.department_id;

  if r.envio_id is not null then
    -- ── resposta a um e-mail que saiu do DoctorSaaS ──
    select e.referencia_id into v_ref from public.email_envios e where e.id = r.envio_id;

    select t.id, t.cliente_id, t.department_id, t.contexto, t.ticket_code, t.concluido_em, t.deleted_at,
           (coalesce(s.is_terminal, false) or t.concluido_em is not null)
      into v_t_id, v_t_cliente, v_t_setor, v_t_contexto, v_t_code, v_t_concluido, v_t_excluido, v_t_encerrado
      from public.support_tickets t
      left join public.ticket_statuses s on s.id = t.status_id
     where t.id = v_ref and t.tenant_id = r.tenant_id;

    if v_t_id is null then
      -- resposta a resumo de atendimento, e-mail de teste etc.: continua só registrada
      v_acao := 'registrado';

    elsif r.status = 'remetente_diferente' then
      v_acao := 'registrado';
      v_detalhe := 'Veio de outro endereço: não entrou no ticket ' || v_t_code || ' sem alguém confirmar.';

    elsif v_t_excluido is not null then
      v_acao := 'triagem';
      v_setor := v_t_setor;
      v_cliente := coalesce(v_cliente, v_t_cliente);
      v_detalhe := 'Resposta ao ticket ' || v_t_code || ', que foi excluído.';

    else
      v_setor := v_t_setor;
      v_cliente := coalesce(v_cliente, v_t_cliente);

      if v_t_contexto = 'onboarding' then
        perform public.fn_email__evento_cliente(v_t_id, r.tenant_id, r.id, r.de_email, r.assunto, r.corpo_texto);
        v_ticket := v_t_id;
        v_acao := 'jornada';

      elsif not v_t_encerrado then
        perform public.fn_email__evento_cliente(v_t_id, r.tenant_id, r.id, r.de_email, r.assunto, r.corpo_texto);
        v_ticket := v_t_id;
        v_acao := 'resposta_ticket';

      elsif coalesce(v_t_concluido, now()) >= now() - make_interval(days => v_dias) then
        perform public.fn_email__evento_cliente(v_t_id, r.tenant_id, r.id, r.de_email, r.assunto, r.corpo_texto);
        v_ticket := v_t_id;

        select s.id into v_status_ini
          from public.ticket_statuses s
         where s.tenant_id = r.tenant_id and s.department_id = v_t_setor and s.is_initial and s.is_active
         order by s.position
         limit 1;

        if v_status_ini is null then
          v_acao := 'triagem';
          v_detalhe := 'O ticket ' || v_t_code || ' está encerrado e o setor não tem status inicial para reabrir.';
        else
          perform set_config('app.reabertura_por_email', 'on', true);
          update public.support_tickets
             set status_id = v_status_ini, concluido_em = null, closed_by = null
           where id = v_t_id;
          perform set_config('app.reabertura_por_email', 'off', true);

          insert into public.support_ticket_events (tenant_id, ticket_id, user_id, event_type, content, new_value)
          values (r.tenant_id, v_t_id, null, 'email_reaberto', 'Reaberto porque o cliente respondeu por e-mail.', r.id::text);
          v_acao := 'ticket_reaberto';
        end if;

      else
        -- encerrado há mais tempo que o prazo: ticket novo, ligado ao anterior pelo histórico
        begin
          v_ticket := public.fn_email__criar_ticket(r.tenant_id, v_cliente, null, v_t_setor, r.assunto, null);
          select t.ticket_code into v_novo_code from public.support_tickets t where t.id = v_ticket;
          perform public.fn_email__evento_cliente(
            v_ticket, r.tenant_id, r.id, r.de_email, r.assunto, r.corpo_texto,
            'Continuação do ticket ' || v_t_code || ', encerrado há mais de ' || v_dias || ' dias.'
          );
          insert into public.support_ticket_events (tenant_id, ticket_id, user_id, event_type, content, new_value)
          values (r.tenant_id, v_t_id, null, 'email_continuacao',
                  'O cliente respondeu depois do prazo de reabertura; a conversa seguiu no ticket ' || v_novo_code || '.', v_ticket::text);
          v_acao := 'ticket_aberto';
          v_detalhe := 'Continuação do ticket ' || v_t_code || '.';
        exception when others then
          if sqlerrm <> 'EMAIL_SETOR_SEM_STATUS' then
            raise;
          end if;
          v_ticket := null;
          v_acao := 'triagem';
          v_detalhe := 'Resposta ao ticket ' || v_t_code || ' fora do prazo, e o setor não tem status inicial para abrir outro.';
        end;
      end if;
    end if;

  else
    -- ── e-mail novo ──
    select d.id, d.abre_ticket, d.destino, d.department_id
      into v_rota_id, v_rota_abre, v_rota_destino, v_rota_setor
      from public.email_enderecos_destino d
     where d.tenant_id = r.tenant_id
       and d.endereco = lower(btrim(coalesce(r.endereco_destino, '')));

    if v_rota_id is null or not v_rota_abre then
      v_acao := case when r.cliente_id is not null then 'registrado' else 'ignorado' end;

    elsif public.fn_email_remetente_bloqueado(r.tenant_id, r.de_email) then
      v_acao := 'ignorado';
      v_detalhe := 'Remetente bloqueado em Parâmetros de Recebidos.';

    else
      v_destino := v_rota_destino;
      v_setor := v_rota_setor;

      select g.destino, g.department_id
        into v_regra_destino, v_regra_setor
        from public.email_regras_assunto g
       where g.tenant_id = r.tenant_id
         and g.ativo
         and exists (
           select 1 from unnest(g.palavras) w
            where btrim(w) <> ''
              and strpos(lower(coalesce(r.assunto, '')), lower(btrim(w))) > 0
         )
       order by g.ordem, g.created_at
       limit 1;

      if v_regra_destino is not null then
        v_destino := v_regra_destino;
        v_setor := coalesce(v_regra_setor, v_setor);
        v_detalhe := 'Pela regra de assunto.';
      end if;

      select x.cliente_id, x.cliente_contato_id, x.motivo
        into v_cliente, v_contato, v_motivo
        from public.fn_email_cliente_do_remetente(r.tenant_id, r.de_email, v_aceitar_dom) x;

      if v_cliente is null then
        v_acao := 'triagem';
        if v_motivo = 'desconhecido' then
          v_status := 'desconhecido';
        end if;
        v_detalhe := case v_motivo
          when 'ambiguo' then 'O remetente está na ficha de mais de um cliente.'
          when 'dominio_ambiguo' then 'O domínio do remetente pertence a mais de um cliente.'
          else 'O remetente não está na ficha de nenhum cliente.'
        end;

      elsif v_destino = 'onboarding' then
        select j.ticket_id into v_jornada
          from public.onboarding_journeys j
         where j.tenant_id = r.tenant_id
           and j.cliente_id = v_cliente
           and j.situacao in ('nao_iniciado', 'em_andamento', 'parado')
         order by j.created_at desc
         limit 1;

        if v_jornada is null then
          v_acao := 'triagem';
          v_detalhe := 'O cliente não tem jornada de onboarding ativa.';
        else
          perform public.fn_email__evento_cliente(v_jornada, r.tenant_id, r.id, r.de_email, r.assunto, r.corpo_texto);
          select coalesce(t.department_id, v_setor) into v_setor from public.support_tickets t where t.id = v_jornada;
          v_ticket := v_jornada;
          v_acao := 'jornada';
        end if;

      else
        begin
          -- endereço em Automática: o ticket já nasce com responsável (16/09/2026)
          v_responsavel := public.fn_email__escolher_responsavel(v_rota_id, r.tenant_id, v_setor);
          v_ticket := public.fn_email__criar_ticket(r.tenant_id, v_cliente, v_contato, v_setor, r.assunto, null, v_responsavel);
          perform public.fn_email__evento_cliente(v_ticket, r.tenant_id, r.id, r.de_email, r.assunto, r.corpo_texto);
          v_acao := 'ticket_aberto';
        exception when others then
          if sqlerrm <> 'EMAIL_SETOR_SEM_STATUS' then
            raise;
          end if;
          v_ticket := null;
          v_acao := 'triagem';
          v_detalhe := 'O setor não tem status inicial de ticket. Defina um em Tickets e status.';
        end;
      end if;
    end if;
  end if;

  update public.email_recebidos
     set acao          = v_acao,
         acao_detalhe  = v_detalhe,
         status        = v_status,
         ticket_id     = coalesce(v_ticket, ticket_id),
         referencia_id = coalesce(v_ticket, referencia_id),
         cliente_id    = coalesce(v_cliente, cliente_id),
         department_id = coalesce(v_setor, department_id),
         tentativas    = tentativas + 1,
         processado_em = now()
   where id = r.id;

  return jsonb_build_object(
    'ok', true,
    'acao', v_acao,
    'detalhe', v_detalhe,
    'ticket_id', v_ticket,
    'ticket_code', (select t.ticket_code from public.support_tickets t where t.id = v_ticket),
    'confirmar', v_acao = 'ticket_aberto' and r.envio_id is null and v_confirmar
  );

exception when others then
  update public.email_recebidos
     set acao = 'erro', acao_detalhe = left(sqlerrm, 300), tentativas = tentativas + 1, processado_em = now()
   where id = p_recebido_id;
  return jsonb_build_object('ok', false, 'acao', 'erro', 'erro', sqlerrm);
end;
$$;

revoke all on function public.fn_email_processar_recebido(uuid) from public, anon, authenticated;
grant all on function public.fn_email_processar_recebido(uuid) to service_role;

commit;
