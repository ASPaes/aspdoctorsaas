-- ============================================================================
-- Fora do horario: liberar para a fila na abertura do setor — 1/3, a coluna
-- (06/09/2026)
--
-- Hoje o chat que chega fora do expediente ganha `opened_out_of_hours = true`,
-- um atendimento `waiting` com `created_from = 'out_of_hours'` e o setor da
-- instancia. Ele ja esta na fila em dado; o que o segura na aba "Fora do
-- horario" e so o balde (wa_conversation_bucket poe a flag na frente do
-- waiting).
--
-- Quem tira a flag hoje:
--   1. o cliente escrever de novo DENTRO do expediente (message-processor), ou
--   2. o chat ser ATRIBUIDO a um agente (trg_clear_out_of_hours_on_assign).
--
-- O (2) e automatico para quem tem o motor de distribuicao ligado: o cron
-- `retry-waiting-conversations` roda de minuto em minuto e atribui assim que o
-- expediente abre. Medido em 06/09/2026 em producao — 4 dos 8 tenants com
-- trafego fora do horario estao com o motor DESLIGADO (Athuz 92 chats/30d,
-- Consysa 62, Feax 27, DEMO). Para esses, fn_assign_conversation_if_ready sai
-- na primeira linha com `kill_switch_off` e NADA nunca limpa a flag: o chat
-- fica no laranja ate alguem abrir na mao. E o caso que originou o pedido.
--
-- Por isso a liberacao desta entrega NAO passa por distribuicao: ela so tira a
-- flag e deixa o chat na Fila como `waiting`. Com o motor desligado o operador
-- pega na mao; com o motor ligado o cron de 1 minuto atribui em seguida, igual
-- ja faz hoje.
--
-- Padrao `false` de proposito: quem nao ligar continua exatamente como hoje.
--
-- Este controle NAO substitui `assignment_rules.respect_business_hours`, que
-- decide se o motor distribui fora do expediente. Os dois compoem:
--   respect ligado  + release desligado -> igual a hoje
--   respect ligado  + release ligado    -> a novidade
--   respect desligado + release ligado  -> libera na hora certa em vez de
--                                          depender de quem loga primeiro
-- ============================================================================
begin;

alter table public.support_departments
  add column if not exists off_hours_release_to_queue boolean not null default false;

comment on column public.support_departments.off_hours_release_to_queue is
  'true = o chat que chegou fora do expediente sai da aba "Fora do horario" e cai na Fila quando o setor abre (fn_release_off_hours_on_open). false (padrao) = fica na aba ate alguem abrir, que e o comportamento historico.';

commit;
