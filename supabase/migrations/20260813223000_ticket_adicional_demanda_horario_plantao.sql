-- ============================================================================
-- Ticket adicional (reabertura) e demanda externa: aceitar os horários de
-- plantão e parar de gravar now()/now().
--
-- Dois defeitos na mesma raiz:
--
-- 1) O modal passou a enviar p_horario_inicio/p_horario_fim em 24/07/2026
--    (commit f7ac102f, no ramo compartilhado do encerramento), mas
--    create_additional_ticket_from_attendance e
--    create_demand_ticket_from_attendance nunca ganharam esses parâmetros.
--    O PostgREST não resolve a função e devolve 404 PGRST202 ANTES de executar
--    — as duas telas estão quebradas desde então. Confirmado em produção em
--    13/08/2026 chamando as RPCs com attendance_id inexistente.
--
-- 2) create_additional_ticket_from_attendance gravava now() nos DOIS campos de
--    plantão, o que dá duração 0 e hoje viola o CHECK
--    support_tickets_horario_coerente (horario_fim > horario_inicio).
--
-- A nota [F2] original ("não se aplica" na reabertura) continua valendo: o
-- ticket adicional NÃO herda a 1ª resposta humana do atendimento original,
-- que pertence ao primeiro ticket. A âncora certa da reabertura é reopened_at.
--
-- Quando não há âncora confiável, os dois campos ficam NULL e o operador
-- preenche na tela — melhor que gravar duração 0 ou barrar a criação do ticket.
--
-- DROP + CREATE (e não CREATE OR REPLACE) porque a lista de argumentos muda:
-- replace criaria uma sobrecarga e o PostgREST ficaria ambíguo. Os GRANTs são
-- refeitos logo abaixo — o DROP leva os antigos junto.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1) create_additional_ticket_from_attendance — reabertura, nasce fechado
-- ----------------------------------------------------------------------------
-- Assinatura antiga (sem os horários) e a nova — derrubar as duas deixa a
-- migration re-executável e garante que não sobre sobrecarga ambígua.
DROP FUNCTION IF EXISTS public.create_additional_ticket_from_attendance(
  uuid, uuid, uuid, uuid, bigint, text, text, text, uuid, uuid);
DROP FUNCTION IF EXISTS public.create_additional_ticket_from_attendance(
  uuid, uuid, uuid, uuid, bigint, text, text, text, uuid, uuid, timestamptz, timestamptz);

CREATE FUNCTION public.create_additional_ticket_from_attendance(
  p_attendance_id      uuid,
  p_category_id        uuid,
  p_subcategory_id     uuid,
  p_service_type_id    uuid,
  p_produto_id         bigint,
  p_tipo_horario       text        DEFAULT NULL,
  p_observacao_agente  text        DEFAULT NULL,
  p_observacao_ia      text        DEFAULT NULL,
  p_department_id      uuid        DEFAULT NULL,
  p_responsavel_user_id uuid       DEFAULT NULL,
  p_horario_inicio     timestamptz DEFAULT NULL,
  p_horario_fim        timestamptz DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_att record;
  v_ticket_id uuid;
  v_status_id uuid;
  v_dept_id uuid;
  v_responsavel uuid;
  v_existing_ticket_id uuid;
  v_tipo text;                                            -- [F1]
  v_ini timestamptz;
  v_fim timestamptz;
BEGIN
  SELECT a.tenant_id, a.cliente_id, a.contact_id, a.department_id, a.assigned_to, a.ticket_id,
         a.attendance_code, a.opened_at,                  -- [F1] (opened_at p/ auto-detecção)
         a.reopened_at, a.closed_at                       -- âncoras do horário de plantão
  INTO v_att
  FROM public.support_attendances a
  WHERE a.id = p_attendance_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Atendimento não encontrado: %', p_attendance_id;
  END IF;

  IF v_uid != v_att.assigned_to AND NOT public.is_admin_or_head() THEN
    RAISE EXCEPTION 'Sem permissão para encerrar este atendimento';
  END IF;

  IF p_horario_inicio IS NOT NULL AND p_horario_fim IS NOT NULL
     AND p_horario_fim <= p_horario_inicio THEN
    RAISE EXCEPTION 'Horário de fim do plantão deve ser posterior ao início';
  END IF;

  v_existing_ticket_id := v_att.ticket_id;
  IF v_existing_ticket_id IS NULL THEN
    SELECT id INTO v_existing_ticket_id
    FROM public.support_tickets
    WHERE attendance_id = p_attendance_id
      AND origem_criacao IS DISTINCT FROM 'demanda_externa'
    LIMIT 1;
  END IF;
  IF v_existing_ticket_id IS NULL THEN
    RAISE EXCEPTION 'Nenhum ticket vinculado ao atendimento. Use create_ticket_from_closure.';
  END IF;

  -- [F1] Auto-detecção pela âncora do atendimento (opened_at)
  v_tipo := COALESCE(
    p_tipo_horario,
    CASE WHEN public.is_within_business_hours(
           v_att.tenant_id, COALESCE(p_department_id, v_att.department_id), v_att.opened_at)
         THEN 'comercial' ELSE 'plantao' END
  );

  -- Horário de plantão: o que o operador digitou manda; sem isso, a âncora é a
  -- REABERTURA (não a 1ª resposta humana — essa é do ticket original, [F2] não
  -- se aplica aqui). Sem âncora coerente, deixa vazio para preencher na tela.
  IF v_tipo = 'plantao' THEN
    v_ini := COALESCE(p_horario_inicio, v_att.reopened_at);
    v_fim := COALESCE(p_horario_fim, v_att.closed_at, now());
    -- Medido em 13/08/2026: 187 das 1.054 reaberturas fecham em menos de 1 min
    -- (reabre e fecha em seguida). Derivar dali gravaria duração 0 de novo, que
    -- é exatamente o defeito que estamos tirando. Se QUALQUER um dos dois campos
    -- foi derivado e a janela é sub-minuto, deixa vazio. Se o operador digitou
    -- os dois, o que ele digitou vale — mesmo que seja curto.
    IF v_ini IS NULL OR v_fim IS NULL OR v_fim <= v_ini
       OR ((p_horario_inicio IS NULL OR p_horario_fim IS NULL)
           AND v_fim - v_ini < interval '1 minute') THEN
      v_ini := NULL;
      v_fim := NULL;
    END IF;
  ELSE
    v_ini := p_horario_inicio;
    v_fim := p_horario_fim;
  END IF;

  v_dept_id := COALESCE(p_department_id, v_att.department_id);
  v_responsavel := COALESCE(p_responsavel_user_id, v_att.assigned_to);

  SELECT id INTO v_status_id
  FROM ticket_statuses
  WHERE tenant_id = v_att.tenant_id
    AND department_id = v_dept_id
    AND is_terminal = true AND is_active = true
  ORDER BY position LIMIT 1;

  INSERT INTO public.support_tickets (
    tenant_id, attendance_id, cliente_id, contact_id, department_id,
    produto_id, category_id, subcategory_id, service_type_id,
    canal_origem, tipo_horario, assunto, descricao, observacao_agente, observacao_ia,
    prioridade, status_id, responsavel_user_id, criado_por, closed_by,
    aberto_em, concluido_em, tipo, horario_inicio, horario_fim
  )
  VALUES (
    v_att.tenant_id, p_attendance_id, v_att.cliente_id, v_att.contact_id, v_dept_id,
    p_produto_id, p_category_id, p_subcategory_id, p_service_type_id,
    'whatsapp', v_tipo,                                   -- [F1]
    (SELECT nome FROM public.service_categories WHERE id = p_category_id),
    (SELECT nome FROM public.service_subcategories WHERE id = p_subcategory_id),
    p_observacao_agente, p_observacao_ia,
    'media'::support_ticket_prioridade, v_status_id,
    v_responsavel, v_uid, v_uid,
    now(), now(), 'cliente'::support_ticket_tipo,
    v_ini, v_fim
  )
  RETURNING id INTO v_ticket_id;

  INSERT INTO public.support_ticket_events (tenant_id, ticket_id, user_id, event_type, content)
  VALUES (
    v_att.tenant_id, v_ticket_id, v_uid, 'comment',
    'Ticket adicional criado a partir do atendimento ' || COALESCE(v_att.attendance_code, '') ||
    ' reaberto. Ticket original: ' || v_existing_ticket_id::text
  );

  INSERT INTO public.support_ticket_events (tenant_id, ticket_id, user_id, event_type, content)
  VALUES (
    v_att.tenant_id, v_existing_ticket_id, v_uid, 'comment',
    'Novo ticket criado a partir de reabertura: ' || v_ticket_id::text
  );

  RETURN v_ticket_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_additional_ticket_from_attendance(
  uuid, uuid, uuid, uuid, bigint, text, text, text, uuid, uuid, timestamptz, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_additional_ticket_from_attendance(
  uuid, uuid, uuid, uuid, bigint, text, text, text, uuid, uuid, timestamptz, timestamptz) TO authenticated, service_role;


-- ----------------------------------------------------------------------------
-- 2) create_demand_ticket_from_attendance — demanda externa, nasce ABERTO
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.create_demand_ticket_from_attendance(
  uuid, uuid, uuid, uuid, bigint, text, text, text, uuid, uuid);
DROP FUNCTION IF EXISTS public.create_demand_ticket_from_attendance(
  uuid, uuid, uuid, uuid, bigint, text, text, text, uuid, uuid, timestamptz, timestamptz);

CREATE FUNCTION public.create_demand_ticket_from_attendance(
  p_attendance_id      uuid,
  p_category_id        uuid,
  p_subcategory_id     uuid,
  p_service_type_id    uuid,
  p_produto_id         bigint,
  p_tipo_horario       text        DEFAULT NULL,
  p_observacao_agente  text        DEFAULT NULL,
  p_observacao_ia      text        DEFAULT NULL,
  p_department_id      uuid        DEFAULT NULL,
  p_responsavel_user_id uuid       DEFAULT NULL,
  p_horario_inicio     timestamptz DEFAULT NULL,
  p_horario_fim        timestamptz DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_att record; v_ticket_id uuid; v_status_id uuid; v_dept_id uuid;
  v_responsavel uuid;
  v_tipo text;                                            -- [F1]
  v_ini timestamptz;
  v_fim timestamptz;
BEGIN
  SELECT a.tenant_id, a.cliente_id, a.contact_id, a.department_id, a.assigned_to,
         a.attendance_code, a.status,
         a.opened_at, a.first_human_response_at           -- [F1]/[F2]
  INTO v_att
  FROM public.support_attendances a
  WHERE a.id = p_attendance_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Atendimento não encontrado: %', p_attendance_id;
  END IF;

  IF v_att.tenant_id <> public.current_tenant_id() AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Sem permissão para abrir ticket neste atendimento';
  END IF;

  IF p_horario_inicio IS NOT NULL AND p_horario_fim IS NOT NULL
     AND p_horario_fim <= p_horario_inicio THEN
    RAISE EXCEPTION 'Horário de fim do plantão deve ser posterior ao início';
  END IF;

  -- [F1] Auto-detecção pela âncora do atendimento (opened_at)
  v_tipo := COALESCE(
    p_tipo_horario,
    CASE WHEN public.is_within_business_hours(
           v_att.tenant_id, COALESCE(p_department_id, v_att.department_id), v_att.opened_at)
         THEN 'comercial' ELSE 'plantao' END
  );

  -- [F2] início = o que o operador digitou, senão 1ª resposta humana
  -- (fallback opened_at). Fim normalmente NULL: o ticket nasce ABERTO.
  IF v_tipo = 'plantao' THEN
    v_ini := COALESCE(p_horario_inicio, v_att.first_human_response_at, v_att.opened_at);
    v_fim := p_horario_fim;
    IF v_fim IS NOT NULL AND (v_ini IS NULL OR v_fim <= v_ini) THEN
      v_fim := NULL;
    END IF;
  ELSE
    v_ini := p_horario_inicio;
    v_fim := p_horario_fim;
  END IF;

  v_dept_id := COALESCE(p_department_id, v_att.department_id);
  v_responsavel := COALESCE(p_responsavel_user_id, v_att.assigned_to, v_uid);

  SELECT id INTO v_status_id
  FROM public.ticket_statuses
  WHERE tenant_id = v_att.tenant_id
    AND department_id = v_dept_id
    AND is_terminal = false AND is_active = true
  ORDER BY position LIMIT 1;

  IF v_status_id IS NULL THEN
    RAISE EXCEPTION 'Nenhum status não-terminal ativo configurado para o departamento';
  END IF;

  INSERT INTO public.support_tickets (
    tenant_id, attendance_id, cliente_id, contact_id, department_id,
    produto_id, category_id, subcategory_id, service_type_id,
    canal_origem, tipo_horario, assunto, descricao, observacao_agente, observacao_ia,
    prioridade, status_id, responsavel_user_id, criado_por,
    aberto_em, tipo, horario_inicio, horario_fim, origem_criacao
  )
  VALUES (
    v_att.tenant_id, p_attendance_id, v_att.cliente_id, v_att.contact_id, v_dept_id,
    p_produto_id, p_category_id, p_subcategory_id, p_service_type_id,
    'whatsapp', v_tipo,                                   -- [F1]
    (SELECT nome FROM public.service_categories WHERE id = p_category_id),
    (SELECT nome FROM public.service_subcategories WHERE id = p_subcategory_id),
    p_observacao_agente, p_observacao_ia,
    'media'::support_ticket_prioridade, v_status_id,
    v_responsavel, v_uid,
    now(), 'cliente'::support_ticket_tipo,
    v_ini, v_fim,
    'demanda_externa'
  )
  RETURNING id INTO v_ticket_id;

  INSERT INTO public.support_ticket_events (tenant_id, ticket_id, user_id, event_type, content)
  VALUES (
    v_att.tenant_id, v_ticket_id, v_uid, 'comment',
    CASE WHEN v_att.status IN ('closed', 'inactive_closed')
      THEN 'Ticket aberto a partir do atendimento ' || COALESCE(v_att.attendance_code, p_attendance_id::text) || ' (já encerrado).'
      ELSE 'Ticket aberto com o atendimento ' || COALESCE(v_att.attendance_code, p_attendance_id::text) || ' em andamento.'
    END
  );

  RETURN v_ticket_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_demand_ticket_from_attendance(
  uuid, uuid, uuid, uuid, bigint, text, text, text, uuid, uuid, timestamptz, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_demand_ticket_from_attendance(
  uuid, uuid, uuid, uuid, bigint, text, text, text, uuid, uuid, timestamptz, timestamptz) TO authenticated, service_role;


-- ----------------------------------------------------------------------------
-- VALIDAÇÃO — rodar depois, deve voltar 2 linhas com assinatura nova e
-- grants em authenticated + service_role. Sobrecarga antiga = 0.
-- ----------------------------------------------------------------------------
-- SELECT p.proname,
--        pg_get_function_identity_arguments(p.oid) AS args,
--        (SELECT array_agg(r.grantee ORDER BY r.grantee)
--           FROM information_schema.routine_privileges r
--          WHERE r.specific_name = p.proname || '_' || p.oid) AS grants
--   FROM pg_proc p
--   JOIN pg_namespace n ON n.oid = p.pronamespace
--  WHERE n.nspname = 'public'
--    AND p.proname IN ('create_additional_ticket_from_attendance',
--                      'create_demand_ticket_from_attendance')
--  ORDER BY 1;
