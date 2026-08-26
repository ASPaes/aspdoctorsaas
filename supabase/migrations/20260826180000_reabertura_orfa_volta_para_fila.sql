-- Reabertura orfa volta para a fila (26/08/2026)
--
-- Queixa: no Athuz o operador Robert Silva nao atende mais (profiles.status =
-- 'inativo') e o setor dele, Comercial, esta desativado. Se um dos clientes dele
-- voltar a escrever, o chat tem que ir para a FILA -- qualquer operador da a
-- sequencia -- e nao voltar para o nome dele.
--
-- O QUE JA ESTAVA CERTO e por isso NAO e tocado aqui:
--   * fn_assign_conversation_if_ready ja filtra o pool por profiles.status =
--     'ativo'. Operador inativo NUNCA e sorteado.
--   * sendUraWelcome/handleUraResponse ja filtram support_departments.is_active.
--     Setor desativado nao aparece no menu e nao pode ser escolhido.
--   * fn_clear_conversation_assigned_on_close zera assigned_to e department_id
--     da conversa a cada encerramento.
--
-- O BURACO: a JANELA DE REABERTURA (support_reopen_window_minutes, default 10).
-- ensureAttendanceForIncomingMessage reabre o MESMO atendimento e devolve
-- `assigned_to = ultimo operador` ja como 'in_progress', sem checar se ele ainda
-- esta ativo. O AFTER fn_restore_conv_assigned_on_reopen carimba isso na
-- conversa junto com o setor antigo, e ai fn_assign_conversation_if_ready sai em
-- 'already_assigned'. Resultado: chat vivo com dono fantasma, num setor sem
-- regra de distribuicao ativa (Comercial tem 0). Ninguem recebe, ninguem ve.
--
-- POR QUE NO BANCO E NAO NA EDGE FUNCTION: sao TRES caminhos de reabertura
-- (customer 10min, out-of-hours 60min, billing) e os tres passam por este mesmo
-- funil de triggers. Pior: os dois ultimos nem tocam em assigned_to -- e o
-- proprio fn_restore_conv_assigned_on_reopen que reinjeta o dono fantasma
-- sozinho, lendo o campo que ficou na linha. Corrigir so o primeiro caminho
-- deixaria os outros dois quebrados. E mexer em _shared dispararia deploy das
-- 66 edge functions do repo.
--
-- NOME COM zzz: Postgres dispara trigger em ordem ALFABETICA do nome. Este
-- precisa ser o ULTIMO BEFORE, depois de trg_zz_operador_responsavel (que pode
-- atribuir dono/setor a partir do contato) e de trg_sync_attendance_department.
-- Quem fala por ultimo decide.
--
-- BEFORE puro, so mexe em NEW: zero risco de recursao. Os AFTER que espelham na
-- conversa (fn_mirror_attendance_to_conversation, fn_restore_conv_assigned_on_reopen)
-- so PREENCHEM campo NULL, nunca sobrescrevem -- entao, com NEW limpo, eles nao
-- tem o que restaurar.
--
-- FORA DE ESCOPO por decisao do owner: chat que esta ABERTO no momento em que o
-- operador e desativado. Nenhum trigger de reabertura o alcanca, porque ele
-- nunca fechou. Athuz tem 0 hoje. Fica para uma entrega separada.

-- 1) O CHECK precisa aceitar os motivos novos ANTES do trigger existir.
--    Mesma armadilha do closed_reason/'ura_encerrado': sem isto o UPDATE de
--    reabertura falharia -- e o erro seria engolido pelo EXCEPTION do dispatch.
--    agent_offline NAO serve: descreve quem esta offline agora, nao quem saiu da
--    empresa. Confundir os dois estraga a leitura da fila.
-- lock_timeout: ALTER TABLE pega ACCESS EXCLUSIVE. A tabela tem 30k linhas / 42 MB,
-- entao o scan e de milissegundos -- o risco nao e o scan, e ficar preso na FILA
-- de lock atras de uma transacao longa e travar o atendimento inteiro junto.
-- Falhar limpo em 3s e melhor que segurar a tabela quente.
SET LOCAL lock_timeout = '3s';

ALTER TABLE public.support_attendances
  DROP CONSTRAINT IF EXISTS chk_support_attendances_queue_reason;

ALTER TABLE public.support_attendances
  ADD CONSTRAINT chk_support_attendances_queue_reason CHECK (
    last_queue_reason IS NULL OR last_queue_reason = ANY (ARRAY[
      'acceptance_timeout','agent_offline','agent_shift_end','manual_reassign',
      'department_changed','initial_enqueue','no_active_rule',
      'max_retries_kept_assigned','claimed_manually',
      'owner_inactive','department_inactive'
    ])
  );

-- 2) O trigger.
CREATE OR REPLACE FUNCTION public.fn_reopen_orfao_para_fila()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_owner_ativo   BOOLEAN := true;
  v_setor_ativo   BOOLEAN := true;
  v_motivo        TEXT;
BEGIN
  -- So a transicao de reabertura. Qualquer outro UPDATE passa reto.
  IF NOT (OLD.status IN ('closed','inactive_closed')
          AND NEW.status IN ('waiting','in_progress')) THEN
    RETURN NEW;
  END IF;

  IF NEW.assigned_to IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = NEW.assigned_to
        AND p.tenant_id = NEW.tenant_id
        AND p.status = 'ativo'
    ) INTO v_owner_ativo;
  END IF;

  IF NEW.department_id IS NOT NULL THEN
    SELECT COALESCE(d.is_active, false) INTO v_setor_ativo
    FROM public.support_departments d
    WHERE d.id = NEW.department_id;
    -- Setor apagado (SELECT sem linha) conta como morto, nao como vivo.
    v_setor_ativo := COALESCE(v_setor_ativo, false);
  END IF;

  IF v_owner_ativo AND v_setor_ativo THEN
    RETURN NEW;  -- reabertura normal: continuidade com o ultimo agente, regra de 24/08.
  END IF;

  IF NOT v_owner_ativo THEN
    NEW.assigned_to            := NULL;
    NEW.assumed_at             := NULL;
    NEW.acceptance_deadline_at := NULL;
    v_motivo := 'owner_inactive';
  END IF;

  IF NOT v_setor_ativo THEN
    -- Sem setor a conversa cai na fila dos setores da INSTANCIA dela
    -- (whatsapp_list_queue, 23/08/2026) -- fica visivel, nao encalha.
    NEW.department_id := NULL;
    v_motivo := COALESCE(v_motivo, 'department_inactive');
  END IF;

  -- 'waiting' + assigned_to NULL e exatamente o que
  -- fn_trg_dispatch_on_attendance_ready (AFTER) exige para chamar o motor.
  NEW.status             := 'waiting';
  NEW.queued_at          := COALESCE(NEW.queued_at, now());
  NEW.last_queue_reason  := v_motivo;
  NEW.updated_at         := now();

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_zzz_reopen_orfao_para_fila ON public.support_attendances;
CREATE TRIGGER trg_zzz_reopen_orfao_para_fila
  BEFORE UPDATE ON public.support_attendances
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_reopen_orfao_para_fila();
