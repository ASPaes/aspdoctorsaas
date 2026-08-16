-- ============================================================================
-- O CNPJ que o OEM manda é o do GRUPO, não o da filial
--
-- Medido em 16/08/2026 no grupo 8201 (Bem Docado), depois de o Alexandre
-- estranhar 38 licenças numa ficha de cliente:
--
--   filiais_do_grupo         23
--   cnpjs_distintos_no_oem    1     <-- 54165179000166 nas 23
--   clientes_distintos          1
--
-- No DoctorSaaS cada loja é um cadastro com CNPJ próprio (BEM DOCADO BOLOS 1,
-- 2, 3, 7, 8, 9, 10...). Só uma delas bate com o CNPJ do grupo, então o
-- casamento por CNPJ jogou as 23 licenças nesse único cadastro.
--
-- A regra do Alexandre — 1 filial = 1 cliente — está certa; o que não dá é
-- desempatar por um campo que o OEM não envia por filial. O sinal de que ele é
-- do grupo sai do próprio espelho: CNPJ que aparece em mais de uma filial não
-- identifica loja nenhuma. Nesses casos o critério passa a ser o NOME, que
-- nesse grupo bate quase um a um (MAIS DOCADO SAPOPEMBA, BEM DOCADO JARDIM,
-- BEM DOCADO SAO RAFAEL, MAIS DOCADO GRIMALDI...).
--
-- POR QUE GRAVAR O CRITÉRIO
-- "Casado" sem dizer por quê é pedir confiança cega. Vínculo achado por nome
-- merece um olhar diferente de vínculo achado por CNPJ, e vínculo vindo do
-- código gravado não é achado — é confirmado. A tela precisa poder dizer isso.
--
-- E a conferência de CNPJ é DESLIGADA quando o CNPJ é de grupo: comparar o do
-- grupo com o do cliente acusaria divergência em toda filial dele — alarme
-- garantido e sempre falso, o mesmo erro que os 994 do nome já custaram.
-- ============================================================================

begin;

alter table public.reconciliacao_oem
  add column if not exists criterio_match text;

comment on column public.reconciliacao_oem.criterio_match is
  'Como o vínculo foi achado: codigo (gravado na ficha, confirmado) · cnpj · nome (CNPJ era do grupo e não desempata).';

create index if not exists idx_recon_oem_criterio
  on public.reconciliacao_oem (conta_integration_id, criterio_match);

commit;

-- ---------------------------------------------------------------------------
-- CONFERÊNCIA (só leitura) — depois de "Atualizar espelho":
--
--   select coalesce(criterio_match,'(sem vinculo)') as criterio,
--          count(*),
--          count(distinct ds_customer_id) as clientes
--     from public.reconciliacao_oem
--    where filial_codigo is not null
--    group by 1 order by 2 desc;
--
--   -- o grupo do caso, que tinha 23 filiais num cliente só:
--   select filial_codigo, razao_oem, razao_ds, criterio_match
--     from public.reconciliacao_oem
--    where empresa_codigo = '8201' order by razao_oem;
-- ---------------------------------------------------------------------------
