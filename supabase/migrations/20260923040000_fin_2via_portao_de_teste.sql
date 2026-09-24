-- =============================================================================
-- 2ª via no chat — o portão que impede o robô de falar com cliente.
--
-- Regra do Alexandre, dada em 23/09/2026: nenhuma automação fala com cliente
-- antes de ele testar no próprio WhatsApp, fazendo o papel de cliente. E a
-- regra não pode depender de alguém lembrar dela: quem tem de impedir é o
-- código.
--
-- Por isso a function nasce publicada e MUDA: com `fin_2via_liberado = false`
-- e a lista de telefones vazia, ela não alcança ninguém. Entra o número do
-- Alexandre na lista, ele testa, e só então a chave vira.
--
-- Depois de liberado, a lista deixa de filtrar (serve só de histórico de quem
-- testou). Desligar a chave volta tudo para o modo teste na hora, sem deploy:
-- é o freio de mão se algo sair errado com cliente de verdade.
-- =============================================================================

alter table public.configuracoes
  add column if not exists fin_2via_liberado boolean not null default false,
  add column if not exists fin_2via_telefones_teste text[] not null default '{}'::text[];

comment on column public.configuracoes.fin_2via_liberado is
  'Libera a 2ª via automática no chat para TODOS os clientes deste tenant. Padrão false: enquanto estiver false, só os números em fin_2via_telefones_teste recebem resposta automática. É também o freio de mão: virar para false para o robô parar na hora, sem deploy.';

comment on column public.configuracoes.fin_2via_telefones_teste is
  'Telefones que recebem a 2ª via automática enquanto ela não está liberada. Só dígitos, com DDI (ex.: 5545999998888). Comparação pelos últimos 10 dígitos, que é o que sobrevive ao nono dígito do celular.';
