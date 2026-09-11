-- ============================================================================
-- Treino: desistência do cliente + conclusão automática ao marcar "realizado"
--
-- 1) Marcar um treino como realizado passa a MOVER o sub-ticket para a coluna de
--    conclusão do pipeline. Antes só o status mudava e o cartão ficava parado na
--    coluna anterior, esperando alguém arrastar.
-- 2) Desfecho novo `desistencia`: o cliente não quis aquele treinamento. O sub-ticket
--    é encerrado na coluna de conclusão, com quem/quando registrados, e a jornada
--    continua na Implantação (diferente de `cancelado`, que a devolve ao Onboarding).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Etapa de conclusão do pipeline em que o treino corre.
-- O pipeline sai da etapa atual do cartão; sem etapa atual (treino recém-criado num
-- pipeline sem etapa inicial), cai no pipeline de implantação da jornada.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_onb_etapa_final_do_treino(p_training_id uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT s.id
    FROM public.onboarding_training_sessions t
    LEFT JOIN public.onboarding_stages atual ON atual.id = t.current_stage_id
    LEFT JOIN public.onboarding_journeys j ON j.id = t.journey_id
    JOIN public.onboarding_stages s
      ON s.pipeline_id = COALESCE(atual.pipeline_id, j.pipeline_implantacao_id)
     AND s.ativo AND s.is_final
   WHERE t.id = p_training_id
   ORDER BY s.position
   LIMIT 1;
$function$;

REVOKE ALL ON FUNCTION public.fn_onb_etapa_final_do_treino(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_onb_etapa_final_do_treino(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Go-live: desistência é sub-ticket ENCERRADO, não pendência.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_onb_treinos_em_aberto(p_parent_ticket_id uuid)
 RETURNS TABLE(qtd integer, codigos text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT count(*)::int,
         string_agg(tk.ticket_code, ', ' ORDER BY tk.sub_seq)
    FROM public.onboarding_training_sessions t
    JOIN public.support_tickets tk ON tk.id = t.ticket_id
   WHERE tk.parent_ticket_id = p_parent_ticket_id
     AND t.deleted_at IS NULL
     AND t.status NOT IN ('realizado'::public.onb_treino_status,
                          'cancelado'::public.onb_treino_status,
                          'desistencia'::public.onb_treino_status);
$function$;

-- ---------------------------------------------------------------------------
-- Carimbo de quem encerrou. Serve aos DOIS desfechos manuais: cancelado e
-- desistência. As colunas continuam se chamando `cancelado_*` porque já existiam e
-- guardam a mesma coisa — quem tirou o treino da fila e quando.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_onb_training_stamp_cancel()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_novo_term boolean; v_velho_term boolean;
BEGIN
  v_novo_term  := NEW.status IN ('cancelado'::public.onb_treino_status,
                                 'desistencia'::public.onb_treino_status);
  v_velho_term := OLD.status IN ('cancelado'::public.onb_treino_status,
                                 'desistencia'::public.onb_treino_status);

  IF v_novo_term AND NOT v_velho_term THEN
    NEW.cancelado_em  := COALESCE(NEW.cancelado_em, now());
    NEW.cancelado_por := COALESCE(NEW.cancelado_por, auth.uid());
  ELSIF v_velho_term AND NOT v_novo_term THEN
    NEW.cancelado_em  := NULL;
    NEW.cancelado_por := NULL;
  END IF;
  RETURN NEW;
END $function$;

-- ---------------------------------------------------------------------------
-- Timeline do ticket pai: a desistência precisa de frase própria.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_onboarding_training_rollup()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_parent uuid; v_code text; v_rotulo text;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
  IF NEW.current_stage_id IS DISTINCT FROM OLD.current_stage_id THEN RETURN NEW; END IF;

  SELECT tk.parent_ticket_id, tk.ticket_code INTO v_parent, v_code
    FROM public.support_tickets tk WHERE tk.id = NEW.ticket_id;
  IF v_parent IS NULL THEN RETURN NEW; END IF;

  v_rotulo := CASE
    WHEN NEW.no_shows > OLD.no_shows              THEN 'no-show (' || NEW.no_shows || 'ª falta)'
    WHEN NEW.status = 'realizado'::public.onb_treino_status   THEN 'realizado'
    WHEN NEW.status = 'no_show'::public.onb_treino_status     THEN 'no-show'
    WHEN NEW.status = 'desistencia'::public.onb_treino_status THEN 'desistência do cliente'
    WHEN NEW.status = 'cancelado'::public.onb_treino_status   THEN 'cancelado'
    WHEN NEW.status = 'agendado'::public.onb_treino_status    THEN 'agendado'
    ELSE 'previsto' END;

  INSERT INTO public.support_ticket_events (tenant_id, ticket_id, user_id, event_type, old_value, new_value, content, origem_sub_ticket_id)
  VALUES (NEW.tenant_id, v_parent, auth.uid(), 'onboarding_treino_status',
          OLD.status::text, NEW.status::text,
          COALESCE(v_code, NEW.titulo) || ' · ' || v_rotulo, NEW.ticket_id);

  RETURN NEW;
END $function$;

-- ---------------------------------------------------------------------------
-- Mover de etapa. Mudanças:
--  · entrar na coluna de conclusão NÃO transforma desistência em "realizado";
--  · arrastar para fora da conclusão estorna tanto o realizado quanto a desistência
--    (o carimbo de quem encerrou é limpo pelo trigger de stamp).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.move_onboarding_training_stage(p_training_id uuid, p_target_stage_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid; v_journey uuid; v_ticket uuid; v_parent uuid; v_current uuid;
  v_status public.onb_treino_status; v_deleted timestamptz;
  v_now timestamptz := now(); v_open uuid; v_hist_stage uuid; v_dept uuid;
  v_cur_nome text; v_tgt_nome text; v_is_final boolean; v_titulo text; v_code text;
  v_pendente boolean := false;
  v_from_final boolean := false; v_estornou boolean := false;
  v_desistencia boolean := false;
BEGIN
  SELECT t.tenant_id, t.journey_id, t.ticket_id, t.current_stage_id, t.status, t.deleted_at, t.titulo
    INTO v_tenant, v_journey, v_ticket, v_current, v_status, v_deleted, v_titulo
    FROM public.onboarding_training_sessions t WHERE t.id = p_training_id;

  IF v_tenant IS NULL THEN RAISE EXCEPTION 'treino nao encontrado'; END IF;
  IF NOT public.can_access_tenant_row(v_tenant) THEN RAISE EXCEPTION 'sem permissao'; END IF;
  IF v_deleted IS NOT NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'treino_excluido'); END IF;
  IF v_status = 'cancelado'::public.onb_treino_status THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'treino_cancelado');
  END IF;

  v_desistencia := v_status = 'desistencia'::public.onb_treino_status;

  SELECT s.id IS NOT NULL INTO v_is_final FROM public.onboarding_stages s WHERE s.id = p_target_stage_id;
  IF NOT COALESCE(v_is_final, false) THEN RAISE EXCEPTION 'etapa destino nao encontrada'; END IF;

  SELECT h.id, h.stage_id INTO v_open, v_hist_stage
    FROM public.onboarding_training_stage_history h
   WHERE h.training_id = p_training_id AND h.saiu_em IS NULL
   ORDER BY h.entrou_em DESC LIMIT 1;

  IF v_open IS NOT NULL THEN
    SELECT COALESCE(p.department_id, tk.department_id) INTO v_dept
      FROM public.onboarding_stages s
      JOIN public.onboarding_pipelines p ON p.id = s.pipeline_id
      LEFT JOIN public.support_tickets tk ON tk.id = v_ticket
     WHERE s.id = v_hist_stage;

    UPDATE public.onboarding_training_stage_history
       SET saiu_em = v_now,
           duracao_minutos = GREATEST(0, EXTRACT(EPOCH FROM (v_now - entrou_em))/60)::int,
           duracao_util_minutos = public.fn_onb_util_min(entrou_em, v_now, v_tenant, v_dept)
     WHERE id = v_open;
  END IF;

  SELECT COALESCE(s.is_final, false) INTO v_is_final
    FROM public.onboarding_stages s WHERE s.id = p_target_stage_id;

  -- Etapa de ORIGEM: o estorno só vale para quem estava na coluna de conclusão.
  SELECT COALESCE(s.is_final, false) INTO v_from_final
    FROM public.onboarding_stages s WHERE s.id = v_current;
  v_from_final := COALESCE(v_from_final, false);

  v_estornou := (NOT v_is_final) AND v_from_final
                AND v_status IN ('realizado'::public.onb_treino_status,
                                 'desistencia'::public.onb_treino_status);

  UPDATE public.onboarding_training_sessions
     SET current_stage_id = p_target_stage_id,
         status = CASE
           -- Desistência entrando na conclusão continua desistência: o treino não
           -- aconteceu, e virar "realizado" aqui inflaria o painel.
           WHEN v_is_final AND v_desistencia THEN status
           WHEN v_is_final AND status <> 'realizado'::public.onb_treino_status
             THEN 'realizado'::public.onb_treino_status
           WHEN v_estornou
             THEN CASE WHEN agendado_para IS NOT NULL
                       THEN 'agendado'::public.onb_treino_status
                       ELSE 'previsto'::public.onb_treino_status END
           ELSE status END,
         realizado_em = CASE
           WHEN v_is_final AND v_desistencia THEN realizado_em
           WHEN v_is_final THEN COALESCE(realizado_em, v_now)
           WHEN v_estornou THEN NULL
           ELSE realizado_em END,
         updated_at = v_now
   WHERE id = p_training_id;

  INSERT INTO public.onboarding_training_stage_history (tenant_id, training_id, journey_id, stage_id)
  VALUES (v_tenant, p_training_id, v_journey, p_target_stage_id);

  SELECT nome INTO v_cur_nome FROM public.onboarding_stages WHERE id = v_current;
  SELECT nome INTO v_tgt_nome FROM public.onboarding_stages WHERE id = p_target_stage_id;
  SELECT tk.parent_ticket_id, tk.ticket_code INTO v_parent, v_code
    FROM public.support_tickets tk WHERE tk.id = v_ticket;

  INSERT INTO public.support_ticket_events (tenant_id, ticket_id, user_id, event_type, old_value, new_value, content, origem_sub_ticket_id)
  VALUES (v_tenant, COALESCE(v_parent, v_ticket), auth.uid(), 'onboarding_treino_movido',
          v_cur_nome, v_tgt_nome,
          COALESCE(v_code, v_titulo) || ' → ' || COALESCE(v_tgt_nome, '—')
            || CASE WHEN v_estornou AND v_desistencia THEN ' (desistência estornada)'
                    WHEN v_estornou THEN ' (conclusão estornada)'
                    ELSE '' END, v_ticket);

  -- Fechou o cartão com a chamada em aberto: avisa, não impede. Desistência não tem
  -- chamada para cobrar — ninguém participou.
  IF v_is_final AND NOT v_desistencia THEN
    SELECT count(*) = 0 OR count(*) FILTER (WHERE presente IS NULL) > 0
      INTO v_pendente
      FROM public.onboarding_training_participants WHERE training_id = p_training_id;
  END IF;

  RETURN jsonb_build_object('ok', true, 'stage_id', p_target_stage_id,
                            'realizado', v_is_final AND NOT v_desistencia,
                            'estornado', v_estornou,
                            'chamada_pendente', COALESCE(v_pendente, false));
END $function$;

-- ---------------------------------------------------------------------------
-- Marcar realizado agora ENCERRA o cartão: manda o sub-ticket para a coluna de
-- conclusão, em vez de deixá-lo parado esperando o arraste.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mark_onboarding_training_realized(p_training_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid; v_deleted timestamptz; v_status public.onb_treino_status;
  v_total int; v_pendentes int; v_now timestamptz := now();
  v_stage uuid; v_final uuid; v_moveu boolean := false;
BEGIN
  SELECT t.tenant_id, t.deleted_at, t.status, t.current_stage_id
    INTO v_tenant, v_deleted, v_status, v_stage
    FROM public.onboarding_training_sessions t WHERE t.id = p_training_id;

  IF v_tenant IS NULL THEN RAISE EXCEPTION 'treino nao encontrado'; END IF;
  IF NOT public.can_access_tenant_row(v_tenant) THEN RAISE EXCEPTION 'sem permissao'; END IF;

  IF v_deleted IS NOT NULL
     OR v_status IN ('cancelado'::public.onb_treino_status,
                     'desistencia'::public.onb_treino_status) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'treino_indisponivel');
  END IF;

  IF v_status = 'realizado'::public.onb_treino_status THEN
    RETURN jsonb_build_object('ok', true, 'reason', 'ja_realizado');
  END IF;

  SELECT count(*), count(*) FILTER (WHERE presente IS NULL)
    INTO v_total, v_pendentes
    FROM public.onboarding_training_participants WHERE training_id = p_training_id;

  IF v_total = 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'sem_participantes');
  END IF;

  IF v_pendentes > 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'presenca_pendente', 'pendentes', v_pendentes);
  END IF;

  UPDATE public.onboarding_training_sessions
     SET status = 'realizado'::public.onb_treino_status,
         realizado_em = COALESCE(realizado_em, v_now),
         updated_at = v_now
   WHERE id = p_training_id;

  -- O cartão fecha junto. Pipeline sem etapa de conclusão: degrada, não quebra — o
  -- treino fica realizado onde está, como era antes.
  v_final := public.fn_onb_etapa_final_do_treino(p_training_id);
  IF v_final IS NOT NULL AND v_final IS DISTINCT FROM v_stage THEN
    PERFORM public.move_onboarding_training_stage(p_training_id, v_final);
    v_moveu := true;
  END IF;

  RETURN jsonb_build_object('ok', true, 'participantes', v_total,
                            'moveu', v_moveu, 'stage_id', COALESCE(v_final, v_stage));
END $function$;

-- ---------------------------------------------------------------------------
-- Treino desistido não vira no-show, não é editado e não é excluído.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mark_onboarding_training_no_show(p_training_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid; v_status public.onb_treino_status; v_deleted timestamptz;
  v_stage uuid; v_pipe uuid; v_destino uuid; v_ag timestamptz;
  v_now timestamptz := now(); v_n int;
BEGIN
  SELECT t.tenant_id, t.status, t.deleted_at, t.current_stage_id, t.agendado_para
    INTO v_tenant, v_status, v_deleted, v_stage, v_ag
    FROM public.onboarding_training_sessions t WHERE t.id = p_training_id;

  IF v_tenant IS NULL THEN RAISE EXCEPTION 'treino nao encontrado'; END IF;
  IF NOT public.can_access_tenant_row(v_tenant) THEN RAISE EXCEPTION 'sem permissao'; END IF;
  IF v_deleted IS NOT NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'treino_excluido'); END IF;
  IF v_status = 'cancelado'::public.onb_treino_status THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'treino_cancelado');
  END IF;
  IF v_status = 'desistencia'::public.onb_treino_status THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'treino_desistencia');
  END IF;
  IF v_status = 'realizado'::public.onb_treino_status THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'treino_realizado');
  END IF;

  -- Etapa de retorno do pipeline em que o cartão está. Sem a flag configurada, a falta
  -- ainda é registrada e a agenda limpa: degrada, não quebra.
  SELECT s.pipeline_id INTO v_pipe FROM public.onboarding_stages s WHERE s.id = v_stage;
  IF v_pipe IS NOT NULL THEN
    SELECT s.id INTO v_destino FROM public.onboarding_stages s
     WHERE s.pipeline_id = v_pipe AND s.retorno_no_show AND s.ativo LIMIT 1;
  END IF;

  IF v_destino IS NOT NULL AND v_destino IS DISTINCT FROM v_stage THEN
    PERFORM public.move_onboarding_training_stage(p_training_id, v_destino);
  END IF;

  UPDATE public.onboarding_training_sessions
     SET no_shows          = no_shows + 1,
         no_show           = true,
         ultimo_no_show_em = COALESCE(v_ag, v_now),
         agendado_para     = NULL,
         status            = 'previsto'::public.onb_treino_status,
         updated_at        = v_now
   WHERE id = p_training_id
   RETURNING no_shows INTO v_n;

  RETURN jsonb_build_object('ok', true, 'no_shows', v_n,
                            'stage_id', COALESCE(v_destino, v_stage),
                            'moveu', v_destino IS NOT NULL AND v_destino IS DISTINCT FROM v_stage);
END $function$;

CREATE OR REPLACE FUNCTION public.update_onboarding_training(p_training_id uuid, p_titulo text DEFAULT NULL::text, p_training_type_id uuid DEFAULT NULL::uuid, p_conduzido_por uuid DEFAULT NULL::uuid, p_agendado_para timestamp with time zone DEFAULT NULL::timestamp with time zone, p_link text DEFAULT NULL::text, p_limpar_conduzido boolean DEFAULT false, p_limpar_agendado boolean DEFAULT false, p_limpar_link boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid; v_ticket uuid; v_parent uuid; v_code text; v_deleted timestamptz;
  v_titulo_ant text; v_cond_ant uuid; v_now timestamptz := now();
  v_titulo_novo text; v_cond_novo uuid; v_mudou text[] := '{}';
  v_stage uuid; v_ini uuid; v_status public.onb_treino_status;
BEGIN
  SELECT t.tenant_id, t.ticket_id, t.deleted_at, t.titulo, t.conduzido_por, t.status
    INTO v_tenant, v_ticket, v_deleted, v_titulo_ant, v_cond_ant, v_status
    FROM public.onboarding_training_sessions t WHERE t.id = p_training_id;

  IF v_tenant IS NULL THEN RAISE EXCEPTION 'treino nao encontrado'; END IF;
  IF NOT public.can_access_tenant_row(v_tenant) THEN RAISE EXCEPTION 'sem permissao'; END IF;
  IF v_deleted IS NOT NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'treino_excluido'); END IF;
  -- Desistência é desfecho fechado e ocupa a coluna de conclusão: editar data ou título
  -- ali dentro só produziria cartão incoerente. (O `cancelado` sai do quadro e sempre
  -- aceitou edição — não mexo nisso aqui.)
  IF v_status = 'desistencia'::public.onb_treino_status THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'treino_desistencia');
  END IF;

  v_titulo_novo := COALESCE(NULLIF(btrim(COALESCE(p_titulo, '')), ''), v_titulo_ant);
  v_cond_novo   := CASE WHEN p_limpar_conduzido THEN NULL ELSE COALESCE(p_conduzido_por, v_cond_ant) END;

  UPDATE public.onboarding_training_sessions
     SET titulo           = v_titulo_novo,
         training_type_id = COALESCE(p_training_type_id, training_type_id),
         conduzido_por    = v_cond_novo,
         agendado_para    = CASE WHEN p_limpar_agendado THEN NULL
                                 ELSE COALESCE(p_agendado_para, agendado_para) END,
         link_agendamento = CASE WHEN p_limpar_link THEN NULL
                                 ELSE COALESCE(NULLIF(btrim(COALESCE(p_link,'')),''), link_agendamento) END,
         status           = CASE
           WHEN status IN ('previsto'::public.onb_treino_status, 'no_show'::public.onb_treino_status)
                AND NOT p_limpar_agendado
                AND COALESCE(p_agendado_para, agendado_para) IS NOT NULL
             THEN 'agendado'::public.onb_treino_status
           ELSE status END,
         updated_at       = v_now
   WHERE id = p_training_id;

  -- o assunto do sub-ticket acompanha o título
  UPDATE public.support_tickets
     SET assunto = v_titulo_novo
   WHERE id = v_ticket AND assunto IS DISTINCT FROM v_titulo_novo;

  -- quem passa a conduzir vira implantador da jornada
  IF v_cond_novo IS NOT NULL AND v_cond_novo IS DISTINCT FROM v_cond_ant THEN
    SELECT tk.parent_ticket_id INTO v_parent FROM public.support_tickets tk WHERE tk.id = v_ticket;
    INSERT INTO public.onboarding_participants (tenant_id, ticket_id, user_id, role_id)
    VALUES (v_tenant, v_parent, v_cond_novo, public.fn_onboarding_role_id(v_tenant, 'implantador'))
    ON CONFLICT DO NOTHING;
  END IF;

  IF v_titulo_novo IS DISTINCT FROM v_titulo_ant THEN v_mudou := array_append(v_mudou, 'título'); END IF;
  IF v_cond_novo   IS DISTINCT FROM v_cond_ant   THEN v_mudou := array_append(v_mudou, 'responsável'); END IF;
  IF p_agendado_para IS NOT NULL OR p_limpar_agendado THEN v_mudou := array_append(v_mudou, 'data'); END IF;
  IF p_training_type_id IS NOT NULL THEN v_mudou := array_append(v_mudou, 'tipo'); END IF;
  IF p_link IS NOT NULL OR p_limpar_link THEN v_mudou := array_append(v_mudou, 'link'); END IF;

  IF array_length(v_mudou, 1) IS NOT NULL THEN
    SELECT tk.parent_ticket_id, tk.ticket_code INTO v_parent, v_code
      FROM public.support_tickets tk WHERE tk.id = v_ticket;
    INSERT INTO public.support_ticket_events (tenant_id, ticket_id, user_id, event_type, old_value, new_value, content, origem_sub_ticket_id)
    VALUES (v_tenant, COALESCE(v_parent, v_ticket), auth.uid(), 'onboarding_treino_editado',
            v_titulo_ant, v_titulo_novo,
            COALESCE(v_code, v_titulo_novo) || ' · ' || array_to_string(v_mudou, ', '), v_ticket);
  END IF;

  -- Remarcar de dentro da etapa de retorno devolve o cartão para onde o treino nasce.
  -- Agendar em qualquer outra etapa continua manual (decisão do owner, 11/08).
  IF NOT p_limpar_agendado AND p_agendado_para IS NOT NULL THEN
    SELECT t.current_stage_id INTO v_stage
      FROM public.onboarding_training_sessions t WHERE t.id = p_training_id;

    SELECT ini.id INTO v_ini
      FROM public.onboarding_stages atual
      JOIN public.onboarding_stages ini ON ini.pipeline_id = atual.pipeline_id
                                       AND ini.is_initial AND ini.ativo
     WHERE atual.id = v_stage AND atual.retorno_no_show
     LIMIT 1;

    IF v_ini IS NOT NULL AND v_ini IS DISTINCT FROM v_stage THEN
      PERFORM public.move_onboarding_training_stage(p_training_id, v_ini);
    END IF;
  END IF;

  RETURN jsonb_build_object('ok', true, 'mudou', to_jsonb(v_mudou));
END $function$;

CREATE OR REPLACE FUNCTION public.delete_onboarding_training(p_training_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid; v_ticket uuid; v_parent uuid; v_code text; v_titulo text;
  v_realizado timestamptz; v_deleted timestamptz; v_movimentos int;
  v_status public.onb_treino_status;
BEGIN
  SELECT t.tenant_id, t.ticket_id, t.realizado_em, t.deleted_at, t.titulo, t.status
    INTO v_tenant, v_ticket, v_realizado, v_deleted, v_titulo, v_status
    FROM public.onboarding_training_sessions t WHERE t.id = p_training_id;

  IF v_tenant IS NULL THEN RAISE EXCEPTION 'treino nao encontrado'; END IF;
  IF NOT public.can_access_tenant_row(v_tenant) THEN RAISE EXCEPTION 'sem permissao'; END IF;
  IF v_deleted IS NOT NULL THEN RETURN jsonb_build_object('ok', true, 'reason', 'ja_excluido'); END IF;

  IF v_realizado IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'treino_realizado');
  END IF;

  -- Desistência é histórico: o cliente recusou o treinamento e isso tem que sobrar no
  -- painel. Apagar esconderia justamente o número que o encerramento existe para contar.
  IF v_status = 'desistencia'::public.onb_treino_status THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'treino_desistencia');
  END IF;

  SELECT count(*) INTO v_movimentos
    FROM public.onboarding_training_stage_history h WHERE h.training_id = p_training_id;

  IF v_movimentos > 1 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'treino_com_movimento', 'movimentos', v_movimentos);
  END IF;

  SELECT tk.parent_ticket_id, tk.ticket_code INTO v_parent, v_code
    FROM public.support_tickets tk WHERE tk.id = v_ticket;

  UPDATE public.onboarding_training_sessions
     SET deleted_at = now(), deleted_by = auth.uid(), updated_at = now()
   WHERE id = p_training_id;

  UPDATE public.support_tickets
     SET deleted_at = now()
   WHERE id = v_ticket;

  INSERT INTO public.support_ticket_events (tenant_id, ticket_id, user_id, event_type, old_value, content, origem_sub_ticket_id)
  VALUES (v_tenant, COALESCE(v_parent, v_ticket), auth.uid(), 'onboarding_treino_excluido',
          v_code, COALESCE(v_code, '') || ' · ' || COALESCE(v_titulo, ''), v_ticket);

  RETURN jsonb_build_object('ok', true);
END $function$;

-- ---------------------------------------------------------------------------
-- Encerrar o sub-ticket por desistência do cliente.
-- Grava o desfecho, carimba quem/quando (pelo trigger de stamp) e manda o cartão
-- para a coluna de conclusão. A jornada NÃO volta para o Onboarding — só o
-- `cancelado` faz isso.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.desistir_onboarding_training(p_training_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid; v_status public.onb_treino_status; v_deleted timestamptz;
  v_stage uuid; v_final uuid; v_moveu boolean := false; v_now timestamptz := now();
BEGIN
  SELECT t.tenant_id, t.status, t.deleted_at, t.current_stage_id
    INTO v_tenant, v_status, v_deleted, v_stage
    FROM public.onboarding_training_sessions t WHERE t.id = p_training_id;

  IF v_tenant IS NULL THEN RAISE EXCEPTION 'treino nao encontrado'; END IF;
  IF NOT public.can_access_tenant_row(v_tenant) THEN RAISE EXCEPTION 'sem permissao'; END IF;
  IF v_deleted IS NOT NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'treino_excluido'); END IF;

  IF v_status = 'desistencia'::public.onb_treino_status THEN
    RETURN jsonb_build_object('ok', true, 'reason', 'ja_desistencia');
  END IF;
  IF v_status = 'cancelado'::public.onb_treino_status THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'treino_cancelado');
  END IF;
  IF v_status = 'realizado'::public.onb_treino_status THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'treino_realizado');
  END IF;

  UPDATE public.onboarding_training_sessions
     SET status = 'desistencia'::public.onb_treino_status,
         agendado_para = NULL,
         updated_at = v_now
   WHERE id = p_training_id;

  v_final := public.fn_onb_etapa_final_do_treino(p_training_id);
  IF v_final IS NOT NULL AND v_final IS DISTINCT FROM v_stage THEN
    PERFORM public.move_onboarding_training_stage(p_training_id, v_final);
    v_moveu := true;
  END IF;

  RETURN jsonb_build_object('ok', true, 'moveu', v_moveu, 'stage_id', COALESCE(v_final, v_stage));
END $function$;

REVOKE ALL ON FUNCTION public.desistir_onboarding_training(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.desistir_onboarding_training(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Views. `security_invoker=true` é REPOSTO de propósito: CREATE OR REPLACE VIEW sem a
-- cláusula descarta a opção e a view passa a rodar como dona, furando o RLS.
-- ---------------------------------------------------------------------------

-- Cartão do quadro: quem encerrou o sub-ticket aparece na tarja.
CREATE OR REPLACE VIEW public.vw_onboarding_training_cards
WITH (security_invoker = true) AS
 SELECT t.id AS training_id,
    t.tenant_id,
    t.journey_id,
    t.ticket_id,
    tk.ticket_code,
    tk.sub_seq,
    pai.id AS parent_ticket_id,
    pai.ticket_code AS parent_ticket_code,
    t.titulo,
    t.status::text AS status,
    t.agendado_para,
    t.realizado_em,
    t.tentativas,
    t.no_show,
    t.is_retreinamento,
    t.link_agendamento,
    t.current_stage_id,
    t.conduzido_por,
    f.nome AS conduzido_por_nome,
    t.training_type_id,
    tt.nome AS training_type_nome,
    j.cliente_id,
    COALESCE(c.nome_fantasia, c.razao_social) AS cliente_nome,
    c.unidade_base_id AS cliente_unidade_id,
    j.situacao::text AS journey_situacao,
    j.demand_type_id,
    dt.nome AS demand_type_nome,
    dt.cor AS demand_type_cor,
    h.entrou_em AS etapa_entrou_em,
    t.created_at,
    t.cancelado_em,
    j.implantacao_iniciada_em,
    t.status = 'cancelado'::onb_treino_status AND j.implantacao_iniciada_em IS NOT NULL AND t.cancelado_em IS NOT NULL AND t.cancelado_em >= j.implantacao_iniciada_em AS cancelado_na_implantacao,
    COALESCE(pt.total, 0::bigint)::integer AS participantes_total,
    COALESCE(pt.presentes, 0::bigint)::integer AS participantes_presentes,
    COALESCE(pt.total, 0::bigint) = 0 OR COALESCE(pt.pendentes, 0::bigint) > 0 AS chamada_pendente,
    t.no_shows,
    t.ultimo_no_show_em,
    t.cancelado_por,
    fenc.nome AS cancelado_por_nome
   FROM onboarding_training_sessions t
     JOIN support_tickets tk ON tk.id = t.ticket_id
     LEFT JOIN support_tickets pai ON pai.id = tk.parent_ticket_id
     JOIN onboarding_journeys j ON j.id = t.journey_id
     LEFT JOIN clientes c ON c.id = j.cliente_id
     LEFT JOIN onboarding_training_types tt ON tt.id = t.training_type_id
     LEFT JOIN onboarding_demand_types dt ON dt.id = j.demand_type_id
     LEFT JOIN profiles p ON p.user_id = t.conduzido_por
     LEFT JOIN funcionarios f ON f.id = p.funcionario_id
     LEFT JOIN profiles penc ON penc.user_id = t.cancelado_por
     LEFT JOIN funcionarios fenc ON fenc.id = penc.funcionario_id
     LEFT JOIN LATERAL ( SELECT hh.entrou_em
           FROM onboarding_training_stage_history hh
          WHERE hh.training_id = t.id AND hh.saiu_em IS NULL
          ORDER BY hh.entrou_em DESC
         LIMIT 1) h ON true
     LEFT JOIN LATERAL ( SELECT count(*) AS total,
            count(*) FILTER (WHERE pp.presente) AS presentes,
            count(*) FILTER (WHERE pp.presente IS NULL) AS pendentes
           FROM onboarding_training_participants pp
          WHERE pp.training_id = t.id) pt ON true
  WHERE t.deleted_at IS NULL;

-- KPIs do painel. Faltavam `no_shows`/`ultimo_no_show_em` desde 11/08: a tela pedia as
-- duas e a view não tinha, então TODA a seção de treinos do painel vinha de um 400.
CREATE OR REPLACE VIEW public.vw_onboarding_training_kpis
WITH (security_invoker = true) AS
 SELECT ts.tenant_id,
    ts.training_type_id,
    tt.nome AS tipo_nome,
    tt.conta_como_pdv,
    ts.status,
    ts.no_show,
    ts.proprietario_presente,
    ts.is_retreinamento,
    ts.conduzido_por,
    ts.agendado_para,
    ts.realizado_em,
    ts.tentativas,
    ts.journey_id,
    ts.no_shows,
    ts.ultimo_no_show_em,
    ts.id,
    ts.titulo,
    ts.cancelado_em,
    ts.cancelado_por
   FROM onboarding_training_sessions ts
     LEFT JOIN onboarding_training_types tt ON tt.id = ts.training_type_id
  WHERE ts.deleted_at IS NULL;
