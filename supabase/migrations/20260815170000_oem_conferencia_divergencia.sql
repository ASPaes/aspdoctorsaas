-- ============================================================================
-- Conferência do OEM — o que deixou de bater depois do vínculo feito
--
-- Decisão do Alexandre em 15/08/2026, escolhendo entre duas leituras da regra
-- "nome, CNPJ, grupo e filial, todos precisam bater":
--
--   NÃO é pré-requisito do vínculo. Exigir os quatro para casar seria circular
--   — os códigos só existem no DoctorSaaS DEPOIS do vínculo, então nada novo
--   casaria nunca e tudo cairia na fila manual.
--
--   É CONFERÊNCIA. Feito o vínculo, o par grupo+filial passa a ser a chave, e a
--   cada sincronização o sistema compara os outros dois campos e aponta o que
--   divergiu. O vínculo continua valendo: divergência é aviso, não desvínculo.
--
-- POR QUE DUAS COLUNAS E NÃO UMA FLAG
-- `divergencias` é text[] porque os dois tipos não valem o mesmo:
--   'cnpj' é sinal FORTE — código apontando para cliente de outro CNPJ é
--          provavelmente vínculo errado, e é o que se olha primeiro.
--   'nome' é sinal FRACO — o OEM guarda nome de loja ("FILIAL 1") e o
--          DoctorSaaS guarda razão social. Divergir é o normal, não a exceção.
-- Uma flag só empilharia os dois e o forte sumiria no meio do fraco.
--
-- `cnpj_ds` existe porque a tabela só guardava o CNPJ do lado do OEM
-- (`cnpj_norm`). Sem o do outro lado a tela mostraria "divergente" sem mostrar
-- contra o quê — e a primeira pergunta de quem confere é exatamente essa.
-- ============================================================================

begin;

alter table public.reconciliacao_oem
  add column if not exists cnpj_ds      text,
  add column if not exists divergencias text[];

comment on column public.reconciliacao_oem.cnpj_ds is
  'CNPJ do cliente no DoctorSaaS, só dígitos. O do OEM é cnpj_norm.';
comment on column public.reconciliacao_oem.divergencias is
  'O que não bate entre os dois lados de um vínculo já feito: {cnpj}, {nome} ou ambos. Null = confere.';

-- A aba de conferência filtra por isto e por mais nada.
create index if not exists idx_recon_oem_divergencias
  on public.reconciliacao_oem (conta_integration_id)
  where divergencias is not null;

commit;

-- ---------------------------------------------------------------------------
-- CONFERÊNCIA (só leitura) — depois de rodar "Atualizar espelho" uma vez,
-- porque quem preenche as colunas é a edge function, não esta migration:
--
--   select coalesce(array_to_string(divergencias, '+'), '(confere)') as situacao,
--          count(*)
--     from public.reconciliacao_oem
--    where ds_customer_id is not null and filial_codigo is not null
--    group by 1 order by 2 desc;
-- ---------------------------------------------------------------------------
