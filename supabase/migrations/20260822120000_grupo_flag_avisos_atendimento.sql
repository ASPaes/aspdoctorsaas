-- Flag por tenant: enviar (ou nao) as mensagens automaticas de abertura e
-- encerramento de atendimento dentro dos grupos de WhatsApp.
--
-- Nasce `true` porque hoje 100% dos grupos de todos os tenants recebem esses
-- avisos. Desligar so afeta grupo: conversa 1:1 continua com o comportamento
-- atual, e o CSAT tem o gate proprio (support_csat_enabled).

alter table public.configuracoes
  add column if not exists group_send_attendance_notices boolean not null default true;

comment on column public.configuracoes.group_send_attendance_notices is
  'Grupos: quando false, o atendimento abre e fecha sem as mensagens automaticas "Atendimento X iniciado/encerrado com sucesso" no grupo. Nao afeta conversas 1:1.';
