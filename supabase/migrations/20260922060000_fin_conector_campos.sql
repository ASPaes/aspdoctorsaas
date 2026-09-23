-- =============================================================================
-- Financeiro — o que o conector precisa guardar.
--
-- 1) O link do boleto do Omie VALE 24 HORAS: ele vem assinado, com `Expires=`
--    dentro da própria URL (medido em 22/09/2026). Guardar o link sem guardar a
--    validade é entregar link quebrado ao cliente no dia seguinte. Então o link
--    passa a ter data de morte, e quem for usar confere antes.
--
-- 2) Cada empresa pode ter mais de uma conta no sistema de origem — a Digi
--    Office tem duas contas no Omie, uma por unidade. O cursor da leitura é
--    POR CONTA, então `fin_sync_estado` ganha um mapa conta -> último título
--    visto. `ultima_leitura_ok` continua uma linha por origem e guarda a leitura
--    MAIS RECENTE entre as contas. Parece o contrário do conservador, e não é:
--    a trava da view é `visto_em >= ultima_leitura_ok`, então quanto mais
--    recente esse carimbo, MAIS título fica de fora. Se uma das contas parar de
--    ser lida, os títulos dela envelhecem e somem da régua sozinhos, que é
--    exatamente o que se quer. Com a leitura mais atrasada, conta parada
--    continuaria cobrando com dado velho.
-- =============================================================================

alter table public.fin_titulos
  add column if not exists link_boleto_expira_em timestamptz,
  add column if not exists numero_boleto text;

comment on column public.fin_titulos.link_boleto_expira_em is
  'Quando o link do boleto deixa de funcionar. O Omie assina a URL com validade de 24 h. Link vencido tem de ser pedido de novo, nunca reenviado.';

alter table public.fin_sync_estado
  add column if not exists cursores jsonb not null default '{}'::jsonb;

comment on column public.fin_sync_estado.cursores is
  'Mapa conta_da_origem -> carimbo do último título lido. Uma empresa pode ter mais de uma conta no mesmo sistema (a Digi Office tem duas no Omie).';
