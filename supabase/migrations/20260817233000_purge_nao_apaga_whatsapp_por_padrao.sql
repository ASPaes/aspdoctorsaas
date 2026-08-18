-- 17/08/2026 — apagar o WhatsApp deixa de ser o padrao do purge.
--
-- Continuacao de 20260817220000_guarda_purge_cliente_ticket_e_chat.sql. Aquela
-- migration impede o acidente; esta mexe no que o sistema faz quando ninguem
-- decide nada. p_incluir_chat era DEFAULT true: chamada sem o parametro
-- (script, edge function, SQL Editor) apagava whatsapp_contacts do cliente e,
-- por ON DELETE CASCADE, conversa + mensagens + reacoes + notas + resumos +
-- sentimento + atendimentos. Destruir historico era o comportamento de quem
-- so nao passou o argumento.
--
-- O frontend sempre manda p_incluir_chat explicito no purge, entao a tela nao
-- muda de comportamento por causa daqui — o default so protege chamador direto.
-- O switch da tela vira desligado no mesmo commit.
--
-- CREATE OR REPLACE, sem DROP: mudar o default de um parametro existente nao
-- muda nome/tipo/ordem, entao a assinatura e a mesma e os GRANTs sobrevivem
-- (medido no Postgres local antes de subir). Nao repor GRANT aqui de proposito
-- — nao ha o que repor, e REVOKE/GRANT redundante so cria ruido no diff.
--
-- Corpo identico ao que esta em producao hoje, extraido do dump. A UNICA
-- diferenca e o DEFAULT do p_incluir_chat.

CREATE OR REPLACE FUNCTION "public"."admin_delete_cliente"("p_cliente_id" "uuid", "p_mode" "text", "p_target_id" "uuid" DEFAULT NULL::"uuid", "p_confirm" boolean DEFAULT false, "p_incluir_chat" boolean DEFAULT false, "p_forcar" boolean DEFAULT false) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_is_super  boolean;
  v_c_tenant  uuid;
  v_c_role    text;
  v_cliente   record;
  v_filiais   int;
  v_t_tenant  uuid;
  n_contratos int := 0;
  n_produtos  int := 0;
  n_mov       int := 0;
  n_attend    int := 0;
  n_tickets   int := 0;
  n_cs        int := 0;
  n_chat      int := 0;
  n_open_tk   int := 0;
  n_open_att  int := 0;
  n_live_chat int := 0;
begin
  select id, tenant_id, razao_social into v_cliente
  from clientes where id = p_cliente_id;
  if not found then
    raise exception 'Cliente % não encontrado', p_cliente_id;
  end if;

  v_is_super := public.is_super_admin();
  if auth.uid() is not null then
    select tenant_id, role into v_c_tenant, v_c_role from profiles where user_id = auth.uid();
    if not v_is_super
       and (v_c_role is distinct from 'admin' or v_c_tenant is distinct from v_cliente.tenant_id) then
      raise exception 'Sem permissão para excluir clientes deste tenant';
    end if;
  end if;

  if coalesce(p_confirm, false) = false then
    raise exception 'Confirmação obrigatória (p_confirm = true)';
  end if;

  select count(*) into v_filiais from clientes where matriz_id = p_cliente_id;
  if v_filiais > 0 then
    raise exception 'Cliente é matriz de % filial(is). Resolva as filiais antes de excluir.', v_filiais;
  end if;

  ---------------------------------------------------------------- GUARDA DO PURGE
  if p_mode = 'purge' and not coalesce(p_forcar, false) then

    select count(*) into n_open_tk
    from support_tickets st
    left join ticket_statuses ts on ts.id = st.status_id
    where st.cliente_id = p_cliente_id
      and st.deleted_at is null
      and coalesce(ts.is_terminal, false) = false;

    if n_open_tk > 0 then
      raise exception
        'Cliente tem % ticket(s) em aberto. "Excluir tudo" apagaria cada um e a timeline junto, sem volta. Use "Transferir para outro cliente".',
        n_open_tk;
    end if;

    -- Atendimento e apagado por cliente_id mesmo com incluir_chat desligado.
    select count(*) into n_open_att
    from support_attendances sa
    where sa.cliente_id = p_cliente_id
      and sa.status in ('waiting', 'in_progress');

    if n_open_att > 0 then
      raise exception
        'Cliente tem % atendimento(s) em andamento. Encerre antes, ou use "Transferir para outro cliente".',
        n_open_att;
    end if;

    if coalesce(p_incluir_chat, true) then
      select count(*) into n_live_chat
      from whatsapp_conversations c
      where c.contact_id in (select id from whatsapp_contacts where cliente_id = p_cliente_id)
        and (c.status = 'active' or c.last_message_at > now() - interval '90 days');

      if n_live_chat > 0 then
        raise exception
          'Cliente tem % conversa(s) de WhatsApp ativa(s) ou com mensagem nos ultimos 90 dias. Desligue "Incluir conversas/mensagens WhatsApp", ou use "Transferir para outro cliente".',
          n_live_chat;
      end if;
    end if;
  end if;

  ---------------------------------------------------------------- TRANSFER
  if p_mode = 'transfer' then
    if p_target_id is null then raise exception 'Destino obrigatório no modo transfer'; end if;
    if p_target_id = p_cliente_id then raise exception 'Destino não pode ser o próprio cliente'; end if;
    select tenant_id into v_t_tenant from clientes where id = p_target_id;
    if not found then raise exception 'Cliente destino % não encontrado', p_target_id; end if;
    if v_t_tenant is distinct from v_cliente.tenant_id then
      raise exception 'Destino é de outro tenant — transferência bloqueada';
    end if;

    update certificado_a1_vendas          set cliente_id = p_target_id where cliente_id = p_cliente_id;
    update client_alerts                  set cliente_id = p_target_id where cliente_id = p_cliente_id;
    update cliente_avaliacoes_atendimento set cliente_id = p_target_id where cliente_id = p_cliente_id;
    update cliente_contatos               set cliente_id = p_target_id where cliente_id = p_cliente_id;
    update cliente_produtos               set cliente_id = p_target_id where cliente_id = p_cliente_id;
    update clientes_reativacoes_historico set cliente_id = p_target_id where cliente_id = p_cliente_id;
    update contrato_eventos               set cliente_id = p_target_id where cliente_id = p_cliente_id;
    update contratos                      set cliente_id = p_target_id where cliente_id = p_cliente_id;
    update cs_tickets                     set cliente_id = p_target_id where cliente_id = p_cliente_id;
    update movimentos_mrr                 set cliente_id = p_target_id where cliente_id = p_cliente_id;
    update support_attendances            set cliente_id = p_target_id where cliente_id = p_cliente_id;
    update support_tickets                set cliente_id = p_target_id where cliente_id = p_cliente_id;
    update whatsapp_contacts              set cliente_id = p_target_id where cliente_id = p_cliente_id;

    delete from clientes where id = p_cliente_id;

    insert into audit_events(tenant_id, actor_user_id, event_type, metadata)
    values (v_cliente.tenant_id, auth.uid(), 'cliente_excluido',
      jsonb_build_object('mode','transfer','cliente_id',p_cliente_id,
        'razao_social',v_cliente.razao_social,'target_id',p_target_id));

    return jsonb_build_object('ok', true, 'mode', 'transfer',
      'cliente_id', p_cliente_id, 'target_id', p_target_id);

  ---------------------------------------------------------------- PURGE
  elsif p_mode = 'purge' then
    delete from reajuste_contratos where contrato_id in (select id from contratos where cliente_id = p_cliente_id);
    delete from contrato_eventos   where cliente_id = p_cliente_id;
    update movimentos_mrr set estorno_de = null, estornado_por = null where cliente_id = p_cliente_id;
    delete from movimentos_mrr     where cliente_id = p_cliente_id;
    get diagnostics n_mov = row_count;
    update contratos set contrato_pai_id = null where cliente_id = p_cliente_id;
    delete from contratos          where cliente_id = p_cliente_id;
    get diagnostics n_contratos = row_count;
    delete from cliente_produtos   where cliente_id = p_cliente_id;
    get diagnostics n_produtos = row_count;

    if coalesce(p_incluir_chat, true) then
      update support_kb_articles set source_attendance_id = null
        where source_attendance_id in (
          select id from support_attendances
          where contact_id in (select id from whatsapp_contacts where cliente_id = p_cliente_id)
        );
      update support_tickets set parent_ticket_id = null
        where contact_id in (select id from whatsapp_contacts where cliente_id = p_cliente_id);
      delete from support_attendances
        where contact_id in (select id from whatsapp_contacts where cliente_id = p_cliente_id);
      delete from support_tickets
        where contact_id in (select id from whatsapp_contacts where cliente_id = p_cliente_id);
    end if;

    update support_kb_articles set source_attendance_id = null
      where source_attendance_id in (select id from support_attendances where cliente_id = p_cliente_id);
    update support_tickets set parent_ticket_id = null where cliente_id = p_cliente_id;
    delete from support_attendances where cliente_id = p_cliente_id;
    get diagnostics n_attend = row_count;
    delete from support_tickets     where cliente_id = p_cliente_id;
    get diagnostics n_tickets = row_count;

    update whatsapp_sentiment_analysis set cs_ticket_created_id = null
      where cs_ticket_created_id in (select id from cs_tickets where cliente_id = p_cliente_id);
    delete from cs_tickets where cliente_id = p_cliente_id;
    get diagnostics n_cs = row_count;

    if coalesce(p_incluir_chat, true) then
      delete from whatsapp_contacts where cliente_id = p_cliente_id;
      get diagnostics n_chat = row_count;
    end if;

    delete from clientes where id = p_cliente_id;

    insert into audit_events(tenant_id, actor_user_id, event_type, metadata)
    values (v_cliente.tenant_id, auth.uid(), 'cliente_excluido',
      jsonb_build_object('mode','purge','cliente_id',p_cliente_id,
        'razao_social',v_cliente.razao_social,'incluir_chat',coalesce(p_incluir_chat,true),
        'apagados', jsonb_build_object(
          'contratos',n_contratos,'cliente_produtos',n_produtos,'movimentos_mrr',n_mov,
          'support_attendances',n_attend,'support_tickets',n_tickets,'cs_tickets',n_cs,
          'whatsapp_contacts',n_chat)));

    return jsonb_build_object('ok', true, 'mode', 'purge',
      'cliente_id', p_cliente_id,
      'incluir_chat', coalesce(p_incluir_chat, true),
      'apagados', jsonb_build_object(
        'contratos', n_contratos, 'cliente_produtos', n_produtos,
        'movimentos_mrr', n_mov, 'support_attendances', n_attend,
        'support_tickets', n_tickets, 'cs_tickets', n_cs,
        'whatsapp_contacts', n_chat));
  else
    raise exception 'Modo inválido: % (use transfer ou purge)', p_mode;
  end if;
end;
$$;
