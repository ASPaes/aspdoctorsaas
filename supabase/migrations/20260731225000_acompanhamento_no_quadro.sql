-- O ticket de acompanhamento vive no quadro da jornada de Acompanhamento.
--
-- Decisão do owner (31/07): o acompanhamento não fica escondido na lista de Tickets — ele é um
-- cartão nas colunas da jornada de Acompanhamento (Primeiras semanas → Uso em ritmo → Cliente
-- destravado), como qualquer outro quadro do módulo.
--
-- O cartão é o TICKET, não uma jornada: por isso a etapa mora no próprio ticket, e não em
-- onboarding_journeys. A aba de Acompanhamento passa a ler daqui.

ALTER TABLE public.support_tickets
  ADD COLUMN IF NOT EXISTS acompanhamento_stage_id uuid
    REFERENCES public.onboarding_stages(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.support_tickets.acompanhamento_stage_id IS
  'Etapa do ticket no quadro da jornada de Acompanhamento. Só faz sentido com is_acompanhamento.';

CREATE INDEX IF NOT EXISTS idx_tickets_acomp_stage
  ON public.support_tickets (tenant_id, acompanhamento_stage_id)
  WHERE is_acompanhamento;

-- ─────────────────────────────────────────────────────────────────────────────
-- Primeira etapa da jornada de Acompanhamento do tenant
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_acompanhamento_first_stage(p_tenant_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT s.id
    FROM public.onboarding_stages s
    JOIN public.onboarding_pipelines p ON p.id = s.pipeline_id
    JOIN public.onboarding_phases f ON f.id = p.phase_id
   WHERE f.tenant_id = p_tenant_id AND f.slug = 'acompanhamento' AND f.ativo
     AND p.ativo AND s.ativo
   ORDER BY p.position, s.is_initial DESC, s.position
   LIMIT 1
$function$;

REVOKE ALL ON FUNCTION public.fn_acompanhamento_first_stage(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_acompanhamento_first_stage(uuid) TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- O ticket nasce na primeira coluna do quadro
-- ─────────────────────────────────────────────────────────────────────────────
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
  v_existente uuid; v_ticket uuid; v_cliente_nome text; v_unidade bigint; v_dept uuid; v_stage uuid;
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

  v_stage := public.fn_acompanhamento_first_stage(p_tenant_id);

  INSERT INTO public.support_tickets
    (tenant_id, cliente_id, assunto, descricao, contexto, canal_origem, origem_criacao,
     unidade_base_id, department_id, is_acompanhamento, acompanhamento_stage_id, criado_por)
  VALUES
    (p_tenant_id, p_cliente_id,
     'Acompanhamento de uso — ' || COALESCE(v_cliente_nome, 'cliente'),
     p_motivo, 'onboarding', 'whatsapp',
     CASE WHEN p_origem_ticket_id IS NULL THEN 'acompanhamento_manual' ELSE 'acompanhamento_auto' END,
     v_unidade, v_dept, true, v_stage, auth.uid())
  RETURNING id INTO v_ticket;

  INSERT INTO public.support_ticket_events (tenant_id, ticket_id, user_id, event_type, content)
  VALUES (p_tenant_id, v_ticket, auth.uid(), 'acompanhamento_aberto',
          COALESCE(p_motivo, 'Acompanhamento de uso aberto'));

  RETURN jsonb_build_object('ok', true, 'ticket_id', v_ticket, 'stage_id', v_stage);
END $function$;

REVOKE ALL ON FUNCTION public.fn_create_acompanhamento_ticket(uuid, uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_create_acompanhamento_ticket(uuid, uuid, uuid, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.fn_create_acompanhamento_ticket(uuid, uuid, uuid, text) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- Arrastar o cartão entre as colunas
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.move_acompanhamento_stage(
  p_ticket_id uuid,
  p_stage_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_tenant uuid; v_is_acomp boolean; v_de text; v_para text;
BEGIN
  SELECT tk.tenant_id, tk.is_acompanhamento INTO v_tenant, v_is_acomp
    FROM public.support_tickets tk WHERE tk.id = p_ticket_id;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'ticket nao encontrado'; END IF;
  IF NOT public.can_access_tenant_row(v_tenant) THEN RAISE EXCEPTION 'sem permissao'; END IF;
  IF NOT COALESCE(v_is_acomp, false) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'nao_e_acompanhamento');
  END IF;

  -- a etapa destino tem que ser da jornada de Acompanhamento DESTE tenant
  IF NOT EXISTS (
    SELECT 1 FROM public.onboarding_stages s
      JOIN public.onboarding_pipelines p ON p.id = s.pipeline_id
      JOIN public.onboarding_phases f ON f.id = p.phase_id
     WHERE s.id = p_stage_id AND f.tenant_id = v_tenant AND f.slug = 'acompanhamento'
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'etapa_invalida');
  END IF;

  SELECT s.nome INTO v_de FROM public.onboarding_stages s
    JOIN public.support_tickets tk ON tk.acompanhamento_stage_id = s.id
   WHERE tk.id = p_ticket_id;
  SELECT nome INTO v_para FROM public.onboarding_stages WHERE id = p_stage_id;

  UPDATE public.support_tickets
     SET acompanhamento_stage_id = p_stage_id, atualizado_em = now()
   WHERE id = p_ticket_id;

  INSERT INTO public.support_ticket_events (tenant_id, ticket_id, user_id, event_type, content, old_value, new_value)
  VALUES (v_tenant, p_ticket_id, auth.uid(), 'acompanhamento_mudou_etapa',
          COALESCE(v_de, '—') || ' → ' || v_para, v_de, v_para);

  RETURN jsonb_build_object('ok', true, 'stage_id', p_stage_id);
END $function$;

REVOKE ALL ON FUNCTION public.move_acompanhamento_stage(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.move_acompanhamento_stage(uuid, uuid) TO authenticated, service_role;

-- backfill: o que já existe entra na primeira coluna
UPDATE public.support_tickets tk
   SET acompanhamento_stage_id = public.fn_acompanhamento_first_stage(tk.tenant_id)
 WHERE tk.is_acompanhamento AND tk.acompanhamento_stage_id IS NULL;
