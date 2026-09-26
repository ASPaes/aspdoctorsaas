-- Push no telefone: só o que está no NOME da pessoa.
--
-- Até aqui, toda notificação que passava pela régua virava push. Na prática isso
-- entregava no aparelho coisas que não são demanda de ninguém em particular:
-- falha de sincronismo do Omie (vai para 5 admins de uma vez), divergência do OEM
-- (4), aprovação pendente do OEM (6), estouro de cota de IA, relatório semanal do
-- Théo, digest gerencial e queda de instância do WhatsApp. Medido em 24/09/2026,
-- numa amostra de 2 dias: os tipos de demanda pessoal têm média de 1,00
-- destinatário; os de integração, de 4 a 6. É essa a diferença.
--
-- A régua continua sendo a de sempre (quiet hours, preferências, escopo de tenant)
-- e nada muda no aviso dentro do sistema: o sino segue mostrando tudo. O que esta
-- migration decide é apenas o que ACORDA o telefone.
--
-- Lista branca, e não lista negra, de propósito: tipo novo não empurra até ser
-- listado aqui. O erro cai para o lado do silêncio, que é recuperável — o contrário
-- é o usuário desinstalar o aplicativo depois do terceiro aviso que não é dele.

create or replace function public.fn_push_ao_receber_notificacao()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
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
    'onboarding_journey_assigned' -- a jornada passou a ser sua
  ) then
    return new;
  end if;

  if not exists (
    select 1 from public.push_subscriptions s where s.user_id = new.user_id
  ) then
    return new;
  end if;

  -- pg_net é assíncrono: a inserção não espera a resposta do envio.
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
  -- Push é acessório: se o envio falhar, a notificação tem que existir do mesmo
  -- jeito. Sem este bloco, um erro aqui derrubaria a transação que grava o aviso.
  raise warning 'fn_push_ao_receber_notificacao: %', sqlerrm;
  return new;
end;
$$;

revoke all on function public.fn_push_ao_receber_notificacao() from public;

comment on function public.fn_push_ao_receber_notificacao() is
  'Chama send-web-push quando a notificação já passou pela régua E é demanda com dono. Integração, relatório e alerta de operação ficam só no sino. Não decide quiet hours: isso é resolvido antes, em notify_event.';
