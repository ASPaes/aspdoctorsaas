-- ============================================================================
-- Mensagem agendada no chat -- 1/3, a tabela  (11/09/2026)
--
-- O QUE E: uma 4a aba no compositor do chat ("Agendar"). O operador escreve a
-- mensagem, marca dia e hora, e o motor envia sozinho na hora marcada. Varias
-- por conversa, editaveis e cancelaveis ate o disparo.
--
-- POR QUE TABELA PROPRIA e nao um campo em support_attendances: o
-- `scheduled_until` do atendimento e OUTRA coisa -- ele so dispara o texto fixo
-- "vamos retomar nosso atendimento?" da `schedule-reminder`, e e um por
-- atendimento. Aqui o texto e livre e sao N por conversa.
--
-- O ARQUIVO do anexo sobe para o bucket `whatsapp-media` no momento em que o
-- operador agenda (mesmo caminho da `get-media-upload-url`) e so vira mensagem
-- no disparo. A `purge-chat-media` NAO varre o bucket -- ela so apaga o que ja
-- esta em `whatsapp_messages` e passou da retencao -- entao o anexo agendado
-- esta a salvo dela. Quem limpa o orfao de agendamento cancelado e o motor
-- (3/3), que roda com service_role.
--
-- STATUS: pending -> sending -> sent | failed, ou canceled a qualquer momento
-- antes do disparo. `sending` e o claim do motor: existe para que duas
-- execucoes do cron nao enviem a mesma mensagem duas vezes.
-- ============================================================================
BEGIN;

CREATE TABLE IF NOT EXISTS public.whatsapp_scheduled_messages (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  conversation_id     uuid NOT NULL REFERENCES public.whatsapp_conversations(id) ON DELETE CASCADE,

  -- Instancia escolhida no momento do agendamento. NULL = decidir no disparo
  -- pela instancia corrente da conversa (o caso normal); preenchida quando o
  -- operador agendou de uma instancia especifica numa conversa multi-instancia.
  instance_id         uuid REFERENCES public.whatsapp_instances(id) ON DELETE SET NULL,

  created_by          uuid NOT NULL,

  content             text NOT NULL DEFAULT '',
  message_type        text NOT NULL DEFAULT 'text',

  -- Anexo ja no Storage (bucket whatsapp-media), no formato tenant/conversa/uuid.ext
  storage_path        text,
  media_mimetype      text,
  media_file_name     text,
  media_size_bytes    bigint,

  scheduled_at        timestamptz NOT NULL,

  -- "Cancelar se o cliente responder antes". Desmarcado por padrao: lembrete de
  -- vencimento continua valendo mesmo que o cliente tenha escrito no meio.
  cancel_if_client_replies boolean NOT NULL DEFAULT false,

  status              text NOT NULL DEFAULT 'pending',
  attempts            int  NOT NULL DEFAULT 0,
  claimed_at          timestamptz,
  last_error          text,

  sent_at             timestamptz,
  -- Sem FK de proposito: a mensagem pode ser apagada pelo operador (delete_status)
  -- e isso nao pode derrubar o historico do agendamento.
  sent_message_id     uuid,

  canceled_at         timestamptz,
  canceled_by         uuid,
  cancel_reason       text,

  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT wa_sched_status_chk
    CHECK (status IN ('pending','sending','sent','failed','canceled')),
  CONSTRAINT wa_sched_type_chk
    CHECK (message_type IN ('text','image','video','document','audio')),
  -- Texto puro exige conteudo; midia exige arquivo. A legenda da midia e
  -- opcional e vai no proprio `content`.
  CONSTRAINT wa_sched_payload_chk
    CHECK (
      (message_type = 'text'  AND length(btrim(content)) > 0 AND storage_path IS NULL)
      OR
      (message_type <> 'text' AND storage_path IS NOT NULL AND media_mimetype IS NOT NULL)
    )
);

COMMENT ON TABLE public.whatsapp_scheduled_messages IS
  'Mensagens que o operador agendou para sair sozinhas numa data/hora. Enviadas pelo cron dispatch-scheduled-messages. Nao confundir com support_attendances.scheduled_until, que e o lembrete de retomada com texto fixo.';
COMMENT ON COLUMN public.whatsapp_scheduled_messages.claimed_at IS
  'Momento em que o motor pegou a linha (status=sending). Linha presa em sending ha mais de 10 min volta para a fila -- e o que resgata o isolate que morreu no meio do envio.';
COMMENT ON COLUMN public.whatsapp_scheduled_messages.cancel_if_client_replies IS
  'true = se o cliente escrever na conversa depois do agendamento e antes da hora marcada, a mensagem e cancelada em vez de enviada.';

-- Indice do motor: a varredura do cron e só esta. Parcial porque pending/sending
-- sao uma fracao minuscula da tabela depois de algumas semanas.
CREATE INDEX IF NOT EXISTS idx_wa_sched_due
  ON public.whatsapp_scheduled_messages (scheduled_at)
  WHERE status IN ('pending','sending');

-- Indice da tela: o chip "N agendadas" e a lista dentro da conversa aberta.
CREATE INDEX IF NOT EXISTS idx_wa_sched_conv_pendente
  ON public.whatsapp_scheduled_messages (conversation_id, scheduled_at)
  WHERE status IN ('pending','sending');

-- Historico por conversa (as ja enviadas/canceladas aparecem no proprio chat,
-- mas a aba de agendadas mostra as ultimas).
CREATE INDEX IF NOT EXISTS idx_wa_sched_tenant_criado
  ON public.whatsapp_scheduled_messages (tenant_id, created_at DESC);

-- updated_at
CREATE OR REPLACE FUNCTION public.trg_wa_sched_touch()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_wa_sched_touch ON public.whatsapp_scheduled_messages;
CREATE TRIGGER trg_wa_sched_touch
  BEFORE UPDATE ON public.whatsapp_scheduled_messages
  FOR EACH ROW EXECUTE FUNCTION public.trg_wa_sched_touch();

-- ----------------------------------------------------------------------------
-- RLS: a tela so LE por aqui. Toda escrita passa pelas RPCs do arquivo 2/3,
-- que e onde mora a regra de quem pode editar/cancelar. Sem policy de
-- INSERT/UPDATE/DELETE, `authenticated` nao escreve direto nem por engano.
--
-- `coalesce(..., false)` no super admin: `is_super_admin()` devolve NULL para
-- perfil que a RLS de profiles nao deixa ler, e NULL num OR de policy ja
-- negaria -- o coalesce e para o predicado ficar legivel e nao virar NULL.
-- ----------------------------------------------------------------------------
ALTER TABLE public.whatsapp_scheduled_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS wa_sched_select ON public.whatsapp_scheduled_messages;
CREATE POLICY wa_sched_select ON public.whatsapp_scheduled_messages
  FOR SELECT USING (
    tenant_id = (SELECT public.current_tenant_id())
    OR coalesce((SELECT public.is_super_admin()), false)
  );

-- O banco tem ALTER DEFAULT PRIVILEGES dando ALL em TABLES para anon e
-- authenticated: tabela nova nasce com INSERT/UPDATE/DELETE nos dois papeis
-- (conferido no container local -- 7 privilegios em cada). A RLS sem policy de
-- escrita ja barraria, mas depender so dela e deixar o portao aberto atras de
-- uma tranca. Revogar e o que fecha.
REVOKE ALL ON public.whatsapp_scheduled_messages FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.whatsapp_scheduled_messages TO authenticated;
GRANT ALL    ON public.whatsapp_scheduled_messages TO service_role;

COMMIT;
