-- =============================================================================
-- Custo do WhatsApp Oficial (Meta) — fase 1b: configuração por tenant
--
-- configuracoes (1 linha por tenant, índice único configuracoes_tenant_unique):
--   meta_compose_mode              modo do compositor nas instâncias Meta
--   meta_compose_group_seconds     janela do modo 'agrupar'
--   meta_price_per_message_brl     preço por mensagem cobrada (R$)
--   meta_free_messages_per_number  franquia mensal por número
--
-- Defaults constantes: no PG 17 o ADD COLUMN não reescreve a tabela; os CHECKs
-- validam as 15 linhas existentes (instantâneo). Transação própria — ver 1a.
-- =============================================================================

begin;
set local lock_timeout = '5s';

alter table public.configuracoes
  add column if not exists meta_compose_mode text not null default 'agrupar'
    check (meta_compose_mode in ('agrupar','enter_quebra_linha','alerta','desligado')),
  add column if not exists meta_compose_group_seconds smallint not null default 4
    check (meta_compose_group_seconds between 2 and 15),
  add column if not exists meta_price_per_message_brl numeric(10,4) not null default 0.035
    check (meta_price_per_message_brl >= 0),
  add column if not exists meta_free_messages_per_number integer not null default 1000
    check (meta_free_messages_per_number >= 0);

commit;
