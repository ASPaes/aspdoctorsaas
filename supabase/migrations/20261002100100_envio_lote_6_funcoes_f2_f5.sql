-- ============================================================================
-- Envio em lote (DEM-0492) -- 6: funcoes das fases 2 a 5  (02/10/2026)
--
-- Depende da 5 (estrutura). Tudo SECURITY DEFINER + search_path + grants
-- explicitos. Permissao igual a do disparo: admin/head do tenant ou super
-- admin, com o portao tenants.envio_lote_enabled ligado.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Ajudantes (sem acesso a dado: IMMUTABLE/VOLATILE puros)
-- ---------------------------------------------------------------------------
BEGIN;
SET LOCAL lock_timeout = '5s';

-- Telefone digitado -> 55 + DDD + numero (mesma regra do normalizeBRPhone do
-- _shared/phone.ts). NULL se nao der para mandar.
CREATE OR REPLACE FUNCTION public.fn_bulk_normaliza_tel(p text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  WITH d AS (SELECT regexp_replace(regexp_replace(coalesce(p, ''), '\D', '', 'g'), '^0+', '') AS t)
  SELECT CASE
    WHEN length(t) = 10 OR (length(t) = 11 AND substr(t, 3, 1) = '9') THEN '55' || t
    WHEN length(t) BETWEEN 12 AND 13 THEN t
    ELSE NULL END
  FROM d;
$$;

-- Chave da pessoa: celular sem o 9 (com e sem o 9 sao a mesma pessoa). Igual a
-- chaveTelefone() da tela.
CREATE OR REPLACE FUNCTION public.fn_bulk_chave_tel(p text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  WITH d AS (SELECT regexp_replace(coalesce(p, ''), '\D', '', 'g') AS t)
  SELECT CASE
    WHEN length(t) = 13 AND left(t, 2) = '55' AND substr(t, 5, 1) = '9' AND substr(t, 6, 1) ~ '[6-9]'
      THEN left(t, 4) || substr(t, 6)
    ELSE t END
  FROM d;
$$;

-- Variacao de texto: {Ola|Oi|Bom dia} vira uma das opcoes, sorteada por
-- destinatario. So conta chave COM barra: {nome_cliente} fica intacto.
CREATE OR REPLACE FUNCTION public.fn_bulk_spintax(p text)
RETURNS text LANGUAGE plpgsql VOLATILE SET search_path = public AS $$
DECLARE
  v_out  text := coalesce(p, '');
  v_m    text[];
  v_opts text[];
  v_guard int := 0;
BEGIN
  LOOP
    v_m := regexp_match(v_out, '\{([^{}]*\|[^{}]*)\}');
    EXIT WHEN v_m IS NULL OR v_guard > 200;
    v_opts := string_to_array(v_m[1], '|');
    v_out := overlay(v_out PLACING v_opts[1 + floor(random() * array_length(v_opts, 1))::int]
                     FROM strpos(v_out, '{' || v_m[1] || '}') FOR length(v_m[1]) + 2);
    v_guard := v_guard + 1;
  END LOOP;
  RETURN v_out;
END;
$$;

-- Texto final de um destinatario: variacao, {nome_cliente} e as colunas da
-- planilha ({vencimento}, {valor}...). Coluna que o destinatario nao tem fica vazia.
CREATE OR REPLACE FUNCTION public.fn_bulk_aplicar(p_texto text, p_nome text, p_vars jsonb)
RETURNS text LANGUAGE plpgsql VOLATILE SET search_path = public AS $$
DECLARE
  v_out text := public.fn_bulk_spintax(p_texto);
  k text;
  v text;
BEGIN
  v_out := replace(v_out, '{nome_cliente}', coalesce(nullif(btrim(p_nome), ''), 'cliente'));
  IF p_vars IS NOT NULL AND jsonb_typeof(p_vars) = 'object' THEN
    FOR k, v IN SELECT key, value FROM jsonb_each_text(p_vars) LOOP
      v_out := replace(v_out, '{' || lower(k) || '}', coalesce(v, ''));
    END LOOP;
  END IF;
  -- Coluna que este destinatario nao tem: some, em vez de sair "{vencimento}".
  RETURN regexp_replace(v_out, '\{[a-z0-9_]{1,40}\}', '', 'g');
END;
$$;

-- Corpo do template com as variaveis trocadas, para a bolha do chat e a previa.
CREATE OR REPLACE FUNCTION public.fn_bulk_render_template(p_body text, p_params jsonb)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE
  v_out text := coalesce(p_body, '');
  i int;
  k text;
  v text;
BEGIN
  IF p_params IS NULL THEN RETURN v_out; END IF;
  IF jsonb_typeof(p_params) = 'array' THEN
    FOR i IN 0 .. jsonb_array_length(p_params) - 1 LOOP
      v_out := replace(v_out, '{{' || (i + 1) || '}}', coalesce(p_params->>i, ''));
    END LOOP;
  ELSIF jsonb_typeof(p_params) = 'object' THEN
    FOR k, v IN SELECT key, value FROM jsonb_each_text(p_params) LOOP
      v_out := replace(v_out, '{{' || k || '}}', coalesce(v, ''));
    END LOOP;
  END IF;
  RETURN v_out;
END;
$$;

-- Dia util do tenant: seg a sex e sem feriado geral fechado.
CREATE OR REPLACE FUNCTION public.fn_bulk_dia_util(p_tenant uuid, p_dia date)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT extract(isodow FROM p_dia) < 6
     AND NOT EXISTS (
       SELECT 1 FROM public.business_hours_exceptions e
        WHERE e.tenant_id = p_tenant AND e.date = p_dia
          AND e.department_id IS NULL AND e.is_closed
     );
$$;

-- Contexto de quem chama: tenant efetivo + papel. Levanta erro se nao pode.
-- No cron (recorrencia) nao ha JWT: o "quem" vem de doctorsaas.acting_user e o
-- super admin vem da coluna do perfil (is_super_admin() le auth.uid()).
CREATE OR REPLACE FUNCTION public.fn_bulk_ctx(p_tenant_id uuid, OUT tenant_id uuid, OUT me uuid, OUT role text, OUT super boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  me := public.fn_acting_user();
  IF me IS NULL THEN
    RAISE EXCEPTION 'Sessao sem usuario identificado.' USING ERRCODE = '42501';
  END IF;
  SELECT p.role, p.tenant_id, coalesce(p.is_super_admin, false)
    INTO role, tenant_id, super
    FROM public.profiles p WHERE p.user_id = me;
  super := coalesce(public.is_super_admin(), false) OR coalesce(super, false);

  IF super THEN
    tenant_id := coalesce(p_tenant_id, tenant_id);
  ELSIF p_tenant_id IS NOT NULL AND p_tenant_id IS DISTINCT FROM tenant_id THEN
    RAISE EXCEPTION 'Sem permissao para este tenant.' USING ERRCODE = '42501';
  END IF;
  IF tenant_id IS NULL THEN
    RAISE EXCEPTION 'Tenant nao identificado.' USING ERRCODE = '22023';
  END IF;
  IF NOT super AND coalesce(role, '') NOT IN ('admin', 'head') THEN
    RAISE EXCEPTION 'Envio em lote e so para admin e head.' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tenants t WHERE t.id = fn_bulk_ctx.tenant_id AND t.envio_lote_enabled) THEN
    RAISE EXCEPTION 'Envio em lote nao esta liberado para esta empresa.' USING ERRCODE = '42501';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_bulk_normaliza_tel(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_bulk_chave_tel(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_bulk_spintax(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_bulk_aplicar(text, text, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_bulk_render_template(text, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_bulk_dia_util(uuid, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_bulk_ctx(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_bulk_normaliza_tel(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_bulk_chave_tel(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_bulk_spintax(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_bulk_aplicar(text, text, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_bulk_render_template(text, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_bulk_dia_util(uuid, date) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_bulk_ctx(uuid) TO service_role;
COMMIT;

-- ---------------------------------------------------------------------------
-- Disparo (substitui a versao de 12 argumentos da migration 4)
--
-- Novidades:
--   F2  p_template_id/p_template_params: numero oficial so manda template.
--   F3  p_list_id: so registra de qual grupo veio (e carimba last_used_at).
--   F4  p_recurrence_id: lote criado pela recorrencia.
--   F5  p_teste; destino com "vars" (colunas da planilha); variacao {a|b};
--       descadastrado fica de fora (volta em `ignorados`); limite diario do numero.
-- ---------------------------------------------------------------------------
BEGIN;
SET LOCAL lock_timeout = '5s';

DROP FUNCTION IF EXISTS public.fn_bulk_send_create(uuid, uuid, text, jsonb, text, text, text, bigint, int, int, timestamptz, text);

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
  p_titulo           text        DEFAULT NULL,
  p_template_id      uuid        DEFAULT NULL,
  p_template_params  jsonb       DEFAULT NULL,
  p_list_id          uuid        DEFAULT NULL,
  p_recurrence_id    uuid        DEFAULT NULL,
  p_teste            boolean     DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  c           record;
  v_me        uuid;
  v_super     boolean;
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
  v_provider  text;
  v_inst_nome text;
  v_limite    int;
  v_no_dia    int;
  v_tpl       record;
  v_tpl_nome  text;
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
  v_vars      jsonb;
  v_ignorados jsonb := '[]'::jsonb;
  v_grupo_fora int := 0;
BEGIN
  SELECT * INTO c FROM public.fn_bulk_ctx(p_tenant_id);
  v_me := c.me; v_super := c.super; v_role := c.role; v_tenant := c.tenant_id;

  -- Ritmo. Quem nao e admin fica no padrao, sem negociar.
  IF p_intervalo_min_s IS NULL OR p_intervalo_max_s IS NULL
     OR p_intervalo_min_s < 0 OR p_intervalo_max_s > 600 OR p_intervalo_min_s > p_intervalo_max_s
     OR p_intervalo_max_s < 1 THEN
    RAISE EXCEPTION 'Intervalo invalido: de 0 a 600 s, o menor antes do maior.' USING ERRCODE = '22023';
  END IF;
  IF NOT v_super AND v_role <> 'admin' AND (p_intervalo_min_s <> 5 OR p_intervalo_max_s <> 30) THEN
    RAISE EXCEPTION 'So o admin muda o ritmo do envio.' USING ERRCODE = '42501';
  END IF;

  SELECT i.provider_type, coalesce(i.display_name, i.instance_name), i.lote_limite_diario
    INTO v_provider, v_inst_nome, v_limite
    FROM public.whatsapp_instances i WHERE i.id = p_instance_id AND i.tenant_id = v_tenant;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Numero de WhatsApp nao encontrado nesta empresa.' USING ERRCODE = 'P0002';
  END IF;

  -- Conteudo.
  IF p_template_id IS NOT NULL THEN
    -- F2: numero oficial da Meta. Fora da janela de 24 h a Meta so aceita template.
    IF v_provider IS DISTINCT FROM 'meta_cloud' THEN
      RAISE EXCEPTION 'Template so sai por numero oficial da Meta.' USING ERRCODE = '22023';
    END IF;
    SELECT t.id, t.name, t.status, t.body_text, t.instance_id INTO v_tpl
      FROM public.whatsapp_meta_templates t WHERE t.id = p_template_id AND t.tenant_id = v_tenant;
    IF NOT FOUND OR v_tpl.instance_id <> p_instance_id THEN
      RAISE EXCEPTION 'Template nao encontrado neste numero.' USING ERRCODE = 'P0002';
    END IF;
    IF v_tpl.status <> 'APPROVED' THEN
      RAISE EXCEPTION 'O template "%" nao esta aprovado pela Meta (situacao: %).', v_tpl.name, v_tpl.status USING ERRCODE = '22023';
    END IF;
    IF p_storage_path IS NOT NULL THEN
      RAISE EXCEPTION 'Template nao leva PDF solto: o anexo, se houver, faz parte do template.' USING ERRCODE = '22023';
    END IF;
    v_tipo := 'template';
    v_tpl_nome := v_tpl.name;
    v_content := coalesce(v_tpl.body_text, '');
  ELSIF v_provider = 'meta_cloud' THEN
    RAISE EXCEPTION 'Numero oficial da Meta so envia template aprovado. Escolha um template.' USING ERRCODE = '22023';
  ELSIF p_storage_path IS NOT NULL THEN
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
    ordem int, conversation_id uuid, contact_id uuid, nome text, vars jsonb
  ) ON COMMIT DROP;
  TRUNCATE _bulk_dest;

  FOR e IN SELECT * FROM jsonb_array_elements(p_destinos) LOOP
    v_conv := NULL; v_contact := NULL; v_ativo := NULL; v_cliente := NULL;
    v_nome := nullif(btrim(left(e->>'nome', 120)), '');
    v_vars := CASE WHEN jsonb_typeof(e->'vars') = 'object' THEN e->'vars' ELSE NULL END;

    IF nullif(e->>'conversation_id', '') IS NOT NULL THEN
      -- Grupo (ou chamada antiga): a conversa tem de ser deste numero.
      IF v_tipo = 'template' THEN
        RAISE EXCEPTION 'A API oficial da Meta nao envia para grupo. Tire os grupos da selecao.' USING ERRCODE = '22023';
      END IF;
      SELECT cv.id, cv.contact_id, coalesce(v_nome, nullif(btrim(ct.name), ''))
        INTO v_conv, v_contact, v_nome
        FROM public.whatsapp_conversations cv
        LEFT JOIN public.whatsapp_contacts ct ON ct.id = cv.contact_id
       WHERE cv.id = (e->>'conversation_id')::uuid
         AND cv.tenant_id = v_tenant
         AND (cv.instance_id = p_instance_id OR cv.current_instance_id = p_instance_id);
      IF v_conv IS NULL THEN
        v_grupo_fora := v_grupo_fora + 1;
        CONTINUE;
      END IF;

    ELSE
      v_tel := public.fn_bulk_normaliza_tel(e->>'telefone');
      v_variants := CASE WHEN v_tel IS NULL THEN NULL ELSE public.fn_wa_phone_variants(v_tel) END;
      IF coalesce(array_length(v_variants, 1), 0) = 0 OR length(v_variants[1]) < 12 THEN
        v_ignorados := v_ignorados || jsonb_build_object('telefone', e->>'telefone', 'nome', v_nome, 'motivo', 'telefone invalido');
        CONTINUE;
      END IF;
      v_tel := v_variants[1];

      -- F5: pediu para nao receber.
      IF EXISTS (SELECT 1 FROM public.whatsapp_bulk_optouts o
                  WHERE o.tenant_id = v_tenant AND o.telefone = public.fn_bulk_chave_tel(v_tel)) THEN
        v_ignorados := v_ignorados || jsonb_build_object('telefone', v_tel, 'nome', v_nome, 'motivo', 'descadastrado');
        CONTINUE;
      END IF;

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
      SELECT cv.id, ct.id, ct.is_active
        INTO v_conv, v_contact, v_ativo
        FROM public.whatsapp_conversations cv
        JOIN public.whatsapp_contacts ct
          ON ct.id = cv.contact_id
         AND ct.tenant_id = v_tenant
         AND ct.phone_number = ANY (v_variants)
       WHERE cv.tenant_id = v_tenant
         AND cv.instance_id = p_instance_id
         AND coalesce(cv.is_group, false) = false
       ORDER BY (ct.phone_number = v_tel) DESC, cv.last_message_at DESC NULLS LAST
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

      -- 3) Cria a conversa FECHADA e sem dono: fechada nao entra na distribuicao
      --    e a resposta do cliente reabre pelo fluxo normal.
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

    -- Mesma pessoa marcada duas vezes sai uma vez so.
    IF NOT EXISTS (SELECT 1 FROM _bulk_dest b WHERE b.conversation_id = v_conv) THEN
      v_ordem := v_ordem + 1;
      INSERT INTO _bulk_dest (ordem, conversation_id, contact_id, nome, vars)
      VALUES (v_ordem, v_conv, v_contact, coalesce(v_nome, 'cliente'), v_vars);
    END IF;
  END LOOP;

  IF v_grupo_fora > 0 THEN
    RAISE EXCEPTION '% destinatario(s) nao sao conversas deste numero. Recarregue a lista.', v_grupo_fora
      USING ERRCODE = '22023';
  END IF;

  SELECT count(*) INTO v_validos FROM _bulk_dest;
  IF v_validos = 0 THEN
    IF jsonb_array_length(v_ignorados) > 0 THEN
      RAISE EXCEPTION 'Ninguem para receber: % ficaram de fora (%).', jsonb_array_length(v_ignorados),
        (SELECT string_agg(DISTINCT x->>'motivo', ', ') FROM jsonb_array_elements(v_ignorados) x)
        USING ERRCODE = '22023';
    END IF;
    RAISE EXCEPTION 'Nenhum destinatario valido para este numero.' USING ERRCODE = '22023';
  END IF;

  -- Ordem de saida sorteada (a ordem da tela nao vale).
  WITH s AS (SELECT conversation_id, row_number() OVER (ORDER BY random()) AS n FROM _bulk_dest)
  UPDATE _bulk_dest b SET ordem = s.n FROM s WHERE s.conversation_id = b.conversation_id;

  -- Inicio: agora (+15 s de folga para o motor) ou o horario agendado.
  -- Se ja existe outro lote saindo por este numero, entra depois dele.
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

  -- F5: limite diario do numero (dia de Sao Paulo em que o lote comeca).
  IF v_limite IS NOT NULL AND NOT p_teste THEN
    SELECT count(*) INTO v_no_dia
      FROM public.whatsapp_scheduled_messages s
     WHERE s.bulk_send_id IS NOT NULL
       AND s.instance_id = p_instance_id
       AND s.status IN ('pending', 'sending', 'sent')
       AND (s.scheduled_at AT TIME ZONE 'America/Sao_Paulo')::date = (v_inicio AT TIME ZONE 'America/Sao_Paulo')::date;
    IF v_no_dia + v_validos > v_limite THEN
      RAISE EXCEPTION 'O numero % tem limite de % mensagens de lote por dia e ja tem % nesse dia. Cabem mais %. Escolha outro dia, outro numero ou menos destinatarios.',
        v_inst_nome, v_limite, v_no_dia, greatest(v_limite - v_no_dia, 0) USING ERRCODE = '22023';
    END IF;
  END IF;

  v_titulo := coalesce(
    nullif(btrim(left(p_titulo, 80)), ''),
    CASE WHEN v_tipo = 'template' THEN 'Template ' || v_tpl_nome END,
    nullif(btrim(left(regexp_replace(regexp_replace(coalesce(p_media_file_name, ''), '\.pdf$', '', 'i'), '[_-]+', ' ', 'g'), 80)), ''),
    nullif(btrim(left(regexp_replace(replace(v_content, '{nome_cliente}', '...'), '\s+', ' ', 'g'), 60)), ''),
    'Envio em lote'
  );
  IF p_teste THEN v_titulo := 'Teste: ' || v_titulo; END IF;

  INSERT INTO public.whatsapp_bulk_sends (
    tenant_id, instance_id, created_by, titulo, content, message_type,
    storage_path, media_mimetype, media_file_name, media_size_bytes,
    intervalo_min_s, intervalo_max_s, total, inicio_em, fim_previsto_em,
    template_id, template_params, list_id, recurrence_id, teste
  ) VALUES (
    v_tenant, p_instance_id, v_me, left(v_titulo, 90), v_content, v_tipo,
    p_storage_path, p_media_mimetype, p_media_file_name, p_media_size_bytes,
    p_intervalo_min_s, p_intervalo_max_s, v_validos, v_inicio, v_inicio,
    p_template_id, p_template_params, p_list_id, p_recurrence_id, coalesce(p_teste, false)
  )
  RETURNING id INTO v_bulk;

  -- Horarios: o primeiro no inicio; cada proximo soma um intervalo sorteado.
  WITH sorteio AS (
    SELECT b.*,
           CASE WHEN b.ordem = 1 THEN 0
                ELSE p_intervalo_min_s + random() * (p_intervalo_max_s - p_intervalo_min_s)
           END AS passo
      FROM _bulk_dest b
  ), horarios AS (
    SELECT s.*, v_inicio + make_interval(secs => sum(s.passo) OVER (ORDER BY s.ordem)) AS quando
      FROM sorteio s
  ), params AS (
    -- Variaveis do template com o nome/colunas de cada destinatario.
    SELECT h.*,
           CASE
             WHEN v_tipo <> 'template' OR p_template_params IS NULL THEN NULL
             WHEN jsonb_typeof(p_template_params) = 'array' THEN (
               -- A Meta recusa variavel vazia: sem valor vai "-".
               SELECT jsonb_agg(coalesce(nullif(btrim(public.fn_bulk_aplicar(x.v, h.nome, h.vars)), ''), '-') ORDER BY x.i)
                 FROM jsonb_array_elements_text(p_template_params) WITH ORDINALITY x(v, i))
             ELSE (
               SELECT jsonb_object_agg(x.key, coalesce(nullif(btrim(public.fn_bulk_aplicar(x.value, h.nome, h.vars)), ''), '-'))
                 FROM jsonb_each_text(p_template_params) x)
           END AS tparams
      FROM horarios h
  )
  INSERT INTO public.whatsapp_scheduled_messages (
    tenant_id, conversation_id, instance_id, created_by,
    content, message_type, storage_path, media_mimetype, media_file_name, media_size_bytes,
    scheduled_at, cancel_if_client_replies, bulk_send_id, template_id, template_parameters
  )
  SELECT v_tenant, p.conversation_id, p_instance_id, v_me,
         CASE WHEN v_tipo = 'template' THEN public.fn_bulk_render_template(v_content, p.tparams)
              ELSE public.fn_bulk_aplicar(v_content, p.nome, p.vars) END,
         v_tipo, p_storage_path, p_media_mimetype, p_media_file_name, p_media_size_bytes,
         date_trunc('second', p.quando), false, v_bulk,
         CASE WHEN v_tipo = 'template' THEN p_template_id END,
         p.tparams
    FROM params p;

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

  IF p_list_id IS NOT NULL THEN
    UPDATE public.whatsapp_bulk_lists SET last_used_at = now()
     WHERE id = p_list_id AND tenant_id = v_tenant;
  END IF;

  RETURN jsonb_build_object(
    'bulk_send_id', v_bulk,
    'total', v_validos,
    'inicio_em', v_inicio,
    'fim_previsto_em', v_fim,
    'ignorados', v_ignorados
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.fn_bulk_send_create(uuid, uuid, text, jsonb, text, text, text, bigint, int, int, timestamptz, text, uuid, jsonb, uuid, uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_bulk_send_create(uuid, uuid, text, jsonb, text, text, text, bigint, int, int, timestamptz, text, uuid, jsonb, uuid, uuid, boolean) TO authenticated, service_role;
COMMIT;

-- ---------------------------------------------------------------------------
-- F3: grupos de envio
-- ---------------------------------------------------------------------------
BEGIN;
SET LOCAL lock_timeout = '5s';

-- Cria ou atualiza. p_modo: 'substituir' (membros = p_membros) ou 'adicionar'.
-- p_membros: [{"conversation_id": ...} | {"telefone", "nome_contato", "nome_na_mensagem", "cliente_id", "vars"}]
CREATE OR REPLACE FUNCTION public.fn_bulk_list_save(
  p_tenant_id uuid,
  p_list_id   uuid,
  p_nome      text,
  p_descricao text  DEFAULT NULL,
  p_tipo      text  DEFAULT 'fixa',
  p_filtros   jsonb DEFAULT NULL,
  p_membros   jsonb DEFAULT NULL,
  p_modo      text  DEFAULT 'substituir'
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  c      record;
  v_id   uuid := p_list_id;
  m      jsonb;
  v_tel  text;
  v_cli  uuid;
BEGIN
  SELECT * INTO c FROM public.fn_bulk_ctx(p_tenant_id);
  IF length(btrim(coalesce(p_nome, ''))) = 0 THEN
    RAISE EXCEPTION 'De um nome ao grupo.' USING ERRCODE = '22023';
  END IF;
  IF coalesce(p_tipo, 'fixa') NOT IN ('fixa', 'dinamica') THEN
    RAISE EXCEPTION 'Tipo de grupo invalido.' USING ERRCODE = '22023';
  END IF;
  IF p_tipo = 'dinamica' AND (p_filtros IS NULL OR jsonb_typeof(p_filtros) <> 'object') THEN
    RAISE EXCEPTION 'Grupo automatico precisa dos filtros.' USING ERRCODE = '22023';
  END IF;

  BEGIN
    IF v_id IS NULL THEN
      INSERT INTO public.whatsapp_bulk_lists (tenant_id, nome, descricao, tipo, filtros, created_by)
      VALUES (c.tenant_id, btrim(left(p_nome, 80)), nullif(btrim(p_descricao), ''), coalesce(p_tipo, 'fixa'),
              CASE WHEN p_tipo = 'dinamica' THEN p_filtros END, c.me)
      RETURNING id INTO v_id;
    ELSE
      UPDATE public.whatsapp_bulk_lists
         SET nome = btrim(left(p_nome, 80)), descricao = nullif(btrim(p_descricao), ''),
             tipo = coalesce(p_tipo, tipo),
             filtros = CASE WHEN coalesce(p_tipo, tipo) = 'dinamica' THEN coalesce(p_filtros, filtros) END,
             updated_at = now()
       WHERE id = v_id AND tenant_id = c.tenant_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Grupo nao encontrado.' USING ERRCODE = 'P0002';
      END IF;
    END IF;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'Ja existe um grupo chamado "%".', btrim(p_nome) USING ERRCODE = '23505';
  END;

  IF p_membros IS NULL OR coalesce(p_tipo, 'fixa') = 'dinamica' THEN
    IF coalesce(p_tipo, 'fixa') = 'dinamica' THEN
      DELETE FROM public.whatsapp_bulk_list_members WHERE list_id = v_id;
    END IF;
    RETURN v_id;
  END IF;
  IF jsonb_typeof(p_membros) <> 'array' THEN
    RAISE EXCEPTION 'Lista de membros invalida.' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_membros) > 5000 THEN
    RAISE EXCEPTION 'Maximo de 5.000 pessoas por grupo.' USING ERRCODE = '22023';
  END IF;

  IF p_modo = 'substituir' THEN
    DELETE FROM public.whatsapp_bulk_list_members WHERE list_id = v_id;
  END IF;

  FOR m IN SELECT * FROM jsonb_array_elements(p_membros) LOOP
    IF nullif(m->>'conversation_id', '') IS NOT NULL THEN
      INSERT INTO public.whatsapp_bulk_list_members (list_id, tenant_id, conversation_id, nome_contato, nome_na_mensagem)
      SELECT v_id, c.tenant_id, cv.id, left(m->>'nome_contato', 120), nullif(btrim(left(m->>'nome_na_mensagem', 120)), '')
        FROM public.whatsapp_conversations cv
       WHERE cv.id = (m->>'conversation_id')::uuid AND cv.tenant_id = c.tenant_id
      ON CONFLICT (list_id, conversation_id) WHERE conversation_id IS NOT NULL
      DO UPDATE SET nome_na_mensagem = coalesce(EXCLUDED.nome_na_mensagem, whatsapp_bulk_list_members.nome_na_mensagem);
    ELSE
      v_tel := public.fn_bulk_normaliza_tel(m->>'telefone');
      CONTINUE WHEN v_tel IS NULL;
      v_tel := public.fn_bulk_chave_tel(v_tel);
      -- Guarda o celular COM o 9 quando ele existe, que e a forma que sai.
      IF length(v_tel) = 12 AND substr(v_tel, 5, 1) ~ '[6-9]' THEN v_tel := left(v_tel, 4) || '9' || substr(v_tel, 5); END IF;
      BEGIN v_cli := nullif(m->>'cliente_id', '')::uuid; EXCEPTION WHEN invalid_text_representation THEN v_cli := NULL; END;
      INSERT INTO public.whatsapp_bulk_list_members (list_id, tenant_id, telefone, nome_contato, nome_na_mensagem, cliente_id, vars)
      VALUES (v_id, c.tenant_id, v_tel, left(m->>'nome_contato', 120), nullif(btrim(left(m->>'nome_na_mensagem', 120)), ''),
              v_cli, CASE WHEN jsonb_typeof(m->'vars') = 'object' THEN m->'vars' END)
      ON CONFLICT (list_id, telefone) WHERE telefone IS NOT NULL
      DO UPDATE SET nome_contato = coalesce(EXCLUDED.nome_contato, whatsapp_bulk_list_members.nome_contato),
                    nome_na_mensagem = coalesce(EXCLUDED.nome_na_mensagem, whatsapp_bulk_list_members.nome_na_mensagem),
                    cliente_id = coalesce(EXCLUDED.cliente_id, whatsapp_bulk_list_members.cliente_id),
                    vars = coalesce(EXCLUDED.vars, whatsapp_bulk_list_members.vars);
    END IF;
  END LOOP;

  UPDATE public.whatsapp_bulk_lists SET updated_at = now() WHERE id = v_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_bulk_list_remove_members(p_list_id uuid, p_member_ids uuid[])
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c record; v_tenant uuid; v_n int;
BEGIN
  SELECT l.tenant_id INTO v_tenant FROM public.whatsapp_bulk_lists l WHERE l.id = p_list_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Grupo nao encontrado.' USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO c FROM public.fn_bulk_ctx(v_tenant);
  DELETE FROM public.whatsapp_bulk_list_members WHERE list_id = p_list_id AND id = ANY (p_member_ids);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  UPDATE public.whatsapp_bulk_lists SET updated_at = now() WHERE id = p_list_id;
  RETURN v_n;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_bulk_list_delete(p_list_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c record; v_tenant uuid; v_rec text;
BEGIN
  SELECT l.tenant_id INTO v_tenant FROM public.whatsapp_bulk_lists l WHERE l.id = p_list_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Grupo nao encontrado.' USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO c FROM public.fn_bulk_ctx(v_tenant);
  SELECT string_agg(r.titulo, ', ') INTO v_rec FROM public.whatsapp_bulk_recurrences r WHERE r.list_id = p_list_id;
  IF v_rec IS NOT NULL THEN
    RAISE EXCEPTION 'Este grupo e usado no envio recorrente: %. Apague a recorrencia antes.', v_rec USING ERRCODE = '23503';
  END IF;
  DELETE FROM public.whatsapp_bulk_lists WHERE id = p_list_id;
END;
$$;

-- Quem esta no grupo agora. Fixa: os membros. Dinamica: os clientes que passam
-- nos filtros (mesma regra de src/lib/filtrosClientes.ts, menos os periodos de
-- data, que nao fazem sentido num grupo que se atualiza sozinho) com o WhatsApp
-- de cada um. `instancia_ok`: grupo de WhatsApp so recebe pelo numero dele.
CREATE OR REPLACE FUNCTION public.fn_bulk_list_resolve(p_list_id uuid, p_instance_id uuid DEFAULT NULL)
RETURNS TABLE (
  member_id uuid, conversation_id uuid, telefone text, nome_contato text, nome_na_mensagem text,
  cliente_id uuid, cliente_nome text, vars jsonb, eh_grupo boolean, instancia_ok boolean
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  c   record;
  l   record;
  f   jsonb;
  v_lucro_min numeric; v_lucro_max numeric; v_marg_min numeric; v_marg_max numeric;
  v_mens_min numeric; v_mens_max numeric;
BEGIN
  SELECT * INTO l FROM public.whatsapp_bulk_lists x WHERE x.id = p_list_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Grupo nao encontrado.' USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO c FROM public.fn_bulk_ctx(l.tenant_id);

  IF l.tipo = 'fixa' THEN
    RETURN QUERY
      SELECT m.id, m.conversation_id,
             coalesce(m.telefone, ct.phone_number),
             coalesce(m.nome_contato, ct.name),
             coalesce(m.nome_na_mensagem, ct.nome_na_mensagem),
             coalesce(m.cliente_id, ct.cliente_id),
             coalesce(cl.nome_fantasia, cl.razao_social),
             m.vars,
             m.conversation_id IS NOT NULL,
             m.conversation_id IS NULL OR p_instance_id IS NULL
               OR cv.instance_id = p_instance_id OR cv.current_instance_id = p_instance_id
        FROM public.whatsapp_bulk_list_members m
        LEFT JOIN public.whatsapp_conversations cv ON cv.id = m.conversation_id
        LEFT JOIN public.whatsapp_contacts ct ON ct.id = cv.contact_id
        LEFT JOIN public.clientes cl ON cl.id = coalesce(m.cliente_id, ct.cliente_id)
       WHERE m.list_id = p_list_id
       ORDER BY coalesce(m.nome_contato, ct.name);
    RETURN;
  END IF;

  -- Dinamica.
  f := coalesce(l.filtros, '{}'::jsonb);
  v_mens_min := nullif(replace(replace(f->>'mensalidadeMin', '.', ''), ',', '.'), '')::numeric;
  v_mens_max := nullif(replace(replace(f->>'mensalidadeMax', '.', ''), ',', '.'), '')::numeric;
  v_lucro_min := nullif(replace(replace(f->>'lucroMin', '.', ''), ',', '.'), '')::numeric;
  v_lucro_max := nullif(replace(replace(f->>'lucroMax', '.', ''), ',', '.'), '')::numeric;
  v_marg_min := nullif(replace(replace(f->>'margemMin', '.', ''), ',', '.'), '')::numeric;
  v_marg_max := nullif(replace(replace(f->>'margemMax', '.', ''), ',', '.'), '')::numeric;

  RETURN QUERY
  WITH cli AS (
    SELECT v.id, v.nome_fantasia, v.razao_social, v.telefone_whatsapp,
           v.mensalidade, v.custo_operacao, v.imposto_percentual, v.custo_fixo_percentual
      FROM public.vw_clientes_financeiro v
     WHERE v.tenant_id = l.tenant_id
       AND (coalesce(f->>'status', 'ativos') = 'todos'
            OR (f->>'status' = 'cancelados' AND v.cancelado)
            OR (coalesce(f->>'status', 'ativos') = 'ativos' AND NOT v.cancelado))
       AND (NOT coalesce((f->>'apenasSetupIncompleto')::boolean, false) OR v.setup_completo = false)
       AND (coalesce(f->>'unidadeBaseQuick', '') = '' OR (f->>'unidadeBaseQuick' = '__null__' AND v.unidade_base_id IS NULL) OR v.unidade_base_id::text = f->>'unidadeBaseQuick')
       AND (coalesce(f->>'recorrenciaAdv', '') = '' OR (f->>'recorrenciaAdv' = '__null__' AND v.recorrencia IS NULL) OR v.recorrencia::text = f->>'recorrenciaAdv')
       AND (coalesce(f->>'modeloContratoId', '') = '' OR (f->>'modeloContratoId' = '__null__' AND v.modelo_contrato_id IS NULL) OR v.modelo_contrato_id::text = f->>'modeloContratoId')
       AND (coalesce(f->>'origemVendaId', '') = '' OR (f->>'origemVendaId' = '__null__' AND v.origem_venda_id IS NULL) OR v.origem_venda_id::text = f->>'origemVendaId')
       AND (coalesce(f->>'estadoId', '') = '' OR (f->>'estadoId' = '__null__' AND v.estado_id IS NULL) OR v.estado_id::text = f->>'estadoId')
       AND (coalesce(f->>'cidadeId', '') = '' OR (f->>'cidadeId' = '__null__' AND v.cidade_id IS NULL) OR v.cidade_id::text = f->>'cidadeId')
       AND (coalesce(f->>'motivoCancelamentoId', '') = '' OR (f->>'motivoCancelamentoId' = '__null__' AND v.motivo_cancelamento_id IS NULL) OR v.motivo_cancelamento_id::text = f->>'motivoCancelamentoId')
       AND (coalesce(f->>'areaAtuacaoId', '') = '' OR (f->>'areaAtuacaoId' = '__null__' AND v.area_atuacao_id IS NULL) OR v.area_atuacao_id::text = f->>'areaAtuacaoId')
       AND (coalesce(f->>'segmentoId', '') = '' OR (f->>'segmentoId' = '__null__' AND v.segmento_id IS NULL) OR v.segmento_id::text = f->>'segmentoId')
       AND (coalesce(f->>'funcionarioId', '') = '' OR (f->>'funcionarioId' = '__null__' AND v.funcionario_id IS NULL) OR v.funcionario_id::text = f->>'funcionarioId')
       AND (v_mens_min IS NULL OR v.mensalidade >= v_mens_min)
       AND (v_mens_max IS NULL OR v.mensalidade <= v_mens_max)
       AND (NOT coalesce((f->>'somenteMatrizes')::boolean, false)
            OR EXISTS (SELECT 1 FROM public.clientes fi WHERE fi.matriz_id = v.id))
       AND (coalesce(f->>'fornecedorId', '') = '' AND coalesce(f->>'produtoId', '') = ''
            AND coalesce(jsonb_array_length(f->'moduloIds'), 0) = 0
            OR EXISTS (
              SELECT 1 FROM public.cliente_produtos cp
               WHERE cp.cliente_id = v.id AND cp.ativo
                 AND (coalesce(f->>'fornecedorId', '') = '' OR (f->>'fornecedorId' = '__null__' AND cp.fornecedor_id IS NULL) OR cp.fornecedor_id::text = f->>'fornecedorId')
                 AND (coalesce(f->>'produtoId', '') = '' OR (f->>'produtoId' = '__null__' AND cp.produto_id IS NULL) OR cp.produto_id::text = f->>'produtoId')
                 AND (coalesce(jsonb_array_length(f->'moduloIds'), 0) = 0 OR EXISTS (
                   SELECT 1 FROM public.cliente_produto_modulos cpm
                    WHERE cpm.cliente_produto_id = cp.id AND cpm.ativo
                      AND cpm.modulo_id::text IN (SELECT jsonb_array_elements_text(f->'moduloIds'))))
            ))
  ), calc AS (
    SELECT cli.*,
           CASE WHEN coalesce(cli.mensalidade, 0) > 0 THEN
             round((cli.mensalidade - coalesce(cli.custo_operacao, 0))
                   - round(cli.mensalidade * coalesce(cli.imposto_percentual, 0), 2)
                   - round(cli.mensalidade * coalesce(cli.custo_fixo_percentual, 0), 2), 2)
           ELSE 0 END AS lucro,
           CASE WHEN coalesce(cli.mensalidade, 0) > 0 THEN
             round((cli.mensalidade - coalesce(cli.custo_operacao, 0)) / cli.mensalidade * 100, 2)
           ELSE 0 END AS margem
      FROM cli
  ), ok AS (
    SELECT * FROM calc
     WHERE (v_lucro_min IS NULL OR lucro >= v_lucro_min) AND (v_lucro_max IS NULL OR lucro <= v_lucro_max)
       AND (v_marg_min IS NULL OR margem >= v_marg_min) AND (v_marg_max IS NULL OR margem <= v_marg_max)
  ), fones AS (
    -- WhatsApp ligado ao cliente; sem nenhum, o do cadastro.
    SELECT ok.id AS cid, coalesce(ok.nome_fantasia, ok.razao_social) AS cnome,
           ct.phone_number AS tel, ct.name AS cont, ct.nome_na_mensagem AS nmsg
      FROM ok JOIN public.whatsapp_contacts ct
        ON ct.cliente_id = ok.id AND ct.tenant_id = l.tenant_id AND ct.is_active
       AND NOT coalesce(ct.is_group, false) AND length(ct.phone_number) BETWEEN 10 AND 13
    UNION ALL
    SELECT ok.id, coalesce(ok.nome_fantasia, ok.razao_social),
           public.fn_bulk_normaliza_tel(coalesce(cl.telefone_whatsapp, cl.telefone_whatsapp_contato)),
           coalesce(cl.contato_nome, ok.nome_fantasia, ok.razao_social), NULL
      FROM ok JOIN public.clientes cl ON cl.id = ok.id
     WHERE NOT EXISTS (SELECT 1 FROM public.whatsapp_contacts ct
                        WHERE ct.cliente_id = ok.id AND ct.tenant_id = l.tenant_id AND ct.is_active
                          AND NOT coalesce(ct.is_group, false) AND length(ct.phone_number) BETWEEN 10 AND 13)
       AND public.fn_bulk_normaliza_tel(coalesce(cl.telefone_whatsapp, cl.telefone_whatsapp_contato)) IS NOT NULL
  )
  SELECT DISTINCT ON (public.fn_bulk_chave_tel(fo.tel))
         NULL::uuid, NULL::uuid, fo.tel, fo.cont, fo.nmsg, fo.cid, fo.cnome, NULL::jsonb, false, true
    FROM fones fo
   ORDER BY public.fn_bulk_chave_tel(fo.tel), fo.cnome;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_bulk_list_save(uuid, uuid, text, text, text, jsonb, jsonb, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_bulk_list_remove_members(uuid, uuid[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_bulk_list_delete(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_bulk_list_resolve(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_bulk_list_save(uuid, uuid, text, text, text, jsonb, jsonb, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_bulk_list_remove_members(uuid, uuid[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_bulk_list_delete(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_bulk_list_resolve(uuid, uuid) TO authenticated, service_role;
COMMIT;

-- ---------------------------------------------------------------------------
-- F4: mensagens prontas e recorrencia
-- ---------------------------------------------------------------------------
BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.fn_bulk_model_save(
  p_tenant_id uuid, p_model_id uuid, p_titulo text, p_content text,
  p_storage_path text DEFAULT NULL, p_media_mimetype text DEFAULT NULL,
  p_media_file_name text DEFAULT NULL, p_media_size_bytes bigint DEFAULT NULL,
  p_template_id uuid DEFAULT NULL, p_template_params jsonb DEFAULT NULL
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c record; v_id uuid := p_model_id;
BEGIN
  SELECT * INTO c FROM public.fn_bulk_ctx(p_tenant_id);
  IF p_storage_path IS NOT NULL AND p_storage_path NOT LIKE c.tenant_id::text || '/lote/%' THEN
    RAISE EXCEPTION 'Anexo fora da pasta do envio em lote.' USING ERRCODE = '22023';
  END IF;
  IF p_template_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.whatsapp_meta_templates t WHERE t.id = p_template_id AND t.tenant_id = c.tenant_id) THEN
    RAISE EXCEPTION 'Template nao encontrado.' USING ERRCODE = 'P0002';
  END IF;
  BEGIN
    IF v_id IS NULL THEN
      INSERT INTO public.whatsapp_bulk_models (tenant_id, titulo, content, storage_path, media_mimetype,
        media_file_name, media_size_bytes, template_id, template_params, created_by)
      VALUES (c.tenant_id, btrim(left(p_titulo, 80)), coalesce(p_content, ''), p_storage_path, p_media_mimetype,
        p_media_file_name, p_media_size_bytes, p_template_id, p_template_params, c.me)
      RETURNING id INTO v_id;
    ELSE
      UPDATE public.whatsapp_bulk_models
         SET titulo = btrim(left(p_titulo, 80)), content = coalesce(p_content, ''),
             storage_path = p_storage_path, media_mimetype = p_media_mimetype,
             media_file_name = p_media_file_name, media_size_bytes = p_media_size_bytes,
             template_id = p_template_id, template_params = p_template_params, updated_at = now()
       WHERE id = v_id AND tenant_id = c.tenant_id;
      IF NOT FOUND THEN RAISE EXCEPTION 'Mensagem pronta nao encontrada.' USING ERRCODE = 'P0002'; END IF;
    END IF;
  EXCEPTION
    WHEN unique_violation THEN
      RAISE EXCEPTION 'Ja existe uma mensagem pronta chamada "%".', btrim(p_titulo) USING ERRCODE = '23505';
    WHEN check_violation THEN
      RAISE EXCEPTION 'A mensagem pronta precisa de titulo e de texto, PDF ou template.' USING ERRCODE = '22023';
  END;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_bulk_model_delete(p_model_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c record; v_tenant uuid; v_rec text;
BEGIN
  SELECT m.tenant_id INTO v_tenant FROM public.whatsapp_bulk_models m WHERE m.id = p_model_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Mensagem pronta nao encontrada.' USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO c FROM public.fn_bulk_ctx(v_tenant);
  SELECT string_agg(r.titulo, ', ') INTO v_rec FROM public.whatsapp_bulk_recurrences r WHERE r.model_id = p_model_id;
  IF v_rec IS NOT NULL THEN
    RAISE EXCEPTION 'Esta mensagem e usada no envio recorrente: %. Apague a recorrencia antes.', v_rec USING ERRCODE = '23503';
  END IF;
  DELETE FROM public.whatsapp_bulk_models WHERE id = p_model_id;
END;
$$;

-- Proxima data de uma regra, depois de p_depois (hora de Sao Paulo).
CREATE OR REPLACE FUNCTION public.fn_bulk_rec_proxima(
  p_tenant uuid, p_freq text, p_dia_mes int, p_dias_semana int[], p_hora time, p_ajuste text, p_depois timestamptz
)
RETURNS timestamptz LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  d      date := (p_depois AT TIME ZONE 'America/Sao_Paulo')::date - 7;
  v_fim  date := d + 420;
  v_alvo date;
  v_ts   timestamptz;
  v_ult  int;
BEGIN
  WHILE d <= v_fim LOOP
    v_alvo := NULL;
    IF p_freq = 'mensal' THEN
      v_ult := extract(day FROM (date_trunc('month', d) + interval '1 month - 1 day'))::int;
      IF extract(day FROM d)::int = least(p_dia_mes, v_ult) THEN v_alvo := d; END IF;
    ELSIF p_freq = 'semanal' THEN
      IF extract(dow FROM d)::int = ANY (p_dias_semana) THEN v_alvo := d; END IF;
    ELSIF p_freq = 'diaria' THEN
      IF public.fn_bulk_dia_util(p_tenant, d) THEN v_alvo := d; END IF;
    END IF;

    IF v_alvo IS NOT NULL AND p_freq <> 'diaria' AND p_ajuste <> 'manter'
       AND NOT public.fn_bulk_dia_util(p_tenant, v_alvo) THEN
      FOR i IN 1 .. 15 LOOP
        v_alvo := v_alvo + CASE WHEN p_ajuste = 'anterior' THEN -1 ELSE 1 END;
        EXIT WHEN public.fn_bulk_dia_util(p_tenant, v_alvo);
      END LOOP;
    END IF;

    IF v_alvo IS NOT NULL THEN
      v_ts := (v_alvo + p_hora) AT TIME ZONE 'America/Sao_Paulo';
      IF v_ts > p_depois THEN RETURN v_ts; END IF;
    END IF;
    d := d + 1;
  END LOOP;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_bulk_recurrence_save(
  p_tenant_id uuid, p_id uuid, p_titulo text, p_instance_id uuid, p_list_id uuid, p_model_id uuid,
  p_frequencia text, p_dia_mes int, p_dias_semana int[], p_hora time, p_ajuste text DEFAULT 'proximo',
  p_intervalo_min_s int DEFAULT 5, p_intervalo_max_s int DEFAULT 30, p_ativo boolean DEFAULT true
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c record; v_id uuid := p_id; v_prox timestamptz; v_prov text; v_tpl uuid;
BEGIN
  SELECT * INTO c FROM public.fn_bulk_ctx(p_tenant_id);
  IF NOT c.super AND c.role <> 'admin' AND (p_intervalo_min_s <> 5 OR p_intervalo_max_s <> 30) THEN
    RAISE EXCEPTION 'So o admin muda o ritmo do envio.' USING ERRCODE = '42501';
  END IF;
  SELECT i.provider_type INTO v_prov FROM public.whatsapp_instances i WHERE i.id = p_instance_id AND i.tenant_id = c.tenant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Numero de WhatsApp nao encontrado nesta empresa.' USING ERRCODE = 'P0002'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.whatsapp_bulk_lists l WHERE l.id = p_list_id AND l.tenant_id = c.tenant_id) THEN
    RAISE EXCEPTION 'Grupo de envio nao encontrado.' USING ERRCODE = 'P0002';
  END IF;
  SELECT m.template_id INTO v_tpl FROM public.whatsapp_bulk_models m WHERE m.id = p_model_id AND m.tenant_id = c.tenant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Mensagem pronta nao encontrada.' USING ERRCODE = 'P0002'; END IF;
  IF (v_prov = 'meta_cloud') <> (v_tpl IS NOT NULL) THEN
    RAISE EXCEPTION 'Numero oficial da Meta so envia mensagem pronta de template, e template so sai por numero oficial.' USING ERRCODE = '22023';
  END IF;

  v_prox := public.fn_bulk_rec_proxima(c.tenant_id, p_frequencia, p_dia_mes, p_dias_semana, p_hora, coalesce(p_ajuste, 'proximo'), now());
  IF v_prox IS NULL THEN
    RAISE EXCEPTION 'Nao achei a proxima data dessa regra. Confira o dia escolhido.' USING ERRCODE = '22023';
  END IF;

  BEGIN
    IF v_id IS NULL THEN
      INSERT INTO public.whatsapp_bulk_recurrences (tenant_id, titulo, ativo, instance_id, list_id, model_id,
        frequencia, dia_mes, dias_semana, hora, ajuste_dia_util, intervalo_min_s, intervalo_max_s, proxima_em, created_by)
      VALUES (c.tenant_id, btrim(left(p_titulo, 80)), coalesce(p_ativo, true), p_instance_id, p_list_id, p_model_id,
        p_frequencia, CASE WHEN p_frequencia = 'mensal' THEN p_dia_mes END,
        CASE WHEN p_frequencia = 'semanal' THEN p_dias_semana END, p_hora, coalesce(p_ajuste, 'proximo'),
        p_intervalo_min_s, p_intervalo_max_s, v_prox, c.me)
      RETURNING id INTO v_id;
    ELSE
      UPDATE public.whatsapp_bulk_recurrences
         SET titulo = btrim(left(p_titulo, 80)), ativo = coalesce(p_ativo, ativo), instance_id = p_instance_id,
             list_id = p_list_id, model_id = p_model_id, frequencia = p_frequencia,
             dia_mes = CASE WHEN p_frequencia = 'mensal' THEN p_dia_mes END,
             dias_semana = CASE WHEN p_frequencia = 'semanal' THEN p_dias_semana END,
             hora = p_hora, ajuste_dia_util = coalesce(p_ajuste, 'proximo'),
             intervalo_min_s = p_intervalo_min_s, intervalo_max_s = p_intervalo_max_s,
             proxima_em = v_prox, ultimo_erro = NULL, updated_at = now(),
             -- quem salvou por ultimo passa a ser quem "dispara" (permissao conferida agora)
             created_by = c.me
       WHERE id = v_id AND tenant_id = c.tenant_id;
      IF NOT FOUND THEN RAISE EXCEPTION 'Recorrencia nao encontrada.' USING ERRCODE = 'P0002'; END IF;
    END IF;
  EXCEPTION WHEN check_violation THEN
    RAISE EXCEPTION 'Regra de repeticao invalida: confira dia do mes, dias da semana e ritmo.' USING ERRCODE = '22023';
  END;
  RETURN jsonb_build_object('id', v_id, 'proxima_em', v_prox);
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_bulk_recurrence_set_active(p_id uuid, p_ativo boolean)
RETURNS timestamptz LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c record; r record; v_prox timestamptz;
BEGIN
  SELECT * INTO r FROM public.whatsapp_bulk_recurrences x WHERE x.id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Recorrencia nao encontrada.' USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO c FROM public.fn_bulk_ctx(r.tenant_id);
  IF p_ativo THEN
    v_prox := public.fn_bulk_rec_proxima(r.tenant_id, r.frequencia, r.dia_mes, r.dias_semana, r.hora, r.ajuste_dia_util, now());
  END IF;
  UPDATE public.whatsapp_bulk_recurrences
     SET ativo = p_ativo, proxima_em = CASE WHEN p_ativo THEN v_prox ELSE proxima_em END,
         ultimo_erro = CASE WHEN p_ativo THEN NULL ELSE ultimo_erro END, updated_at = now()
   WHERE id = p_id;
  RETURN v_prox;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_bulk_recurrence_delete(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c record; v_tenant uuid;
BEGIN
  SELECT r.tenant_id INTO v_tenant FROM public.whatsapp_bulk_recurrences r WHERE r.id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Recorrencia nao encontrada.' USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO c FROM public.fn_bulk_ctx(v_tenant);
  DELETE FROM public.whatsapp_bulk_recurrences WHERE id = p_id;
END;
$$;

-- Cron (*/5): cria o lote de cada recorrencia vencida. Um erro nao trava as
-- outras e nao fica tentando de novo: grava ultimo_erro, avisa no sino e pula
-- para a proxima data.
CREATE OR REPLACE FUNCTION public.fn_bulk_recurrence_run()
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r       record;
  m       record;
  v_dest  jsonb;
  v_res   jsonb;
  v_n     int := 0;
  v_err   text;
BEGIN
  FOR r IN
    SELECT * FROM public.whatsapp_bulk_recurrences
     WHERE ativo AND proxima_em IS NOT NULL AND proxima_em <= now() + interval '1 minute'
     ORDER BY proxima_em
     FOR UPDATE SKIP LOCKED
  LOOP
    BEGIN
      PERFORM set_config('doctorsaas.acting_user', r.created_by::text, true);
      SELECT * INTO m FROM public.whatsapp_bulk_models WHERE id = r.model_id;

      SELECT coalesce(jsonb_agg(
               CASE WHEN x.eh_grupo
                 THEN jsonb_build_object('conversation_id', x.conversation_id, 'nome', x.nome_na_mensagem)
                 ELSE jsonb_build_object('telefone', x.telefone, 'nome',
                        coalesce(x.nome_na_mensagem, split_part(btrim(coalesce(x.nome_contato, '')), ' ', 1)),
                        'nome_contato', x.nome_contato, 'cliente_id', x.cliente_id, 'vars', x.vars)
               END), '[]'::jsonb)
        INTO v_dest
        FROM public.fn_bulk_list_resolve(r.list_id, r.instance_id) x
       WHERE x.instancia_ok;

      v_res := public.fn_bulk_send_create(
        r.tenant_id, r.instance_id, m.content, v_dest,
        m.storage_path, m.media_mimetype, m.media_file_name, m.media_size_bytes,
        r.intervalo_min_s, r.intervalo_max_s, NULL, r.titulo,
        m.template_id, m.template_params, r.list_id, r.id, false);

      UPDATE public.whatsapp_bulk_recurrences
         SET ultima_em = now(), ultimo_bulk_id = (v_res->>'bulk_send_id')::uuid, ultimo_erro = NULL,
             proxima_em = public.fn_bulk_rec_proxima(tenant_id, frequencia, dia_mes, dias_semana, hora, ajuste_dia_util, now() + interval '1 minute')
       WHERE id = r.id;
      v_n := v_n + 1;
    EXCEPTION WHEN OTHERS THEN
      v_err := SQLERRM;
      UPDATE public.whatsapp_bulk_recurrences
         SET ultima_em = now(), ultimo_erro = left(v_err, 500),
             proxima_em = public.fn_bulk_rec_proxima(tenant_id, frequencia, dia_mes, dias_semana, hora, ajuste_dia_util, now() + interval '1 minute')
       WHERE id = r.id;
      BEGIN
        PERFORM public.fn_notify_user(
          r.tenant_id, r.created_by, 'scheduled_message_failed', 'warning',
          'Envio recorrente nao saiu',
          '"' || r.titulo || '": ' || left(v_err, 200),
          '/whatsapp/envio-lote',
          jsonb_build_object('recurrence_id', r.id), NULL);
      EXCEPTION WHEN OTHERS THEN NULL;  -- aviso e cortesia: nunca derruba o cron
      END;
    END;
  END LOOP;
  RETURN v_n;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_bulk_model_save(uuid, uuid, text, text, text, text, text, bigint, uuid, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_bulk_model_delete(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_bulk_rec_proxima(uuid, text, int, int[], time, text, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_bulk_recurrence_save(uuid, uuid, text, uuid, uuid, uuid, text, int, int[], time, text, int, int, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_bulk_recurrence_set_active(uuid, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_bulk_recurrence_delete(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_bulk_recurrence_run() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_bulk_model_save(uuid, uuid, text, text, text, text, text, bigint, uuid, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_bulk_model_delete(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_bulk_rec_proxima(uuid, text, int, int[], time, text, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_bulk_recurrence_save(uuid, uuid, text, uuid, uuid, uuid, text, int, int[], time, text, int, int, boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_bulk_recurrence_set_active(uuid, boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_bulk_recurrence_delete(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_bulk_recurrence_run() TO service_role;
COMMIT;

-- ---------------------------------------------------------------------------
-- F5: descadastro, limite por numero e funil
-- ---------------------------------------------------------------------------
BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.fn_bulk_optout_save(p_tenant_id uuid, p_telefone text, p_nome text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c record; v_tel text;
BEGIN
  SELECT * INTO c FROM public.fn_bulk_ctx(p_tenant_id);
  v_tel := public.fn_bulk_normaliza_tel(p_telefone);
  IF v_tel IS NULL THEN RAISE EXCEPTION 'Telefone invalido.' USING ERRCODE = '22023'; END IF;
  INSERT INTO public.whatsapp_bulk_optouts (tenant_id, telefone, nome, origem, created_by)
  VALUES (c.tenant_id, public.fn_bulk_chave_tel(v_tel), nullif(btrim(p_nome), ''), 'manual', c.me)
  ON CONFLICT (tenant_id, telefone) DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_bulk_optout_delete(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c record; v_tenant uuid;
BEGIN
  SELECT o.tenant_id INTO v_tenant FROM public.whatsapp_bulk_optouts o WHERE o.id = p_id;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT * INTO c FROM public.fn_bulk_ctx(v_tenant);
  DELETE FROM public.whatsapp_bulk_optouts WHERE id = p_id;
END;
$$;

-- Limite diario de mensagens de lote por numero. So admin (ou super admin).
CREATE OR REPLACE FUNCTION public.fn_bulk_instance_limit(p_instance_id uuid, p_limite int)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c record; v_tenant uuid;
BEGIN
  SELECT i.tenant_id INTO v_tenant FROM public.whatsapp_instances i WHERE i.id = p_instance_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Numero nao encontrado.' USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO c FROM public.fn_bulk_ctx(v_tenant);
  IF NOT c.super AND c.role <> 'admin' THEN
    RAISE EXCEPTION 'So o admin muda o limite do numero.' USING ERRCODE = '42501';
  END IF;
  IF p_limite IS NOT NULL AND (p_limite < 1 OR p_limite > 100000) THEN
    RAISE EXCEPTION 'Limite invalido.' USING ERRCODE = '22023';
  END IF;
  UPDATE public.whatsapp_instances SET lote_limite_diario = p_limite WHERE id = p_instance_id;
END;
$$;

-- Funil do lote: enviadas -> entregues -> lidas -> responderam (resposta do
-- cliente ate 7 dias depois da mensagem). Lido de whatsapp_messages pelo
-- sent_message_id; nada novo e gravado.
CREATE OR REPLACE FUNCTION public.fn_bulk_send_funil(p_bulk_send_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_tenant uuid; v jsonb;
BEGIN
  SELECT b.tenant_id INTO v_tenant FROM public.whatsapp_bulk_sends b WHERE b.id = p_bulk_send_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF NOT (coalesce(public.is_super_admin(), false) OR v_tenant = public.current_tenant_id()) THEN
    RAISE EXCEPTION 'Sem permissao.' USING ERRCODE = '42501';
  END IF;
  SELECT jsonb_build_object(
           'enviadas',    count(*) FILTER (WHERE s.status = 'sent'),
           'entregues',   count(*) FILTER (WHERE m.status IN ('delivered', 'read', 'played')),
           'lidas',       count(*) FILTER (WHERE m.status IN ('read', 'played')),
           'responderam', count(*) FILTER (WHERE s.status = 'sent' AND EXISTS (
                            SELECT 1 FROM public.whatsapp_messages r
                             WHERE r.conversation_id = s.conversation_id
                               AND r."timestamp" > s.sent_at
                               AND r."timestamp" < s.sent_at + interval '7 days'
                               AND NOT r.is_from_me)),
           'responderam_ids', coalesce(jsonb_agg(s.conversation_id) FILTER (WHERE s.status = 'sent' AND EXISTS (
                            SELECT 1 FROM public.whatsapp_messages r
                             WHERE r.conversation_id = s.conversation_id
                               AND r."timestamp" > s.sent_at
                               AND r."timestamp" < s.sent_at + interval '7 days'
                               AND NOT r.is_from_me)), '[]'::jsonb))
    INTO v
    FROM public.whatsapp_scheduled_messages s
    LEFT JOIN public.whatsapp_messages m ON m.id = s.sent_message_id
   WHERE s.bulk_send_id = p_bulk_send_id;
  RETURN v;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_bulk_optout_save(uuid, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_bulk_optout_delete(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_bulk_instance_limit(uuid, int) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_bulk_send_funil(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_bulk_optout_save(uuid, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_bulk_optout_delete(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_bulk_instance_limit(uuid, int) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_bulk_send_funil(uuid) TO authenticated, service_role;
COMMIT;

-- ---------------------------------------------------------------------------
-- View do lote: as colunas novas entram no FIM (CREATE OR REPLACE VIEW so
-- acrescenta). security_invoker mantido.
-- ---------------------------------------------------------------------------
BEGIN;
SET LOCAL lock_timeout = '5s';
CREATE OR REPLACE VIEW public.vw_whatsapp_bulk_sends WITH (security_invoker = true) AS
 SELECT b.id, b.tenant_id, b.instance_id, b.created_by, b.titulo, b.content, b.message_type,
    b.storage_path, b.media_mimetype, b.media_file_name, b.media_size_bytes,
    b.intervalo_min_s, b.intervalo_max_s, b.total, b.inicio_em, b.fim_previsto_em,
    b.canceled_at, b.canceled_by, b.created_at,
    COALESCE(c.pendentes, 0::bigint) AS pendentes,
    COALESCE(c.enviando, 0::bigint) AS enviando,
    COALESCE(c.enviadas, 0::bigint) AS enviadas,
    COALESCE(c.falharam, 0::bigint) AS falharam,
    COALESCE(c.canceladas, 0::bigint) AS canceladas,
    c.ultima_saida_em,
    b.teste, b.template_id, b.list_id, b.recurrence_id
   FROM whatsapp_bulk_sends b
     LEFT JOIN LATERAL ( SELECT count(*) FILTER (WHERE s.status = 'pending') AS pendentes,
            count(*) FILTER (WHERE s.status = 'sending') AS enviando,
            count(*) FILTER (WHERE s.status = 'sent') AS enviadas,
            count(*) FILTER (WHERE s.status = 'failed') AS falharam,
            count(*) FILTER (WHERE s.status = 'canceled') AS canceladas,
            max(s.sent_at) AS ultima_saida_em
           FROM whatsapp_scheduled_messages s
          WHERE s.bulk_send_id = b.id) c ON true;
COMMIT;

-- ---------------------------------------------------------------------------
-- F5: cliente responde "SAIR" a um lote -> descadastrado
--
-- Gatilho em whatsapp_messages (tabela quente): o WHEN ja descarta quase tudo
-- (mensagem nossa, sem texto ou longa) antes de chamar a funcao. So conta quem
-- recebeu lote nos ultimos 30 dias, e grupo nunca entra. Nada e respondido ao
-- cliente (regra: robo nao fala com cliente sem teste). Qualquer erro aqui e
-- engolido: o inbound nunca pode falhar por causa do descadastro.
-- ---------------------------------------------------------------------------
BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE INDEX IF NOT EXISTS idx_wa_sched_bulk_conv
  ON public.whatsapp_scheduled_messages (conversation_id, sent_at)
  WHERE bulk_send_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_wa_sched_bulk_inst_dia
  ON public.whatsapp_scheduled_messages (instance_id, scheduled_at)
  WHERE bulk_send_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.fn_bulk_optout_da_resposta()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_txt  text;
  v_tel  text;
  v_nome text;
BEGIN
  BEGIN
    v_txt := btrim(regexp_replace(
               translate(lower(NEW.content), 'áàâãéêíóôõúç', 'aaaaeeiooouc'),
               '[^a-z ]', '', 'g'));
    IF v_txt NOT IN ('sair', 'parar', 'pare', 'stop', 'descadastrar', 'descadastre', 'descadastra',
                     'nao quero receber', 'remover', 'me remova', 'me tire da lista', 'sair da lista') THEN
      RETURN NULL;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.whatsapp_scheduled_messages s
       WHERE s.conversation_id = NEW.conversation_id
         AND s.bulk_send_id IS NOT NULL
         AND s.sent_at > now() - interval '30 days'
    ) THEN
      RETURN NULL;
    END IF;
    SELECT ct.phone_number, ct.name INTO v_tel, v_nome
      FROM public.whatsapp_conversations cv
      JOIN public.whatsapp_contacts ct ON ct.id = cv.contact_id
     WHERE cv.id = NEW.conversation_id AND NOT coalesce(cv.is_group, false);
    IF v_tel IS NULL OR length(v_tel) > 13 THEN
      RETURN NULL;
    END IF;
    INSERT INTO public.whatsapp_bulk_optouts (tenant_id, telefone, nome, origem, mensagem)
    VALUES (NEW.tenant_id, public.fn_bulk_chave_tel(v_tel), v_nome, 'resposta', left(NEW.content, 200))
    ON CONFLICT (tenant_id, telefone) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    RAISE LOG '[fn_bulk_optout_da_resposta] msg %: %', NEW.id, SQLERRM;
  END;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_bulk_optout_da_resposta() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_bulk_optout_da_resposta ON public.whatsapp_messages;
CREATE TRIGGER trg_bulk_optout_da_resposta
  AFTER INSERT ON public.whatsapp_messages
  FOR EACH ROW
  WHEN (NOT NEW.is_from_me AND NEW.content IS NOT NULL AND length(NEW.content) <= 30)
  EXECUTE FUNCTION public.fn_bulk_optout_da_resposta();
COMMIT;
