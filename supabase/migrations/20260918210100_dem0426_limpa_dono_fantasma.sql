-- DEM-0426 (bloco 2 de 2): solta as conversas que ficaram com dono fantasma.
-- Rodar DEPOIS de 20260918210000 (senao o proximo encerramento cria outros).
--
-- Criterio fechado, so o padrao provado: a ultima atribuicao da conversa foi
-- 'auto', no mesmo segundo (+-2s) de um encerramento, para quem ainda e o dono,
-- e esse dono nao tem atendimento vivo na conversa.
--
-- Medido em 18/09/2026: 60 conversas.
--   - 3 ativas com atendimento na fila (Digi Office, a mais antiga de 09/09):
--     o retry-waiting-conversations distribui no minuto seguinte, se o setor
--     estiver no expediente.
--   - 57 encerradas (37 Digi Office, 20 ASP): travariam no proximo contato.
--
-- Mexe so em assigned_to. Nenhum BEFORE UPDATE de setor muda o setor por isso
-- (trg_auto_set_department_on_assign so age com assigned_to NOT NULL), entao
-- trg_dispatch_on_department_change nao dispara.

UPDATE public.whatsapp_conversations c
   SET assigned_to = NULL,
       updated_at  = now()
  FROM (
    SELECT c2.id
      FROM public.whatsapp_conversations c2
      CROSS JOIN LATERAL (
        SELECT ca.reason, ca.assigned_to, ca.created_at
          FROM public.conversation_assignments ca
         WHERE ca.conversation_id = c2.id
         ORDER BY ca.created_at DESC
         LIMIT 1
      ) l
     WHERE c2.assigned_to IS NOT NULL
       AND COALESCE(c2.is_group, false) = false
       AND l.reason = 'auto'
       AND l.assigned_to = c2.assigned_to
       AND EXISTS (
         SELECT 1 FROM public.support_attendances x
          WHERE x.conversation_id = c2.id
            AND x.closed_at BETWEEN l.created_at - interval '2 seconds'
                                AND l.created_at + interval '2 seconds')
       AND NOT EXISTS (
         SELECT 1 FROM public.support_attendances a
          WHERE a.conversation_id = c2.id
            AND a.status IN ('waiting', 'in_progress')
            AND a.assigned_to = c2.assigned_to)
  ) alvo
 WHERE c.id = alvo.id
RETURNING c.id, c.tenant_id, c.status;
