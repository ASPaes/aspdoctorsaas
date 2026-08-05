-- Encerramento automatico nao alcanca a FILA
--
-- Achado ao publicar o DEM-0227 (fila em ordem de chegada): existem atendimentos
-- em 'waiting' ha 53 dias. Nao e configuracao desligada — sao tres camadas que
-- so enxergam 'in_progress':
--
--   1. fn_close_attendances_no_agent_response  WHERE sa.status = 'in_progress'
--   2. get_inactive_attendances_to_process     WHERE a.status  = 'in_progress'
--   3. fn_close_attendance_atomic              IF status != 'in_progress' -> recusa
--
-- A terceira e a trava dura: mesmo mandando fechar um atendimento em fila, o
-- executor recusa. Quem entra na fila e nunca e assumido e inalcancavel.
--
-- E tem uma quarta, achada no smoke test local: o CHECK
-- support_attendances_closed_reason_check so aceita
-- ('manual','inactivity','csat_timeout','system') — e a funcao (1) fecha com
-- closed_reason = 'agent_no_response'. Ela violaria o CHECK, e o erro cairia no
-- EXCEPTION WHEN OTHERS dela, virando linha de log. Ou seja: essa varredura nao
-- so esta desligada em 14/14 tenants como nunca teria funcionado se ligassem.
-- Corrigido aqui junto — nao adianta alcancar a fila se o executor estoura.
--
-- Esta migration tira a impossibilidade TECNICA. Ela NAO liga encerramento para
-- ninguem: o gate continua sendo agent_no_response_close_enabled, false nos 14
-- tenants (os 60 min sao o default, intocado). Nenhum comportamento muda hoje.
-- Decisao do Alexandre em 05/08/2026 — a fila fica mostrando a verdade, sem
-- limpeza retroativa do passivo (226 atendimentos, 87 deles com mais de 7 dias).
--
-- A camada 2 fica de fora DE PROPOSITO: get_inactive_attendances_to_process e
-- inatividade do CLIENTE e exige awaiting_agent_since IS NULL (bola com o
-- cliente). Na fila a bola esta com a empresa. Nao se aplica.

-- 1) Executor: aceitar 'waiting', mas so no caminho da fila ----------------
-- Assinatura INALTERADA de proposito. Acrescentar um p_allow_waiting criaria
-- SOBRECARGA (CREATE OR REPLACE nao substitui quando a aridade muda) e as
-- chamadas atuais de 3 argumentos ficariam ambiguas — foi exatamente o que
-- quase quebrou whatsapp_pill_counts no DEM-0234.
--
-- O gatilho e o p_closure_type, NAO o p_closed_reason: closure_type e campo
-- livre (sem CHECK), enquanto closed_reason e fechado na lista acima. Por isso
-- o abandono na fila entra como reason 'inactivity' (que e o que ele e:
-- ninguem assumiu) + closure_type 'queue_abandoned', que carrega a distincao
-- para a metrica. De quebra, reason 'inactivity' ja passa por
-- fn_block_close_without_cliente sem precisar mexer naquele trigger.
--
-- Callers existentes, todos com outro closure_type e portanto INTOCADOS:
--   fn_close_attendances_no_agent_response · check-csat-timeout
--   check-inactivity-timeout · _shared/message-processor · TicketUpdateExistingDialog
CREATE OR REPLACE FUNCTION public.fn_close_attendance_atomic(
  p_attendance_id uuid,
  p_closed_reason text DEFAULT 'inactivity'::text,
  p_closure_type text DEFAULT 'inactivity_auto'::text
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_attendance RECORD;
  v_now timestamptz := now();
BEGIN
  -- Busca e trava o attendance (FOR UPDATE garante atomicidade)
  SELECT id, conversation_id, tenant_id, status, attendance_code, is_group
  INTO v_attendance
  FROM support_attendances
  WHERE id = p_attendance_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'reason', 'attendance_not_found');
  END IF;

  IF v_attendance.status = 'closed' THEN
    RETURN jsonb_build_object('success', true, 'reason', 'already_closed');
  END IF;

  -- 'waiting' passa APENAS com closure_type 'queue_abandoned' (abandono na
  -- fila). Qualquer outro caminho continua exigindo 'in_progress', como antes.
  IF v_attendance.status <> 'in_progress'
     AND NOT (v_attendance.status = 'waiting' AND p_closure_type = 'queue_abandoned')
  THEN
    RETURN jsonb_build_object('success', false, 'reason', 'not_in_progress', 'current_status', v_attendance.status);
  END IF;

  -- 1. Fecha attendance
  UPDATE support_attendances
  SET status = 'closed',
      closed_at = v_now,
      closed_reason = p_closed_reason,
      closure_type = p_closure_type,
      updated_at = v_now
  WHERE id = p_attendance_id;

  -- 2. Fecha conversa (na MESMA transacao) - EXCETO grupos: o chat do grupo nunca fecha
  IF v_attendance.is_group IS NOT TRUE THEN
    UPDATE whatsapp_conversations
    SET status = 'closed',
        updated_at = v_now
    WHERE id = v_attendance.conversation_id
      AND tenant_id = v_attendance.tenant_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'attendance_id', p_attendance_id,
    'conversation_id', v_attendance.conversation_id,
    'attendance_code', v_attendance.attendance_code,
    'closed_at', v_now
  );
END;
$function$;

-- 2) Varredura: alcancar a fila e parar de violar o CHECK ------------------
-- Semanticamente encaixa: agent_no_response_close_enabled significa "encerrar
-- quando a EMPRESA nao respondeu", e atendimento parado na fila e exatamente
-- isso. O prazo continua contado em segundos_uteis (so horario comercial).
--
-- ATENCAO ao ligar o booleano num tenant: a partir daqui ele alcanca a fila
-- tambem, com o mesmo prazo. Com o default de 60 min isso e agressivo para quem
-- tem fila — conferir o valor antes de ligar.
--
-- Os dois caminhos passam a fechar com closed_reason 'inactivity' (o unico da
-- lista do CHECK que descreve o caso) e se distinguem pelo closure_type:
--   in_progress -> 'agent_no_response'   (era tambem o closed_reason: violava o CHECK)
--   waiting     -> 'queue_abandoned'
CREATE OR REPLACE FUNCTION public.fn_close_attendances_no_agent_response()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '30s'
AS $function$
DECLARE
  v_att RECORD;
  v_closed INT := 0;
  v_closed_queue INT := 0;
  v_errors INT := 0;
  v_now TIMESTAMPTZ := now();
  v_started_at TIMESTAMPTZ := clock_timestamp();
  v_process_limit CONSTANT INT := 200;
BEGIN
  FOR v_att IN
    SELECT sa.id AS attendance_id,
           sa.tenant_id,
           sa.department_id,
           sa.status,
           sa.awaiting_agent_since,
           COALESCE(dept.agent_no_response_close_minutes,
                    cfg.support_agent_no_response_close_minutes) AS close_minutes
    FROM support_attendances sa
    JOIN configuracoes cfg ON cfg.tenant_id = sa.tenant_id
    LEFT JOIN support_departments dept ON dept.id = sa.department_id
    LEFT JOIN whatsapp_contacts ct ON ct.id = sa.contact_id
    -- 'waiting' entrou aqui: e o atendimento que ninguem assumiu. Sem isto
    -- nenhuma varredura o alcanca, e ele fica na fila para sempre.
    WHERE sa.status IN ('in_progress', 'waiting')
      AND sa.is_group = false
      AND sa.awaiting_agent_since IS NOT NULL
      -- hold manual do operador: nao encerrar por inatividade de forma alguma
      AND COALESCE(sa.inactivity_hold, false) = false
      -- encerramento ligado (cascata setor > geral)
      AND COALESCE(dept.agent_no_response_close_enabled,
                   cfg.support_agent_no_response_close_enabled) = true
      -- contato sem "regras do sistema desligadas"
      AND COALESCE(ct.rules_disabled, false) = false
      -- PRECEDENCIA: nao encerrar enquanto o acceptance-timeout esta no controle.
      -- Exige assigned_to IS NOT NULL, entao nao alcanca a fila (assigned_to NULL).
      AND NOT (
        sa.acceptance_deadline_at IS NOT NULL
        AND COALESCE(sa.msg_agent_count, 0) = 0
        AND sa.assigned_to IS NOT NULL
        AND COALESCE((cfg.support_config->>'distribution_enabled_globally')::boolean, false) = true
      )
    ORDER BY sa.awaiting_agent_since ASC
    LIMIT v_process_limit
  LOOP
    BEGIN
      IF public.segundos_uteis(v_att.awaiting_agent_since, v_now, v_att.tenant_id, v_att.department_id)
         >= v_att.close_minutes * 60 THEN
        IF v_att.status = 'waiting' THEN
          PERFORM public.fn_close_attendance_atomic(v_att.attendance_id, 'inactivity', 'queue_abandoned');
          v_closed_queue := v_closed_queue + 1;
        ELSE
          PERFORM public.fn_close_attendance_atomic(v_att.attendance_id, 'inactivity', 'agent_no_response');
          v_closed := v_closed + 1;
        END IF;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_errors := v_errors + 1;
      RAISE LOG '[fn_close_attendances_no_agent_response] erro no att %: %', v_att.attendance_id, SQLERRM;
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'closed', v_closed,
    'closed_queue', v_closed_queue,
    'errors', v_errors,
    'elapsed_ms', EXTRACT(EPOCH FROM (clock_timestamp() - v_started_at)) * 1000,
    'ran_at', v_now
  );
END;
$function$;

COMMENT ON FUNCTION public.fn_close_attendances_no_agent_response() IS
  'Encerra atendimento em que a EMPRESA nao respondeu, para tenant/setor com '
  'agent_no_response_close_enabled = true (false em 14/14 tenants em 05/08/2026). '
  'Alcanca in_progress (closure_type agent_no_response) e a fila/waiting '
  '(closure_type queue_abandoned). closed_reason e sempre inactivity: o CHECK '
  'support_attendances_closed_reason_check so aceita manual/inactivity/csat_timeout/system.';
