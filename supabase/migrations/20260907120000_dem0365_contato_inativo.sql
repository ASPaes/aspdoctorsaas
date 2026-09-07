-- DEM-0365 — Inativacao de contato de WhatsApp
--
-- Contato inativo some da busca do diretorio e da criacao de conversa nova.
-- Nada e apagado: conversas, mensagens, atendimentos e CSAT continuam intactos
-- e acessiveis pela lista de conversas e pelo historico do proprio contato.
--
-- NAO ha CI de migrations neste projeto: aplicar no SQL Editor.

-- ---------------------------------------------------------------------------
-- 1) Colunas
-- ---------------------------------------------------------------------------
-- 10.773 linhas e DEFAULT constante (PG >= 11 nao reescreve a tabela), mas o
-- webhook escreve aqui o tempo todo: o lock_timeout impede o ALTER de ficar
-- preso na fila de lock e travar a ingestao de mensagem.
SET lock_timeout = '3s';

ALTER TABLE public.whatsapp_contacts
  ADD COLUMN IF NOT EXISTS is_active          boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS inactivated_at     timestamptz,
  ADD COLUMN IF NOT EXISTS inactivated_by     uuid,
  ADD COLUMN IF NOT EXISTS inactivated_reason text;

RESET lock_timeout;

COMMENT ON COLUMN public.whatsapp_contacts.is_active IS
  'false = contato inativo (DEM-0365): fora da busca do diretorio e da abertura de conversa. Historico preservado.';

-- Parcial em is_active = false: a esmagadora maioria das linhas e ativa, entao
-- so a consulta "mostrar os inativos" ganha indice. O filtro is_active = true
-- do dia a dia continua sendo checagem de linha, sem custo relevante.
CREATE INDEX IF NOT EXISTS idx_whatsapp_contacts_tenant_inactive
  ON public.whatsapp_contacts (tenant_id)
  WHERE is_active = false;

-- ---------------------------------------------------------------------------
-- 2) RPC de alternancia
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_wa_contact_active(
  p_contact_id uuid,
  p_active     boolean,
  p_reason     text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_tenant uuid;
  v_uid    uuid := public.fn_acting_user();
BEGIN
  IF p_contact_id IS NULL OR p_active IS NULL THEN
    RAISE EXCEPTION 'missing_params';
  END IF;

  SELECT tenant_id INTO v_tenant
  FROM public.whatsapp_contacts
  WHERE id = p_contact_id;

  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'contact_not_found';
  END IF;

  -- COALESCE obrigatorio: is_super_admin() devolve NULL para quem nao tem
  -- profile, e "IF NOT NULL" nao dispara — o portao abriria sozinho.
  IF NOT COALESCE(
       public.is_super_admin()
       OR (public.is_tenant_active_member() AND v_tenant = public.current_tenant_id()),
       false
     ) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  UPDATE public.whatsapp_contacts
  SET is_active          = p_active,
      inactivated_at     = CASE WHEN p_active THEN NULL ELSE now() END,
      -- fn_acting_user(): sob service_role auth.uid() e NULL e a autoria
      -- nasceria orfa sem erro nenhum.
      inactivated_by     = CASE WHEN p_active THEN NULL ELSE v_uid END,
      inactivated_reason = CASE WHEN p_active THEN NULL ELSE NULLIF(btrim(p_reason), '') END
  WHERE id = p_contact_id;

  RETURN jsonb_build_object('contact_id', p_contact_id, 'is_active', p_active);
END;
$function$;

REVOKE ALL ON FUNCTION public.set_wa_contact_active(uuid, boolean, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_wa_contact_active(uuid, boolean, text) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3) Portao na abertura de conversa
-- ---------------------------------------------------------------------------
-- Corpo identico ao de producao lido em 07/09/2026, com UMA mudanca: o contato
-- inativo devolve status 'inactive_contact' em vez de abrir/reusar conversa.
-- Contato novo nasce ativo, entao o caminho de criacao nunca e barrado por isso.
CREATE OR REPLACE FUNCTION public.wa_open_or_reuse_conversation(
  p_tenant_id uuid,
  p_instance_id uuid,
  p_phone text,
  p_contact_name text DEFAULT NULL::text,
  p_cliente_id uuid DEFAULT NULL::uuid,
  p_department_id uuid DEFAULT NULL::uuid
)
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
  v_contact_active boolean;
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
         conv.contact_id, ct.is_active, att.id, att.assigned_to
    INTO v_conv_id, v_conv_status, v_conv_assigned, v_conv_cliente,
         v_contact_id, v_contact_active, v_att_id, v_att_assigned
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
    -- DEM-0365: contato inativo nao abre nem retoma conversa. Antes de qualquer
    -- escrita — inclusive a do nome logo abaixo.
    IF NOT COALESCE(v_contact_active, true) THEN
      RETURN jsonb_build_object(
        'status', 'inactive_contact',
        'conversation_id', v_conv_id,
        'contact_id', v_contact_id
      );
    END IF;

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
  SELECT id, is_active INTO v_contact_id, v_contact_active
  FROM public.whatsapp_contacts
  WHERE tenant_id = p_tenant_id
    AND phone_number = ANY (v_variants)
  ORDER BY (phone_number = v_phone) DESC, created_at ASC
  LIMIT 1;

  -- DEM-0365: o contato existe e esta inativo -> nao cria conversa nova.
  IF v_contact_id IS NOT NULL AND NOT COALESCE(v_contact_active, true) THEN
    RETURN jsonb_build_object('status', 'inactive_contact', 'contact_id', v_contact_id);
  END IF;

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
