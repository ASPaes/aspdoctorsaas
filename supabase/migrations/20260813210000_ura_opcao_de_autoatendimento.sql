-- URA: opção que responde e volta pro menu, sem acionar atendente
--
-- Hoje toda opção da URA roteia para um setor e cai na fila de um humano.
-- Esta migration abre o segundo tipo de opção: "responder e voltar ao menu"
-- (ex.: Indique e ganhe — manda o link e encerra sozinha se o cliente sumir).
--
-- Só schema e travas. O motor (_shared/message-processor.ts), o encerramento
-- por silêncio (check-inactivity-timeout) e a tela vêm nos passos seguintes.

BEGIN;

-- Toda a migration é ALTER em tabela quente (support_attendances tem 25 mil
-- linhas e é lida pela fila a cada poucos segundos). Sem lock_timeout, um
-- ALTER que fica na fila do lock trava TODO leitor atrás dele.
-- SET (e não SET LOCAL) para o limite valer também quando este arquivo roda
-- por fora de uma transação explícita, como no apply_migration.
SET lock_timeout = '3s';

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Configuração da opção, no próprio setor
-- ─────────────────────────────────────────────────────────────────────────────
-- O menu da URA já sai de support_departments (ura_option_number + show_in_ura
-- + ura_label). A opção de autoatendimento é mais uma linha dessa mesma lista,
-- então a configuração mora aqui — não numa tabela nova que a tela teria de
-- juntar com esta na hora de montar o menu.

ALTER TABLE public.support_departments
  ADD COLUMN IF NOT EXISTS ura_action             text NOT NULL DEFAULT 'route',
  ADD COLUMN IF NOT EXISTS ura_auto_reply_message text,
  ADD COLUMN IF NOT EXISTS ura_auto_close_minutes integer,
  ADD COLUMN IF NOT EXISTS ura_auto_close_message text;

COMMENT ON COLUMN public.support_departments.ura_action IS
  'route = confirma e joga na fila do setor (comportamento de sempre). auto_reply = manda ura_auto_reply_message, não aciona ninguém e devolve o cliente pro menu.';
COMMENT ON COLUMN public.support_departments.ura_auto_reply_message IS
  'auto_reply: mensagem enviada ao cliente que escolhe a opção (ex.: o link do Indique).';
COMMENT ON COLUMN public.support_departments.ura_auto_close_minutes IS
  'auto_reply: minutos de silêncio até encerrar sozinho. NULL = 3. O corte real cai entre este valor e +2 min, porque quem encerra é um cron de 2 em 2 minutos.';
COMMENT ON COLUMN public.support_departments.ura_auto_close_message IS
  'auto_reply: mensagem de encerramento por silêncio (o agradecimento).';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.support_departments'::regclass
      AND conname  = 'chk_support_departments_ura_action'
  ) THEN
    ALTER TABLE public.support_departments
      ADD CONSTRAINT chk_support_departments_ura_action
      CHECK (ura_action IN ('route', 'auto_reply'));
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Trava #1: o CHECK de closed_reason
-- ─────────────────────────────────────────────────────────────────────────────
-- O CHECK aceitava só manual / inactivity / csat_timeout / system. Qualquer
-- outro motivo faz o UPDATE inteiro falhar — e o código não confere o erro, o
-- que transforma a falha em silêncio.
--
-- Medido em produção antes desta migration:
--   · 'ura_encerrado'  → 0 linhas em toda a tabela, apesar de 25 clientes terem
--     digitado "0" nos últimos 30 dias. Quem digita 0 recebe "Atendimento
--     encerrado com sucesso", a CONVERSA fecha, mas o ATENDIMENTO continua
--     'waiting' na fila até a inatividade fechar horas depois.
--   · 'csat_completed' → 0 linhas, pelo mesmo motivo (4 pontos de escrita).
--
-- 'ura_autoatendimento' é o motivo novo, da opção que responde e volta.
ALTER TABLE public.support_attendances
  DROP CONSTRAINT IF EXISTS support_attendances_closed_reason_check;

ALTER TABLE public.support_attendances
  ADD CONSTRAINT support_attendances_closed_reason_check
  CHECK (
    closed_reason IS NULL
    OR closed_reason = ANY (ARRAY[
      'manual', 'inactivity', 'system',
      'csat_timeout', 'csat_completed',
      'ura_encerrado', 'ura_autoatendimento'
    ])
  ) NOT VALID;

-- O conjunto novo contém o antigo, então nenhuma linha existente reprova.
-- VALIDATE em passo separado: pega SHARE UPDATE EXCLUSIVE, que não bloqueia
-- leitura nem escrita da fila.
ALTER TABLE public.support_attendances
  VALIDATE CONSTRAINT support_attendances_closed_reason_check;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Trava #2: fn_block_close_without_cliente
-- ─────────────────────────────────────────────────────────────────────────────
-- A guarda existe para o operador humano não encerrar sem vincular o cliente.
-- Fechamento automático não tem operador para avisar: se ela barra, o
-- atendimento simplesmente não fecha. E quem indica costuma ser lead novo, sem
-- cliente_id — cairia direto na trava.
--
-- Baseada na definição de produção lida em 13/08/2026
-- (md5 6ceac505327dce10e394a96714d17512). Única mudança: a lista de motivos
-- automáticos que passam direto.
CREATE OR REPLACE FUNCTION public.fn_block_close_without_cliente()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_phone text;
  v_count int;
BEGIN
  -- Bloqueia APENAS encerramento manual de operador humano sem cliente vinculado.
  -- Fechamentos automáticos passam direto: não há ninguém na tela para vincular
  -- o cliente, e barrar aqui deixa o atendimento preso na fila.
  IF NEW.status = 'closed'
     AND OLD.status IS DISTINCT FROM 'closed'
     AND NEW.cliente_id IS NULL
     AND COALESCE(NEW.closed_reason, '') NOT IN (
           'inactivity', 'system',
           'csat_timeout', 'csat_completed',
           'ura_encerrado', 'ura_autoatendimento'
         )
     AND COALESCE(NEW.closure_type, '') NOT IN ('inactivity_auto')
  THEN
    SELECT wc.phone_number INTO v_phone
    FROM public.whatsapp_contacts wc
    WHERE wc.id = NEW.contact_id;

    IF v_phone IS NOT NULL AND length(regexp_replace(v_phone, '\D', '', 'g')) >= 10 THEN
      SELECT count(*) INTO v_count
      FROM public.get_clientes_candidatos_by_phone(NEW.tenant_id, v_phone);
      IF v_count >= 1 THEN
        RAISE EXCEPTION
          'É necessário vincular um cliente antes de encerrar este atendimento. Encontramos % cliente(s) compatível(eis) com o telefone do contato.',
          v_count USING ERRCODE = 'P0001';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

COMMIT;
