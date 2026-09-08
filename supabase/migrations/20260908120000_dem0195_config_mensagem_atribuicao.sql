-- DEM-0195 (Athuz) — mensagem padrão enviada ao cliente quando o atendimento
-- ganha um dono. Bloco 1 de 3: só a configuração do tenant.
--
-- Três arquivos separados de propósito: o bloco 3 cria trigger em
-- support_attendances (tabela quente, 27 triggers). ALTER de catálogo + trigger
-- em tabela quente na MESMA transação já deadlockou neste banco.
--
-- Desligado por padrão: nenhum tenant muda de comportamento ao aplicar.

ALTER TABLE public.configuracoes
  ADD COLUMN IF NOT EXISTS support_assignment_greeting_enabled boolean NOT NULL DEFAULT false;

ALTER TABLE public.configuracoes
  ADD COLUMN IF NOT EXISTS support_assignment_greeting_template text;

COMMENT ON COLUMN public.configuracoes.support_assignment_greeting_enabled IS
  'DEM-0195: envia a mensagem padrão ao cliente quando o atendimento que ELE iniciou ganha um dono.';

COMMENT ON COLUMN public.configuracoes.support_assignment_greeting_template IS
  'DEM-0195: texto enviado. Placeholders: {nome}, {operador}, {atendimento}, {setor}.';
