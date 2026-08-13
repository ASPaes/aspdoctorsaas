-- Operador via a conversa encerrada na lista, abria, e o corpo vinha vazio:
-- "Nenhuma mensagem ainda". Admin via o historico inteiro na mesma conversa.
--
-- Causa: o fechamento do atendimento limpa `department_id` e `assigned_to` da
-- conversa (reabertura = roteamento fresh). A policy de SELECT de
-- whatsapp_messages exigia um dos dois preenchidos para quem nao e admin/head,
-- entao toda conversa encerrada ficava sem corpo para o operador.
--
-- whatsapp_conversations_select e support_attendances_select ja tinham o ramo
-- `department_id IS NULL`. whatsapp_messages era a UNICA das tres policies que
-- usam current_user_department_id() sem ele — esquecimento, nao decisao. Era
-- por isso que a conversa aparecia e o conteudo nao.
--
-- Medido em producao em 12/08/2026, antes do fix:
--   - 2.095 de 6.755 conversas nao-grupo com department_id NULL (31%)
--   - operador role=user na conversa do relato: conversa_visivel=1, mensagens=0
--     (a conversa tem 6)
--
-- Depois: mensagens_visiveis=6. Isolamento reconferido — conversa de OUTRO
-- setor com 5 mensagens continua 0 visiveis para o mesmo operador.
--
-- Efeito colateral aceito: o operador tambem passa a ver o conteudo de conversa
-- nova ainda nao roteada (department_id nulo antes da distribuicao). A lista ja
-- mostrava essas conversas com preview da ultima mensagem.
--
-- Os 4 EXISTS viraram 1: como c.id e PK, EXISTS(P AND Q1) OR EXISTS(P AND Q2)
-- equivale a EXISTS(P AND (Q1 OR Q2)) — mesma semantica, um subplan so.
-- Custo medido no maior tenant (ASP, 2.217 conversas): 7,5 ms na abertura da
-- conversa, tudo buffer hit.
--
-- ALTER POLICY e nao DROP+CREATE: atomico, sem janela sem protecao.
-- lock_timeout e obrigatorio — ALTER POLICY pede AccessExclusiveLock numa tabela
-- quente e o lock pendente enfileira todos os SELECTs atras dele. A primeira
-- tentativa sem timeout deu deadlock contra o chat em uso.
DO $$
DECLARE cur_md5 text;
BEGIN
  PERFORM set_config('lock_timeout', '3s', true);

  SELECT md5(pg_get_expr(polqual, polrelid)) INTO cur_md5
  FROM pg_policy
  WHERE polrelid = 'public.whatsapp_messages'::regclass
    AND polname = 'whatsapp_messages_select';

  IF cur_md5 IS DISTINCT FROM '0b85226e88e46fa8433cabb92a2db29a' THEN
    RAISE EXCEPTION 'ABORTADO: whatsapp_messages_select mudou em producao desde a leitura (md5 atual=%)', cur_md5;
  END IF;

  EXECUTE $sql$
    ALTER POLICY whatsapp_messages_select ON public.whatsapp_messages
    USING (
      (SELECT public.is_admin_or_head())
      OR EXISTS (
        SELECT 1
        FROM public.whatsapp_conversations c
        WHERE c.id = whatsapp_messages.conversation_id
          AND c.tenant_id = (SELECT public.current_tenant_id())
          AND (
               c.is_group = true
            OR c.department_id = (SELECT public.current_user_department_id())
            OR c.department_id IS NULL
            OR c.assigned_to = (SELECT auth.uid())
          )
      )
    )
  $sql$;
END $$;
