-- ============================================================================
-- Envio em lote pelo WhatsApp (DEM-0492) -- 1/3, estrutura  (30/09/2026)
--
-- O QUE E: no Chat, admin/head escolhe varios grupos ou contatos, escreve UMA
-- mensagem com {nome_cliente}, anexa um PDF opcional e dispara. Cada
-- destinatario vira UMA linha em `whatsapp_scheduled_messages` com horario
-- proprio, e quem entrega e o motor que ja existe (dispatch-scheduled-messages).
-- Nao ha fila nova.
--
-- RITMO: um intervalo sorteado entre `intervalo_min_s` e `intervalo_max_s`
-- ENTRE uma mensagem e a proxima (padrao 5 a 30 s). Nao e "tudo em 30 s": numero
-- Evolution que dispara muita mensagem igual de uma vez e bloqueado pelo
-- WhatsApp. So admin muda o ritmo (decisao do Alexandre, 29/09).
--
-- PORTAO: `tenants.envio_lote_enabled` nasce false em todo tenant. A RPC recusa
-- e o botao nao aparece enquanto estiver false. Regra de 23/09: nada fala com
-- cliente antes do teste no WhatsApp do Alexandre.
--
-- Uma transacao por recurso, cada uma com lock_timeout: `whatsapp_contacts` e
-- tabela quente (webhook), e DDL nela nao divide transacao com outra.
-- Tudo idempotente -- se um bloco cair no timeout, rode o arquivo de novo.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. O lote
-- ---------------------------------------------------------------------------
BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.whatsapp_bulk_sends (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  instance_id      uuid NOT NULL REFERENCES public.whatsapp_instances(id) ON DELETE CASCADE,
  created_by       uuid NOT NULL,

  titulo           text NOT NULL,
  -- O texto como o autor escreveu, ainda com {nome_cliente}. O texto ja
  -- trocado de cada destinatario mora na linha de whatsapp_scheduled_messages.
  content          text NOT NULL DEFAULT '',
  message_type     text NOT NULL DEFAULT 'text',

  -- Um arquivo so para o lote inteiro: todas as linhas apontam para ele.
  -- Por isso a limpeza de orfao do motor ignora linha com bulk_send_id
  -- (ver 3/3 e a edge function) -- apagar pelo cancelamento de UM destinatario
  -- derrubaria o anexo dos outros.
  storage_path     text,
  media_mimetype   text,
  media_file_name  text,
  media_size_bytes bigint,

  intervalo_min_s  int  NOT NULL DEFAULT 5,
  intervalo_max_s  int  NOT NULL DEFAULT 30,
  total            int  NOT NULL DEFAULT 0,
  inicio_em        timestamptz NOT NULL,
  fim_previsto_em  timestamptz NOT NULL,

  canceled_at      timestamptz,
  canceled_by      uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT wa_bulk_type_chk     CHECK (message_type IN ('text','document')),
  CONSTRAINT wa_bulk_intervalo_chk CHECK (intervalo_min_s >= 2 AND intervalo_max_s <= 600 AND intervalo_min_s <= intervalo_max_s),
  CONSTRAINT wa_bulk_payload_chk  CHECK (
    (message_type = 'text'     AND length(btrim(content)) > 0 AND storage_path IS NULL)
    OR
    (message_type = 'document' AND storage_path IS NOT NULL AND media_mimetype IS NOT NULL)
  )
);

COMMENT ON TABLE public.whatsapp_bulk_sends IS
  'Envio em lote do Chat (DEM-0492). Um registro por disparo; cada destinatario e uma linha de whatsapp_scheduled_messages com bulk_send_id. Escrita so por fn_bulk_send_create / fn_bulk_send_cancel.';

CREATE INDEX IF NOT EXISTS idx_wa_bulk_tenant_criado
  ON public.whatsapp_bulk_sends (tenant_id, created_at DESC);

ALTER TABLE public.whatsapp_bulk_sends ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS wa_bulk_select ON public.whatsapp_bulk_sends;
CREATE POLICY wa_bulk_select ON public.whatsapp_bulk_sends
  FOR SELECT USING (
    tenant_id = (SELECT public.current_tenant_id())
    OR coalesce((SELECT public.is_super_admin()), false)
  );

-- Default privileges dao ALL a anon/authenticated em tabela nova. So leitura.
REVOKE ALL ON public.whatsapp_bulk_sends FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.whatsapp_bulk_sends TO authenticated;
GRANT ALL    ON public.whatsapp_bulk_sends TO service_role;
COMMIT;

-- ---------------------------------------------------------------------------
-- 2. Cada destinatario aponta para o lote
-- ---------------------------------------------------------------------------
BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE public.whatsapp_scheduled_messages
  ADD COLUMN IF NOT EXISTS bulk_send_id uuid
    REFERENCES public.whatsapp_bulk_sends(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.whatsapp_scheduled_messages.bulk_send_id IS
  'Preenchido quando a linha nasceu de um envio em lote (DEM-0492). O motor pega essas linhas ate 55 s antes e espera o segundo exato, para o intervalo entre mensagens valer de verdade.';

CREATE INDEX IF NOT EXISTS idx_wa_sched_bulk
  ON public.whatsapp_scheduled_messages (bulk_send_id)
  WHERE bulk_send_id IS NOT NULL;
COMMIT;

-- ---------------------------------------------------------------------------
-- 3. Nome que entra no lugar de {nome_cliente}, guardado para o proximo envio
-- ---------------------------------------------------------------------------
BEGIN;
SET LOCAL lock_timeout = '5s';

-- Coluna nula sem default: so metadado, nao reescreve a tabela.
ALTER TABLE public.whatsapp_contacts
  ADD COLUMN IF NOT EXISTS nome_na_mensagem text;

COMMENT ON COLUMN public.whatsapp_contacts.nome_na_mensagem IS
  'Como chamar este contato/grupo numa mensagem em lote ({nome_cliente}). NULL = a tela sugere a partir do nome, tirando o nome da propria empresa. Gravado pela fn_bulk_send_create.';
COMMIT;

-- ---------------------------------------------------------------------------
-- 4. Portao por tenant
-- ---------------------------------------------------------------------------
BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS envio_lote_enabled boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.tenants.envio_lote_enabled IS
  'Libera o Envio em lote do Chat (DEM-0492). Nasce false: so liga depois do teste no WhatsApp do Alexandre.';
COMMIT;
