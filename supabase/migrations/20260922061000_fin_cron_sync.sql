-- =============================================================================
-- Financeiro — segredo e agendamento da leitura de títulos.
--
-- A function `fin-sync-titulos` roda sem JWT de usuário (quem chama é o pg_cron),
-- então a autenticação dela é um segredo dedicado no vault, comparado com o
-- Bearer recebido. Mesmo desenho do `recon-espelho-pull-cron`, que já roda assim
-- de 15 em 15 minutos.
--
-- O segredo nasce aqui, aleatório, e ninguém precisa saber o valor: quem lê é a
-- função do cron, por dentro do banco.
--
-- O JOB NÃO É CRIADO AQUI DE PROPÓSITO. Agendar é decisão de quem opera, e o
-- módulo ainda está fechado. O comando está no fim do arquivo, comentado.
-- =============================================================================

do $$
declare
  v_id uuid;
begin
  select id into v_id from vault.secrets where name = 'fin_sync_cron_secret';
  if v_id is null then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'fin_sync_cron_secret',
      'Segredo do cron que lê títulos a receber para o módulo Financeiro'
    );
  end if;
end $$;

create or replace function public.obter_segredo_cron_fin_sync()
returns text
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  v_segredo text;
begin
  select s.decrypted_secret into v_segredo
  from vault.decrypted_secrets s
  where s.name = 'fin_sync_cron_secret';
  return v_segredo;
end;
$$;

comment on function public.obter_segredo_cron_fin_sync() is
  'Devolve o segredo que a edge function fin-sync-titulos compara com o Bearer recebido. Só service_role executa.';

-- Só a edge function (service_role) chama. Revogar de `authenticated` de forma
-- explícita: revogar de PUBLIC não restringe nada neste projeto.
revoke all on function public.obter_segredo_cron_fin_sync() from public;
revoke all on function public.obter_segredo_cron_fin_sync() from anon, authenticated;
grant execute on function public.obter_segredo_cron_fin_sync() to service_role;

-- =============================================================================
-- Disparo. Lê o segredo do vault e chama a edge function, como o cron do espelho.
-- =============================================================================
create or replace function public.cron_fin_sync_titulos()
returns void
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  v_segredo text;
  v_req     bigint;
begin
  select s.decrypted_secret into v_segredo
  from vault.decrypted_secrets s
  where s.name = 'fin_sync_cron_secret';

  if v_segredo is null then
    raise warning 'cron_fin_sync_titulos: segredo ausente no vault; nada disparado';
    return;
  end if;

  select net.http_post(
    url := 'https://vbngjzovjhkmietztffo.supabase.co/functions/v1/fin-sync-titulos',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_segredo
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 180000
  ) into v_req;
end;
$$;

comment on function public.cron_fin_sync_titulos() is
  'Dispara a leitura de títulos a receber (edge function fin-sync-titulos). Chamada pelo pg_cron.';

revoke all on function public.cron_fin_sync_titulos() from public;
revoke all on function public.cron_fin_sync_titulos() from anon, authenticated;
grant execute on function public.cron_fin_sync_titulos() to service_role;

-- Para agendar, quando o módulo for liberado (de hora em hora, no minuto 20,
-- longe do minuto cheio onde os outros crons se acumulam):
--
--   select cron.schedule('fin-sync-titulos', '20 * * * *', $cron$select public.cron_fin_sync_titulos()$cron$);
--
-- Para parar:
--
--   select cron.unschedule('fin-sync-titulos');
