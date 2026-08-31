-- O código do cadastro na linha da divergência.
--
-- É por ele que a operação identifica cliente ("o 351"), mas a busca só olhava
-- nome e CNPJ: digitar 351 trazia três clientes cujo CNPJ contém 351 e não o
-- cliente 351. Quem procurava concluía que a linha tinha sumido.
alter table public.reconciliacao_hiper
  add column if not exists codigo_sequencial_ds integer;

comment on column public.reconciliacao_hiper.codigo_sequencial_ds is
  'clientes.codigo_sequencial do cliente casado. Só para achar e reconhecer na tela — não entra em nenhuma comparação.';
