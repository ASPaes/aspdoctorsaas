-- DEM-0353, correção: o fechamento não limpava a pausa automática.
--
-- fn_clear_inactivity_hold_on_close já zerava o inactivity_hold (o toggle
-- manual) quando o atendimento fecha, justamente para que uma reabertura não
-- herdasse o hold anterior. Ela foi escrita antes do inactivity_hold_until e
-- não sabe que ele existe.
--
-- Efeito sem esta correção: atendimento que fecha com pausa pendente e depois
-- reabre (trg_zzz_reopen_orfao_para_fila / trg_restore_conv_assigned_on_reopen
-- reaproveitam a linha) volta com a pausa velha de pé. Ele fica invisível para
-- get_inactive_attendances_to_process até a pausa vencer — que é exatamente o
-- problema de "pausa que não expira" que a coluna nova existia para evitar.
--
-- Só o corpo muda. O gatilho continua o mesmo:
--   BEFORE UPDATE OF status ... WHEN (old.status IS DISTINCT FROM new.status)
--
-- Ainda inofensivo hoje: support_inactivity_autohold_enabled é false nos 14
-- tenants, então nenhuma linha tem inactivity_hold_until preenchido. Entra
-- agora porque depois de ligar a flag o resíduo já teria sido criado.
CREATE OR REPLACE FUNCTION public.fn_clear_inactivity_hold_on_close()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status IN ('closed', 'inactive_closed') THEN
    IF COALESCE(NEW.inactivity_hold, false) THEN
      NEW.inactivity_hold := false;
    END IF;

    -- [DEM-0353] A pausa automática morre junto com o atendimento. Reabertura
    -- é roteamento novo: a régua tem que voltar a valer do zero.
    IF NEW.inactivity_hold_until IS NOT NULL THEN
      NEW.inactivity_hold_until := NULL;
    END IF;
    IF NEW.inactivity_hold_reason IS NOT NULL THEN
      NEW.inactivity_hold_reason := NULL;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;
