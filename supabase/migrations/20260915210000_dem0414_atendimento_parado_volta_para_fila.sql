-- DEM-0414 — atendimento parado no agente volta para a fila
--
-- O caso: 06962/26 (Digi Office). O cliente respondeu a pesquisa de satisfacao
-- 47 min depois do encerramento, fora do expediente. A resposta nao foi
-- reconhecida como nota, caiu na janela de 60 min do ramo fora-do-horario e
-- REABRIU o atendimento que estava sendo avaliado, devolvendo-o ao ultimo
-- agente. Ninguem respondeu. Onze dias depois o cliente voltou com assunto novo
-- ("gostaria de agendar a reuniao") e a mensagem entrou naquele atendimento de
-- 03/09: sem fila, sem distribuicao, sem contagem de SLA propria. So saiu de la
-- por transferencia manual.
--
-- A causa da reabertura foi corrigida no _shared/message-processor.ts
-- (csatBlocksReopen). Esta migration e a rede de seguranca para o resto: um
-- atendimento onde a bola esta com a EMPRESA ha muito tempo nao pode ficar preso
-- num agente so porque alguem esqueceu dele.
--
-- POR QUE DEVOLVER E NAO FECHAR
-- Ja existe fn_close_attendances_no_agent_response (cron check-agent-no-response,
-- de 2 em 2 min) que alcanca exatamente estes atendimentos — e esta desligada em
-- 14/14 tenants, com 60 min de default. Ela FECHA. Fechar um chat em que o
-- cliente perguntou e ninguem respondeu resolve a metrica e nao o cliente.
-- Devolver para a fila mantem o atendimento vivo e deixa o motor redistribuir.
-- Se o tenant ligar as duas, ponha o tempo do requeue MENOR que o do
-- fechamento — senao o fechamento chega primeiro e o requeue nunca roda.
--
-- UMA DEVOLUCAO POR ATENDIMENTO (awaiting_agent_requeued_at)
-- Sem esse carimbo o atendimento voltaria para a fila a cada ciclo enquanto
-- ninguem respondesse, e cada atribuicao dispara fn_enqueue_assignment_greeting
-- — ou seja, o cliente receberia a saudacao de "fulano vai te atender" em loop.
-- Devolve uma vez; se o segundo agente tambem nao responder, quem trata e o
-- encerramento por agent_no_response ou o alerta de fn_notify_awaiting_agent.
--
-- awaiting_agent_since fica INTACTO de proposito: e ele que ordena a fila
-- (COALESCE(awaiting_agent_since, queued_at, opened_at), DEM-0227). O cliente
-- que ja esperava 2h entra na frente de quem acabou de chegar, que e o certo.
--
-- SEM INDICE NOVO. support_attendances tem 38 mil linhas e ja recebe uma
-- varredura igual a cada 2 min (fn_close_attendances_no_agent_response). Indice
-- parcial aqui so acrescentaria custo de escrita numa tabela quente.
--
-- NASCE DESLIGADO em todos os tenants. Ligar e decisao por tenant/setor.

-- ------------------------------------------------------------------ colunas --

ALTER TABLE public.support_attendances
  ADD COLUMN IF NOT EXISTS awaiting_agent_requeued_at timestamptz;

COMMENT ON COLUMN public.support_attendances.awaiting_agent_requeued_at IS
  'Quando o atendimento foi devolvido a fila por fn_requeue_stale_awaiting_agent. Preenchido = ja foi devolvido uma vez e nao sera de novo.';

ALTER TABLE public.configuracoes
  ADD COLUMN IF NOT EXISTS support_awaiting_agent_requeue_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS support_awaiting_agent_requeue_minutes integer NOT NULL DEFAULT 120;

COMMENT ON COLUMN public.configuracoes.support_awaiting_agent_requeue_enabled IS
  'Devolve a fila o atendimento em que o agente nao responde ha support_awaiting_agent_requeue_minutes (minutos UTEIS). Desligado por padrao.';
COMMENT ON COLUMN public.configuracoes.support_awaiting_agent_requeue_minutes IS
  'Minutos UTEIS (segundos_uteis) de espera pelo agente antes de devolver o atendimento a fila. Ponha MENOR que support_agent_no_response_close_minutes se o fechamento tambem estiver ligado.';

-- Cascata setor > geral, igual a do encerramento. NULL = herda do tenant.
ALTER TABLE public.support_departments
  ADD COLUMN IF NOT EXISTS awaiting_agent_requeue_enabled boolean,
  ADD COLUMN IF NOT EXISTS awaiting_agent_requeue_minutes integer;

COMMENT ON COLUMN public.support_departments.awaiting_agent_requeue_enabled IS
  'Sobrepoe configuracoes.support_awaiting_agent_requeue_enabled neste setor. NULL = herda do tenant.';
COMMENT ON COLUMN public.support_departments.awaiting_agent_requeue_minutes IS
  'Sobrepoe configuracoes.support_awaiting_agent_requeue_minutes neste setor. NULL = herda do tenant.';

-- ------------------------------------------------------- motivo de re-fila --
-- last_queue_reason tem CHECK fechado (chk_support_attendances_queue_reason) e
-- 'agent_no_response_requeue' nao esta na lista. Sem isto o UPDATE da funcao
-- estoura, o erro cai no EXCEPTION WHEN OTHERS dela e a devolucao vira linha de
-- log silenciosa — o mesmo alcapao que deixou fn_close_attendances_no_agent_response
-- quebrada desde sempre com closed_reason = 'agent_no_response' (05/08/2026).
-- Pego no smoke test local.
--
-- So AMPLIA a lista: todo valor valido antes continua valido, entao o ADD entra
-- NOT VALID (sem scan sob ACCESS EXCLUSIVE) e a validacao vem depois, com lock
-- fraco. lock_timeout para nao segurar a fila de atendimento se a tabela estiver
-- ocupada — support_attendances esta na publication do Realtime.
-- Sem LOCAL de proposito: no SQL Editor cada execucao nao e um bloco de
-- transacao explicito, e SET LOCAL ali vira warning e nao pega.
SET lock_timeout = '5s';

ALTER TABLE public.support_attendances
  DROP CONSTRAINT IF EXISTS chk_support_attendances_queue_reason;

ALTER TABLE public.support_attendances
  ADD CONSTRAINT chk_support_attendances_queue_reason CHECK (
    last_queue_reason IS NULL OR last_queue_reason = ANY (ARRAY[
      'acceptance_timeout', 'agent_offline', 'agent_shift_end', 'manual_reassign',
      'department_changed', 'initial_enqueue', 'no_active_rule',
      'max_retries_kept_assigned', 'claimed_manually', 'owner_inactive',
      'department_inactive',
      -- DEM-0414
      'agent_no_response_requeue'
    ])
  ) NOT VALID;

ALTER TABLE public.support_attendances
  VALIDATE CONSTRAINT chk_support_attendances_queue_reason;

-- ----------------------------------------------------------------- varredura --

CREATE OR REPLACE FUNCTION public.fn_requeue_stale_awaiting_agent()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '30s'
AS $function$
DECLARE
  v_att RECORD;
  v_requeued INT := 0;
  v_errors INT := 0;
  v_now TIMESTAMPTZ := now();
  v_started_at TIMESTAMPTZ := clock_timestamp();
  v_process_limit CONSTANT INT := 200;
BEGIN
  FOR v_att IN
    SELECT sa.id AS attendance_id,
           sa.conversation_id,
           sa.tenant_id,
           sa.department_id,
           sa.awaiting_agent_since,
           COALESCE(dept.awaiting_agent_requeue_minutes,
                    cfg.support_awaiting_agent_requeue_minutes) AS requeue_minutes
    FROM support_attendances sa
    JOIN configuracoes cfg ON cfg.tenant_id = sa.tenant_id
    LEFT JOIN support_departments dept ON dept.id = sa.department_id
    LEFT JOIN whatsapp_contacts ct ON ct.id = sa.contact_id
    WHERE sa.status = 'in_progress'
      AND sa.assigned_to IS NOT NULL
      AND sa.awaiting_agent_since IS NOT NULL
      -- uma devolucao por atendimento
      AND sa.awaiting_agent_requeued_at IS NULL
      -- grupo nao tem fila nem setor por design
      AND COALESCE(sa.is_group, false) = false
      -- pausa/agendamento do operador: intocaveis, iguais ao motor de inatividade
      AND COALESCE(sa.inactivity_hold, false) = false
      AND (sa.inactivity_hold_until IS NULL OR sa.inactivity_hold_until <= v_now)
      AND (sa.scheduled_until IS NULL OR sa.scheduled_until <= v_now)
      -- contato com "regras do sistema desligadas" nao sofre automacao nenhuma
      AND COALESCE(ct.rules_disabled, false) = false
      -- PRECEDENCIA: enquanto o acceptance-timeout decide, ele manda.
      AND NOT (
        sa.acceptance_deadline_at IS NOT NULL
        AND COALESCE(sa.msg_agent_count, 0) = 0
        AND COALESCE((cfg.support_config->>'distribution_enabled_globally')::boolean, false) = true
      )
      -- gate ligado (cascata setor > geral)
      AND COALESCE(dept.awaiting_agent_requeue_enabled,
                   cfg.support_awaiting_agent_requeue_enabled) = true
    ORDER BY sa.awaiting_agent_since ASC
    LIMIT v_process_limit
  LOOP
    BEGIN
      -- Minutos UTEIS: sem isso o chat da tarde voltaria para a fila de
      -- madrugada, e de manha o motor o entregaria a quem estivesse online no
      -- lugar de quem entra no expediente.
      IF public.segundos_uteis(v_att.awaiting_agent_since, v_now, v_att.tenant_id, v_att.department_id)
         >= v_att.requeue_minutes * 60 THEN

        -- in_progress -> waiting com assigned_to NULL aciona
        -- trg_dispatch_on_attendance_reopen, que enfileira a distribuicao.
        -- Nao e transicao de reabertura (OLD.status nao e closed), entao nem
        -- fn_reopen_orfao_para_fila nem fn_restore_conv_assigned_on_reopen agem.
        UPDATE support_attendances
           SET status                     = 'waiting',
               assigned_to                = NULL,
               assumed_at                 = NULL,
               acceptance_deadline_at     = NULL,
               queued_at                  = v_now,
               last_queue_reason          = 'agent_no_response_requeue',
               awaiting_agent_requeued_at = v_now,
               updated_at                 = v_now
         WHERE id = v_att.attendance_id;

        -- Depois do atendimento, nunca antes: fn_mirror_attendance_to_conversation
        -- roda no UPDATE acima e preserva o dono da conversa. fn_retry_waiting_conversations
        -- (cron de 1 min) so enxerga conversa com assigned_to NULL.
        UPDATE whatsapp_conversations
           SET assigned_to = NULL,
               updated_at  = v_now
         WHERE id = v_att.conversation_id;

        v_requeued := v_requeued + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_errors := v_errors + 1;
      RAISE LOG '[fn_requeue_stale_awaiting_agent] erro no att %: %', v_att.attendance_id, SQLERRM;
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'requeued', v_requeued,
    'errors', v_errors,
    'elapsed_ms', EXTRACT(EPOCH FROM (clock_timestamp() - v_started_at)) * 1000,
    'ran_at', v_now
  );
END;
$function$;

COMMENT ON FUNCTION public.fn_requeue_stale_awaiting_agent() IS
  'DEM-0414: devolve a fila o atendimento in_progress em que a EMPRESA nao responde ha '
  'awaiting_agent_requeue_minutes (minutos uteis), para tenant/setor com o gate ligado. '
  'Uma vez por atendimento (awaiting_agent_requeued_at). Nao fecha nada: quem fecha e '
  'fn_close_attendances_no_agent_response, e o requeue deve ter tempo MENOR que o dela.';

REVOKE ALL ON FUNCTION public.fn_requeue_stale_awaiting_agent() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_requeue_stale_awaiting_agent() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.fn_requeue_stale_awaiting_agent() TO service_role;

-- ---------------------------------------------------------------------- cron --
-- A cada 5 min. Nao precisa de 2 min: o relogio e de horas uteis, e a varredura
-- so existe para o caso em que ninguem olhou o chat.

SELECT cron.unschedule('requeue-stale-awaiting-agent')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'requeue-stale-awaiting-agent');

SELECT cron.schedule(
  'requeue-stale-awaiting-agent',
  '*/5 * * * *',
  $cron$SELECT public.fn_requeue_stale_awaiting_agent();$cron$
);
