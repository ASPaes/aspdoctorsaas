-- ============================================================================
-- Fora do horario: liberar para a fila na abertura do setor — 3/3, o cron
-- (06/09/2026)  Ver o arquivo 1/3 para o porque.
--
-- Cadencia */5: a abertura de setor e hora cheia ou meia hora, entao 5 minutos
-- de atraso no pior caso e irrelevante para o cliente e custa 1/5 do
-- `retry-waiting-conversations` (que roda */1). Com a flag desligada em todo
-- mundo — o estado de hoje — cada execucao e uma leitura indexada em
-- support_departments que nao encontra nada.
--
-- cron.schedule com nome que ja existe SUBSTITUI o job, entao reaplicar este
-- arquivo e seguro.
-- ============================================================================
begin;

select cron.schedule(
  'release-off-hours-on-open',
  '*/5 * * * *',
  $$select public.fn_release_off_hours_on_open()$$
);

commit;

-- ----------------------------------------------------------------------------
-- FORA DA TRANSACAO — so aplicar se a medicao pedir.
--
-- Hoje NAO precisa: sao 30 linhas com opened_out_of_hours = true em toda a
-- producao (medido 06/09/2026) e whatsapp_conversations tem ~5k linhas, entao a
-- varredura resolve pelo indice de department_id sem esforco. Se o numero de
-- conversas crescer uma ordem de grandeza, o indice parcial abaixo passa a
-- valer. CREATE INDEX CONCURRENTLY nao roda em transacao: vai por execute_sql,
-- nunca por apply_migration.
--
--   create index concurrently if not exists idx_wa_conv_out_of_hours_dept
--     on public.whatsapp_conversations (department_id)
--     where opened_out_of_hours;
-- ----------------------------------------------------------------------------
