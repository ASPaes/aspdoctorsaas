-- ============================================================================
-- Anexos do e-mail do cliente entram no ticket (etapa 3)
--
-- O robô (ler-emails-recebidos) extrai os anexos, sobe cada arquivo para o
-- bucket `ticket-attachments` ANTES de gravar o e-mail, num caminho fixo por
-- mensagem (regravar por cima não cria órfão), e guarda a lista em
-- `email_recebidos.anexos`. Quando a mensagem é ligada a um ticket, os anexos
-- entram em `support_ticket_attachments`, e a tela de anexos do ticket e da
-- jornada mostra e abre como qualquer outro.
--
-- Onde a ligação acontece: em `fn_email__evento_cliente`, que é chamada em
-- todos os caminhos que ligam e-mail a ticket (ticket novo, resposta,
-- reabertura, continuação, jornada e triagem). Por isso as funções grandes da
-- etapa 1 não precisam ser reescritas.
--
-- `support_ticket_attachments.uploaded_by` deixa de ser obrigatório: o anexo
-- que veio do cliente não tem usuário. A coluna não tem FK nem gatilho; a tela
-- mostra "Cliente por e-mail" quando está vazia.
--
-- Aplicar pelo SQL Editor. Blocos independentes e idempotentes.
-- ============================================================================


-- ── Bloco 1: colunas ─────────────────────────────────────────────────────────
begin;

alter table public.support_ticket_attachments
  alter column uploaded_by drop not null;

comment on column public.support_ticket_attachments.uploaded_by is
  'Quem subiu o arquivo. Nulo = veio anexado no e-mail do cliente (ler-emails-recebidos, 14/09/2026).';

alter table public.email_recebidos
  add column if not exists anexos           jsonb  not null default '[]'::jsonb,
  add column if not exists anexos_ignorados text[] not null default '{}';

comment on column public.email_recebidos.anexos is
  'Anexos guardados no bucket ticket-attachments: [{nome, mime, tamanho, caminho}]. Entram no ticket quando o e-mail é ligado a um.';
comment on column public.email_recebidos.anexos_ignorados is
  'Arquivos do e-mail que não foram guardados, com o motivo (tipo não aceito, grande demais, falha ao subir).';

commit;


-- ── Bloco 2: mensagem do cliente no histórico, agora com os anexos ──────────
-- Mesma assinatura da etapa 1 (20260913230000); troca de SQL para plpgsql.
begin;

create or replace function public.fn_email__evento_cliente(
  p_ticket_id uuid, p_tenant_id uuid, p_recebido_id uuid,
  p_de text, p_assunto text, p_corpo text, p_extra text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_anexos jsonb;
  v_nomes  text;
begin
  select coalesce(r.anexos, '[]'::jsonb) into v_anexos
    from public.email_recebidos r
   where r.id = p_recebido_id;
  v_anexos := coalesce(v_anexos, '[]'::jsonb);

  select string_agg(a->>'nome', ', ') into v_nomes
    from jsonb_array_elements(v_anexos) a
   where coalesce(a->>'caminho', '') <> '';

  insert into public.support_ticket_events (tenant_id, ticket_id, user_id, event_type, content, new_value)
  values (
    p_tenant_id, p_ticket_id, null, 'email_cliente',
    concat_ws(E'\n\n',
      nullif(btrim(coalesce(p_extra, '')), ''),
      'De: ' || coalesce(p_de, '') || coalesce(E'\nAssunto: ' || nullif(btrim(p_assunto), ''), ''),
      coalesce(
        nullif(btrim(p_corpo), ''),
        case when v_nomes is not null then '(mensagem só com anexo)' else '(mensagem sem texto)' end
      ),
      case when v_nomes is not null then 'Anexos: ' || v_nomes end
    ),
    p_recebido_id::text
  );

  -- os arquivos entram na lista de anexos do ticket (ou da jornada), sem repetir
  if v_nomes is not null then
    insert into public.support_ticket_attachments (
      tenant_id, ticket_id, file_name, file_path, file_url, file_size, file_type, uploaded_by
    )
    select p_tenant_id, p_ticket_id, a->>'nome', a->>'caminho', a->>'caminho',
           nullif(a->>'tamanho', '')::bigint, a->>'mime', null
      from jsonb_array_elements(v_anexos) a
     where coalesce(a->>'caminho', '') <> ''
       and not exists (
         select 1 from public.support_ticket_attachments x
          where x.ticket_id = p_ticket_id and x.file_path = a->>'caminho'
       );
  end if;
end;
$$;

revoke all on function public.fn_email__evento_cliente(uuid, uuid, uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.fn_email__evento_cliente(uuid, uuid, uuid, text, text, text, text) to service_role;

commit;
