-- DEM-0410 | Resolvedor: extrato sem repetição e queda para a próxima regra
--
-- ACHADO EM 17/09/2026, ANTES DE QUALQUER REGRA EXISTIR EM PRODUÇÃO (0 regras,
-- 0 linhas de extrato no momento da escrita). O que não se via na entrega:
--
-- O cron `retry-waiting-conversations` roda TODO MINUTO e chama
-- `fn_assign_conversation_if_ready` para cada chat parado na fila. Ou seja, o
-- resolvedor não roda uma vez por chat, roda uma vez por minuto enquanto o
-- chat esperar. Três consequências:
--
--   1. Regra que casa mas não se aplica (destino inativo) gravava uma linha
--      "não aplicada" POR MINUTO, POR CHAT. Um chat parado 2 h = 120 linhas
--      iguais, e o histórico da tela vira ruído.
--   2. Regra só por canal cujo destino já é o setor atual do chat caía no
--      mesmo caminho: "chat já está no setor de destino", uma linha por
--      minuto, para um não-evento.
--   3. Se a regra vencedora (menor prioridade) tinha destino inválido, a
--      função desistia ali. Uma regra válida logo abaixo nunca era tentada.
--
-- O QUE MUDA
--   · As candidatas são percorridas em ordem de prioridade; vence a primeira
--     com destino VÁLIDO. As inválidas deixam o motivo no extrato.
--   · "Já está no destino" deixa de ser registrado: não aconteceu nada.
--   · A linha "não aplicada" é gravada uma vez por (regra, atendimento). Os
--     minutos seguintes do mesmo chat não repetem.
--
-- E UM EFEITO QUE PASSA A SER DOCUMENTADO, NÃO CORRIGIDO: por causa do mesmo
-- cron, uma regra nova pega também o chat que JÁ ESTAVA esperando na fila
-- (em até 1 minuto), não só o que chega depois de salvar. Para o caso de
-- origem (alguém faltou) é exatamente o desejado. O texto da tela e do
-- CHANGELOG, que diziam o contrário, foram corrigidos junto.
--
-- Só o resolvedor muda. O motor (`fn_assign_conversation_if_ready`) continua
-- igual e o CREATE OR REPLACE preserva os grants (postgres + service_role).

begin;

set local lock_timeout = '5s';

create or replace function public.fn_automation_resolve_chat_routing(
  p_conversation_id uuid,
  p_tenant_id       uuid,
  p_department_id   uuid,
  p_instance_id     uuid,
  p_attendance_id   uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
DECLARE
  v_now             timestamptz := now();
  v_rule            public.automation_rules;
  v_would_be_agent  uuid;
  v_target_dept     uuid;
  v_target_agent    uuid;
  v_skip            text;
BEGIN
  IF p_tenant_id IS NULL OR p_conversation_id IS NULL OR p_department_id IS NULL THEN
    RETURN jsonb_build_object('matched', false, 'reason', 'sem_tenant_setor_ou_conversa');
  END IF;

  -- Regra que casa por PESSOA precisa saber para quem o chat iria. Hoje isso
  -- só é determinável quando a regra de atribuição do setor é 'fixed'. O
  -- EXISTS roda no índice parcial e só cobra a segunda consulta do tenant que
  -- realmente tem regra por pessoa valendo agora.
  IF EXISTS (
    SELECT 1
      FROM public.automation_rules r
     WHERE r.tenant_id = p_tenant_id
       AND r.is_active
       AND r.match_agent_id IS NOT NULL
       AND (r.starts_at IS NULL OR r.starts_at <= v_now)
       AND (r.ends_at   IS NULL OR r.ends_at   >  v_now)
  ) THEN
    SELECT ar.fixed_agent_id
      INTO v_would_be_agent
      FROM public.assignment_rules ar
     WHERE ar.tenant_id     = p_tenant_id
       AND ar.department_id = p_department_id
       AND ar.is_active     = true
       AND ar.strategy      = 'fixed'
     LIMIT 1;
  END IF;

  -- Candidatas em ordem de prioridade; vence a primeira com destino válido.
  FOR v_rule IN
    SELECT r.*
      FROM public.automation_rules r
     WHERE r.tenant_id = p_tenant_id
       AND r.is_active
       AND r.trigger_event = 'chat_inbound'
       AND (r.starts_at IS NULL OR r.starts_at <= v_now)
       AND (r.ends_at   IS NULL OR r.ends_at   >  v_now)
       AND (r.match_department_id IS NULL OR r.match_department_id = p_department_id)
       AND (r.match_instance_id   IS NULL OR r.match_instance_id   = p_instance_id)
       AND (r.match_agent_id      IS NULL OR r.match_agent_id      = v_would_be_agent)
     ORDER BY r.priority, r.created_at
  LOOP
    v_skip := NULL;
    v_target_dept := NULL;
    v_target_agent := NULL;

    IF v_rule.action = 'route_to_department' THEN
      SELECT d.id
        INTO v_target_dept
        FROM public.support_departments d
       WHERE d.id        = v_rule.target_department_id
         AND d.tenant_id = p_tenant_id
         AND d.is_active = true;

      IF v_target_dept IS NULL THEN
        v_skip := 'setor de destino inativo ou de outro tenant';
      ELSIF v_target_dept = p_department_id THEN
        -- Regra só por canal com o chat já no destino: nada a fazer, e nada a
        -- registrar. Antes isto virava uma linha de extrato por minuto.
        CONTINUE;
      END IF;

    ELSE
      -- Mesmo critério de perfil que o motor usa para o agente de backup.
      SELECT p.user_id
        INTO v_target_agent
        FROM public.profiles p
       WHERE p.user_id   = v_rule.target_agent_id
         AND p.tenant_id = p_tenant_id
         AND p.status    = 'ativo';

      IF v_target_agent IS NULL THEN
        v_skip := 'pessoa de destino inativa ou de outro tenant';
      END IF;
    END IF;

    IF v_skip IS NOT NULL THEN
      -- Uma linha por (regra, atendimento). O cron de retry passa por aqui
      -- todo minuto enquanto o chat espera; sem esta guarda, cada minuto
      -- repetia a mesma linha.
      IF NOT EXISTS (
        SELECT 1
          FROM public.automation_rule_logs l
         WHERE l.rule_id = v_rule.id
           AND NOT l.applied
           AND (
             (p_attendance_id IS NOT NULL AND l.attendance_id = p_attendance_id)
             OR (p_attendance_id IS NULL AND l.conversation_id = p_conversation_id)
           )
      ) THEN
        INSERT INTO public.automation_rule_logs
          (tenant_id, rule_id, conversation_id, attendance_id, applied,
           from_department_id, skipped_reason)
        VALUES
          (p_tenant_id, v_rule.id, p_conversation_id, p_attendance_id, false,
           p_department_id, v_skip);
      END IF;

      CONTINUE;  -- tenta a próxima candidata
    END IF;

    -- ─── Aplicou ───
    INSERT INTO public.automation_rule_logs
      (tenant_id, rule_id, conversation_id, attendance_id, applied,
       from_department_id, to_department_id, to_agent_id)
    VALUES
      (p_tenant_id, v_rule.id, p_conversation_id, p_attendance_id, true,
       p_department_id, v_target_dept, v_target_agent);

    UPDATE public.automation_rules
       SET applied_count   = applied_count + 1,
           last_applied_at = v_now
     WHERE id = v_rule.id;

    RETURN jsonb_build_object(
      'matched', true,
      'applied', true,
      'rule_id', v_rule.id,
      'rule_name', v_rule.name,
      'action', v_rule.action,
      'department_id', v_target_dept,
      'agent_id', v_target_agent);
  END LOOP;

  RETURN jsonb_build_object('matched', false);

EXCEPTION
  WHEN OTHERS THEN
    -- Automação com defeito NÃO pode impedir a distribuição normal do chat.
    RAISE LOG '[fn_automation_resolve_chat_routing] erro em conv %: %',
      p_conversation_id, SQLERRM;
    RETURN jsonb_build_object('matched', false, 'reason', 'erro', 'erro', SQLERRM);
END;
$function$;

commit;

-- ─── Conferência (rodar depois, leitura pura) ───────────────────────────────
--
-- select position('CONTINUE' in pg_get_functiondef(p.oid)) > 0         as com_queda,  -- true
--        array_to_string(p.proacl, ' | ')                               as acl         -- sem authenticated
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--  where n.nspname = 'public' and p.proname = 'fn_automation_resolve_chat_routing';
