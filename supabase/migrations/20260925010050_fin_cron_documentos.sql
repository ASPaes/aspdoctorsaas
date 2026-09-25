-- =============================================================================
-- Preenchedor de documentos — em segundo plano, longe do cliente.
--
-- POR QUE ELE EXISTE, e é a lição mais cara desta feature: buscar o documento
-- na hora da resposta fez a 2ª via levar **107 segundos** e o cliente não
-- receber nada. O motor de atendimento desistiu de esperar e mandou o aviso de
-- fora do expediente no lugar da resposta.
--
-- Buscar documento custa até três chamadas ao Omie. Quem está do outro lado do
-- WhatsApp não espera isso. Então o cache se enche aqui, onde ninguém espera, e
-- o chat só lê.
--
-- DE 5 EM 5 MINUTOS, 5 POR RODADA: 60 por hora. Os ~760 títulos em aberto da
-- Digi Office enchem em meio dia. O Omie bloqueia a API por 30 minutos quando
-- leva rajada, e este ritmo fica longe disso.
-- =============================================================================

create or replace function public.cron_fin_documentos()
returns void
language plpgsql
security definer
set search_path to 'public', 'vault'
as $$
declare
  v_segredo text;
  v_req     bigint;
begin
  select s.decrypted_secret into v_segredo
  from vault.decrypted_secrets s
  where s.name = 'fin_sync_cron_secret';

  if v_segredo is null then
    raise warning 'cron_fin_documentos: segredo ausente no vault; nada disparado';
    return;
  end if;

  select net.http_post(
    url := 'https://vbngjzovjhkmietztffo.supabase.co/functions/v1/fin-documentos-preencher',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_segredo
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  ) into v_req;
end;
$$;

revoke all on function public.cron_fin_documentos() from public;

comment on function public.cron_fin_documentos() is
  'Enche fin_titulos.documentos em segundo plano. O chat NUNCA busca documento na hora: em 25/09/2026 isso fez a resposta levar 107s e não chegar.';

select cron.schedule(
  'fin-documentos-preencher',
  '*/5 * * * *',
  $$select public.cron_fin_documentos();$$
);
