-- ============================================================================
-- E-mail enviado vira linha nas Ocorrências do chamado (17/09/2026)
--
-- Pedido do Alexandre: o e-mail mandado pelo ticket precisa ficar registrado no
-- histórico, com opção de ver e responder. A resposta do cliente já virava
-- linha (`fn_email__evento_cliente`, tipo 'email_cliente', guardando o id do
-- recebido em new_value); faltava o lado do envio.
--
-- Mesma ideia: uma linha 'email_enviado' com o id de `email_envios` em
-- new_value, que é por onde a tela abre o e-mail. Quem chama é a send-email,
-- depois de registrar o envio, e só quando a referência do envio é um chamado
-- (e-mail do chat referencia o ATENDIMENTO, não o ticket, e não entra aqui).
--
-- Idempotente por envio: reenviar a mesma linha não duplica a ocorrência.
--
-- Aplicar pelo SQL Editor. Pode ser aplicada antes ou depois do deploy: sem a
-- função, a send-email só registra um aviso no log e o envio segue normal.
-- ============================================================================

begin;

create or replace function public.fn_email__evento_enviado(p_envio_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  e record;
begin
  select id, tenant_id, referencia_id, assunto, para, cc, status
    into e
    from public.email_envios
   where id = p_envio_id;

  if not found or e.referencia_id is null or e.status <> 'enviado' then
    return;
  end if;

  -- a referência precisa ser um chamado deste tenant; no chat ela é o atendimento
  if not exists (
    select 1 from public.support_tickets t
     where t.id = e.referencia_id and t.tenant_id = e.tenant_id and t.deleted_at is null
  ) then
    return;
  end if;

  if exists (
    select 1 from public.support_ticket_events v
     where v.ticket_id = e.referencia_id and v.event_type = 'email_enviado' and v.new_value = p_envio_id::text
  ) then
    return;
  end if;

  insert into public.support_ticket_events (tenant_id, ticket_id, user_id, event_type, content, new_value)
  values (
    e.tenant_id,
    e.referencia_id,
    null,
    'email_enviado',
    concat_ws(E'\n',
      'Para: ' || array_to_string(e.para, ', '),
      case when coalesce(array_length(e.cc, 1), 0) > 0 then 'Cc: ' || array_to_string(e.cc, ', ') end,
      'Assunto: ' || coalesce(e.assunto, '')
    ),
    p_envio_id::text
  );
end;
$$;

revoke all on function public.fn_email__evento_enviado(uuid) from public, anon, authenticated;
grant execute on function public.fn_email__evento_enviado(uuid) to service_role;

commit;
