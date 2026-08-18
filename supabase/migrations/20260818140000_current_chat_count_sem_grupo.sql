-- Cracha "2/4" da barra lateral deixa de contar atendimento de GRUPO.
--
-- Decisao do owner (18/08/2026): grupo nao aparece na aba "Atendendo" (a lista
-- e a pill filtram is_group = false; grupo vive na aba Grupos), entao contar
-- grupo no cracha fazia o numero nunca bater com o que esta na tela. Medido no
-- dia: Anderson 4 de 4 em grupo, Renan 4 de 5, Fabricio 2 de 2 — para eles o
-- cracha nunca ia fechar, e F5 nao resolvia porque nao era atraso.
--
-- Por que uma funcao NOVA em vez de mexer na fn_current_chat_count: aquela e o
-- portao de capacidade do motor de distribuicao (fn_dispatch_next_in_queue e
-- fn_assign_conversation_if_ready). Tirar grupo de la destravaria hoje quem
-- esta cheio de grupo — Renan (5/5) e Guilherme (7/5) voltariam a receber da
-- fila na hora. O owner decidiu que grupo CONTINUA ocupando vaga no motor;
-- muda so o que a tela mostra. As duas funcoes medem coisas diferentes de
-- proposito, e e por isso que elas nao podem ser a mesma.
--
-- is_group vem de support_attendances (NOT NULL DEFAULT false). Conferido em
-- 18/08: 1 divergencia contra whatsapp_conversations.is_group em 26.561 linhas,
-- e ela e de julho, closed e sem dono — nao alcanca um contador de in_progress.
CREATE OR REPLACE FUNCTION public.fn_current_chat_count_individual(
  p_user_id uuid,
  p_tenant_id uuid
)
RETURNS integer
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_count INT;
BEGIN
  PERFORM public.assert_tenant_scope(p_tenant_id);
  IF p_user_id IS NULL OR p_tenant_id IS NULL THEN
    RETURN 0;
  END IF;

  SELECT COUNT(*)::INT INTO v_count
  FROM public.support_attendances
  WHERE assigned_to = p_user_id
    AND tenant_id = p_tenant_id
    AND status = 'in_progress'
    AND is_group = false
    AND (scheduled_until IS NULL OR scheduled_until <= now());

  RETURN COALESCE(v_count, 0);
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_current_chat_count_individual(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_current_chat_count_individual(uuid, uuid) TO authenticated, service_role;
