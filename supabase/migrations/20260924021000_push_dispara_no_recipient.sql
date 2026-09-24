-- Dispara o Web Push quando uma notificação chega para alguém.
--
-- Por que AQUI e não dentro de `fn_notify_user`: `notification_recipients` é o
-- ponto por onde passa TODA notificação, venha de onde vier — e, mais
-- importante, quando a linha chega aqui ela **já passou pela régua**: quiet
-- hours, preferências e escopo de tenant foram decididos antes. Repetir esse
-- julgamento no push seria a forma mais rápida de mandar aviso às 3 da manhã.
--
-- Duas guardas, porque esta tabela é quente:
--   1. `silent_mode` = notificação que entra sem avisar ninguém. Nada de push.
--   2. sem aparelho inscrito = nem chama a function. A maioria dos usuários não
--      tem assinatura, e o EXISTS com índice em user_id custa quase nada perto
--      de uma requisição HTTP por linha inserida.

create or replace function public.fn_push_ao_receber_notificacao()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.silent_mode is true then
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

drop trigger if exists trg_push_ao_receber_notificacao on public.notification_recipients;
create trigger trg_push_ao_receber_notificacao
  after insert on public.notification_recipients
  for each row execute function public.fn_push_ao_receber_notificacao();

comment on function public.fn_push_ao_receber_notificacao() is
  'Chama send-web-push quando a notificação já passou pela régua. Não decide se deve avisar: isso é resolvido antes, em notify_event.';
