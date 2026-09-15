-- ============================================================================
-- E-mail em cópia e anexos visíveis em Recebidos
--
-- 1. `email_enderecos_destino.aceita_copia`: pedido do Alexandre (14/09/2026)
--    depois de um e-mail interno em que a caixa do suporte só estava em cópia
--    ir para a Triagem. Desligado, o endereço só abre ticket quando o cliente
--    escreveu PARA ele; em cópia, a mensagem é ignorada. Padrão desligado.
--
-- 2. Anexo de e-mail que ainda não virou ticket (Triagem) não abria: a regra de
--    leitura do bucket `ticket-attachments` só libera arquivo que já está em
--    `support_ticket_attachments`. A regra nova libera o arquivo listado em
--    `email_recebidos.anexos` para quem pode ver aquele e-mail. Quem pode ver
--    continua sendo o RLS de `email_recebidos` (o operador só vê os dele).
--    Regras de leitura no Storage somam com OR; nenhuma existente muda.
--
-- Aplicar pelo SQL Editor. Blocos independentes e idempotentes.
-- ============================================================================


-- ── Bloco 1: chave de cópia por endereço ────────────────────────────────────
begin;

alter table public.email_enderecos_destino
  add column if not exists aceita_copia boolean not null default false;

comment on column public.email_enderecos_destino.aceita_copia is
  'Abre ticket também quando o endereço só está em cópia (Cc). Desligado: só quando o cliente escreveu para ele.';

commit;


-- ── Bloco 2: ver e baixar anexo pela tela de Recebidos ──────────────────────
begin;

create index if not exists ix_email_recebidos_anexos
  on public.email_recebidos using gin (anexos jsonb_path_ops);

drop policy if exists email_recebidos_anexos_select on storage.objects;
create policy email_recebidos_anexos_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'ticket-attachments'
    and exists (
      -- o RLS de email_recebidos vale dentro desta consulta: só enxerga o
      -- arquivo quem enxerga o e-mail
      select 1
        from public.email_recebidos r
       where r.anexos @> jsonb_build_array(jsonb_build_object('caminho', storage.objects.name))
    )
  );

commit;
