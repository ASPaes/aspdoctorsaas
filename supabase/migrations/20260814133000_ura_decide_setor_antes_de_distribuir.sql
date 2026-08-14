-- URA volta a ser quem decide o setor: ninguem recebe o chat antes da escolha.
--
-- Sintoma (14/08/2026, atendimento 07375/26 da ASP):
--   10:12:25  atendimento criado (waiting, sem setor escolhido)
--   10:12:26  motor atribuiu Luiz Hansen / Suporte Tecnico  <-- 1s ANTES do menu
--   10:12:27  menu da URA enviado
--   10:12:43  cliente respondeu "2" (Financeiro) -> DESCARTADO
--   10:18:00  timeout da URA devolveu pro Suporte Tecnico, desfazendo a
--             transferencia manual que o operador fez pro Financeiro as 10:13:50
--
-- Causa raiz: o INSERT do atendimento (message-processor.ts) nao passa ura_state,
-- entao a linha nasce com o DEFAULT 'none' da coluna. A guarda da URA dentro de
-- fn_assign_conversation_if_ready lista 'none' entre os estados de "URA resolvida",
-- logo ela NUNCA segurava um atendimento recem-criado: o AFTER INSERT distribuia
-- na hora. O 'pending' so e gravado ~1s depois, em sendUraWelcome, quando o menu
-- ja saiu e o chat ja tem dono. Com o chat em 'in_progress', handleUraResponse
-- (que so le atendimento 'waiting') ignora a opcao digitada pelo cliente.
--
-- Medido em prod, ultimos 30 dias, tenant ASP: 491 de 989 atendimentos de cliente
-- com URA (50%) foram atribuidos antes de o menu sair — TODOS sem opcao escolhida.
--
-- Regra do dono: antes da escolha, ninguem recebe. Depois da escolha, distribui no
-- setor escolhido. Sem resposta dentro do timeout (ASP: 3 min), ai sim automatico.
--
-- Patch aplicado sobre pg_get_functiondef() em vez de reescrever a funcao inteira:
-- prod muda durante a sessao e reescrever perderia edicao de outra sessao. Cada
-- ancora e conferida por ocorrencia UNICA e o bloco aborta se nao casar — ancora
-- que nao bate nao pode virar no-op silencioso.

DO $mig$
DECLARE
  v_src  text;
  v_new  text;
  v_anc  text;
  v_rep  text;
  v_hits int;
BEGIN
  -- ─────────────────────────────────────────────────────────────────────────
  -- 1) fn_assign_conversation_if_ready — a guarda da URA passa a valer
  -- ─────────────────────────────────────────────────────────────────────────
  SELECT pg_get_functiondef(p.oid) INTO v_src
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'fn_assign_conversation_if_ready';

  IF v_src IS NULL THEN
    RAISE EXCEPTION 'fn_assign_conversation_if_ready nao encontrada';
  END IF;

  v_new := v_src;

  -- 1a) variaveis novas
  v_anc := '  v_ura_is_pending BOOLEAN := false;';
  v_hits := (length(v_new) - length(replace(v_new, v_anc, ''))) / length(v_anc);
  IF v_hits <> 1 THEN
    RAISE EXCEPTION 'ancora 1a esperava 1 ocorrencia, achou %', v_hits;
  END IF;
  v_rep := '  v_ura_is_pending BOOLEAN := false;
  v_ura_enabled BOOLEAN;
  v_skip_ura BOOLEAN;
  v_conv_is_group BOOLEAN;';
  v_new := replace(v_new, v_anc, v_rep);

  -- 1b) precisa de created_from para separar o caminho da URA dos demais
  v_anc := '  SELECT id, ura_state, ura_completed_at';
  v_hits := (length(v_new) - length(replace(v_new, v_anc, ''))) / length(v_anc);
  IF v_hits <> 1 THEN
    RAISE EXCEPTION 'ancora 1b esperava 1 ocorrencia, achou %', v_hits;
  END IF;
  v_new := replace(v_new, v_anc, '  SELECT id, ura_state, ura_completed_at, created_from');

  -- 1c) a guarda de verdade
  v_anc := '      v_ura_is_pending := true;
    END IF;
  END IF;';
  v_hits := (length(v_new) - length(replace(v_new, v_anc, ''))) / length(v_anc);
  IF v_hits <> 1 THEN
    RAISE EXCEPTION 'ancora 1c esperava 1 ocorrencia, achou %', v_hits;
  END IF;
  v_rep := '      v_ura_is_pending := true;
    END IF;

    -- 14/08/2026: a checagem acima e cega justamente na janela que importa.
    -- O atendimento nasce com ura_state = ''none'' (DEFAULT da coluna; o INSERT do
    -- processor nao passa o campo) e ''none'' esta na lista de "URA resolvida" —
    -- entao o AFTER INSERT distribuia o chat ~1s ANTES de o menu chegar ao cliente,
    -- e a opcao digitada depois era descartada (handleUraResponse so le ''waiting'').
    -- Enquanto a URA for a dona do roteamento, quem tira o atendimento daqui e o
    -- cliente escolhendo o setor ou o timeout (fn_process_ura_timeouts) — nunca o
    -- motor de distribuicao.
    IF NOT v_ura_is_pending
       AND v_attendance.ura_completed_at IS NULL
       AND v_attendance.created_from = ''customer''
       AND COALESCE(v_attendance.ura_state, ''none'') IN (''none'',''pending'') THEN

      SELECT COALESCE(c.is_group, false) INTO v_conv_is_group
      FROM public.whatsapp_conversations c
      WHERE c.id = p_conversation_id;

      IF COALESCE(v_conv_is_group, false) = false THEN
        SELECT COALESCE(cfg.support_ura_enabled, cfg.ura_enabled, false)
          INTO v_ura_enabled
        FROM public.configuracoes cfg
        WHERE cfg.tenant_id = v_conv.tenant_id;

        -- Mesma regra das 3 triggers de setor (sync_conversation_department,
        -- fn_auto_assign_dept_by_instance, fn_reroute_dept_by_instance_on_customer_att):
        -- instancia com skip_ura nao passa pela URA. Nesse caso o processor ja abre
        -- o atendimento como ''in_progress'' e nem chega aqui — a checagem mantem as
        -- duas pontas com a mesma regra em vez de depender desse detalhe.
        SELECT COALESCE(i.skip_ura, false) INTO v_skip_ura
        FROM public.whatsapp_conversations c
        JOIN public.whatsapp_instances i
          ON i.id = COALESCE(c.current_instance_id, c.instance_id)
        WHERE c.id = p_conversation_id;

        IF COALESCE(v_ura_enabled, false) = true
           AND COALESCE(v_skip_ura, false) = false THEN
          v_ura_is_pending := true;
        END IF;
      END IF;
    END IF;
  END IF;';
  v_new := replace(v_new, v_anc, v_rep);

  IF v_new = v_src THEN
    RAISE EXCEPTION 'fn_assign_conversation_if_ready: nada mudou';
  END IF;

  EXECUTE v_new;

  -- ─────────────────────────────────────────────────────────────────────────
  -- 2) fn_process_ura_timeouts — resgate de quem ficou preso em 'none'
  -- ─────────────────────────────────────────────────────────────────────────
  -- Sem isso a correcao acima abre um buraco novo: atendimento de cliente cujo
  -- envio do menu falhou fica ura_state='none' + status='waiting' para sempre,
  -- segurado pela guarda nova e ignorado pelo cron (que tambem exclui 'none').
  -- created_from='customer' limita ao caminho da URA — out_of_hours, operator e
  -- billing_automation nascem 'none' de proposito e continuam fora.
  SELECT pg_get_functiondef(p.oid) INTO v_src
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'fn_process_ura_timeouts';

  IF v_src IS NULL THEN
    RAISE EXCEPTION 'fn_process_ura_timeouts nao encontrada';
  END IF;

  v_anc := '        AND ura_state NOT IN (''completed'',''skipped'',''bypassed'',''timeout_fallback'',''none'')';
  v_hits := (length(v_src) - length(replace(v_src, v_anc, ''))) / length(v_anc);
  IF v_hits <> 1 THEN
    RAISE EXCEPTION 'ancora 2 esperava 1 ocorrencia, achou %', v_hits;
  END IF;

  v_rep := '        AND (
              ura_state NOT IN (''completed'',''skipped'',''bypassed'',''timeout_fallback'',''none'')
              OR (ura_state = ''none'' AND created_from = ''customer'')
            )';
  v_new := replace(v_src, v_anc, v_rep);

  IF v_new = v_src THEN
    RAISE EXCEPTION 'fn_process_ura_timeouts: nada mudou';
  END IF;

  EXECUTE v_new;
END
$mig$;
