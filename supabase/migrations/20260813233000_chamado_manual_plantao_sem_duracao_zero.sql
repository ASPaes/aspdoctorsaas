-- ============================================================================
-- Chamado manual de plantão: parar de nascer com duração 0 (ou de dar erro).
--
-- Regra antiga:
--   v_horario_inicio := COALESCE(p_horario_inicio, now());
--   IF v_is_terminal AND v_horario_fim IS NULL THEN v_horario_fim := now(); END IF;
--
-- Quando o chamado manual de plantão é criado JÁ FINALIZADO e o operador não
-- digita nenhum dos dois horários, os dois viram now() no mesmo instante:
-- duração 0. Foi assim que nasceram TK-2026-0276 e TK-2026-0543. Hoje o CHECK
-- support_tickets_horario_coerente (horario_fim > horario_inicio) barra isso,
-- então o operador leva um erro de constraint na tela em vez de gravar zero —
-- os dois defeitos são a mesma linha de código.
--
-- Regra nova: o auto-preenchimento continua, mas se a janela resultante for
-- derivada (pelo menos um dos lados não foi digitado) e menor que 1 minuto,
-- os dois campos ficam vazios para o operador preencher. Chamado de plantão
-- criado ABERTO segue como era: início = agora, fim vazio até encerrar.
--
-- Assinatura inalterada -> CREATE OR REPLACE, os GRANTs continuam de pé.
-- Corpo copiado da produção (dump de 13/08/2026); só o bloco de horário mudou.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.create_manual_ticket(
  p_cliente_id uuid, p_produto_id bigint, p_category_id uuid, p_subcategory_id uuid,
  p_service_type_id uuid, p_canal_origem text, p_department_id uuid,
  p_status_id uuid DEFAULT NULL, p_tipo_horario text DEFAULT NULL,
  p_observacao_agente text DEFAULT NULL, p_agendado_para timestamptz DEFAULT NULL,
  p_contact_id uuid DEFAULT NULL, p_responsavel_user_id uuid DEFAULT NULL,
  p_cliente_contato_id uuid DEFAULT NULL, p_previsao_encerramento timestamptz DEFAULT NULL,
  p_horario_inicio timestamptz DEFAULT NULL, p_horario_fim timestamptz DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid            uuid := auth.uid();
  v_profile_tenant uuid;
  v_tenant_id      uuid;
  v_ticket_id      uuid;
  v_responsavel    uuid;
  v_final_status_id uuid;
  v_is_terminal    boolean := false;
  v_tipo           text;
  v_horario_inicio timestamptz;
  v_horario_fim    timestamptz;
BEGIN
  SELECT p.tenant_id INTO v_profile_tenant
  FROM public.profiles p WHERE p.user_id = v_uid;

  IF v_profile_tenant IS NULL THEN
    RAISE EXCEPTION 'Usuário sem tenant';
  END IF;

  SELECT c.tenant_id INTO v_tenant_id FROM public.clientes c WHERE c.id = p_cliente_id;
  IF v_tenant_id IS NULL AND p_department_id IS NOT NULL THEN
    SELECT d.tenant_id INTO v_tenant_id FROM public.support_departments d WHERE d.id = p_department_id;
  END IF;
  v_tenant_id := COALESCE(v_tenant_id, v_profile_tenant);

  IF v_tenant_id <> v_profile_tenant AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Sem permissão para criar ticket neste tenant';
  END IF;

  IF p_canal_origem NOT IN ('whatsapp', 'telefone', 'presencial', 'email') THEN
    RAISE EXCEPTION 'Canal inválido: %', p_canal_origem;
  END IF;

  -- Validação de coerência dos horários de plantão
  IF p_horario_inicio IS NOT NULL AND p_horario_fim IS NOT NULL
     AND p_horario_fim <= p_horario_inicio THEN
    RAISE EXCEPTION 'Horário de fim do plantão deve ser posterior ao início';
  END IF;

  IF p_horario_fim IS NOT NULL AND p_horario_fim > now() + interval '5 minutes' THEN
    RAISE EXCEPTION 'Horário de fim do plantão não pode estar no futuro';
  END IF;

  IF p_horario_inicio IS NOT NULL AND p_horario_inicio > now() + interval '5 minutes' THEN
    RAISE EXCEPTION 'Horário de início do plantão não pode estar no futuro';
  END IF;

  v_tipo := COALESCE(
    p_tipo_horario,
    CASE WHEN public.is_within_business_hours(v_tenant_id, p_department_id, now())
         THEN 'comercial' ELSE 'plantao' END
  );

  v_responsavel := COALESCE(p_responsavel_user_id, v_uid);

  IF p_status_id IS NOT NULL THEN
    v_final_status_id := p_status_id;
    SELECT ts.is_terminal INTO v_is_terminal FROM ticket_statuses ts WHERE ts.id = v_final_status_id;
  ELSIF p_department_id IS NOT NULL THEN
    SELECT id INTO v_final_status_id
    FROM ticket_statuses
    WHERE tenant_id = v_tenant_id AND department_id = p_department_id
      AND is_initial = true AND is_active = true
    ORDER BY position LIMIT 1;
  END IF;

  IF v_tipo = 'plantao' THEN
    v_horario_inicio := COALESCE(p_horario_inicio, now());
    v_horario_fim := p_horario_fim;
    IF v_is_terminal AND v_horario_fim IS NULL THEN
      v_horario_fim := now();
    END IF;

    -- Nasce fechado sem o operador ter digitado: os dois lados caem em now() e
    -- a duração sai 0 (e o CHECK barra). Melhor entregar o chamado com os
    -- horários em branco para ele preencher do que zero ou erro na tela.
    IF v_horario_inicio IS NOT NULL AND v_horario_fim IS NOT NULL
       AND (p_horario_inicio IS NULL OR p_horario_fim IS NULL)
       AND v_horario_fim - v_horario_inicio < interval '1 minute' THEN
      v_horario_inicio := NULL;
      v_horario_fim    := NULL;
    END IF;
  ELSE
    v_horario_inicio := p_horario_inicio;
    v_horario_fim := p_horario_fim;
  END IF;

  INSERT INTO public.support_tickets (
    tenant_id, cliente_id, contact_id, department_id,
    produto_id, category_id, subcategory_id, service_type_id,
    canal_origem, tipo_horario,
    assunto, descricao, observacao_agente,
    prioridade, status_id,
    responsavel_user_id, criado_por,
    aberto_em, agendado_para,
    concluido_em, closed_by, tipo,
    cliente_contato_id, previsao_encerramento,
    horario_inicio, horario_fim
  )
  VALUES (
    v_tenant_id, p_cliente_id, p_contact_id, p_department_id,
    p_produto_id, p_category_id, p_subcategory_id, p_service_type_id,
    p_canal_origem, v_tipo,
    (SELECT nome FROM public.service_categories WHERE id = p_category_id),
    (SELECT nome FROM public.service_subcategories WHERE id = p_subcategory_id),
    p_observacao_agente,
    'media'::support_ticket_prioridade,
    v_final_status_id,
    v_responsavel, v_uid,
    now(), p_agendado_para,
    CASE WHEN v_is_terminal THEN now() ELSE NULL END,
    CASE WHEN v_is_terminal THEN v_uid ELSE NULL END,
    'cliente'::support_ticket_tipo,
    p_cliente_contato_id, p_previsao_encerramento,
    v_horario_inicio, v_horario_fim
  )
  RETURNING id INTO v_ticket_id;

  RETURN v_ticket_id;
END;
$function$;
