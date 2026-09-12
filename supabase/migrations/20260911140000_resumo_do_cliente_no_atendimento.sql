-- ============================================================================
-- Resumo do atendimento escrito PARA O CLIENTE, e o motivo de não ter enviado
--
-- A finalize-attendance já pede à IA um resumo do atendimento, mas ele é escrito
-- para a equipe, em terceira pessoa ("o cliente relatou que..."). Para mandar ao
-- cliente é preciso um texto falando com ele. Em vez de uma segunda chamada de
-- IA, a mesma chamada passa a devolver também esse texto, gravado aqui.
--
-- `email_skip_reason` guarda por que o e-mail automático NÃO saiu (sem cliente
-- vinculado, ficha sem e-mail, nenhuma conta ativa). É o que a tela de
-- parâmetros promete: "o motivo fica registrado". Envio que acontece de verdade
-- continua sendo registrado em `email_envios`.
--
-- Aplicar pelo SQL Editor. Idempotente.
-- ============================================================================

begin;

alter table public.support_attendances
  add column if not exists ai_customer_summary text,
  add column if not exists email_skip_reason    text;

comment on column public.support_attendances.ai_customer_summary is
  'Resumo do atendimento escrito para o CLIENTE (2a pessoa), gerado na mesma chamada de IA do encerramento.';
comment on column public.support_attendances.email_skip_reason is
  'Por que o e-mail automático de encerramento não foi enviado. Nulo quando enviou ou quando o parâmetro está desligado.';

commit;
