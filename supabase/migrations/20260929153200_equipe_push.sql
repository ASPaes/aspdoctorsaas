-- =============================================================================
-- Equipe DS (chat interno) — push no celular para mensagem direta, menção e fio.
--
-- Acrescenta 'equipe_mensagem' à lista branca de fn_push_ao_receber_notificacao
-- (migration 20260926010000). O critério da lista é "demanda que tem dono": a
-- Equipe só gera aviso para quem recebeu DM, foi mencionado ou está no fio, ou
-- seja, sempre para uma pessoa, nunca para a empresa toda (exceto @todos).
--
-- ⚠️ SÓ PRODUÇÃO. NÃO aplicar no banco local: esta função faz net.http_post
-- para a edge function send-web-push de PRODUÇÃO, e no local ela é um no-op de
-- propósito (isolamento do setup-local-db). Os avisos em si (sino) nascem na
-- migration 20260929153000 e funcionam no local sem esta.
--
-- Corpo copiado do dump de produção de 29/09/2026; única mudança = o tipo novo.
-- Antes de aplicar, confira se ninguém mexeu nela depois:
--   select pg_get_functiondef('public.fn_push_ao_receber_notificacao'::regproc);
-- =============================================================================
begin;

CREATE OR REPLACE FUNCTION "public"."fn_push_ao_receber_notificacao"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_tipo text;
begin
  if new.silent_mode is true then
    return new;
  end if;

  select n.type into v_tipo
    from public.notifications n
   where n.id = new.notification_id;

  -- Demanda que tem dono. Todo o resto é operação da empresa e fica no sino.
  if v_tipo is null or v_tipo not in (
    'chat_assignment',            -- o atendimento passou a ser seu
    'chat_awaiting_reply',        -- o cliente está esperando você responder
    'whatsapp_new_message',       -- mensagem nova numa conversa sua
    'whatsapp_message_failed',    -- a mensagem que você mandou não saiu
    'scheduled_message_failed',   -- o agendamento que você criou não saiu
    'ticket_assigned',            -- o ticket passou a ser seu
    'onboarding_journey_assigned',-- a jornada passou a ser sua
    'equipe_mensagem'             -- chat interno: DM, menção a você ou resposta no seu fio
  ) then
    return new;
  end if;

  if not exists (
    select 1 from public.push_subscriptions s where s.user_id = new.user_id
  ) then
    return new;
  end if;

  perform net.http_post(
    url := 'https://vbngjzovjhkmietztffo.supabase.co/functions/v1/send-web-push',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZibmdqem92amhrbWlldHp0ZmZvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE4MDM1MTUsImV4cCI6MjA4NzM3OTUxNX0.A9O36VZMT3x0OlnvjyEUwfa7TwLXkATTqw1dhMpJmGQ'
    ),
    body := jsonb_build_object('recipient_id', new.id),
    timeout_milliseconds := 10000
  );

  return new;
exception when others then
  raise warning 'fn_push_ao_receber_notificacao: %', sqlerrm;
  return new;
end;
$$;

commit;
