-- Retenção de mídia do chat — libera espaço no Storage apagando arquivo velho
--
-- Medido em 14/08/2026 no bucket `whatsapp-media` (23,5 GB):
--   vídeo     2.571 arquivos / 11 GB    → 1.549 fora de 30d = 7,2 GB
--   imagem   37.319 arquivos / 4,6 GB   → 21.819 fora de 30d = 2,7 GB
--   áudio    36.598 arquivos / 4,4 GB   → FICA (decisão do Alexandre)
--   documento 5.330 arquivos / 3,3 GB   → 3.325 fora de 30d = 1,9 GB
-- Purgando os três tipos com 30 dias: ~11,8 GB, metade do bucket.
--
-- ESCOPO — o que esta migration NÃO pode alcançar:
--   * `ticket-attachments` e `contrato-anexos` são outros buckets. Nada aqui os toca.
--   * O bucket `whatsapp-media` também guarda anexo de NOTA INTERNA
--     (whatsapp_conversation_notes.media_path, lido por get-note-media-url).
--     Por isso a purga é dirigida por linha de `whatsapp_messages` e nunca por
--     prefixo de caminho no Storage — varrer o bucket apagaria nota interna junto.
--   * Áudio nunca entra: `media_kind IN ('document','video','image')`. Os 682
--     arquivos com media_kind NULL também ficam de fora — entre eles pode haver
--     áudio sem classificação (mediaKind() do message-processor devolve NULL para
--     tipo fora da lista), e 71 MB não justificam o risco.
--
-- POR QUE O SETOR VEM DO ATENDIMENTO, NÃO DA CONVERSA:
--   fn_clear_conversation_assigned_on_close zera whatsapp_conversations.department_id
--   a cada encerramento (ver 20260811160000_setor_do_atendimento_espelha_na_conversa).
--   Conversa velha — exatamente a que a purga alcança — quase sempre está sem setor.
--   Lendo da conversa, quase nenhum arquivo casaria com setor nenhum e a limpeza
--   não rodaria. A chave é o último support_attendances.department_id da conversa,
--   com o setor padrão do tenant (is_default_fallback) cobrindo grupo e conversa
--   sem atendimento.

-- ---------------------------------------------------------------------------
-- 1. Configuração por setor
-- ---------------------------------------------------------------------------
-- Nasce com 30 dias, como pedido, mas DESLIGADA. Apagar arquivo de cliente é
-- irreversível: o interruptor sobe setor a setor, depois de conferir o primeiro
-- lote. Enquanto ninguém liga, fn_chat_media_purge_lote sai vazia no primeiro
-- SELECT e o cron custa ~nada.
ALTER TABLE public.support_departments
  ADD COLUMN IF NOT EXISTS media_retention_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS media_retention_days    integer NOT NULL DEFAULT 30;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.support_departments'::regclass
      AND conname  = 'support_departments_media_retention_days_check'
  ) THEN
    ALTER TABLE public.support_departments
      ADD CONSTRAINT support_departments_media_retention_days_check
      CHECK (media_retention_days BETWEEN 1 AND 3650);
  END IF;
END $$;

COMMENT ON COLUMN public.support_departments.media_retention_enabled IS
  'Liga a purga automática de mídia do chat deste setor. Nasce false de propósito — '
  'a exclusão no Storage é irreversível.';
COMMENT ON COLUMN public.support_departments.media_retention_days IS
  'Dias que documento/vídeo/imagem trocados no chat ficam no Storage. Áudio nunca é apagado.';

-- ---------------------------------------------------------------------------
-- 2. Marca do arquivo purgado
-- ---------------------------------------------------------------------------
-- Sem esta coluna o card do chat cai no ramo `!hasMediaUrl` do AttachmentCard e
-- mostra "Arquivo grande — não foi baixado automaticamente. Abra pelo WhatsApp",
-- que é mentira. O frontend passa a ler media_purged_at ANTES desse ramo.
ALTER TABLE public.whatsapp_messages
  ADD COLUMN IF NOT EXISTS media_purged_at timestamptz;

COMMENT ON COLUMN public.whatsapp_messages.media_purged_at IS
  'Quando o arquivo saiu do Storage pela política de retenção do setor. '
  'media_filename/ext/size ficam preservados para a UI dizer o que havia ali.';

-- ---------------------------------------------------------------------------
-- 3. Registro de download
-- ---------------------------------------------------------------------------
-- Hoje ninguém sabe quem baixou o quê. A regra de 14/08 é 30 dias para todos,
-- sem olhar download — mas o registro nasce junto para que uma regra futura
-- ("já baixou, pode apagar antes") tenha histórico em vez de começar do zero.
--
-- Tabela própria, e não coluna em whatsapp_messages: aquela tabela está na
-- publication supabase_realtime e um UPDATE por clique de download viraria WAL +
-- fanout para todo browser aberto no tenant.
CREATE TABLE IF NOT EXISTS public.whatsapp_media_downloads (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL,
  message_id    uuid NOT NULL REFERENCES public.whatsapp_messages(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL,
  downloaded_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wa_media_dl_message
  ON public.whatsapp_media_downloads (message_id, downloaded_at DESC);
CREATE INDEX IF NOT EXISTS idx_wa_media_dl_tenant
  ON public.whatsapp_media_downloads (tenant_id, downloaded_at DESC);

ALTER TABLE public.whatsapp_media_downloads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS wa_media_dl_select ON public.whatsapp_media_downloads;
CREATE POLICY wa_media_dl_select ON public.whatsapp_media_downloads
  FOR SELECT TO authenticated
  USING (
    public.is_super_admin()
    OR tenant_id = (SELECT p.tenant_id FROM public.profiles p WHERE p.user_id = auth.uid())
  );

-- Sem policy de INSERT: quem grava é a whatsapp-media-proxy com service_role,
-- que passa por cima do RLS. Cliente nenhum escreve aqui.

-- ---------------------------------------------------------------------------
-- 4. Diário da purga
-- ---------------------------------------------------------------------------
-- Para o Alexandre acompanhar sem depender de log de edge function, que expira.
CREATE TABLE IF NOT EXISTS public.chat_media_purge_runs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at  timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  arquivos    integer NOT NULL DEFAULT 0,
  bytes       bigint  NOT NULL DEFAULT 0,
  erros       integer NOT NULL DEFAULT 0,
  detalhe     text
);

CREATE INDEX IF NOT EXISTS idx_chat_media_purge_runs_started
  ON public.chat_media_purge_runs (started_at DESC);

ALTER TABLE public.chat_media_purge_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS chat_media_purge_runs_select ON public.chat_media_purge_runs;
CREATE POLICY chat_media_purge_runs_select ON public.chat_media_purge_runs
  FOR SELECT TO authenticated
  USING (
    public.is_super_admin()
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid() AND p.role IN ('admin', 'head')
    )
  );

-- ---------------------------------------------------------------------------
-- 5. Lote de purga
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_chat_media_purge_lote(p_limit integer DEFAULT 200)
RETURNS TABLE (
  message_id      uuid,
  tenant_id       uuid,
  media_path      text,
  media_size_bytes bigint,
  department_id   uuid,
  retention_days  integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  WITH tenants_ligados AS (
    -- Corte de custo: sem nenhum setor com a purga ligada, esta CTE vem vazia e o
    -- JOIN abaixo mata a query antes de encostar em whatsapp_messages.
    SELECT sd.tenant_id, MIN(sd.media_retention_days) AS menor_prazo
    FROM public.support_departments sd
    WHERE sd.media_retention_enabled = true AND sd.is_active = true
    GROUP BY sd.tenant_id
  )
  SELECT m.id, m.tenant_id, m.media_path, m.media_size_bytes, sd.id, sd.media_retention_days
  FROM public.whatsapp_messages m
  JOIN tenants_ligados t ON t.tenant_id = m.tenant_id
  -- Resolve o setor do arquivo. COALESCE em duas etapas:
  --   1. último atendimento COM setor da conversa (o setor real do arquivo);
  --   2. setor padrão do tenant — cobre grupo (que não tem setor por design) e
  --      conversa que nunca gerou atendimento. Sem o passo 2, esses arquivos
  --      nunca seriam alcançados e o ganho de espaço ficaria pela metade.
  CROSS JOIN LATERAL (
    SELECT COALESCE(
      (SELECT sa.department_id
         FROM public.support_attendances sa
        WHERE sa.conversation_id = m.conversation_id
          AND sa.department_id IS NOT NULL
        ORDER BY sa.opened_at DESC NULLS LAST, sa.created_at DESC
        LIMIT 1),
      (SELECT d.id
         FROM public.support_departments d
        WHERE d.tenant_id = m.tenant_id
          AND d.is_default_fallback = true
          AND d.is_active = true
        LIMIT 1)
    ) AS dept_id
  ) resolvido
  JOIN public.support_departments sd
    ON sd.id = resolvido.dept_id
   AND sd.media_retention_enabled = true
   AND sd.is_active = true
  WHERE m.media_path IS NOT NULL
    AND m.media_purged_at IS NULL
    AND m.media_kind IN ('document', 'video', 'image')
    -- Pré-filtro barato pelo menor prazo do tenant: é o que deixa o índice
    -- parcial cortar a varredura antes do LATERAL, que é a parte cara.
    AND m."timestamp" < now() - make_interval(days => t.menor_prazo)
    -- Prazo real, já com o setor resolvido.
    AND m."timestamp" < now() - make_interval(days => sd.media_retention_days)
  -- Mais velho primeiro, e SEM teto de varredura intermediário: o LIMIT no fim
  -- faz o planner caminhar o índice até juntar p_limit linhas que QUALIFICAM.
  -- Com um "LIMIT p_scan" antes do filtro de setor, um backlog de setor desligado
  -- ocuparia a janela e a purga travaria para sempre sem apagar nada.
  ORDER BY m."timestamp"
  LIMIT p_limit;
END;
$function$;

COMMENT ON FUNCTION public.fn_chat_media_purge_lote(integer) IS
  'Lote de mídias de chat vencidas (documento/vídeo/imagem; áudio nunca). Prazo por '
  'setor, resolvido pelo último support_attendances da conversa com fallback no setor '
  'padrão do tenant — a conversa perde department_id ao ser encerrada.';

-- ---------------------------------------------------------------------------
-- 6. Confirmação da purga
-- ---------------------------------------------------------------------------
-- Chamada pela edge function DEPOIS do storage.remove() dar certo. Idempotente
-- pelo guard `media_purged_at IS NULL`: reenviar o mesmo lote não conta bytes duas
-- vezes nem sobrescreve a data original.
CREATE OR REPLACE FUNCTION public.fn_chat_media_purge_confirmar(p_ids uuid[])
RETURNS TABLE (arquivos integer, bytes bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  WITH purgadas AS (
    UPDATE public.whatsapp_messages m
       SET media_purged_at = now(),
           -- Ponteiros mortos saem: o proxy devolveria 404 e o link assinado
           -- apontaria para objeto inexistente. O nome, a extensão e o tamanho
           -- FICAM — é com eles que a UI diz o que havia ali.
           media_path = NULL,
           media_url  = NULL
     WHERE m.id = ANY(p_ids)
       AND m.media_purged_at IS NULL
    RETURNING m.media_size_bytes
  )
  SELECT COUNT(*)::integer, COALESCE(SUM(media_size_bytes), 0)::bigint FROM purgadas;
END;
$function$;

COMMENT ON FUNCTION public.fn_chat_media_purge_confirmar(uuid[]) IS
  'Marca as mensagens cujo arquivo já saiu do Storage. Idempotente. ATENÇÃO: '
  'whatsapp_messages está na publication supabase_realtime — cada linha aqui gera '
  'WAL + fanout, por isso o cron roda em lote pequeno e fora do pico.';

-- ---------------------------------------------------------------------------
-- 7. Grants
-- ---------------------------------------------------------------------------
-- Só a edge function (service_role) chama. Nenhuma tela executa purga.
--
-- REVOKE FROM PUBLIC NÃO BASTA NESTE PROJETO. O banco tem
--   ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
--     GRANT ALL ON FUNCTIONS TO authenticated;
-- então toda função nasce com EXECUTE direto no papel `authenticated`, e PUBLIC é
-- outro papel — revogar de PUBLIC deixa o grant de authenticated de pé. Medido em
-- 14/08/2026 no dump de produção: as duas funções saíram com
-- `GRANT ALL ... TO authenticated` mesmo com o REVOKE FROM PUBLIC acima.
--
-- Para a maioria das RPCs isso é o desejado (a tela chama). Aqui não:
-- fn_chat_media_purge_confirmar é SECURITY DEFINER, recebe uuid[] arbitrário e não
-- valida tenant — com EXECUTE para authenticated, qualquer usuário logado zeraria
-- media_path/media_url de qualquer mensagem de qualquer tenant.
REVOKE ALL ON FUNCTION public.fn_chat_media_purge_lote(integer)      FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_chat_media_purge_confirmar(uuid[])  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_chat_media_purge_lote(integer)     TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_chat_media_purge_confirmar(uuid[]) TO service_role;
