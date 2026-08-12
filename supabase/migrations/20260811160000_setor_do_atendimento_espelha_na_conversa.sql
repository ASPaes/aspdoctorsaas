-- 11/08/2026 -- CTM: o mesmo atendimento aparecia em "Atendendo" para um usuario
-- e em "Encerrados" para outro.
--
-- Caso medido (conv 4b60d3b4-af9e-4e6b-9886-b90a95ec14a4, CTM):
--   whatsapp_conversations.department_id = NULL
--   support_attendances.department_id    = 'Suporte PDV Legal'  (dono: Marco)
--
-- As duas policies de SELECT nao sao simetricas:
--   whatsapp_conversations -> setor igual OU department_id IS NULL  (NULL = tenant inteiro)
--   support_attendances    -> setor igual (ou admin/head)
--
-- Com esse par, a conversa e visivel para todo o tenant e o atendimento so para
-- o setor do dono. whatsapp_list_conversations e SECURITY INVOKER, entao o
-- LEFT JOIN LATERAL do atendimento volta VAZIO para os demais, sa.status fica
-- NULL e wa_conversation_bucket carimba 'closed' -- mesmo com a conversa 'active'.
-- Na tela: chip "Ativa" no cabecalho, conversa na aba "Encerrados", chip
-- "Sem atendimento" e botao "Reabrir" habilitado num chat que estava em
-- atendimento com outra pessoa. useAttendanceStatus le a tabela direto e cai no
-- mesmo RLS, por isso o cabecalho e a lista erram juntos.
--
-- Por que a conversa ficou sem setor:
--   * fn_clear_conversation_assigned_on_close zera department_id a cada
--     encerramento de atendimento;
--   * fn_auto_assign_dept_by_instance e sync_conversation_department desistem
--     quando a URA esta ligada e a instancia nao tem skip_ura -- o caso da CTM;
--   * sync_attendance_department copia setor SO no sentido conversa -> atendimento.
--     O caminho de volta nao existia.
--
-- Efeito colateral silencioso do mesmo buraco: fn_assign_conversation_if_ready
-- retorna 'no_department' quando a conversa esta sem setor. Atendimento novo
-- nessas conversas nunca chegava a ser distribuido.
--
-- Correcao: espelhar setor e dono do atendimento ATIVO na conversa, mas SO nos
-- campos que estao NULL. Nunca sobrescreve valor existente -- em transferencia
-- quem manda continua sendo a conversa.

CREATE OR REPLACE FUNCTION public.fn_mirror_attendance_to_conversation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Grupo nao tem setor por design (fn_group_conversation_department,
  -- sync_conversation_department e fn_restore_conv_assigned_on_reopen todos
  -- pulam grupo). Aqui tambem.
  UPDATE public.whatsapp_conversations c
  SET department_id = COALESCE(c.department_id, NEW.department_id),
      assigned_to   = COALESCE(c.assigned_to,   NEW.assigned_to),
      updated_at    = now()
  WHERE c.id = NEW.conversation_id
    AND COALESCE(c.is_group, false) = false
    -- Sem este guard o UPDATE roda a cada evento de atendimento sem mudar nada.
    -- whatsapp_conversations esta na publication supabase_realtime: UPDATE a toa
    -- e WAL + fanout para todo browser aberto no tenant.
    AND (
         (c.department_id IS NULL AND NEW.department_id IS NOT NULL)
      OR (c.assigned_to   IS NULL AND NEW.assigned_to   IS NOT NULL)
    );

  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.fn_mirror_attendance_to_conversation() IS
  'Espelha setor e dono do atendimento ATIVO na conversa quando a conversa esta '
  'sem eles. So preenche NULL -- nunca sobrescreve. Existe para as duas policies '
  'de SELECT (whatsapp_conversations x support_attendances) enxergarem o mesmo '
  'conjunto: com a conversa sem setor e o atendimento com setor, o bucket da '
  'lista virava closed para quem nao e do setor do dono (CTM, 11/08/2026).';

DROP TRIGGER IF EXISTS trg_c_mirror_attendance_to_conv ON public.support_attendances;

-- O nome importa: Postgres dispara triggers da mesma tabela e do mesmo momento
-- em ordem ALFABETICA. Este tem que rodar
--   depois de trg_a_reroute_dept_on_customer_att (que ja acerta os dois lados)
--   e ANTES de trg_dispatch_on_attendance_insert / _reopen, senao
--   fn_assign_conversation_if_ready ainda ve a conversa sem setor e sai em
--   'no_department'. "trg_c..." fica entre os dois.
CREATE TRIGGER trg_c_mirror_attendance_to_conv
  AFTER INSERT OR UPDATE OF status, department_id, assigned_to
  ON public.support_attendances
  FOR EACH ROW
  WHEN (
    NEW.conversation_id IS NOT NULL
    AND NEW.status IN ('waiting', 'in_progress')
    AND COALESCE(NEW.is_group, false) = false
    AND (NEW.department_id IS NOT NULL OR NEW.assigned_to IS NOT NULL)
  )
  EXECUTE FUNCTION public.fn_mirror_attendance_to_conversation();

-- Nota sobre recursao e distribuicao, medido na leitura das triggers de
-- whatsapp_conversations:
--   * trg_dispatch_on_department_change dispara com o setor recem-preenchido e
--     chama fn_assign_conversation_if_ready. Quando o atendimento TEM dono, o
--     UPDATE acima ja gravou assigned_to na MESMA instrucao, entao a funcao sai
--     em 'already_assigned' e ninguem rouba o chat. Quando NAO tem dono
--     (waiting na fila), distribuir e exatamente o comportamento desejado -- e o
--     que hoje nao acontece por causa do 'no_department'.
--   * trg_auto_department_on_assign so deriva setor pelo funcionario quando
--     department_id NAO muda na mesma instrucao. Como mudamos os dois juntos,
--     ele nao sobrescreve o setor do atendimento.
--   * trg_sync_conversation_department e trg_auto_dept_by_instance so agem com
--     department_id NULL; depois deste UPDATE nao ha o que fazer.
--   * O caminho de volta (fn_assign_conversation_if_ready escreve o atendimento)
--     dispara esta trigger de novo, mas ai a conversa ja tem setor e dono: o
--     WHERE nao casa, nenhum UPDATE sai e a recursao morre no segundo passe.

-- ---------------------------------------------------------------------------
-- BACKFILL -- conversas vivas hoje com o par divergente.
--
-- Restrito ao mesmo criterio da trigger: so preenche NULL, so 1:1, so onde
-- existe atendimento ATIVO. Conversa encerrada fica como esta (o bucket dela ja
-- e 'closed' para todo mundo, nao ha assimetria a corrigir).
--
-- MEDIR ANTES DE RODAR -- trocar UPDATE por SELECT count(*) com o mesmo WHERE.
-- Cada linha aqui e um UPDATE em tabela da publication supabase_realtime.
-- ---------------------------------------------------------------------------
-- CTE, e nao "UPDATE ... FROM LATERAL (... WHERE s.conversation_id = c.id)":
-- em UPDATE, a tabela alvo nao pode ser referenciada de dentro da FROM-list
-- ("invalid reference to FROM-clause entry for table c"). O LATERAL fica dentro
-- da CTE, onde a conversa e so mais uma tabela da query.
WITH alvo AS (
  SELECT c.id,
         COALESCE(c.department_id, sa.department_id) AS dept,
         COALESCE(c.assigned_to,   sa.assigned_to)   AS dono
  FROM public.whatsapp_conversations c
  JOIN LATERAL (
    SELECT s.department_id, s.assigned_to
    FROM public.support_attendances s
    WHERE s.conversation_id = c.id
      AND s.tenant_id       = c.tenant_id
      AND s.status IN ('waiting', 'in_progress')
    ORDER BY s.opened_at DESC NULLS LAST, s.created_at DESC
    LIMIT 1
  ) sa ON true
  WHERE COALESCE(c.is_group, false) = false
    AND (
         (c.department_id IS NULL AND sa.department_id IS NOT NULL)
      OR (c.assigned_to   IS NULL AND sa.assigned_to   IS NOT NULL)
    )
)
UPDATE public.whatsapp_conversations c
SET department_id = a.dept,
    assigned_to   = a.dono,
    updated_at    = now()
FROM alvo a
WHERE a.id = c.id;
