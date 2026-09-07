-- DEM-0353: "aguarde" do atendente suspende a régua de inatividade do cliente.
--
-- Contexto: o relógio de inatividade JÁ zerava com a mensagem do operador — o
-- que faltava era prazo. Ao responder, fn_track_awaiting_agent limpa
-- awaiting_agent_since, a bola passa formalmente para o cliente, e a régua
-- passa a correr contra alguém que não tem o que responder.
--
-- Medido em produção (30 dias, 07/09/2026): dos 2.789 encerramentos por
-- inatividade em 1:1, 135 tinham um "aguarde" do atendente como última
-- mensagem da conversa, e 41 desses (30,4%) voltaram a falar em até 2h.
--
-- Regra: mensagem do atendente pedindo paciência grava inactivity_hold_until.
-- Enquanto ela não vence, o atendimento sai da fila do motor; quando vence, o
-- relógio RECOMEÇA de lá — não de last_activity.
--
-- Rodar: docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/42_autohold_inatividade_aguarde.sql
-- Espera-se terminar com  ERROR: SMOKE_AUTOHOLD|... TODOS OK  (a exception é o
-- que devolve o resultado e garante o rollback).
BEGIN;

-- Isola o gatilho do teste: os outros 5 de whatsapp_messages exigiriam a
-- fixture inteira (instância, setor, perfil) e não são o que se está provando.
ALTER TABLE public.whatsapp_messages DISABLE TRIGGER USER;
ALTER TABLE public.whatsapp_messages ENABLE TRIGGER trg_inactivity_autohold;
ALTER TABLE public.support_attendances DISABLE TRIGGER USER;
ALTER TABLE public.whatsapp_conversations DISABLE TRIGGER USER;

DO $$
DECLARE
  t uuid := '00000000-0000-0000-0000-000000d353aa';
  ct uuid; cv uuid; att uuid; usr uuid;
  r text := ''; v_hold timestamptz; v_reason text; v_warn timestamptz; v_bool boolean; n int;
  -- casos da detecção pura: {texto, rótulo esperado}
  casos text[][] := ARRAY[
    ARRAY['Um momento','momento'],              ARRAY['um momento por favor','momento'],
    ARRAY['Só um instante!','momento'],         ARRAY['só um segundinho','momento'],
    ARRAY['SÓ UM MINUTINHO','momento'],         ARRAY['aguarde por favor','aguarde'],
    ARRAY['Me aguarde que já verifico','aguarde'], ARRAY['Aguardando o retorno do setor','aguarde'],
    ARRAY['ja retorno','ja_retorno'],           ARRAY['Já te retorno em breve','ja_retorno'],
    ARRAY['vou verificar aqui pra voce','verificando'],
    ARRAY['Estou consultando o financeiro','verificando'],
    -- e o que NÃO pode casar
    ARRAY['Bom dia, tudo bem?', NULL],          ARRAY['Segue o boleto em anexo', NULL],
    ARRAY['O prazo é de um dia util', NULL],    ARRAY['Obrigado pelo contato!', NULL],
    ARRAY['O sistema esta fora do ar', NULL],   ARRAY['Seu protocolo e 12345', NULL]
  ];
  i int; got text; want text;
BEGIN
  -- ── 1. Detecção, sem banco ────────────────────────────────────────────────
  FOR i IN 1 .. array_length(casos,1) LOOP
    want := casos[i][2];
    got  := public.fn_inactivity_autohold_match(casos[i][1], NULL);
    IF got IS DISTINCT FROM want THEN
      r := r || format(' MATCH_FALHOU[%s] esperado=%s obtido=%s |',
                       casos[i][1], COALESCE(want,'NULL'), COALESCE(got,'NULL'));
    END IF;
  END LOOP;

  -- termo extra do tenant casa por substring; termo curto demais é ignorado
  IF public.fn_inactivity_autohold_match('deixa comigo que ja resolvo', 'deixa comigo') IS NULL THEN
    r := r || ' EXTRA_FALHOU(termo do tenant nao casou) |';
  END IF;
  IF public.fn_inactivity_autohold_match('qualquer coisa aqui', 'ok,.,a') IS NOT NULL THEN
    r := r || ' EXTRA_FALHOU(termo curto deveria ser ignorado) |';
  END IF;

  -- ── fixture ───────────────────────────────────────────────────────────────
  SELECT id INTO usr FROM auth.users LIMIT 1;
  INSERT INTO public.tenants(id, nome) VALUES (t, 'Tenant DEM-0353') ON CONFLICT DO NOTHING;
  INSERT INTO public.configuracoes(tenant_id, support_inactivity_autohold_enabled, support_inactivity_autohold_minutes)
    VALUES (t, false, 30);
  INSERT INTO public.whatsapp_contacts(tenant_id, phone_number) VALUES (t,'5511999990000') RETURNING id INTO ct;
  INSERT INTO public.whatsapp_conversations(tenant_id, contact_id) VALUES (t, ct) RETURNING id INTO cv;
  -- Aviso de inatividade JÁ enviado há 6 min: é exatamente a screenshot da demanda.
  INSERT INTO public.support_attendances(tenant_id, conversation_id, contact_id, status, opened_at,
      last_operator_message_at, inactivity_warning_sent_at, is_group)
    VALUES (t, cv, ct, 'in_progress', now()-interval '40 min', now()-interval '40 min',
            now()-interval '6 min', false)
    RETURNING id INTO att;

  -- ── A. flag desligada: nada acontece ──────────────────────────────────────
  INSERT INTO public.whatsapp_messages(tenant_id, conversation_id, message_id, content, is_from_me, message_type, sent_by_user_id)
    VALUES (t, cv, 'm-a', 'Um momento', true, 'text', usr);
  SELECT inactivity_hold_until INTO v_hold FROM public.support_attendances WHERE id=att;
  IF v_hold IS NOT NULL THEN r := r || ' A_FALHOU(pausou com a flag off) |'; END IF;

  UPDATE public.configuracoes SET support_inactivity_autohold_enabled = true WHERE tenant_id = t;

  -- ── B. mensagem AUTOMÁTICA com "aguarde": a cláusula WHEN tem que barrar ──
  -- O texto da URA e o de fora de expediente pedem para aguardar. Se passassem,
  -- congelariam a régua do tenant inteiro.
  INSERT INTO public.whatsapp_messages(tenant_id, conversation_id, message_id, content, is_from_me, message_type, metadata)
    VALUES (t, cv, 'm-b', 'Aguarde, você está na fila', true, 'text', '{"system":true,"ura":1}'::jsonb);
  SELECT inactivity_hold_until INTO v_hold FROM public.support_attendances WHERE id=att;
  IF v_hold IS NOT NULL THEN r := r || ' B_FALHOU(mensagem automatica pausou) |'; END IF;

  -- ── C. texto comum do atendente: não pausa ───────────────────────────────
  INSERT INTO public.whatsapp_messages(tenant_id, conversation_id, message_id, content, is_from_me, message_type, sent_by_user_id)
    VALUES (t, cv, 'm-c', 'Bom dia, segue o boleto', true, 'text', usr);
  SELECT inactivity_hold_until INTO v_hold FROM public.support_attendances WHERE id=att;
  IF v_hold IS NOT NULL THEN r := r || ' C_FALHOU(texto comum pausou) |'; END IF;

  -- ── D. o caso da demanda ─────────────────────────────────────────────────
  INSERT INTO public.whatsapp_messages(tenant_id, conversation_id, message_id, content, is_from_me, message_type, sent_by_user_id)
    VALUES (t, cv, 'm-d', 'Um momento', true, 'text', usr);
  SELECT inactivity_hold_until, inactivity_hold_reason, inactivity_warning_sent_at
    INTO v_hold, v_reason, v_warn FROM public.support_attendances WHERE id=att;
  IF v_hold IS NULL THEN r := r || ' D_FALHOU(nao pausou) |';
  ELSIF abs(extract(epoch FROM (v_hold - (now()+interval '30 min')))) > 5 THEN
    r := r || ' D_FALHOU(duracao errada) |';
  ELSIF v_reason <> 'momento' THEN r := r || ' D_FALHOU(reason='||v_reason||') |';
  -- sem zerar o aviso, needs_close dispararia 5 min depois dele e a pausa
  -- não teria servido para nada
  ELSIF v_warn IS NOT NULL THEN r := r || ' D_FALHOU(aviso nao foi zerado) |';
  END IF;

  -- ── E. resposta pelo CELULAR (sem sent_by_user_id, source=self_hosted) ────
  UPDATE public.support_attendances SET inactivity_hold_until=NULL, inactivity_hold_reason=NULL WHERE id=att;
  INSERT INTO public.whatsapp_messages(tenant_id, conversation_id, message_id, content, is_from_me, message_type, metadata)
    VALUES (t, cv, 'm-e', 'ja retorno', true, 'text', '{"source":"self_hosted"}'::jsonb);
  SELECT inactivity_hold_until, inactivity_hold_reason INTO v_hold, v_reason
    FROM public.support_attendances WHERE id=att;
  IF v_hold IS NULL THEN r := r || ' E_FALHOU(resposta pelo celular nao pausou) |';
  ELSIF v_reason <> 'ja_retorno' THEN r := r || ' E_FALHOU(reason='||v_reason||') |'; END IF;

  -- ── F. fila do motor ─────────────────────────────────────────────────────
  -- F1: pausa ATIVA -> fora da fila
  UPDATE public.support_attendances
     SET inactivity_hold_until = now()+interval '10 min',
         inactivity_warning_sent_at = NULL,
         last_operator_message_at = now()-interval '120 min'
   WHERE id=att;
  SELECT count(*) INTO n FROM public.get_inactive_attendances_to_process(500) WHERE id=att;
  IF n <> 0 THEN r := r || ' F1_FALHOU(atendimento pausado apareceu na fila) |'; END IF;

  -- F2: pausa vencida há 1 min -> relógio recomeça, ainda não é hora de avisar.
  -- Sem o GREATEST do hold em last_activity, os 120 min de silêncio contariam e
  -- o aviso sairia no ciclo seguinte ao fim da pausa.
  UPDATE public.support_attendances SET inactivity_hold_until = now()-interval '1 min' WHERE id=att;
  SELECT count(*) INTO n FROM public.get_inactive_attendances_to_process(500) WHERE id=att;
  IF n <> 0 THEN r := r || ' F2_FALHOU(relogio nao recomecou do fim da pausa) |'; END IF;

  -- F3: pausa vencida há 40 min -> passou dos 25 (30-5) -> volta a avisar
  UPDATE public.support_attendances SET inactivity_hold_until = now()-interval '40 min' WHERE id=att;
  SELECT count(*) INTO n FROM public.get_inactive_attendances_to_process(500) WHERE id=att AND needs_warn;
  IF n <> 1 THEN r := r || ' F3_FALHOU(nao voltou a avisar depois da pausa) |'; END IF;

  -- F4: controle. Sem pausa nenhuma, a régua histórica continua idêntica.
  UPDATE public.support_attendances SET inactivity_hold_until = NULL WHERE id=att;
  SELECT count(*) INTO n FROM public.get_inactive_attendances_to_process(500) WHERE id=att AND needs_warn;
  IF n <> 1 THEN r := r || ' F4_FALHOU(regua normal quebrou) |'; END IF;

  -- ── G. o fechamento tem que matar a pausa ────────────────────────────────
  -- fn_clear_inactivity_hold_on_close é anterior ao inactivity_hold_until. Sem
  -- a correção, atendimento que fecha com pausa pendente reabre com ela de pé e
  -- fica invisível para a régua até vencer.
  ALTER TABLE public.support_attendances ENABLE TRIGGER trg_clear_inactivity_hold_on_close;
  UPDATE public.support_attendances
     SET inactivity_hold = true, inactivity_hold_until = now()+interval '25 min',
         inactivity_hold_reason = 'momento'
   WHERE id=att;

  UPDATE public.support_attendances
     SET status='closed', closed_reason='system', closed_at=now() WHERE id=att;
  SELECT inactivity_hold_until, inactivity_hold_reason, inactivity_hold
    INTO v_hold, v_reason, v_bool FROM public.support_attendances WHERE id=att;
  IF v_hold   IS NOT NULL  THEN r := r || ' G1_FALHOU(pausa sobreviveu ao fechamento) |'; END IF;
  IF v_reason IS NOT NULL  THEN r := r || ' G1_FALHOU(reason sobreviveu) |'; END IF;
  IF v_bool   IS NOT false THEN r := r || ' G1_FALHOU(hold manual sobreviveu) |'; END IF;

  -- G2: reabertura é roteamento novo, não pode herdar pausa
  UPDATE public.support_attendances SET status='in_progress' WHERE id=att;
  SELECT inactivity_hold_until INTO v_hold FROM public.support_attendances WHERE id=att;
  IF v_hold IS NOT NULL THEN r := r || ' G2_FALHOU(reabriu com pausa) |'; END IF;

  -- G3: controle. Mudança de status que NÃO é fechamento preserva a pausa.
  UPDATE public.support_attendances
     SET inactivity_hold_until = now()+interval '25 min', status='waiting' WHERE id=att;
  SELECT inactivity_hold_until INTO v_hold FROM public.support_attendances WHERE id=att;
  IF v_hold IS NULL THEN r := r || ' G3_FALHOU(limpou pausa fora do fechamento) |'; END IF;

  RAISE EXCEPTION 'SMOKE_AUTOHOLD|%',
    CASE WHEN r = '' THEN '18 casos de deteccao + extras + A,B,C,D,E,F1..F4,G1..G3 TODOS OK' ELSE r END;
END $$;

ROLLBACK;
