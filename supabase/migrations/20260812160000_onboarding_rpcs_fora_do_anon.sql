-- Tirar as RPCs de escrita do onboarding do alcance de quem não fez login (12/08/2026).
--
-- Medido: com role `anon` e apenas o UUID da jornada, `cancel_onboarding_journey`
-- devolveu {"ok": true} e cancelou uma jornada real. A guarda interna
-- (`can_access_tenant_row`) não barra anon, e a chave anon é pública por design.
-- Eram 8 RPCs de escrita executáveis sem autenticação nenhuma.
--
-- Seguro: as 8 já têm grant EXPLÍCITO para authenticated e service_role
-- (`authenticated=X/postgres | service_role=X/postgres`), então o app e as edge
-- functions não dependem do grant de PUBLIC. Conferido antes de revogar.
--
-- Fora desta lista de propósito: validate_access_invite (o convite é validado ANTES
-- do login), check_tipo_horario e remind_ai_disabled.

REVOKE EXECUTE ON FUNCTION public.cancel_onboarding_journey(uuid, text)               FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.create_onboarding_journey(uuid, uuid, text, bigint, timestamptz, date, uuid, text, uuid, bigint, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.move_onboarding_stage(uuid, uuid, uuid[], boolean)  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.pause_onboarding(uuid, uuid, text)                  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.resume_onboarding(uuid)                             FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.reopen_onboarding_journey(uuid)                     FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.return_to_vendor(uuid, uuid, uuid, text, boolean)   FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.resolve_vendor_return(uuid)                         FROM PUBLIC, anon;
