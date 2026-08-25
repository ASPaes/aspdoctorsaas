-- 1º contato: a mensagem tem que ser de quem era responsável NA HORA de enviá-la.
--
-- A versão anterior casava com o responsável ATUAL (`responsavel_user_id`). Em jornada
-- transferida — 71 de 162 — quem falou primeiro com o cliente foi o pessoal do
-- onboarding, não quem está com ela hoje. Medido em 25/08/2026: 7 jornadas apareciam
-- como "sem contato" apesar de o responsável original ter falado, e a média inflava de
-- 4.102 para 7.417 minutos (+81%), porque media a mensagem do implantador dias depois.
--
-- É a mesma régua de vw_onboarding_stage_attribution: onboarding_responsavel_history
-- vigente no instante do evento.
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
         -- fn_onb_util_min devolve 0 (nao NULL) quando o fim e NULL. Sem este CASE,
         -- jornada que NUNCA teve contato entraria na media como "contato em 0 min".
         CASE WHEN fc.primeiro_contato_em IS NULL THEN NULL
              ELSE fn_onb_util_min(b.distribuido_em, fc.primeiro_contato_em, b.tenant_id, b.sla_dept_onb_id)
         END AS minutos_uteis
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
         AND m."timestamp" >= b.distribuido_em
         AND m.sent_by_user_id = (
               SELECT rh.user_id FROM onboarding_responsavel_history rh
                WHERE rh.journey_id = b.journey_id
                  AND rh.de <= m."timestamp"
                  AND (rh.ate IS NULL OR rh.ate > m."timestamp")
                ORDER BY rh.de DESC LIMIT 1)
    ) fc ON true;
$fn$;

COMMENT ON FUNCTION public.get_onboarding_first_contact(uuid) IS
'Tempo entre a distribuicao da jornada e a 1a mensagem ao cliente enviada por quem era responsavel NAQUELE INSTANTE (mesma regua de vw_onboarding_stage_attribution). SECURITY DEFINER porque whatsapp_messages_select limita o usuario comum as conversas do proprio setor - sem isso o indicador mudaria conforme quem abre a tela. Expoe so carimbos de tempo, do cliente da propria jornada. Guarda de tenant explicita.';

REVOKE ALL ON FUNCTION public.get_onboarding_first_contact(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_onboarding_first_contact(uuid) TO authenticated, service_role;
