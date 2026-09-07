-- Pausa automática da inatividade (DEM-0353) — Bloco 3 de 3: o gatilho.
--
-- Arquivo separado de propósito: CREATE TRIGGER pega ACCESS EXCLUSIVE em
-- whatsapp_messages (837k linhas, a tabela mais escrita do sistema, e ainda por
-- cima publicada no supabase_realtime). Junto com o ALTER do bloco 1 na mesma
-- transação, isso deadlocka. Aplicar sozinho e fora de pico.
--
-- Este é o último passo: até aqui nada dispara. Mesmo depois dele o
-- comportamento não muda enquanto support_inactivity_autohold_enabled for
-- false nos 14 tenants (padrão do bloco 1).
--
-- ─── Por que a cláusula WHEN é uma ALLOWLIST ─────────────────────────────────
-- Medido em produção, mensagens de saída em 7 dias:
--   sent_by_user_id NOT NULL ..................... 27.803  atendente pelo app
--   metadata->>'source' = 'self_hosted' ..........    905  atendente pelo CELULAR
--   resto (7.755) ................................ TUDO automático:
--     ura (2.300) · welcome (704) · csat (1.214) · business_hours (181) ·
--     auto (435) · billing_automation (83) · automation (24) · watchdog (107)
--
-- Blocklist ("tudo menos system/ura/csat/...") seria frágil na direção errada:
-- uma automação NOVA criada depois, sem nenhuma dessas chaves, entraria sozinha
-- na detecção. Se ela tivesse "aguarde" no texto — e a mensagem de fora de
-- expediente e a da URA costumam ter — congelaria a régua do tenant inteiro
-- para sempre. Com allowlist, automação nova fica de fora por construção.
--
-- LIMITE CONHECIDO: 'self_hosted' é a marca do provider Evolution. Resposta
-- pelo celular via Z-API não é alcançada, e a Meta Cloud API não tem celular.
-- Mesma cegueira que first_human_response_at já tem hoje.

SET LOCAL lock_timeout = '3s';

DROP TRIGGER IF EXISTS trg_inactivity_autohold ON public.whatsapp_messages;

CREATE TRIGGER trg_inactivity_autohold
AFTER INSERT ON public.whatsapp_messages
FOR EACH ROW
WHEN (
  NEW.is_from_me = true
  AND NEW.message_type = 'text'
  AND COALESCE(NEW.metadata->>'system', '') <> 'true'
  AND (NEW.sent_by_user_id IS NOT NULL OR NEW.metadata->>'source' = 'self_hosted')
)
EXECUTE FUNCTION public.fn_inactivity_autohold_on_agent_message();

COMMENT ON TRIGGER trg_inactivity_autohold ON public.whatsapp_messages IS
  'DEM-0353: mensagem do atendente pedindo para aguardar suspende a régua de inatividade do cliente.';
