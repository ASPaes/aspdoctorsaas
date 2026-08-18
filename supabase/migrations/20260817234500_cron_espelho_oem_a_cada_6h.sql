-- ============================================================================
-- Espelho do OEM: agendamento a cada 6h
--
-- POR QUE (17/08/2026)
--
-- O espelho do OEM no DoctorSaaS NUNCA teve agendamento. Das 41 tarefas
-- agendadas do projeto, nenhuma chamava `oem-espelho-sync`: ele só rodava
-- quando alguém clicava em "Atualizar espelho" na tela de Integrações. Medido
-- neste dia, o espelho estava parado havia 40 horas — todas as 2.566 filiais
-- com o mesmo carimbo de atualização — e a tela dizia, na descrição, que a base
-- se atualizava sozinha a cada 6 horas. Quem atualiza a cada 6h é o DoctorOEM
-- contra a API do OEM; do DoctorOEM para cá, não havia nada.
--
-- Isso apareceu como bug de valor: um cliente mostrava custo de licença de dois
-- dias atrás e ninguém tinha como saber que era foto velha.
--
-- COMO
--
-- Cópia fiel do desenho de `cron_recon_espelho`, que já roda neste banco: a
-- chave não vai no comando do cron (que é legível por quem alcança cron.job) e
-- sim no Vault; o disparo fica registrado em `cron_estado` para dar para
-- auditar depois; e `cron_verificar_anterior` reclama se a execução anterior
-- falhou.
--
-- A `oem-espelho-sync` aceita service_role para chamada de máquina (ela mesma
-- declara isso em `exigirAdmin`), por isso o segredo usado é o
-- `service_role_key` — conferido: o claim `role` dele é `service_role`.
--
-- Minuto 17 de propósito: os agendamentos deste banco se acumulam no minuto 0
-- e este não tem pressa nenhuma.
-- ============================================================================

create or replace function public.cron_oem_espelho()
returns void
language plpgsql
security definer
set search_path to 'public', 'vault'
as $fn$
declare
  v_segredo text;
  v_req     bigint;
begin
  perform public.cron_verificar_anterior('oem-espelho-atualizar');

  select s.decrypted_secret into v_segredo
  from vault.decrypted_secrets s
  where s.name = 'service_role_key';

  -- Sem segredo, não dispara e AVISA. Falhar calado aqui reproduziria
  -- exatamente o problema que esta migration existe para resolver.
  if v_segredo is null then
    raise warning 'cron_oem_espelho: segredo ausente no vault; nada disparado';
    return;
  end if;

  select net.http_post(
    url := 'https://vbngjzovjhkmietztffo.supabase.co/functions/v1/oem-espelho-sync',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'Authorization','Bearer ' || v_segredo
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 150000
  ) into v_req;

  insert into public.cron_estado (jobname, ultimo_request_id, ultima_execucao)
  values ('oem-espelho-atualizar', v_req, now())
  on conflict (jobname) do update
    set ultimo_request_id = excluded.ultimo_request_id,
        ultima_execucao   = excluded.ultima_execucao;
end;
$fn$;

-- A função LÊ O COFRE e dispara sincronização: ninguém logado no app tem o que
-- fazer com ela. `revoke from public` sozinho não restringe nada, porque o
-- privilégio padrão já concede EXECUTE a `authenticated` — por isso os revokes
-- são explícitos, um por papel.
revoke all on function public.cron_oem_espelho() from public;
revoke all on function public.cron_oem_espelho() from anon;
revoke all on function public.cron_oem_espelho() from authenticated;
grant execute on function public.cron_oem_espelho() to postgres;

-- Idempotente: remove o agendamento anterior antes de recriar.
do $$
declare j bigint;
begin
  for j in select jobid from cron.job where jobname = 'oem-espelho-atualizar' loop
    perform cron.unschedule(j);
  end loop;
end $$;

select cron.schedule(
  'oem-espelho-atualizar',
  '17 */6 * * *',
  $$select public.cron_oem_espelho();$$
);

-- ---------------------------------------------------------------------------
-- CONFERÊNCIA (só leitura)
--
--   select jobid, jobname, schedule, active from cron.job
--    where jobname = 'oem-espelho-atualizar';
--
--   select * from public.cron_estado where jobname = 'oem-espelho-atualizar';
--
--   -- o que interessa de verdade: o espelho parou de envelhecer?
--   select max(atualizado_em) as ultima, now() - max(atualizado_em) as idade
--     from public.oem_espelho_filial;
--
-- DESLIGAR sem apagar:
--   update cron.job set active = false where jobname = 'oem-espelho-atualizar';
-- ---------------------------------------------------------------------------
