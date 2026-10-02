-- ============================================================================
-- Envio em lote (DEM-0492) -- 5: estrutura das fases 2 a 5  (02/10/2026)
--
--   F2  template da Meta no lote ......... whatsapp_bulk_sends.template_*
--   F3  grupos de envio (listas) ......... whatsapp_bulk_lists / _list_members
--   F4  mensagens prontas e recorrencia .. whatsapp_bulk_models / _recurrences
--   F5  descadastro, limite por numero ... whatsapp_bulk_optouts,
--       teste, funil ...................... whatsapp_instances.lote_limite_diario
--
-- Toda escrita passa por RPC (migration 6). As tabelas sao so leitura para
-- `authenticated`, como whatsapp_bulk_sends.
-- Uma transacao por recurso, com lock_timeout: as tabelas antigas que levam
-- ALTER (bulk_sends, instances) sao pequenas, mas instances e lida o tempo todo.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. F2: lote com template da Meta
-- ---------------------------------------------------------------------------
BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE public.whatsapp_bulk_sends
  ADD COLUMN IF NOT EXISTS template_id     uuid,
  ADD COLUMN IF NOT EXISTS template_params jsonb,
  ADD COLUMN IF NOT EXISTS list_id         uuid,
  ADD COLUMN IF NOT EXISTS recurrence_id   uuid,
  ADD COLUMN IF NOT EXISTS teste           boolean NOT NULL DEFAULT false;

ALTER TABLE public.whatsapp_bulk_sends DROP CONSTRAINT IF EXISTS wa_bulk_type_chk;
ALTER TABLE public.whatsapp_bulk_sends ADD CONSTRAINT wa_bulk_type_chk
  CHECK (message_type IN ('text', 'document', 'template'));

ALTER TABLE public.whatsapp_bulk_sends DROP CONSTRAINT IF EXISTS wa_bulk_payload_chk;
ALTER TABLE public.whatsapp_bulk_sends ADD CONSTRAINT wa_bulk_payload_chk CHECK (
  (message_type = 'text'     AND length(btrim(content)) > 0 AND storage_path IS NULL)
  OR (message_type = 'document' AND storage_path IS NOT NULL AND media_mimetype IS NOT NULL)
  OR (message_type = 'template' AND template_id IS NOT NULL AND storage_path IS NULL)
);

COMMENT ON COLUMN public.whatsapp_bulk_sends.template_params IS
  'F2: valores das variaveis do template como o autor preencheu, ainda com {nome_cliente}/{coluna}. O valor final de cada destinatario fica em whatsapp_scheduled_messages.template_parameters.';
COMMENT ON COLUMN public.whatsapp_bulk_sends.teste IS
  'F5: envio de teste (1 destinatario, para quem montou). Aparece marcado na lista.';
COMMIT;

-- ---------------------------------------------------------------------------
-- 2. F3: grupos de envio
-- ---------------------------------------------------------------------------
BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.whatsapp_bulk_lists (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  nome         text NOT NULL,
  descricao    text,
  -- fixa: quem esta em whatsapp_bulk_list_members.
  -- dinamica: os filtros da carteira (mesmo formato de src/lib/filtrosClientes.ts),
  -- resolvidos na hora do envio por fn_bulk_list_resolve.
  tipo         text NOT NULL DEFAULT 'fixa',
  filtros      jsonb,
  created_by   uuid NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  CONSTRAINT wa_bulk_list_tipo_chk CHECK (tipo IN ('fixa', 'dinamica')),
  CONSTRAINT wa_bulk_list_nome_chk CHECK (length(btrim(nome)) BETWEEN 1 AND 80),
  CONSTRAINT wa_bulk_list_filtros_chk CHECK (tipo = 'fixa' OR filtros IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_wa_bulk_list_nome
  ON public.whatsapp_bulk_lists (tenant_id, lower(btrim(nome)));

CREATE TABLE IF NOT EXISTS public.whatsapp_bulk_list_members (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id          uuid NOT NULL REFERENCES public.whatsapp_bulk_lists(id) ON DELETE CASCADE,
  tenant_id        uuid NOT NULL,
  -- Grupo de WhatsApp: a conversa (so recebe pelo numero que esta nele).
  -- Pessoa: o telefone (recebe por qualquer numero).
  conversation_id  uuid REFERENCES public.whatsapp_conversations(id) ON DELETE CASCADE,
  telefone         text,
  nome_contato     text,
  nome_na_mensagem text,
  cliente_id       uuid,
  vars             jsonb,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wa_bulk_member_alvo_chk CHECK ((conversation_id IS NULL) <> (telefone IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_wa_bulk_member_tel
  ON public.whatsapp_bulk_list_members (list_id, telefone) WHERE telefone IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_wa_bulk_member_conv
  ON public.whatsapp_bulk_list_members (list_id, conversation_id) WHERE conversation_id IS NOT NULL;
COMMIT;

-- ---------------------------------------------------------------------------
-- 3. F4: mensagens prontas
-- ---------------------------------------------------------------------------
BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.whatsapp_bulk_models (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  titulo           text NOT NULL,
  content          text NOT NULL DEFAULT '',
  storage_path     text,
  media_mimetype   text,
  media_file_name  text,
  media_size_bytes bigint,
  -- Mensagem pronta de template (numero oficial): o template e as variaveis.
  template_id      uuid,
  template_params  jsonb,
  created_by       uuid NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wa_bulk_model_titulo_chk CHECK (length(btrim(titulo)) BETWEEN 1 AND 80),
  CONSTRAINT wa_bulk_model_corpo_chk CHECK (
    template_id IS NOT NULL OR storage_path IS NOT NULL OR length(btrim(content)) > 0
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_wa_bulk_model_titulo
  ON public.whatsapp_bulk_models (tenant_id, lower(btrim(titulo)));
COMMIT;

-- ---------------------------------------------------------------------------
-- 4. F4: envio recorrente
-- ---------------------------------------------------------------------------
BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.whatsapp_bulk_recurrences (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  titulo          text NOT NULL,
  ativo           boolean NOT NULL DEFAULT true,
  instance_id     uuid NOT NULL REFERENCES public.whatsapp_instances(id) ON DELETE CASCADE,
  list_id         uuid NOT NULL REFERENCES public.whatsapp_bulk_lists(id) ON DELETE CASCADE,
  model_id        uuid NOT NULL REFERENCES public.whatsapp_bulk_models(id) ON DELETE CASCADE,
  -- mensal: dia_mes (1..31; 31 = ultimo dia do mes) | semanal: dias_semana (0=dom..6=sab)
  -- diaria: todo dia util
  frequencia      text NOT NULL,
  dia_mes         int,
  dias_semana     int[],
  hora            time NOT NULL DEFAULT '09:00',
  -- Caiu em fim de semana ou feriado (business_hours_exceptions geral fechada):
  -- 'proximo' dia util, 'anterior' dia util, ou 'manter' a data.
  ajuste_dia_util text NOT NULL DEFAULT 'proximo',
  intervalo_min_s int  NOT NULL DEFAULT 5,
  intervalo_max_s int  NOT NULL DEFAULT 30,
  proxima_em      timestamptz,
  ultima_em       timestamptz,
  ultimo_bulk_id  uuid,
  ultimo_erro     text,
  created_by      uuid NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wa_bulk_rec_freq_chk  CHECK (frequencia IN ('mensal', 'semanal', 'diaria')),
  CONSTRAINT wa_bulk_rec_dia_chk   CHECK (frequencia <> 'mensal' OR dia_mes BETWEEN 1 AND 31),
  CONSTRAINT wa_bulk_rec_sem_chk   CHECK (frequencia <> 'semanal' OR coalesce(array_length(dias_semana, 1), 0) > 0),
  CONSTRAINT wa_bulk_rec_ajuste_chk CHECK (ajuste_dia_util IN ('proximo', 'anterior', 'manter')),
  CONSTRAINT wa_bulk_rec_intervalo_chk CHECK (intervalo_min_s >= 0 AND intervalo_max_s <= 600 AND intervalo_min_s <= intervalo_max_s)
);
CREATE INDEX IF NOT EXISTS idx_wa_bulk_rec_proxima
  ON public.whatsapp_bulk_recurrences (proxima_em) WHERE ativo;
COMMIT;

-- ---------------------------------------------------------------------------
-- 5. F5: descadastrados (nao recebem lote) e limite diario por numero
-- ---------------------------------------------------------------------------
BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.whatsapp_bulk_optouts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  -- Chave do telefone: celular SEM o 9 (mesma regra de chaveTelefone na tela),
  -- para "com 9" e "sem 9" serem a mesma pessoa.
  telefone    text NOT NULL,
  nome        text,
  origem      text NOT NULL DEFAULT 'resposta',
  mensagem    text,
  created_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wa_bulk_optout_origem_chk CHECK (origem IN ('resposta', 'manual'))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_wa_bulk_optout ON public.whatsapp_bulk_optouts (tenant_id, telefone);
COMMIT;

BEGIN;
SET LOCAL lock_timeout = '5s';
-- Coluna nula sem default: so metadado, nao reescreve a tabela.
ALTER TABLE public.whatsapp_instances
  ADD COLUMN IF NOT EXISTS lote_limite_diario int;
COMMENT ON COLUMN public.whatsapp_instances.lote_limite_diario IS
  'F5 do envio em lote: maximo de mensagens de lote por dia neste numero (NULL = sem limite). Protege numero novo ou nao oficial de bloqueio.';
COMMIT;

-- ---------------------------------------------------------------------------
-- 6. Leitura: mesmo modelo de whatsapp_bulk_sends
-- ---------------------------------------------------------------------------
BEGIN;
SET LOCAL lock_timeout = '5s';
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['whatsapp_bulk_lists', 'whatsapp_bulk_list_members', 'whatsapp_bulk_models',
                           'whatsapp_bulk_recurrences', 'whatsapp_bulk_optouts'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_select', t);
    EXECUTE format($p$CREATE POLICY %I ON public.%I FOR SELECT USING (
        tenant_id = (SELECT public.current_tenant_id())
        OR coalesce((SELECT public.is_super_admin()), false))$p$, t || '_select', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
  END LOOP;
END $$;
COMMIT;
