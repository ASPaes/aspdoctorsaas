-- Tempo entre a distribuição da jornada e o 1º contato do responsável com o cliente.
CREATE OR REPLACE FUNCTION public.get_onboarding_first_contact(p_tenant_id uuid)
RETURNS TABLE (
  journey_id uuid,
  distribuido_em timestamptz,
  primeiro_contato_em timestamptz,
  minutos_corridos numeric,
  minutos_uteis numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  WITH guard AS (
    SELECT 1 WHERE p_tenant_id = current_tenant_id() OR is_super_admin()
  ),
  base AS (
    SELECT v.journey_id,
           v.tenant_id,
           v.cliente_id,
           v.responsavel_user_id,
           v.sla_dept_onb_id,
           (SELECT min(rh.de)
              FROM onboarding_responsavel_history rh
             WHERE rh.journey_id = v.journey_id) AS distribuido_em
      FROM vw_onboarding_journeys v
     WHERE v.tenant_id = p_tenant_id
       AND v.situacao::text <> 'cancelado'
       AND EXISTS (SELECT 1 FROM guard)
  )
  SELECT b.journey_id,
         b.distribuido_em,
         fc.primeiro_contato_em,
         EXTRACT(epoch FROM (fc.primeiro_contato_em - b.distribuido_em)) / 60 AS minutos_corridos,
         fn_onb_util_min(b.distribuido_em, fc.primeiro_contato_em, b.tenant_id, b.sla_dept_onb_id) AS minutos_uteis
    FROM base b
    LEFT JOIN LATERAL (
      SELECT min(m."timestamp") AS primeiro_contato_em
        FROM whatsapp_contacts ct
        JOIN whatsapp_conversations c
          ON c.tenant_id = ct.tenant_id AND c.contact_id = ct.id
        JOIN whatsapp_messages m
          ON m.tenant_id = c.tenant_id AND m.conversation_id = c.id
       WHERE ct.cliente_id = b.cliente_id
         AND ct.tenant_id = b.tenant_id
         AND m.is_from_me = true
         AND m.sent_by_user_id = b.responsavel_user_id
         AND m."timestamp" >= b.distribuido_em
    ) fc ON true;
$fn$;

COMMENT ON FUNCTION public.get_onboarding_first_contact(uuid) IS
'Tempo entre a distribuicao da jornada e a 1a mensagem que o RESPONSAVEL enviou ao cliente no WhatsApp. SECURITY DEFINER porque whatsapp_messages_select limita o usuario comum as conversas do proprio setor - sem isso o indicador mudaria conforme quem abre a tela. Expoe so carimbos de tempo, nenhum conteudo de mensagem, e so do cliente da propria jornada. Guarda de tenant explicita. Medido em 25/08/2026: 51,8ms para 158 jornadas, plano todo por indice.';

REVOKE ALL ON FUNCTION public.get_onboarding_first_contact(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_onboarding_first_contact(uuid) TO authenticated, service_role;
