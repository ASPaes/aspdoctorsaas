-- DEM-0361: a verificacao de disponibilidade nao enxergava o nono digito
--
-- A tela "Iniciar conversa" pergunta ao banco se o contato ja esta em atendimento
-- (wa_check_conversation_availability) e, no caminho Evolution/Z-API, abre a conversa
-- pela wa_open_or_reuse_conversation. As duas procuravam o contato por igualdade
-- EXATA de whatsapp_contacts.phone_number.
--
-- Quem envia nao faz isso: findOrCreateContact (_shared/message-processor.ts, usado
-- pelo send-whatsapp-template e pelos webhooks) procura pelas VARIANTES do numero
-- (phoneSearchVariants, _shared/phone.ts) -- a forma com e a forma sem o 9 do celular.
--
-- Caso do Del Vale: contato salvo no WhatsApp como 55 51 9834-9876 (sem o 9) e
-- cadastrado no sistema como 55 51 99834-9876 (com o 9). A verificacao nao achou
-- contato nenhum, respondeu "disponivel", e o template de cobranca foi entregue
-- dentro da conversa tecnica que ja estava em andamento com outro atendente.
--
-- Aqui o criterio das duas RPCs passa a ser o mesmo do envio. Medido em 05/09/2026:
-- ha 202 linhas em whatsapp_contacts que sao o mesmo telefone com e sem o 9
-- (101 pares) -- todas invisiveis para o bloqueio ate agora.

-- 1) Variantes do telefone em SQL. Espelha phoneSearchVariants de
--    supabase/functions/_shared/phone.ts, inclusive a recusa de gerar variante
--    para fixo (digito apos o DDD entre 2-5): tirar o 9 de um fixo inventa numero.
CREATE OR REPLACE FUNCTION public.fn_wa_phone_variants(p_phone text)
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  WITH d AS (
    SELECT regexp_replace(coalesce(p_phone, ''), '\D', '', 'g') AS p
  )
  SELECT CASE
    WHEN d.p = '' THEN ARRAY[]::text[]
    WHEN left(d.p, 2) <> '55' THEN ARRAY[d.p]
    -- 55 + DDD + 9 digitos comecando em 9 -> tambem procura a forma antiga, sem o 9
    WHEN length(d.p) = 13 AND substr(d.p, 5, 1) = '9' AND substr(d.p, 6, 1) ~ '[6-9]'
      THEN ARRAY[d.p, substr(d.p, 1, 4) || substr(d.p, 6)]
    -- 55 + DDD + 8 digitos de celular antigo -> tambem procura a forma com o 9
    WHEN length(d.p) = 12 AND substr(d.p, 5, 1) ~ '[6-9]'
      THEN ARRAY[d.p, substr(d.p, 1, 4) || '9' || substr(d.p, 5)]
    ELSE ARRAY[d.p]
  END
  FROM d;
$function$;

REVOKE ALL ON FUNCTION public.fn_wa_phone_variants(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_wa_phone_variants(text) TO authenticated, service_role;


-- 2) Verificacao de disponibilidade: procura por variantes.
--    O mesmo telefone pode ter 2 linhas em whatsapp_contacts (com e sem o 9) e,
--    portanto, 2 conversas na mesma instancia. A que importa e a OCUPADA -- por
--    isso a ordenacao antes do LIMIT 1, e nao "a primeira que aparecer".
CREATE OR REPLACE FUNCTION public.wa_check_conversation_availability(p_tenant_id uuid, p_instance_id uuid, p_phone text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid          uuid := (SELECT auth.uid());
  v_variants     text[];
  v_conv_id      uuid;
  v_att_id       uuid;
  v_att_assigned uuid;
  v_tech_name    text;
BEGIN
  IF NOT (
    public.is_super_admin()
    OR (public.is_tenant_active_member() AND p_tenant_id = public.current_tenant_id())
  ) THEN
    RETURN jsonb_build_object('occupied', false);
  END IF;

  IF p_tenant_id IS NULL OR p_instance_id IS NULL
     OR p_phone IS NULL OR length(btrim(p_phone)) = 0 THEN
    RETURN jsonb_build_object('occupied', false);
  END IF;

  v_variants := public.fn_wa_phone_variants(p_phone);
  IF coalesce(array_length(v_variants, 1), 0) = 0 THEN
    RETURN jsonb_build_object('occupied', false);
  END IF;

  SELECT conv.id, att.id, att.assigned_to
    INTO v_conv_id, v_att_id, v_att_assigned
  FROM public.whatsapp_conversations conv
  JOIN public.whatsapp_contacts ct
    ON ct.id = conv.contact_id
   AND ct.tenant_id = p_tenant_id
   AND ct.phone_number = ANY (v_variants)
  LEFT JOIN LATERAL (
    SELECT sa.id, sa.assigned_to
    FROM public.support_attendances sa
    WHERE sa.conversation_id = conv.id
      AND sa.status IN ('waiting', 'in_progress')
    ORDER BY sa.created_at DESC
    LIMIT 1
  ) att ON true
  WHERE conv.tenant_id = p_tenant_id
    AND conv.instance_id = p_instance_id
  ORDER BY
    (att.assigned_to IS NOT NULL AND att.assigned_to IS DISTINCT FROM v_uid) DESC,
    (att.assigned_to IS NOT NULL AND att.assigned_to IS NOT DISTINCT FROM v_uid) DESC,
    (ct.phone_number = p_phone) DESC,
    conv.last_message_at DESC NULLS LAST
  LIMIT 1;

  IF v_conv_id IS NULL THEN
    RETURN jsonb_build_object('occupied', false);
  END IF;

  -- Sem atendimento ativo OU fila sem dono => disponivel (mesma regra da RPC de criacao)
  IF v_att_id IS NULL OR v_att_assigned IS NULL THEN
    RETURN jsonb_build_object('occupied', false, 'conversation_id', v_conv_id);
  END IF;

  -- Atendimento do proprio usuario => abre direto (nao bloqueia)
  IF v_att_assigned = v_uid THEN
    RETURN jsonb_build_object('occupied', true, 'is_own', true, 'conversation_id', v_conv_id);
  END IF;

  -- Atendimento com OUTRO agente => bloqueia, devolve o nome
  SELECT f.nome INTO v_tech_name
  FROM public.profiles pr
  JOIN public.funcionarios f ON f.id = pr.funcionario_id
  WHERE pr.user_id = v_att_assigned
  LIMIT 1;

  RETURN jsonb_build_object(
    'occupied', true,
    'is_own', false,
    'tech_name', COALESCE(v_tech_name, 'outro atendente'),
    'conversation_id', v_conv_id
  );
END;
$function$;


-- 3) Abertura/reuso da conversa: mesmo criterio.
--    Esta e a RPC que de fato barra o inicio (status 'blocked') no caminho
--    Evolution/Z-API -- a verificacao acima e so a tela. Se ela continuasse
--    procurando por igualdade exata, o bloqueio seguiria furado por ali, e ainda
--    nasceria um contato duplicado a cada conversa aberta pela outra forma do numero.
CREATE OR REPLACE FUNCTION public.wa_open_or_reuse_conversation(p_tenant_id uuid, p_instance_id uuid, p_phone text, p_contact_name text DEFAULT NULL::text, p_cliente_id uuid DEFAULT NULL::uuid, p_department_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid           uuid := (SELECT auth.uid());
  v_variants      text[];
  v_phone         text;
  v_contact_id    uuid;
  v_conv_id       uuid;
  v_conv_status   text;
  v_conv_assigned uuid;
  v_conv_cliente  text;
  v_att_id        uuid;
  v_att_assigned  uuid;
  v_tech_name     text;
  v_user_dept     uuid;
BEGIN
  -- Authorization (espelha a RLS): membro ativo do tenant OU super admin
  IF NOT (
    public.is_super_admin()
    OR (public.is_tenant_active_member() AND p_tenant_id = public.current_tenant_id())
  ) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  IF p_tenant_id IS NULL OR p_instance_id IS NULL
     OR p_phone IS NULL OR length(btrim(p_phone)) = 0 THEN
    RAISE EXCEPTION 'missing_params';
  END IF;

  v_variants := public.fn_wa_phone_variants(p_phone);
  IF coalesce(array_length(v_variants, 1), 0) = 0 THEN
    RAISE EXCEPTION 'missing_params';
  END IF;
  v_phone := v_variants[1];  -- so digitos, forma canonica do que foi pedido

  -- 1) Conversa desta instancia para QUALQUER variante do telefone.
  --    Sem a cegueira da RLS (definer enxerga a verdade do tenant) e, entre as
  --    duas linhas possiveis do mesmo numero, a ocupada vem primeiro.
  SELECT conv.id, conv.status, conv.assigned_to, conv.metadata->>'cliente_id',
         conv.contact_id, att.id, att.assigned_to
    INTO v_conv_id, v_conv_status, v_conv_assigned, v_conv_cliente,
         v_contact_id, v_att_id, v_att_assigned
  FROM public.whatsapp_conversations conv
  JOIN public.whatsapp_contacts ct
    ON ct.id = conv.contact_id
   AND ct.tenant_id = p_tenant_id
   AND ct.phone_number = ANY (v_variants)
  LEFT JOIN LATERAL (
    SELECT sa.id, sa.assigned_to
    FROM public.support_attendances sa
    WHERE sa.conversation_id = conv.id
      AND sa.status IN ('waiting', 'in_progress')
    ORDER BY sa.created_at DESC
    LIMIT 1
  ) att ON true
  WHERE conv.tenant_id = p_tenant_id
    AND conv.instance_id = p_instance_id
  ORDER BY
    (att.assigned_to IS NOT NULL AND att.assigned_to IS DISTINCT FROM v_uid) DESC,
    (att.assigned_to IS NOT NULL AND att.assigned_to IS NOT DISTINCT FROM v_uid) DESC,
    (ct.phone_number = v_phone) DESC,
    conv.last_message_at DESC NULLS LAST
  LIMIT 1;

  -- 2) Conversa ja existe -> decidir bloqueio / reuso
  IF v_conv_id IS NOT NULL THEN
    IF p_contact_name IS NOT NULL AND btrim(p_contact_name) <> '' AND p_contact_name <> v_phone THEN
      UPDATE public.whatsapp_contacts
      SET name = p_contact_name
      WHERE id = v_contact_id AND (name IS NULL OR name = phone_number);
    END IF;

    -- BLOQUEIO: em atendimento com OUTRO agente -> nao abre, so avisa
    IF v_att_id IS NOT NULL AND v_att_assigned IS NOT NULL AND v_att_assigned <> v_uid THEN
      SELECT f.nome INTO v_tech_name
      FROM public.profiles pr
      JOIN public.funcionarios f ON f.id = pr.funcionario_id
      WHERE pr.user_id = v_att_assigned
      LIMIT 1;

      RETURN jsonb_build_object(
        'status', 'blocked',
        'conversation_id', v_conv_id,
        'tech_name', COALESCE(v_tech_name, 'outro atendente')
      );
    END IF;

    -- Ja e atendimento do proprio user -> so abre
    IF v_att_id IS NOT NULL AND v_att_assigned = v_uid THEN
      RETURN jsonb_build_object('status', 'reused', 'conversation_id', v_conv_id);
    END IF;

    -- DISPONIVEL: reabre + assume (assigned_to dispara o trigger que migra o setor)
    IF v_conv_status <> 'active' OR v_conv_assigned IS DISTINCT FROM v_uid THEN
      UPDATE public.whatsapp_conversations
      SET status = 'active',
          assigned_to = v_uid,
          unread_count = 0
      WHERE id = v_conv_id;
    END IF;

    IF p_cliente_id IS NOT NULL AND v_conv_cliente IS NULL THEN
      UPDATE public.whatsapp_conversations
      SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('cliente_id', p_cliente_id::text)
      WHERE id = v_conv_id;
    END IF;

    RETURN jsonb_build_object('status', 'reused', 'conversation_id', v_conv_id);
  END IF;

  -- 3) Sem conversa nesta instancia -> find-or-create do contato (race-safe via
  --    unique_violation). Reaproveitar a linha da outra variante e o que impede
  --    o par duplicado de nascer.
  SELECT id INTO v_contact_id
  FROM public.whatsapp_contacts
  WHERE tenant_id = p_tenant_id
    AND phone_number = ANY (v_variants)
  ORDER BY (phone_number = v_phone) DESC, created_at ASC
  LIMIT 1;

  IF v_contact_id IS NULL THEN
    BEGIN
      INSERT INTO public.whatsapp_contacts (tenant_id, phone_number, name, instance_id)
      VALUES (p_tenant_id, v_phone, COALESCE(NULLIF(btrim(p_contact_name), ''), v_phone), p_instance_id)
      RETURNING id INTO v_contact_id;
    EXCEPTION WHEN unique_violation THEN
      SELECT id INTO v_contact_id
      FROM public.whatsapp_contacts
      WHERE tenant_id = p_tenant_id
        AND phone_number = ANY (v_variants)
      ORDER BY (phone_number = v_phone) DESC, created_at ASC
      LIMIT 1;
    END;
  ELSIF p_contact_name IS NOT NULL AND btrim(p_contact_name) <> '' AND p_contact_name <> v_phone THEN
    UPDATE public.whatsapp_contacts
    SET name = p_contact_name
    WHERE id = v_contact_id AND (name IS NULL OR name = phone_number);
  END IF;

  -- 4) Cria a conversa.
  -- Espelha o caminho de REUSO acima: quem abre o chat assume o chat, no PROPRIO setor.
  -- Antes: inseria sem assigned_to e o setor era derivado da INSTANCIA
  -- (trg_auto_dept_by_instance) -> o chat nascia no setor de entrada e sumia da vista
  -- de quem abriu (RLS por department_id), indo parar no dispatch de outro setor.
  -- Precedencia do setor: filtro explicito > setor de quem abriu > instancia (fallback).
  SELECT f.department_id INTO v_user_dept
  FROM public.profiles p
  JOIN public.funcionarios f ON f.id = p.funcionario_id AND f.tenant_id = p_tenant_id
  WHERE p.user_id = v_uid;

  INSERT INTO public.whatsapp_conversations (
    tenant_id, instance_id, contact_id, status, unread_count, metadata, department_id, assigned_to
  ) VALUES (
    p_tenant_id, p_instance_id, v_contact_id, 'active', 0,
    CASE WHEN p_cliente_id IS NOT NULL
         THEN jsonb_build_object('cliente_id', p_cliente_id::text)
         ELSE '{}'::jsonb END,
    COALESCE(p_department_id, v_user_dept),
    v_uid
  )
  RETURNING id INTO v_conv_id;

  RETURN jsonb_build_object('status', 'created', 'conversation_id', v_conv_id);
END;
$function$;
