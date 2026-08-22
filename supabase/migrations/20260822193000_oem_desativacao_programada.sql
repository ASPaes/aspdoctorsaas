-- ============================================================================
-- Desativação já programada no OEM — a data que o portal do parceiro mostra
-- como "Desativa em: 31/08/2026"
--
-- POR QUE ESTA COLUNA EXISTE
-- Cancelar no OEM não desliga a licença na hora: o portal agenda a baixa para
-- o último dia do mês e só depois o status vira "Desativado". No meio disso a
-- aba Divergências acusava "Licença OEM ativa de cliente cancelado no DS" —
-- grave, em vermelho, com o custo do lado — para um cancelamento que já tinha
-- sido feito certo dos dois lados.
--
-- Medido em 22/08/2026: os 13 alertas desse tipo tinham TODOS baixa marcada
-- para 31/08/2026. O alarme errava 100% das vezes, e alarme que sempre erra
-- treina a ignorar a tela.
--
-- DE ONDE VEM A DATA (medido chamando as três rotas do OEM em 22/08/2026, não
-- suposto)
--   listagem minhaslicencas ............. só `ativo: true`. Não tem a data.
--   pdvlegal /v1/licenciamento/{e}/{f} ... `status: "AT"`. Não tem a data.
--   minhaslicencas/modulos/{p}/{e}/{f} ... `datavalidade` em cada módulo ativo.
--                                          É a ÚNICA fonte da data.
--
-- E ela já estava aqui: o `oem-sync-passo` copia o módulo inteiro, então
-- `oem_espelho_filial.modulos[].datavalidade` já trazia o dado. Nenhuma rota
-- nova do parceiro é necessária. A coluna só materializa o que custaria varrer
-- um jsonb de 2.500 filiais a cada render da tela.
--
-- QUE A DATA SIGNIFICA ALGO TAMBÉM FOI MEDIDO, na base inteira:
--   855 filiais ativas -> 807 sem datavalidade nenhuma (licença normal não tem
--   data), 24 com 31/08/2026 (as programadas) e o resto com data no passado.
--   Nas desativadas, a data é o mês em que caíram.
--   Ou seja: campo preenchido em licença ATIVA = baixa marcada, não ruído.
--
-- A COLUNA NÃO SILENCIA NADA SOZINHA. Quem decide é a tela, comparando com
-- hoje:
--   data no futuro  -> baixa combinada, não é divergência;
--   data no passado com a licença ainda ativa -> alguém reativou no OEM e o
--   DoctorSaaS não sabe, e o alerta volta sozinho no dia 1º.
-- Guardar a data crua (e não um booleano "está ok") é o que faz o alerta
-- voltar sem ninguém precisar rodar nada.
-- ============================================================================

begin;

alter table public.oem_espelho_filial
  add column if not exists desativa_em date;

alter table public.reconciliacao_oem
  add column if not exists desativa_em date;

comment on column public.oem_espelho_filial.desativa_em is
  'Data em que o OEM vai desativar a licença, quando já está programada: a maior datavalidade entre os módulos ATIVOS. Null = sem baixa marcada (o normal de quem está em dia).';
comment on column public.reconciliacao_oem.desativa_em is
  'Cópia de oem_espelho_filial.desativa_em no momento da conferência. A aba Divergências compara com hoje: futuro = baixa combinada, passado com licença ativa = reativaram no OEM.';

commit;

-- ---------------------------------------------------------------------------
-- CONFERÊNCIA (só leitura), depois de rodar "Atualizar espelho" uma vez —
-- quem preenche a coluna é a edge function, não esta migration:
--
--   select status,
--          case when desativa_em is null then '(sem baixa marcada)'
--               when desativa_em >= current_date then 'baixa marcada: ' || desativa_em
--               else 'venceu e continua ativa: ' || desativa_em end as situacao,
--          count(*)
--     from public.oem_espelho_filial
--    group by 1, 2 order by 3 desc;
-- ---------------------------------------------------------------------------
