-- Web Push: colunas de diagnóstico na tabela que JÁ EXISTE.
--
-- ⚠️ `public.push_subscriptions` não é nova. Ela já estava em produção, com
-- `device_label`, `last_used_at`, as FKs para `tenants` e `profiles.user_id` e a
-- policy `push_subs_all_own` — mas **vazia e sem nenhum código a usando**, nem no
-- repositório nem nas 106 functions publicadas. Alguém montou a tabela e parou
-- aí. Por isso esta migration é aditiva: mexer na estrutura existente seria
-- desfazer uma decisão que não é minha, e o que falta para o envio funcionar é
-- só saber por que uma assinatura parou de receber.
--
-- Um registro por APARELHO, e não por pessoa: o mesmo atendente no celular e no
-- computador gera dois endpoints, e os dois precisam receber.

alter table public.push_subscriptions
  add column if not exists last_success_at timestamptz,
  add column if not exists last_error text,
  -- Assinatura morta (404/410) é apagada pela própria função de envio; este
  -- contador é para o caso diferente: o serviço aceita mas o aviso não chega.
  add column if not exists failures integer not null default 0;

comment on table public.push_subscriptions is
  'Aparelhos inscritos para receber aviso de mensagem com o app fechado (Web Push). Um registro por instalação de navegador; o endpoint é a identidade.';

comment on column public.push_subscriptions.last_success_at is
  'Último envio aceito pelo serviço do navegador. Vazio há muito tempo = aparelho provavelmente morto.';
