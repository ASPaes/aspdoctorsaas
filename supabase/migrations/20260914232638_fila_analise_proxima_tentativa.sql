-- Fila de analise de atendimento: nada se perde quando o provedor de IA falha.
--
-- Antes: o cron roda a cada 2 min e desistia na 3a falha. Uma queda de 6 minutos
-- -- ou o cliente ficar sem credito e colocar 20 minutos depois -- apagava a
-- analise para sempre (375 em 14/09/2026).
--
-- next_attempt_at: o process-finalize-queue so pega o item com a hora vencida.
-- Falha do provedor (sem credito, chave recusada, limite de requisicoes, fora do
-- ar) reagenda sem gastar tentativa, por ate 7 dias. As 3 tentativas ficam para
-- erro do proprio item, com espera entre elas.
--
-- Coluna nullable sem default: ALTER instantaneo, sem reescrever a tabela.
-- NULL = pode tentar ja (todo item existente continua elegivel como hoje).

ALTER TABLE public.attendance_analysis_queue
  ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz;

-- Religar a IA re-enfileira os itens do tenant. Sem zerar next_attempt_at, o
-- item reativado ficaria esperando o reagendamento antigo vencer.
CREATE OR REPLACE FUNCTION public.requeue_on_ai_reactivation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.is_active = true AND OLD.is_active = false THEN
    UPDATE attendance_analysis_queue q
    SET status = 'pending', attempts = 0, last_error = NULL, next_attempt_at = NULL
    FROM support_attendances a
    WHERE a.id = q.attendance_id
      AND a.tenant_id = NEW.tenant_id
      AND (
        q.status = 'error'
        OR (q.status = 'done' AND a.sentiment_at IS NULL)
      );
  END IF;
  RETURN NEW;
END $function$;
