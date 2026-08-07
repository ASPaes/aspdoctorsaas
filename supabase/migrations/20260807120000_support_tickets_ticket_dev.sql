-- Campo "Ticket Dev": código/identificador da demanda no DoctorDev associada ao ticket.
-- Texto livre, opcional. Quando preenchido, aparece no card da lista de tickets.

-- 1) Coluna
ALTER TABLE public.support_tickets
  ADD COLUMN IF NOT EXISTS ticket_dev text;

COMMENT ON COLUMN public.support_tickets.ticket_dev IS
  'Identificador da demanda no DoctorDev vinculada a este ticket. Texto livre, opcional.';

-- 2) Liberar o campo na whitelist de update_ticket_fields.
--    Sem isso a RPC ignora o campo em SILÊNCIO (CONTINUE no loop) e a UI mostra
--    "Ticket atualizado" sem ter gravado nada.
--    Patch sobre a definição VIVA em vez de CREATE OR REPLACE do corpo inteiro:
--    o repo não é fonte de verdade das funções, então reescrever cegamente poderia
--    reverter uma versão mais nova que exista só em produção.
DO $do$
DECLARE
  v_def text;
  v_hits int;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'update_ticket_fields'
    AND p.pronargs = 2;

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'update_ticket_fields(uuid, jsonb) não encontrada';
  END IF;

  IF v_def LIKE '%''ticket_dev''%' THEN
    RAISE NOTICE 'ticket_dev já está na whitelist — nada a fazer';
    RETURN;
  END IF;

  -- A âncora precisa ser inequívoca: 'rotulo' só pode aparecer no array de campos.
  v_hits := (length(v_def) - length(replace(v_def, '''rotulo''', ''))) / length('''rotulo''');
  IF v_hits <> 1 THEN
    RAISE EXCEPTION 'Âncora ambígua: ''rotulo'' aparece % vez(es) na definição', v_hits;
  END IF;

  v_def := replace(v_def, '''rotulo''', '''rotulo'', ''ticket_dev''');
  EXECUTE v_def;
END
$do$;

-- 3) Verificação
DO $do$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'support_tickets' AND column_name = 'ticket_dev'
  ) THEN
    RAISE EXCEPTION 'FALHOU: coluna ticket_dev não existe';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'update_ticket_fields'
      AND pg_get_functiondef(p.oid) LIKE '%''ticket_dev''%'
  ) THEN
    RAISE EXCEPTION 'FALHOU: ticket_dev não entrou na whitelist de update_ticket_fields';
  END IF;

  RAISE NOTICE 'OK: coluna criada e campo liberado na RPC';
END
$do$;
