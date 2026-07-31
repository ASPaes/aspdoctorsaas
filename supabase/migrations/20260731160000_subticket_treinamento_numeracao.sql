-- Sub-tickets de treinamento: numeração derivada do ticket pai
--
-- Hoje o filho recebe um número solto da fila geral (TK-2026-2360 gerou TK-2026-2461,
-- TK-2026-2545, TK-2026-2546) e o operador digita o código do pai dentro do assunto para
-- não perder o vínculo. Passa a ser TK-2026-2360-1 / -2 / -3.
--
-- Etapa 1 de 7 do design em
-- docs/superpowers/specs/2026-07-31-onboarding-subtickets-treinamento-por-responsavel-design.md
--
-- Aditivo: next_ticket_code() não é tocada. support_ticket_validate() só gera código quando
-- vem NULL, então passar o código derivado explicitamente convive com o gerador existente.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Colunas
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.support_tickets
  ADD COLUMN IF NOT EXISTS sub_seq      smallint,
  ADD COLUMN IF NOT EXISTS sub_seq_last smallint NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.support_tickets.sub_seq IS
  'Posição do sub-ticket dentro do pai (sufixo do ticket_code). NULL em ticket normal.';
COMMENT ON COLUMN public.support_tickets.sub_seq_last IS
  'Contador de filhos já criados, mantido NO PAI. Nunca decrementa: apagar o -2 não faz o próximo filho nascer -2 de novo.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Índices
--    Verificado antes de criar: 2.966 tickets, 2.966 pares (tenant_id, ticket_code)
--    distintos. Hoje só existe idx_support_tickets_code, um btree comum.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE UNIQUE INDEX IF NOT EXISTS ux_support_tickets_parent_subseq
  ON public.support_tickets (parent_ticket_id, sub_seq)
  WHERE parent_ticket_id IS NOT NULL AND sub_seq IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_support_tickets_tenant_code
  ON public.support_tickets (tenant_id, ticket_code);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Gerador do código derivado
--    O lock no pai serializa duas criações simultâneas do mesmo ticket.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.next_sub_ticket_code(p_parent_ticket_id uuid)
RETURNS TABLE (seq smallint, code text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_parent_code text;
  v_seq smallint;
BEGIN
  SELECT t.ticket_code, (t.sub_seq_last + 1)::smallint
    INTO v_parent_code, v_seq
    FROM public.support_tickets t
   WHERE t.id = p_parent_ticket_id
     FOR UPDATE;

  IF v_parent_code IS NULL THEN
    RAISE EXCEPTION 'ticket pai % nao encontrado', p_parent_ticket_id;
  END IF;

  UPDATE public.support_tickets
     SET sub_seq_last = v_seq
   WHERE id = p_parent_ticket_id;

  seq  := v_seq;
  code := v_parent_code || '-' || v_seq::text;
  RETURN NEXT;
END;
$function$;

REVOKE ALL ON FUNCTION public.next_sub_ticket_code(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.next_sub_ticket_code(uuid) TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. create_onboarding_training passa a numerar o filho a partir do pai
--    Corpo idêntico ao de hoje (md5 6749a502b9eb65aa40677181ff4834da), exceto o
--    INSERT em support_tickets, que agora recebe ticket_code e sub_seq.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.create_onboarding_training(
  p_journey_id uuid,
  p_titulo text,
  p_agendado_para timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_conduzido_por uuid DEFAULT NULL::uuid,
  p_is_retreinamento boolean DEFAULT false,
  p_training_type_id uuid DEFAULT NULL::uuid,
  p_link text DEFAULT NULL::text,
  p_concluir_onboarding boolean DEFAULT false
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid; v_cliente uuid; v_parent uuid; v_sub_ticket uuid; v_training uuid;
  v_seq smallint; v_code text;
BEGIN
  SELECT tenant_id, cliente_id, ticket_id
    INTO v_tenant, v_cliente, v_parent
    FROM public.onboarding_journeys WHERE id = p_journey_id;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'jornada nao encontrada'; END IF;
  IF NOT public.can_access_tenant_row(v_tenant) THEN RAISE EXCEPTION 'sem permissao'; END IF;

  SELECT s.seq, s.code INTO v_seq, v_code FROM public.next_sub_ticket_code(v_parent) s;

  INSERT INTO public.support_tickets (tenant_id, cliente_id, assunto, contexto, canal_origem, origem_criacao, parent_ticket_id, ticket_code, sub_seq)
  VALUES (v_tenant, v_cliente, p_titulo, 'onboarding', 'whatsapp', 'onboarding_treino', v_parent, v_code, v_seq)
  RETURNING id INTO v_sub_ticket;

  INSERT INTO public.onboarding_training_sessions (
    tenant_id, ticket_id, journey_id, titulo, status, agendado_para, conduzido_por, is_retreinamento, training_type_id, link_agendamento
  ) VALUES (
    v_tenant, v_sub_ticket, p_journey_id, p_titulo,
    CASE WHEN p_agendado_para IS NOT NULL THEN 'agendado'::public.onb_treino_status ELSE 'previsto'::public.onb_treino_status END,
    p_agendado_para, p_conduzido_por, p_is_retreinamento, p_training_type_id, p_link
  ) RETURNING id INTO v_training;

  -- Quem conduz o treino e o implantador da jornada: e ele que assume a
  -- responsabilidade quando o onboarding e concluido.
  IF p_conduzido_por IS NOT NULL THEN
    INSERT INTO public.onboarding_participants (tenant_id, ticket_id, user_id, role_id)
    VALUES (v_tenant, v_parent, p_conduzido_por, public.fn_onboarding_role_id(v_tenant, 'implantador')) ON CONFLICT DO NOTHING;
  END IF;

  INSERT INTO public.support_ticket_events (tenant_id, ticket_id, user_id, event_type, content, new_value)
  VALUES (v_tenant, v_parent, auth.uid(), 'onboarding_treino_criado', p_titulo, v_code);

  -- Só conclui o onboarding e vai pra implantação se o usuário pediu explicitamente.
  IF p_concluir_onboarding THEN
    PERFORM public.advance_onboarding_to_implantacao(p_journey_id, false);
  END IF;

  RETURN v_training;
END $function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Backfill dos sub-tickets de treino que já existem
--
--    Numera por aberto_em dentro de cada pai, reescreve o ticket_code e limpa do
--    assunto/título o prefixo "TK-YYYY-NNNN - " e o sufixo " - <NOME DO CLIENTE>"
--    que o operador digitava à mão.
--
--    A caixa do texto NÃO é alterada: "VALIDAÇÃO DE REDE" continua em maiúsculas.
--    O código antigo fica registrado em support_ticket_events (old_value → new_value).
--    Idempotente: só toca em filho com sub_seq IS NULL.
-- ─────────────────────────────────────────────────────────────────────────────

DO $backfill$
DECLARE
  r record;
  v_novo_code text;
  v_assunto text;
  v_cli_fantasia text;
  v_cli_razao text;
BEGIN
  FOR r IN
    SELECT f.id, f.tenant_id, f.assunto, f.cliente_id, f.parent_ticket_id, f.ticket_code AS code_antigo,
           p.ticket_code AS pai_code,
           row_number() OVER (PARTITION BY f.parent_ticket_id ORDER BY f.aberto_em, f.id)::smallint AS seq
      FROM public.support_tickets f
      JOIN public.support_tickets p ON p.id = f.parent_ticket_id
     WHERE f.origem_criacao = 'onboarding_treino'
       AND f.sub_seq IS NULL
     ORDER BY f.parent_ticket_id, f.aberto_em, f.id
  LOOP
    v_novo_code := r.pai_code || '-' || r.seq::text;

    -- prefixo "TK-YYYY-NNNN - " digitado à mão
    v_assunto := regexp_replace(coalesce(r.assunto, ''), '^\s*TK-\d{4}-\d+\s*-\s*', '');

    -- sufixo " - <NOME DO CLIENTE>", só com igualdade exata
    SELECT c.nome_fantasia, c.razao_social INTO v_cli_fantasia, v_cli_razao
      FROM public.clientes c WHERE c.id = r.cliente_id;

    IF v_cli_fantasia IS NOT NULL AND v_assunto ILIKE ('% - ' || v_cli_fantasia) THEN
      v_assunto := left(v_assunto, length(v_assunto) - length(v_cli_fantasia) - 3);
    ELSIF v_cli_razao IS NOT NULL AND v_assunto ILIKE ('% - ' || v_cli_razao) THEN
      v_assunto := left(v_assunto, length(v_assunto) - length(v_cli_razao) - 3);
    END IF;

    v_assunto := btrim(v_assunto);
    IF v_assunto = '' THEN v_assunto := r.assunto; END IF;

    UPDATE public.support_tickets
       SET ticket_code = v_novo_code,
           sub_seq     = r.seq,
           assunto     = v_assunto
     WHERE id = r.id;

    UPDATE public.onboarding_training_sessions
       SET titulo = v_assunto
     WHERE ticket_id = r.id;

    INSERT INTO public.support_ticket_events (tenant_id, ticket_id, user_id, event_type, content, old_value, new_value)
    VALUES (r.tenant_id, r.parent_ticket_id, NULL, 'onboarding_treino_renumerado',
            v_assunto, r.code_antigo, v_novo_code);
  END LOOP;

  -- contador do pai fica no ponto certo para o próximo filho
  UPDATE public.support_tickets p
     SET sub_seq_last = GREATEST(p.sub_seq_last, sub.maxseq)
    FROM (
      SELECT parent_ticket_id, MAX(sub_seq) AS maxseq
        FROM public.support_tickets
       WHERE parent_ticket_id IS NOT NULL AND sub_seq IS NOT NULL
       GROUP BY parent_ticket_id
    ) sub
   WHERE p.id = sub.parent_ticket_id;
END
$backfill$;
