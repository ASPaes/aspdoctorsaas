-- Janela COMERCIAL do tenant, separada da janela de DISPONIBILIDADE
-- (business_hours). A de disponibilidade diz quando tem gente atendendo e é lida
-- por distribuição, mensagem de fora do horário, SLA e inatividade — ela NÃO muda.
-- Esta aqui diz o que está incluso no contrato: fora dela é plantão.
ALTER TABLE public.configuracoes
  ADD COLUMN IF NOT EXISTS horario_comercial jsonb,
  ADD COLUMN IF NOT EXISTS horario_comercial_enabled boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.configuracoes.horario_comercial IS
  'Janela comercial do tenant, mesmo formato de business_hours ({"mon":{"active":true,"slots":[{"start":"08:00","end":"12:00"},...]}}). Base do cálculo de plantão. Nível tenant apenas — sem override por setor.';
COMMENT ON COLUMN public.configuracoes.horario_comercial_enabled IS
  'false => o cálculo de plantão cai em business_hours (comportamento anterior a 25/08/2026).';
