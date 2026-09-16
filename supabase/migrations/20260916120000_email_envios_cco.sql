-- ============================================================================
-- E-mails: Cco também fica registrado no envio
--
-- Pendência registrada em 15/09/2026, quando o Cco entrou na tela de envio do
-- chat: quem recebeu em cópia oculta não aparecia em E-mails › Enviados,
-- porque `email_envios` só tinha `para` e `cc`.
--
-- Isso é registro interno, não muda o e-mail: o Cco continua fora de qualquer
-- cabeçalho da mensagem (só entra no envelope SMTP), então ninguém que recebe
-- descobre quem mais recebeu. O que muda é a operação conseguir auditar depois
-- para quem o e-mail foi, que é o pedido do Alexandre.
--
-- Aplicar pelo SQL Editor. Idempotente.
-- ============================================================================

begin;

alter table public.email_envios
  add column if not exists cco text[] not null default '{}'::text[];

comment on column public.email_envios.cco is
  'Cópia oculta do envio, só para a tela E-mails. Nunca vai em cabeçalho do e-mail: no SMTP o Cco entra apenas no envelope.';

commit;

-- ============================================================================
-- ORDEM: aplicar ANTES de publicar a send-email que grava a coluna. Invertendo,
-- o insert do registro falharia e o e-mail sairia sem ficar registrado.
-- ============================================================================
