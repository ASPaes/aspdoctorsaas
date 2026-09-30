-- ============================================================================
-- Envio em lote pelo WhatsApp (DEM-0492) -- 2/3, as RPCs da tela  (30/09/2026)
--
-- Regras (decisoes do Alexandre em 29/09):
--   * Quem dispara: admin e head do tenant, e super admin.
--   * Ritmo: padrao 5 a 30 s entre mensagens. So admin (e super admin) muda.
--   * O nome de cada destinatario vem da tela ja limpo/editado; a RPC so troca
--     {nome_cliente} e guarda o nome em whatsapp_contacts.nome_na_mensagem.
--   * Fora do expediente: a TELA avisa e sugere, nunca bloqueia -- mesma regra
--     das mensagens agendadas. Nao ha checagem de horario aqui de proposito.
--   * Resposta do cliente segue o fluxo normal (nada aqui abre atendimento).
-- ============================================================================
BEGIN;

-- ----------------------------------------------------------------------------
-- Disparar. Devolve {bulk_send_id, total, inicio_em, fim_previsto_em}.
--
-- p_destinos: [{"conversation_id": "...", "nome": "Padaria Bom Pao"}, ...]
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_bulk_send_create(
  p_tenant_id        uuid,
  p_instance_id      uuid,
  p_content          text,
  p_destinos         jsonb,
  p_storage_path     text        DEFAULT NULL,
  p_media_mimetype   text        DEFAULT NULL,
  p_media_file_name  text        DEFAULT NULL,
  p_media_size_bytes bigint      DEFAULT NULL,
  p_intervalo_min_s  int         DEFAULT 5,
  p_intervalo_max_s  int         DEFAULT 30,
  p_inicio_em        timestamptz DEFAULT NULL,
  p_titulo           text        DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_me        uuid := public.fn_acting_user();
  v_super     boolean := coalesce(public.is_super_admin(), false);
  v_role      text;
  v_tenant    uuid;
  v_tipo      text;
  v_content   text := coalesce(p_content, '');
  v_total     int;
  v_validos   int;
  v_inicio    timestamptz;
  v_fila_ate  timestamptz;
  v_bulk      uuid;
  v_fim       timestamptz;
  v_titulo    text;
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'Sessao sem usuario identificado.' USING ERRCODE = '42501';
  END IF;

  -- Tenant: o do perfil; super admin escolhe (esta simulando).
  SELECT p.role, p.tenant_id INTO v_role, v_tenant
    FROM public.profiles p WHERE p.user_id = v_me;

  IF v_super THEN
    v_tenant := coalesce(p_tenant_id, v_tenant);
  ELSIF p_tenant_id IS NOT NULL AND p_tenant_id IS DISTINCT FROM v_tenant THEN
    RAISE EXCEPTION 'Sem permissao para este tenant.' USING ERRCODE = '42501';
  END IF;

  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'Tenant nao identificado.' USING ERRCODE = '22023';
  END IF;

  IF NOT v_super AND coalesce(v_role, '') NOT IN ('admin', 'head') THEN
    RAISE EXCEPTION 'Envio em lote e so para admin e head.' USING ERRCODE = '42501';
  END IF;

  -- Portao por tenant. Vale inclusive para super admin: e o que garante que
  -- nada sai para cliente de um tenant que ainda nao foi testado.
  IF NOT EXISTS (SELECT 1 FROM public.tenants t WHERE t.id = v_tenant AND t.envio_lote_enabled) THEN
    RAISE EXCEPTION 'Envio em lote nao esta liberado para esta empresa.' USING ERRCODE = '42501';
  END IF;

  -- Ritmo. Quem nao e admin fica no padrao, sem negociar.
  IF p_intervalo_min_s IS NULL OR p_intervalo_max_s IS NULL
     OR p_intervalo_min_s < 2 OR p_intervalo_max_s > 600 OR p_intervalo_min_s > p_intervalo_max_s THEN
    RAISE EXCEPTION 'Intervalo invalido: minimo de 2 s, maximo de 600 s, e o menor antes do maior.' USING ERRCODE = '22023';
  END IF;
  IF NOT v_super AND v_role <> 'admin' AND (p_intervalo_min_s <> 5 OR p_intervalo_max_s <> 30) THEN
    RAISE EXCEPTION 'So o admin muda o ritmo do envio.' USING ERRCODE = '42501';
  END IF;

  -- Numero de envio do mesmo tenant.
  IF NOT EXISTS (SELECT 1 FROM public.whatsapp_instances i WHERE i.id = p_instance_id AND i.tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'Numero de WhatsApp nao encontrado nesta empresa.' USING ERRCODE = 'P0002';
  END IF;

  -- Conteudo. Com anexo vira documento com legenda (limite 1024 do WhatsApp).
  IF p_storage_path IS NOT NULL THEN
    v_tipo := 'document';
    IF p_media_mimetype IS DISTINCT FROM 'application/pdf' THEN
      RAISE EXCEPTION 'O anexo tem de ser PDF.' USING ERRCODE = '22023';
    END IF;
    IF p_storage_path NOT LIKE v_tenant::text || '/lote/%' THEN
      RAISE EXCEPTION 'Anexo fora da pasta do envio em lote.' USING ERRCODE = '22023';
    END IF;
    IF length(v_content) > 1000 THEN
      RAISE EXCEPTION 'Com PDF, a mensagem vai como legenda e passa do limite (1.000 caracteres).' USING ERRCODE = '22023';
    END IF;
  ELSE
    v_tipo := 'text';
    IF length(btrim(v_content)) = 0 THEN
      RAISE EXCEPTION 'Escreva a mensagem ou anexe um PDF.' USING ERRCODE = '22023';
    END IF;
    IF length(v_content) > 4000 THEN
      RAISE EXCEPTION 'A mensagem passa de 4.000 caracteres.' USING ERRCODE = '22023';
    END IF;
  END IF;

  -- Destinatarios: distintos, do tenant, e com conversa neste numero.
  -- Grupo so recebe do numero que esta dentro dele -- por isso a conversa
  -- tem de ser deste numero.
  IF p_destinos IS NULL OR jsonb_typeof(p_destinos) <> 'array' THEN
    RAISE EXCEPTION 'Lista de destinatarios invalida.' USING ERRCODE = '22023';
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS _bulk_dest (
    ordem int, conversation_id uuid, contact_id uuid, nome text
  ) ON COMMIT DROP;
  TRUNCATE _bulk_dest;

  INSERT INTO _bulk_dest (ordem, conversation_id, contact_id, nome)
  SELECT row_number() OVER (ORDER BY random()),
         c.id, c.contact_id,
         coalesce(nullif(btrim(d.nome), ''), nullif(btrim(ct.name), ''), 'cliente')
    FROM (
      SELECT DISTINCT ON ((e->>'conversation_id')::uuid)
             (e->>'conversation_id')::uuid AS conversation_id,
             left(e->>'nome', 120)          AS nome
        FROM jsonb_array_elements(p_destinos) e
    ) d
    JOIN public.whatsapp_conversations c ON c.id = d.conversation_id
    LEFT JOIN public.whatsapp_contacts ct ON ct.id = c.contact_id
   WHERE c.tenant_id = v_tenant
     AND (c.instance_id = p_instance_id OR c.current_instance_id = p_instance_id);

  SELECT count(*) INTO v_validos FROM _bulk_dest;
  v_total := jsonb_array_length(p_destinos);

  IF v_validos = 0 THEN
    RAISE EXCEPTION 'Nenhum destinatario valido para este numero.' USING ERRCODE = '22023';
  END IF;
  IF v_validos > 500 THEN
    RAISE EXCEPTION 'Maximo de 500 destinatarios por envio.' USING ERRCODE = '22023';
  END IF;
  IF v_validos < v_total THEN
    RAISE EXCEPTION '% destinatario(s) nao sao conversas deste numero. Recarregue a lista.', v_total - v_validos
      USING ERRCODE = '22023';
  END IF;

  -- Inicio: agora (+15 s de folga para o motor) ou o horario agendado.
  -- Se ja existe outro lote saindo por este numero, entra depois dele:
  -- dois lotes ao mesmo tempo dobrariam o ritmo real do numero.
  IF p_inicio_em IS NOT NULL AND p_inicio_em > now() + interval '180 days' THEN
    RAISE EXCEPTION 'O inicio nao pode passar de 180 dias.' USING ERRCODE = '22023';
  END IF;
  v_inicio := date_trunc('second', greatest(coalesce(p_inicio_em, now()), now() + interval '15 seconds'));

  SELECT max(s.scheduled_at) INTO v_fila_ate
    FROM public.whatsapp_scheduled_messages s
   WHERE s.bulk_send_id IS NOT NULL
     AND s.instance_id = p_instance_id
     AND s.status IN ('pending', 'sending');
  IF v_fila_ate IS NOT NULL THEN
    v_inicio := greatest(v_inicio, v_fila_ate + make_interval(secs => p_intervalo_min_s));
  END IF;

  -- Titulo da lista: o que a tela mandar; senao o nome do PDF (o texto costuma
  -- comecar por "Ola, {nome_cliente}", que nao identifica nada); senao o texto.
  v_titulo := coalesce(
    nullif(btrim(left(p_titulo, 80)), ''),
    nullif(btrim(left(regexp_replace(regexp_replace(coalesce(p_media_file_name, ''), '\.pdf$', '', 'i'), '[_-]+', ' ', 'g'), 80)), ''),
    nullif(btrim(left(regexp_replace(replace(v_content, '{nome_cliente}', '...'), '\s+', ' ', 'g'), 60)), ''),
    'Envio em lote'
  );

  INSERT INTO public.whatsapp_bulk_sends (
    tenant_id, instance_id, created_by, titulo, content, message_type,
    storage_path, media_mimetype, media_file_name, media_size_bytes,
    intervalo_min_s, intervalo_max_s, total, inicio_em, fim_previsto_em
  ) VALUES (
    v_tenant, p_instance_id, v_me, v_titulo, v_content, v_tipo,
    p_storage_path, p_media_mimetype, p_media_file_name, p_media_size_bytes,
    p_intervalo_min_s, p_intervalo_max_s, v_validos, v_inicio, v_inicio
  )
  RETURNING id INTO v_bulk;

  -- Horarios: o primeiro no inicio; cada proximo soma um intervalo sorteado.
  -- A soma acumulada e feita por window function sobre intervalos ja sorteados.
  WITH sorteio AS (
    SELECT b.*,
           CASE WHEN b.ordem = 1 THEN 0
                ELSE p_intervalo_min_s + random() * (p_intervalo_max_s - p_intervalo_min_s)
           END AS passo
      FROM _bulk_dest b
  ), horarios AS (
    SELECT s.*, v_inicio + make_interval(secs => sum(s.passo) OVER (ORDER BY s.ordem)) AS quando
      FROM sorteio s
  )
  INSERT INTO public.whatsapp_scheduled_messages (
    tenant_id, conversation_id, instance_id, created_by,
    content, message_type, storage_path, media_mimetype, media_file_name, media_size_bytes,
    scheduled_at, cancel_if_client_replies, bulk_send_id
  )
  SELECT v_tenant, h.conversation_id, p_instance_id, v_me,
         replace(v_content, '{nome_cliente}', h.nome),
         v_tipo, p_storage_path, p_media_mimetype, p_media_file_name, p_media_size_bytes,
         date_trunc('second', h.quando), false, v_bulk
    FROM horarios h;

  SELECT max(s.scheduled_at) INTO v_fim
    FROM public.whatsapp_scheduled_messages s WHERE s.bulk_send_id = v_bulk;
  UPDATE public.whatsapp_bulk_sends SET fim_previsto_em = v_fim WHERE id = v_bulk;

  -- Guarda o nome usado, para a proxima vez ja vir certo.
  UPDATE public.whatsapp_contacts ct
     SET nome_na_mensagem = b.nome
    FROM _bulk_dest b
   WHERE ct.id = b.contact_id
     AND b.nome <> 'cliente'
     AND ct.nome_na_mensagem IS DISTINCT FROM b.nome;

  RETURN jsonb_build_object(
    'bulk_send_id', v_bulk,
    'total', v_validos,
    'inicio_em', v_inicio,
    'fim_previsto_em', v_fim
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.fn_bulk_send_create(uuid, uuid, text, jsonb, text, text, text, bigint, int, int, timestamptz, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_bulk_send_create(uuid, uuid, text, jsonb, text, text, text, bigint, int, int, timestamptz, text) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- Cancelar o que ainda nao saiu. Devolve quantas foram canceladas.
-- Quem pode: o autor, admin/head do tenant, super admin.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_bulk_send_cancel(p_bulk_send_id uuid)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_me   uuid := public.fn_acting_user();
  v_bulk public.whatsapp_bulk_sends%ROWTYPE;
  v_n    int;
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'Sessao sem usuario identificado.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_bulk FROM public.whatsapp_bulk_sends WHERE id = p_bulk_send_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Envio nao encontrado.' USING ERRCODE = 'P0002';
  END IF;

  IF NOT coalesce(public.is_super_admin(), false)
     AND v_bulk.created_by <> v_me
     AND NOT EXISTS (
       SELECT 1 FROM public.profiles p
        WHERE p.user_id = v_me AND p.tenant_id = v_bulk.tenant_id AND p.role IN ('admin', 'head')
     )
  THEN
    RAISE EXCEPTION 'Sem permissao para cancelar este envio.' USING ERRCODE = '42501';
  END IF;

  -- So `pending`. A que esta em `sending` ja foi pega pelo motor e pode estar
  -- saindo neste segundo; cancelar ali mentiria para quem cancelou.
  UPDATE public.whatsapp_scheduled_messages
     SET status = 'canceled', canceled_at = now(), canceled_by = v_me, cancel_reason = 'bulk_canceled'
   WHERE bulk_send_id = p_bulk_send_id
     AND status = 'pending';
  GET DIAGNOSTICS v_n = ROW_COUNT;

  UPDATE public.whatsapp_bulk_sends
     SET canceled_at = coalesce(canceled_at, now()), canceled_by = coalesce(canceled_by, v_me)
   WHERE id = p_bulk_send_id;

  RETURN v_n;
END;
$fn$;

REVOKE ALL ON FUNCTION public.fn_bulk_send_cancel(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_bulk_send_cancel(uuid) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- Lista da tela: o lote com a contagem por situacao.
-- security_invoker: respeita a RLS das duas tabelas (tenant / super admin).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.vw_whatsapp_bulk_sends
WITH (security_invoker = true) AS
SELECT b.*,
       coalesce(c.pendentes, 0)  AS pendentes,
       coalesce(c.enviando, 0)   AS enviando,
       coalesce(c.enviadas, 0)   AS enviadas,
       coalesce(c.falharam, 0)   AS falharam,
       coalesce(c.canceladas, 0) AS canceladas,
       c.ultima_saida_em
  FROM public.whatsapp_bulk_sends b
  LEFT JOIN LATERAL (
    SELECT count(*) FILTER (WHERE s.status = 'pending')  AS pendentes,
           count(*) FILTER (WHERE s.status = 'sending')  AS enviando,
           count(*) FILTER (WHERE s.status = 'sent')     AS enviadas,
           count(*) FILTER (WHERE s.status = 'failed')   AS falharam,
           count(*) FILTER (WHERE s.status = 'canceled') AS canceladas,
           max(s.sent_at)                                AS ultima_saida_em
      FROM public.whatsapp_scheduled_messages s
     WHERE s.bulk_send_id = b.id
  ) c ON true;

REVOKE ALL ON public.vw_whatsapp_bulk_sends FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.vw_whatsapp_bulk_sends TO authenticated, service_role;

COMMIT;
