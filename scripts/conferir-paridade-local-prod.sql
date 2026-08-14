-- Paridade local × produção: prova que o refresh deixou o local IGUAL ao remoto.
--
-- Criado em 13/08/2026, depois de o local ter ficado atrasado sem ninguém perceber
-- (fn_assign_conversation_if_ready com o ramo "multi-setor" de antes de 06/08 e
-- fn_track_awaiting_agent sem a guarda de 11/08). Gerar migration a partir de um
-- local assim reverte correção em produção em silêncio.
--
-- Como usar: rode este arquivo NOS DOIS bancos e compare os md5 linha a linha.
--
--   docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f - < scripts/conferir-paridade-local-prod.sql
--
-- e a mesma query em produção (Supabase MCP / SQL Editor). Qualquer md5 diferente
-- significa que o local NÃO é cópia fiel — não escreva migration a partir dele.
SELECT p.proname AS funcao,
       md5(pg_get_functiondef(p.oid)) AS corpo_md5
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND p.proname IN (
     -- motor de atendimento
     'fn_assign_conversation_if_ready',
     'fn_track_awaiting_agent',
     'get_message_notification_recipients_v2',
     'process_notification_dispatch_queue',
     'fn_notify_user',
     'fn_notify_awaiting_agent',
     'fn_notify_ticket_responsavel',
     'fn_notify_journey_responsavel',
     -- onboarding
     'move_onboarding_stage',
     'create_onboarding_journey',
     'conclude_onboarding_journey',
     -- MRR
     'fn_mrr_cliente_em',
     'get_mrr_bridge',
     'aplicar_reajuste'
   )
 ORDER BY p.proname;
