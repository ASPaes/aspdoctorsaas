-- ============================================================================
-- Robô que lê as caixas: segredo, disparo e agenda
--
-- Mesmo desenho do cron do espelho do OEM (recon-espelho-pull-cron): o segredo
-- mora no Vault, a function do banco lê de lá e manda no cabeçalho, e a edge
-- function compara. Assim nenhuma chave entra no repositório.
--
-- Cadência (decisão do Alexandre, 11/09/2026): a cada 5 minutos no horário
-- comercial, a cada 30 fora dele. Em vez de duas agendas em UTC, que é onde
-- esse tipo de conta erra, existe UMA agenda de 5 em 5 e a função decide se é
-- hora de disparar, já no fuso de São Paulo.
--
-- Aplicar pelo SQL Editor. Idempotente: `cron.schedule` com nome repetido
-- substitui a agenda, e o segredo só é criado se ainda não existir.
-- ============================================================================

begin;

-- segredo do cron, gerado no banco: nunca passa por aqui nem pelo repositório
do $$
begin
  if not exists (select 1 from vault.decrypted_secrets where name = 'emails_leitor_cron_secret') then
    perform vault.create_secret(encode(gen_random_bytes(32), 'hex'), 'emails_leitor_cron_secret');
  end if;
end $$;

create or replace function public.obter_segredo_leitor_emails()
returns text
language sql
stable
security definer
set search_path = public, vault
as $$
  select s.decrypted_secret from vault.decrypted_secrets s where s.name = 'emails_leitor_cron_secret';
$$;

-- default privilege daria EXECUTE a authenticated; aqui isso entregaria o segredo
revoke all on function public.obter_segredo_leitor_emails() from public, anon, authenticated;
grant execute on function public.obter_segredo_leitor_emails() to service_role;

/**
 * Dispara a leitura das caixas. Chamado pelo cron de 5 em 5 minutos; fora do
 * horário comercial só deixa passar nos minutos 0 e 30.
 */
create or replace function public.cron_ler_emails_recebidos()
returns void
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  v_segredo text;
  v_agora   timestamp := now() at time zone 'America/Sao_Paulo';
  v_comercial boolean;
begin
  v_comercial := extract(dow from v_agora) between 1 and 5
             and extract(hour from v_agora) between 7 and 18;

  if not v_comercial and extract(minute from v_agora)::int not in (0, 30) then
    return;
  end if;

  select s.decrypted_secret into v_segredo
    from vault.decrypted_secrets s
   where s.name = 'emails_leitor_cron_secret';

  if v_segredo is null then
    raise warning 'cron_ler_emails_recebidos: segredo ausente no vault; nada disparado';
    return;
  end if;

  perform net.http_post(
    url     := 'https://vbngjzovjhkmietztffo.supabase.co/functions/v1/ler-emails-recebidos',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_segredo),
    body    := '{}'::jsonb
  );
end $$;

revoke all on function public.cron_ler_emails_recebidos() from public, anon, authenticated;
grant execute on function public.cron_ler_emails_recebidos() to service_role;

commit;

-- a agenda fica fora da transação: cron.schedule não pertence ao schema public
-- e o banco local não tem pg_cron, então o bloco só roda onde a extensão existe
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule(
      'ler-emails-recebidos',
      '*/5 * * * *',
      $cron$select public.cron_ler_emails_recebidos();$cron$
    );
    raise notice 'agenda ler-emails-recebidos criada/substituida';
  else
    raise notice 'pg_cron ausente (banco local): agenda nao criada';
  end if;
end $$;
