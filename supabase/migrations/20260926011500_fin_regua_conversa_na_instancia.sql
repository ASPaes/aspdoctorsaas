-- Régua de cobrança: a conversa é aberta NA INSTÂNCIA CONFIGURADA.
--
-- Regra do Alexandre, 26/09/2026: a cobrança sai SEMPRE pelo número escolhido
-- na tela da régua, para o número que está em "WhatsApp Financeiro" do cadastro
-- do cliente. Nunca pela instância da última conversa — era o que o motor fazia,
-- e no primeiro teste real a mensagem saiu pelo 9922 tendo o 9944 configurado.
--
-- Isso exige abrir conversa onde ela não existe: dos 366 clientes com fatura em
-- aberto, 366 têm o WhatsApp Financeiro preenchido, mas só 10 já conversaram no
-- 9944. Sem esta função a régua alcançaria 10 clientes.
--
-- POR QUE NÃO `wa_open_or_reuse_conversation`: ela é feita para uma PESSOA
-- abrindo chat — usa `auth.uid()`, assume a conversa para quem chamou e
-- devolve `blocked` quando outro agente está atendendo. A régua não tem dono e
-- não pode deixar de avisar o cliente porque o chat dele está em atendimento.
--
-- A conversa nasce sem `assigned_to`: quem responde entra na fila pelo caminho
-- normal de distribuição, com o setor que o gatilho da instância define.
create or replace function public.fn_fin_regua_conversa(
  p_tenant_id   uuid,
  p_instance_id uuid,
  p_phone       text,
  p_nome        text default null,
  p_cliente_id  uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_variants text[];
  v_phone    text;
  v_contact  uuid;
  v_ativo    boolean;
  v_conv     uuid;
begin
  if p_tenant_id is null or p_instance_id is null or coalesce(btrim(p_phone), '') = '' then
    raise exception 'missing_params';
  end if;

  -- Mesma fonte de variantes do resto do projeto: o nono dígito faz o mesmo
  -- telefone existir escrito de duas formas, e o cadastro não sabe qual delas
  -- o WhatsApp do cliente usa.
  v_variants := public.fn_wa_phone_variants(p_phone);
  if coalesce(array_length(v_variants, 1), 0) = 0 then
    raise exception 'telefone_invalido';
  end if;
  v_phone := v_variants[1];

  -- 1) Conversa desta instância para qualquer variante do número.
  select conv.id, conv.contact_id, ct.is_active
    into v_conv, v_contact, v_ativo
  from public.whatsapp_conversations conv
  join public.whatsapp_contacts ct
    on ct.id = conv.contact_id
   and ct.tenant_id = p_tenant_id
   and ct.phone_number = any (v_variants)
  where conv.tenant_id = p_tenant_id
    and conv.instance_id = p_instance_id
    and conv.is_group is not true
  order by (ct.phone_number = v_phone) desc, conv.last_message_at desc nulls last
  limit 1;

  if v_conv is not null then
    -- DEM-0365: contato inativo não recebe nada. Desativar um contato é uma
    -- decisão de alguém, e a régua não passa por cima dela.
    if not coalesce(v_ativo, true) then
      return jsonb_build_object('status', 'inactive_contact', 'contact_id', v_contact);
    end if;

    if p_cliente_id is not null then
      update public.whatsapp_contacts
         set cliente_id = p_cliente_id
       where id = v_contact and cliente_id is null;
    end if;

    return jsonb_build_object(
      'status', 'reused', 'conversation_id', v_conv,
      'contact_id', v_contact, 'phone', v_phone
    );
  end if;

  -- 2) Contato do tenant, em qualquer variante e em qualquer instância. O
  --    contato é do tenant, não da instância: reaproveitar a linha existente é
  --    o que impede o par duplicado com/sem nono dígito de nascer.
  select id, is_active into v_contact, v_ativo
  from public.whatsapp_contacts
  where tenant_id = p_tenant_id
    and phone_number = any (v_variants)
  order by (phone_number = v_phone) desc, created_at asc
  limit 1;

  if v_contact is not null and not coalesce(v_ativo, true) then
    return jsonb_build_object('status', 'inactive_contact', 'contact_id', v_contact);
  end if;

  if v_contact is null then
    begin
      insert into public.whatsapp_contacts (tenant_id, phone_number, name, instance_id, cliente_id)
      values (p_tenant_id, v_phone, coalesce(nullif(btrim(p_nome), ''), v_phone), p_instance_id, p_cliente_id)
      returning id into v_contact;
    exception when unique_violation then
      select id into v_contact
      from public.whatsapp_contacts
      where tenant_id = p_tenant_id and phone_number = any (v_variants)
      order by (phone_number = v_phone) desc, created_at asc
      limit 1;
    end;
  elsif p_cliente_id is not null then
    update public.whatsapp_contacts
       set cliente_id = p_cliente_id
     where id = v_contact and cliente_id is null;
  end if;

  -- 3) Conversa nova, sem dono. `department_id` fica para o gatilho da
  --    instância decidir, igual a qualquer conversa que chega sozinha.
  insert into public.whatsapp_conversations (
    tenant_id, instance_id, contact_id, status, unread_count, metadata
  ) values (
    p_tenant_id, p_instance_id, v_contact, 'active', 0,
    case when p_cliente_id is not null
         then jsonb_build_object('cliente_id', p_cliente_id::text)
         else '{}'::jsonb end
  )
  returning id into v_conv;

  return jsonb_build_object(
    'status', 'created', 'conversation_id', v_conv,
    'contact_id', v_contact, 'phone', v_phone
  );
end;
$function$;

-- Só o motor chama. `authenticated` não entra: quem está logado abre conversa
-- pela RPC da tela, que respeita atendimento em curso.
revoke all on function public.fn_fin_regua_conversa(uuid, uuid, text, text, uuid) from public;
revoke all on function public.fn_fin_regua_conversa(uuid, uuid, text, text, uuid) from authenticated;
grant execute on function public.fn_fin_regua_conversa(uuid, uuid, text, text, uuid) to service_role;
