-- Pausa automática da inatividade quando o atendente pede para aguardar (DEM-0353)
-- Bloco 1 de 3: colunas. Sem lógica, sem trigger — só o lugar onde o estado mora.
--
-- Por que 3 arquivos: ALTER em tabela lida por gatilho (configuracoes) na mesma
-- transação de um CREATE TRIGGER em tabela quente (whatsapp_messages, 837k linhas)
-- deadlocka. Uma transação por recurso.
--
-- Contexto medido em produção, 30 dias (07/09/2026):
--   2.789 atendimentos 1:1 encerrados por inatividade
--     135 (4,8%) tinham um "aguarde" do operador como ÚLTIMA mensagem da conversa
--      41 desses (30,4%) voltaram a falar em até 2h -> encerramento indevido
--   Comparação: os 2.641 que fecharam SEM "aguarde" voltaram em 2h em 20,4%.
-- Ou seja: o efeito existe e é real, mas responde por 41 dos ~581 encerramentos
-- indevidos do mês. O resto é prazo curto no geral, não falta de detecção.

SET LOCAL lock_timeout = '3s';

-- ─── 1. Estado da pausa, no atendimento ──────────────────────────────────────
-- Coluna NOVA em vez de reaproveitar inactivity_hold (booleano manual, NUNCA
-- expira) ou scheduled_until (marcaria o chat como "agendado" na tela e mexeria
-- em capacidade do operador, ordenação da lista e alerta de espera).
ALTER TABLE public.support_attendances
  ADD COLUMN IF NOT EXISTS inactivity_hold_until timestamptz;

ALTER TABLE public.support_attendances
  ADD COLUMN IF NOT EXISTS inactivity_hold_reason text;

COMMENT ON COLUMN public.support_attendances.inactivity_hold_until IS
  'Régua de inatividade do cliente suspensa até este instante. Preenchida pelo '
  'gatilho de "aguarde" do atendente. Ao expirar, o relógio RECOMEÇA daqui — '
  'não de last_activity — senão a pausa acaba e o encerramento cai no ciclo '
  'seguinte sem dar janela nenhuma ao cliente.';

COMMENT ON COLUMN public.support_attendances.inactivity_hold_reason IS
  'Termo que disparou a pausa automática (auditoria). NULL = pausa nunca aplicada.';

-- ─── 2. Configuração por tenant ──────────────────────────────────────────────
-- DESLIGADO por padrão: aplicar este arquivo não muda o comportamento de
-- nenhum dos 14 tenants. Mesmo desenho do bloco de inatividade em grupos.
ALTER TABLE public.configuracoes
  ADD COLUMN IF NOT EXISTS support_inactivity_autohold_enabled boolean NOT NULL DEFAULT false;

ALTER TABLE public.configuracoes
  ADD COLUMN IF NOT EXISTS support_inactivity_autohold_minutes integer NOT NULL DEFAULT 30;

ALTER TABLE public.configuracoes
  ADD COLUMN IF NOT EXISTS support_inactivity_autohold_extra_terms text NOT NULL DEFAULT '';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'configuracoes_autohold_minutes_check'
  ) THEN
    ALTER TABLE public.configuracoes
      ADD CONSTRAINT configuracoes_autohold_minutes_check
      CHECK (support_inactivity_autohold_minutes BETWEEN 1 AND 240);
  END IF;
END $$;

COMMENT ON COLUMN public.configuracoes.support_inactivity_autohold_enabled IS
  'Liga a pausa automática da inatividade quando o atendente pede para aguardar.';

COMMENT ON COLUMN public.configuracoes.support_inactivity_autohold_minutes IS
  'Duração da pausa. Padrão 30: a mediana medida entre o "aguarde" e o '
  'encerramento é 32 min, então pausa menor que isso quase não muda resultado. '
  'Como o relógio recomeça ao fim da pausa, 30 aqui dá ~60 min de folga real.';

COMMENT ON COLUMN public.configuracoes.support_inactivity_autohold_extra_terms IS
  'Termos extras do tenant, separados por vírgula. Casam por SUBSTRING, nunca '
  'como regex: assim ninguém cola um padrão que casa com tudo e congela a '
  'régua do tenant inteiro. Termo com menos de 4 caracteres é ignorado.';
