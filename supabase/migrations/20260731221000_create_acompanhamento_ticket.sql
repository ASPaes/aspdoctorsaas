-- Abre o ticket livre de acompanhamento do cliente.
--
-- Duas funções de propósito: a interna é chamada pelo trigger do encerramento, que pode rodar sob
-- service_role/postgres, onde can_access_tenant_row é false — com a guarda dentro, a automação
-- derrubaria o próprio go-live.

CREATE OR REPLACE FUNCTION public.fn_create_acompanhamento_ticket(
  p_tenant_id uuid,
  p_cliente_id uuid,
  p_origem_ticket_id uuid DEFAULT NULL,
  p_motivo text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_existente uuid; v_ticket uuid; v_cliente_nome text; v_unidade bigint; v_dept uuid;
BEGIN
  -- um acompanhamento aberto por cliente
  SELECT tk.id INTO v_existente FROM public.support_tickets tk
   WHERE tk.tenant_id = p_tenant_id AND tk.cliente_id = p_cliente_id
     AND tk.is_acompanhamento AND tk.concluido_em IS NULL AND tk.deleted_at IS NULL
   ORDER BY tk.aberto_em DESC LIMIT 1;

  IF v_existente IS NOT NULL THEN
    INSERT INTO public.support_ticket_events (tenant_id, ticket_id, user_id, event_type, content)
    VALUES (p_tenant_id, v_existente, auth.uid(), 'acompanhamento_reforco',
            COALESCE(p_motivo, 'Novo pedido de acompanhamento para um cliente que já está sendo acompanhado'));
    RETURN jsonb_build_object('ok', false, 'reason', 'ja_existe', 'ticket_id', v_existente);
  END IF;

  -- a unidade vem do CLIENTE, nunca do ticket de origem
  SELECT COALESCE(c.nome_fantasia, c.razao_social), c.unidade_base_id
    INTO v_cliente_nome, v_unidade
    FROM public.clientes c WHERE c.id = p_cliente_id;

  SELECT tk.department_id INTO v_dept FROM public.support_tickets tk WHERE tk.id = p_origem_ticket_id;

  INSERT INTO public.support_tickets
    (tenant_id, cliente_id, assunto, descricao, contexto, canal_origem, origem_criacao,
     unidade_base_id, department_id, is_acompanhamento, criado_por)
  VALUES
    (p_tenant_id, p_cliente_id,
     'Acompanhamento de uso — ' || COALESCE(v_cliente_nome, 'cliente'),
     p_motivo, 'onboarding', 'whatsapp',
     CASE WHEN p_origem_ticket_id IS NULL THEN 'acompanhamento_manual' ELSE 'acompanhamento_auto' END,
     v_unidade, v_dept, true, auth.uid())
  RETURNING id INTO v_ticket;

  INSERT INTO public.support_ticket_events (tenant_id, ticket_id, user_id, event_type, content)
  VALUES (p_tenant_id, v_ticket, auth.uid(), 'acompanhamento_aberto',
          COALESCE(p_motivo, 'Acompanhamento de uso aberto'));

  RETURN jsonb_build_object('ok', true, 'ticket_id', v_ticket);
END $function$;

REVOKE ALL ON FUNCTION public.fn_create_acompanhamento_ticket(uuid, uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_create_acompanhamento_ticket(uuid, uuid, uuid, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.fn_create_acompanhamento_ticket(uuid, uuid, uuid, text) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- A pública: mesma coisa, com guarda de tenant por dentro.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_acompanhamento_ticket(
  p_tenant_id uuid,
  p_cliente_id uuid,
  p_origem_ticket_id uuid DEFAULT NULL,
  p_motivo text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.can_access_tenant_row(p_tenant_id) THEN
    RAISE EXCEPTION 'sem permissao para este tenant';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.clientes c
                  WHERE c.id = p_cliente_id AND c.tenant_id = p_tenant_id) THEN
    RAISE EXCEPTION 'cliente nao pertence a este tenant';
  END IF;
  RETURN public.fn_create_acompanhamento_ticket(p_tenant_id, p_cliente_id, p_origem_ticket_id, p_motivo);
END $function$;

REVOKE ALL ON FUNCTION public.create_acompanhamento_ticket(uuid, uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_acompanhamento_ticket(uuid, uuid, uuid, text)
  TO authenticated, service_role;
