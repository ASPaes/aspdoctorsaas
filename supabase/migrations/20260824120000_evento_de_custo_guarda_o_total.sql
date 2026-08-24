-- ============================================================================
-- O vigia de custo do OEM tem um ponto cego: ele só olha o valor UNITÁRIO
--
-- `trg_log_cliente_produto_modulo` só reconhece mudança de preço quando
-- `vlr_custo` muda. Mas quem manda no custo é `vlr_custo_total`: o OEM dá
-- unidade grátis e crédito, e foi por isso que a coluna nasceu em 20/08/2026
-- (`1 × 32,50 · total 0,00`, `3 × 37,86 · total 75,73`, e até total negativo).
--
-- O caso que passava batido: o cliente PERDE a cortesia. O unitário continua
-- 32,50, o total sai de 0,00 e vai para 32,50, o custo dele sobe de verdade
-- e nenhum evento é gravado. Com a regra ratificada em 24/08/2026 (reajuste
-- do OEM não alcança quem já é cliente), este quadro passou a ser o vigia
-- dessa regra — e um vigia cego para o valor que realmente é cobrado não
-- serve.
--
-- Este arquivo faz SÓ as colunas. A função e a view vêm no arquivo seguinte,
-- em outra transação: `cliente_produto_modulo_eventos` é escrita pelo gatilho
-- de `cliente_produto_modulos`, e ALTER na tabela de destino junto com o
-- CREATE OR REPLACE do gatilho que escreve nela é receita de deadlock com a
-- carga do espelho rodando.
-- ============================================================================

begin;

alter table public.cliente_produto_modulo_eventos
  add column if not exists vlr_custo_total          numeric,
  add column if not exists vlr_custo_total_anterior numeric;

comment on column public.cliente_produto_modulo_eventos.vlr_custo_total is
  'Custo TOTAL da linha no momento do evento, do jeito que o parceiro cobra. É a autoridade: o unitário multiplicado pela quantidade mente quando há unidade de cortesia ou crédito.';

comment on column public.cliente_produto_modulo_eventos.vlr_custo_total_anterior is
  'Custo total ANTES do evento. Com vlr_custo_total forma o par "de X para Y" quando o que muda é o valor cobrado, e não o preço por licença.';

commit;

-- ---------------------------------------------------------------------------
-- CONFERÊNCIA (só leitura):
--   select column_name from information_schema.columns
--    where table_name = 'cliente_produto_modulo_eventos'
--      and column_name like 'vlr_custo_total%';
-- ---------------------------------------------------------------------------
