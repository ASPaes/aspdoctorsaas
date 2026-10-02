-- ============================================================================
-- Envio em lote (DEM-0492) -- 4: destinatario por TELEFONE  (01/10/2026)
--
-- Antes: so entrava conversa que ja existia no numero escolhido. Trocar de
-- numero mudava a lista de clientes, e numero digitado nao tinha como entrar.
--
-- Agora cada item de p_destinos e um destes:
--   {"conversation_id": "...", "nome": "..."}                   -- grupo (e legado)
--   {"telefone": "5549...", "nome": "...", "nome_contato": "...",
--    "cliente_id": "..."}                                         -- pessoa
--
-- Telefone: acha a conversa deste numero por qualquer variante (com/sem 9,
-- fn_wa_phone_variants); sem conversa, acha ou cria o contato e cria a conversa
-- FECHADA e sem dono -- fechada nao entra na distribuicao
-- (fn_trg_dispatch_on_conversation_insert sai cedo) e a resposta do cliente
-- reabre pelo fluxo normal, igual a uma conversa antiga que recebe o lote.
-- Diferente de wa_open_or_reuse_conversation, NAO assume nem reabre nada:
-- disparar um lote nao e abrir atendimento.
--
-- Grupo continua preso ao numero: so quem esta dentro do grupo manda nele.
--
-- Telefone invalido ou contato inativo nao derruba o lote: volta em
-- `ignorados` para a tela avisar.
--
-- Ritmo: o minimo cai de 2 s para 0 s. O motor ja garante 3 s entre uma
-- mensagem de lote e a seguinte (PISO_LOTE_MS em dispatch-scheduled-messages),
-- entao "0 a 30" sai na pratica como "3 a 30".
-- ============================================================================

-- Ritmo a partir de 0 s (uma transacao por recurso: tabela pequena, sem pressa).
BEGIN;
SET LOCAL lock_timeout = '5s';
ALTER TABLE public.whatsapp_bulk_sends DROP CONSTRAINT wa_bulk_intervalo_chk;
ALTER TABLE public.whatsapp_bulk_sends ADD CONSTRAINT wa_bulk_intervalo_chk
  CHECK (intervalo_min_s >= 0 AND intervalo_max_s <= 600 AND intervalo_min_s <= intervalo_max_s);
COMMIT;

BEGIN;
SET LOCAL lock_timeout = '5s';

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
  v_validos   int;
  v_inicio    timestamptz;
  v_fila_ate  timestamptz;
  v_bulk      uuid;
  v_fim       timestamptz;
  v_titulo    text;
  -- por destinatario
  e           jsonb;
  v_ordem     int := 0;
  v_nome      text;
  v_tel       text;
  v_variants  text[];
  v_conv      uuid;
  v_contact   uuid;
  v_ativo     boolean;
  v_cliente   uuid;
  v_ignorados jsonb := '[]'::jsonb;
  v_grupo_fora int := 0;
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
     OR p_intervalo_min_s < 0 OR p_intervalo_max_s > 600 OR p_intervalo_min_s > p_intervalo_max_s
     OR p_intervalo_max_s < 1 THEN
    RAISE EXCEPTION 'Intervalo invalido: de 0 a 600 s, o menor antes do maior.' USING ERRCODE = '22023';
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

  IF p_destinos IS NULL OR jsonb_typeof(p_destinos) <> 'array' THEN
    RAISE EXCEPTION 'Lista de destinatarios invalida.' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_destinos) > 500 THEN
    RAISE EXCEPTION 'Maximo de 500 destinatarios por envio.' USING ERRCODE = '22023';
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS _bulk_dest (
    ordem int, conversation_id uuid, contact_id uuid, nome text
  ) ON COMMIT DROP;
  TRUNCATE _bulk_dest;

  FOR e IN SELECT * FROM jsonb_array_elements(p_destinos) LOOP
    v_conv := NULL; v_contact := NULL; v_ativo := NULL; v_cliente := NULL;
    v_nome := nullif(btrim(left(e->>'nome', 120)), '');

    IF nullif(e->>'conversation_id', '') IS NOT NULL THEN
      -- Grupo (ou chamada antiga): a conversa tem de ser deste numero.
      SELECT c.id, c.contact_id, coalesce(v_nome, nullif(btrim(ct.name), ''))
        INTO v_conv, v_contact, v_nome
        FROM public.whatsapp_conversations c
        LEFT JOIN public.whatsapp_contacts ct ON ct.id = c.contact_id
       WHERE c.id = (e->>'conversation_id')::uuid
         AND c.tenant_id = v_tenant
         AND (c.instance_id = p_instance_id OR c.current_instance_id = p_instance_id);
      IF v_conv IS NULL THEN
        v_grupo_fora := v_grupo_fora + 1;
        CONTINUE;
      END IF;

    ELSE
      v_tel := regexp_replace(regexp_replace(coalesce(e->>'telefone', ''), '\D', '', 'g'), '^0+', '');
      -- Digitado sem o 55 (DDD + numero): mesma regra do normalizeBRPhone do
      -- _shared/phone.ts. Com 11 digitos so e BR se for celular (9 apos o DDD).
      IF length(v_tel) = 10 OR (length(v_tel) = 11 AND substr(v_tel, 3, 1) = '9') THEN
        v_tel := '55' || v_tel;
      END IF;
      v_variants := CASE WHEN v_tel = '' THEN NULL ELSE public.fn_wa_phone_variants(v_tel) END;
      IF coalesce(array_length(v_variants, 1), 0) = 0 OR length(v_variants[1]) < 12 THEN
        v_ignorados := v_ignorados || jsonb_build_object('telefone', e->>'telefone', 'nome', v_nome, 'motivo', 'telefone invalido');
        CONTINUE;
      END IF;
      v_tel := v_variants[1];
      BEGIN
        v_cliente := nullif(e->>'cliente_id', '')::uuid;
      EXCEPTION WHEN invalid_text_representation THEN
        v_cliente := NULL;
      END;
      IF v_cliente IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM public.clientes cl WHERE cl.id = v_cliente AND cl.tenant_id = v_tenant) THEN
        v_cliente := NULL;
      END IF;

      -- 1) Conversa individual deste numero, por qualquer variante.
      SELECT c.id, ct.id, ct.is_active
        INTO v_conv, v_contact, v_ativo
        FROM public.whatsapp_conversations c
        JOIN public.whatsapp_contacts ct
          ON ct.id = c.contact_id
         AND ct.tenant_id = v_tenant
         AND ct.phone_number = ANY (v_variants)
       WHERE c.tenant_id = v_tenant
         AND c.instance_id = p_instance_id
         AND coalesce(c.is_group, false) = false
       ORDER BY (ct.phone_number = v_tel) DESC, c.last_message_at DESC NULLS LAST
       LIMIT 1;

      -- 2) Sem conversa: contato do tenant (qualquer numero de origem).
      IF v_conv IS NULL THEN
        SELECT ct.id, ct.is_active INTO v_contact, v_ativo
          FROM public.whatsapp_contacts ct
         WHERE ct.tenant_id = v_tenant
           AND ct.phone_number = ANY (v_variants)
           AND coalesce(ct.is_group, false) = false
         ORDER BY (ct.phone_number = v_tel) DESC, ct.created_at ASC
         LIMIT 1;
      END IF;

      IF v_contact IS NOT NULL AND NOT coalesce(v_ativo, true) THEN
        v_ignorados := v_ignorados || jsonb_build_object('telefone', v_tel, 'nome', v_nome, 'motivo', 'contato inativo');
        CONTINUE;
      END IF;

      IF v_contact IS NULL THEN
        BEGIN
          INSERT INTO public.whatsapp_contacts (tenant_id, phone_number, name, instance_id, cliente_id)
          VALUES (v_tenant, v_tel,
                  coalesce(nullif(btrim(left(e->>'nome_contato', 120)), ''), v_nome, v_tel),
                  p_instance_id, v_cliente)
          RETURNING id INTO v_contact;
        EXCEPTION WHEN unique_violation THEN
          SELECT ct.id INTO v_contact
            FROM public.whatsapp_contacts ct
           WHERE ct.tenant_id = v_tenant AND ct.phone_number = ANY (v_variants)
           ORDER BY (ct.phone_number = v_tel) DESC, ct.created_at ASC
           LIMIT 1;
        END;
      END IF;

      -- 3) Cria a conversa FECHADA e sem dono (ver cabecalho).
      IF v_conv IS NULL THEN
        INSERT INTO public.whatsapp_conversations (
          tenant_id, instance_id, contact_id, status, unread_count, metadata
        ) VALUES (
          v_tenant, p_instance_id, v_contact, 'closed', 0,
          CASE WHEN v_cliente IS NOT NULL THEN jsonb_build_object('cliente_id', v_cliente::text) ELSE '{}'::jsonb END
        )
        RETURNING id INTO v_conv;
      END IF;

      IF v_nome IS NULL THEN
        SELECT nullif(split_part(btrim(ct.name), ' ', 1), '') INTO v_nome
          FROM public.whatsapp_contacts ct WHERE ct.id = v_contact AND ct.name IS DISTINCT FROM ct.phone_number;
      END IF;
    END IF;

    -- Mesma pessoa marcada duas vezes (aba Clientes e aba Contatos, ou o
    -- numero com e sem 9) sai uma vez so.
    IF NOT EXISTS (SELECT 1 FROM _bulk_dest b WHERE b.conversation_id = v_conv) THEN
      v_ordem := v_ordem + 1;
      INSERT INTO _bulk_dest (ordem, conversation_id, contact_id, nome)
      VALUES (v_ordem, v_conv, v_contact, coalesce(v_nome, 'cliente'));
    END IF;
  END LOOP;

  IF v_grupo_fora > 0 THEN
    RAISE EXCEPTION '% destinatario(s) nao sao conversas deste numero. Recarregue a lista.', v_grupo_fora
      USING ERRCODE = '22023';
  END IF;

  SELECT count(*) INTO v_validos FROM _bulk_dest;
  IF v_validos = 0 THEN
    RAISE EXCEPTION 'Nenhum destinatario valido para este numero.' USING ERRCODE = '22023';
  END IF;

  -- Ordem de saida sorteada (a ordem da tela nao vale).
  WITH s AS (SELECT conversation_id, row_number() OVER (ORDER BY random()) AS n FROM _bulk_dest)
  UPDATE _bulk_dest b SET ordem = s.n FROM s WHERE s.conversation_id = b.conversation_id;

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
    v_inicio := greatest(v_inicio, v_fila_ate + make_interval(secs => greatest(p_intervalo_min_s, 3)));
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

  -- Horarios: o primeiro no inicio; cada proximo soma um intervalo sorteado
  -- entre o minimo e o maximo escolhidos.
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
    'fim_previsto_em', v_fim,
    'ignorados', v_ignorados
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.fn_bulk_send_create(uuid, uuid, text, jsonb, text, text, text, bigint, int, int, timestamptz, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_bulk_send_create(uuid, uuid, text, jsonb, text, text, text, bigint, int, int, timestamptz, text) TO authenticated, service_role;

COMMIT;
